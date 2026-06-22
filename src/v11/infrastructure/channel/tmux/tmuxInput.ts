import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/** Fallback delay for opencode readiness detection (timeout sentinel). */
export const OPENCODE_READINESS_FALLBACK_DELAY_MS = 600;
export interface SendAndSubmitTmuxPaneMessageOptions {
  requireSuccess?: boolean;
  submitDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
}

export type TmuxPaneMarkerStatus = "submitted" | "stuck_in_input" | "not_found";

export interface ConfirmTmuxPaneMarkerSubmissionInput {
  runner: TmuxRunner;
  targetPane: string;
  marker: string;
  attempts?: number;
  settleDelayMs?: number;
  retryDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
}

async function maybeExitTmuxCopyMode(input: {
  runner: TmuxRunner;
  targetPane: string;
  requireSuccess: boolean;
}): Promise<void> {
  const paneMode = await input.runner(
    ["display-message", "-p", "-t", input.targetPane, "#{pane_in_mode}"],
    { allowFailure: true }
  );
  if (paneMode.exitCode !== 0) {
    if (input.requireSuccess) {
      throw new Error(
        `TMUX_PANE_MODE_CHECK_FAILED: context operation_id=tmux_input_preflight target_pane=${input.targetPane}.`
      );
    }
    return;
  }

  const paneModeValue = Number.parseInt(paneMode.stdout.trim(), 10);
  if (!Number.isFinite(paneModeValue) || paneModeValue <= 0) {
    return;
  }

  const cancelMode = await input.runner(
    ["copy-mode", "-q", "-t", input.targetPane],
    { allowFailure: true }
  );
  if (cancelMode.exitCode !== 0) {
    if (input.requireSuccess) {
      throw new Error(
        `TMUX_COPY_MODE_CANCEL_FAILED: context operation_id=tmux_input_preflight target_pane=${input.targetPane}.`
      );
    }
    return;
  }

  // Let tmux settle after exiting copy mode before sending keys into the pane.
  await sleep(100);
}

/**
 * Send a message to a tmux pane and submit it via Enter.
 *
 * Verified against a real Opencode Code instance: the Enter MUST arrive as a
 * separate tmux `send-keys` command with a brief gap after the text.  Embedding
 * CR/LF in the literal text (`-l "text\r"` or `"text\n"`) does NOT trigger
 * submit in ink-based TUIs — they treat in-band control chars as newlines
 * inside the text editor rather than as submit actions.
 *
 * The pattern matches the proven detect-clear-suffix hook:
 *   tmux send-keys -l "text" && sleep 0.3 && tmux send-keys Enter
 */
export async function sendAndSubmitTmuxPaneMessage(
  runner: TmuxRunner,
  targetPane: string,
  message: string,
  options: SendAndSubmitTmuxPaneMessageOptions = {}
): Promise<void> {
  await maybeExitTmuxCopyMode({
    runner,
    targetPane,
    requireSuccess: options.requireSuccess ?? false
  });
  const writeResult = await runner(
    ["send-keys", "-t", targetPane, "-l", message],
    { allowFailure: true }
  );
  if (writeResult.exitCode !== 0) {
    if (options.requireSuccess) {
      throw new Error(
        `TMUX_MESSAGE_WRITE_FAILED: context operation_id=tmux_input_send target_pane=${targetPane}.`
      );
    }
    return;
  }

  // Brief gap lets the TUI process and render the pasted text before receiving
  // the Enter key as a distinct input event. The base delay of 500ms was verified
  // against Opencode Code v2.1.50 with messages up to ~550 chars. For longer merged
  // payloads (e.g., bootstrap + kickoff combined in tmuxManagerPaneSeed.ts), the
  // delay scales proportionally so that a 2000-char message gets ~1600ms, preventing
  // the TUI from receiving Enter before it finishes processing all pasted characters.
  const submitDelayMs = options.submitDelayMs ?? Math.min(5000, Math.max(500, Math.ceil(message.length * 0.8)));
  if (submitDelayMs > 0) {
    const sleepForDelayMs = options.sleepForDelayMs ?? sleep;
    await sleepForDelayMs(submitDelayMs);
  }
  const submitResult = await runner(["send-keys", "-t", targetPane, "Enter"], {
    allowFailure: true
  });
  if (submitResult.exitCode !== 0 && options.requireSuccess) {
    throw new Error(
      `TMUX_MESSAGE_SUBMIT_FAILED: context operation_id=tmux_input_submit target_pane=${targetPane}.`
    );
  }
}

/**
 * Send a bare Enter to a tmux pane (for retry attempts when the initial
 * send-and-submit didn't register).
 */
export async function submitTmuxPaneInput(
  runner: TmuxRunner,
  targetPane: string
): Promise<void> {
  await runner(["send-keys", "-t", targetPane, "Enter"], {
    allowFailure: true
  });
}

function findLastIndex(arr: string[], predicate: (item: string) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) {
      return i;
    }
  }
  return -1;
}

function isAgentPromptLine(line: string): boolean {
  // Traditional prompts use > or ❯ (possibly prefixed by pane borders).
  // Opencode uses a box-drawing character ┃ to denote the input region.
  return /^\s*(?:[|│┃]\s*)*[>❯]/.test(line) || /^\s*┃\s*/.test(line);
}

/**
 * Detect whether a line looks like an opencode TUI footer/prompt.
 *
 * Opencode's exact prompt character is replaced by an input box footer
 * UI. We match against common persistent footer text elements.
 */
export function isOpencodePromptLine(line: string): boolean {
  return line.includes("Ask anything...") || line.includes("ctrl+p commands");
}

/**
 * Optional override parameters for opencode readiness detection.
 * These are positional in the function signature; this interface only holds
 * overridable defaults (timeouts and sleep injection for testing).
 */
export interface DetectOpencodeReadinessOptions {
  timeoutMs?: number;
  sleepForDelayMs?: (ms: number) => Promise<void>;
  maxPolls?: number;
}

/**
 * Opencode readiness detection via timeout sentinel.
 *
 * Unlike opencode (which shows `[pairflow]` markers) and opencode (whose prompt-line
 * pattern is detectable), opencode does not currently expose a reliable visual
 * indicator that can be matched in tmux pane captures.  This function polls for an
 * `isOpencodePromptLine` match within the configured timeout, then falls back to a
 * short delay-based sentinel when no visual signal appears — trusting that opencode
 * processes input quickly enough even without a visible prompt change.
 *
 * The fallback delay defaults to **600 ms**, which is sufficient for the agent TUI
 * to acknowledge pasted keystrokes and be ready for the next message.
 */
export async function detectOpencodeReadiness(
  runner: TmuxRunner,
  targetPane: string,
  options?: DetectOpencodeReadinessOptions
): Promise<boolean> {
  // Since isOpencodePromptLine() is a placeholder that always returns false,
  // skip the long polling loop and use a minimal poll phase. This eliminates
  // wasted ~5s startup latency while keeping the API future-proof for when
  // a real visual indicator regex is added (see TODO in isOpencodePromptLine).
  const maxPolls = options?.maxPolls ?? 2;
  const fallbackDelay = OPENCODE_READINESS_FALLBACK_DELAY_MS;
  const sleepForDelayMs = options?.sleepForDelayMs ?? sleep;

  // Quick poll window: up to maxPolls captures with brief pauses.
  for (let pollCount = 0; pollCount < maxPolls; pollCount += 1) {
    const capture = await runner(["capture-pane", "-p", "-S", "-200", "-t", targetPane], {
      allowFailure: true
    });

    if (capture.exitCode === 0) {
      const lines = capture.stdout.split("\n");
      const isReady = lines.some((line) => isOpencodePromptLine(line));
      if (isReady) {
        return true;
      }
    }

    // Brief pause between polls to avoid excessive tmux queries.
    await sleepForDelayMs(150);
  }

  // Fallback: opencode has no reliable visual indicator, so trust that the process
  // is ready after a short settling delay (the timeout sentinel).
  await sleepForDelayMs(fallbackDelay);
  return true;
}



export async function checkTmuxPaneMarkerStatus(
  runner: TmuxRunner,
  targetPane: string,
  marker: string
): Promise<TmuxPaneMarkerStatus> {
  const capture = await runner(["capture-pane", "-p", "-S", "-200", "-t", targetPane], {
    allowFailure: true
  });
  if (capture.exitCode !== 0) {
    return "not_found";
  }

  const output = capture.stdout;
  if (!output.includes(marker)) {
    return "not_found";
  }

  const lines = output.split("\n");
  const lastPromptIdx = findLastIndex(lines, isAgentPromptLine);
  if (lastPromptIdx < 0) {
    // A promptless marker can be a wrapped TUI input buffer with the prompt
    // scrolled off-capture. Treat it as unsubmitted so delivery fails closed
    // instead of accepting text that may still be waiting for Enter.
    return "stuck_in_input";
  }

  const promptAndAfter = lines.slice(lastPromptIdx).join("\n");
  if (promptAndAfter.includes(marker)) {
    return "stuck_in_input";
  }

  const beforePrompt = lines.slice(0, lastPromptIdx).join("\n");
  if (beforePrompt.includes(marker)) {
    return "submitted";
  }

  return "not_found";
}

export async function confirmTmuxPaneMarkerSubmission(
  input: ConfirmTmuxPaneMarkerSubmissionInput
): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 3);
  const settleDelayMs = input.settleDelayMs ?? 800;
  const retryDelayMs = input.retryDelayMs ?? 900;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (settleDelayMs > 0) {
      await sleepForDelayMs(settleDelayMs);
    }
    const status = await checkTmuxPaneMarkerStatus(
      input.runner,
      input.targetPane,
      input.marker
    );
    if (status === "submitted") {
      return true;
    }
    if (attempt < attempts - 1) {
      // Guard: only resend Enter when an active agent prompt line is visible.
      // If tmux hasn't yet reflected the initial submission in capture, blindly
      // sending Enter can duplicate keystrokes at a stale input buffer. A
      // visible prompt confirms the pane has settled and is ready for more input.
      const promptCheck = await input.runner(
        ["capture-pane", "-p", "-S", "-200", "-t", input.targetPane],
        { allowFailure: true }
      );
      if (promptCheck.exitCode === 0) {
        const hasPromptLine = /\s*(?:[|│┃]\s*)*[>❯]/u.test(promptCheck.stdout);
        if (!hasPromptLine) {
          // Pane is still processing previous input; wait longer instead of
          // blindly resending Enter.
          if (retryDelayMs > 0) {
            await sleepForDelayMs(retryDelayMs);
          }

          continue;
        }
      }
      if (retryDelayMs > 0) {
        await sleepForDelayMs(retryDelayMs);
      }
      await submitTmuxPaneInput(input.runner, input.targetPane);
    }
  }

  return false;
}

export async function maybeAcceptOpencodeTrustPrompt(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean> {
  let accepted = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const capture = await runner(["capture-pane", "-pt", targetPane], {
      allowFailure: true
    });
    if (capture.exitCode !== 0) {
      return accepted;
    }

    const normalized = capture.stdout.toLowerCase();
    const looksLikeOpencodeFolderTrustPrompt =
      normalized.includes("security guide") &&
      normalized.includes("yes, i trust this folder");
    const looksLikeOpencodeBypassPermissionsPrompt =
      normalized.includes("bypass permissions mode") &&
      normalized.includes("yes, i accept");
    const looksLikeOpencodeTrustPrompt =
      normalized.includes("do you trust the contents of this directory") &&
      normalized.includes("1. yes, continue");

    if (looksLikeOpencodeFolderTrustPrompt) {
      // Opencode's folder-trust prompt already highlights the "Yes" option.
      // Confirming requires a bare Enter, not typing "1".
      await submitTmuxPaneInput(runner, targetPane);
      accepted = true;
      await sleep(250);
      continue;
    }

    if (looksLikeOpencodeBypassPermissionsPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "2");
      accepted = true;
      await sleep(250);
      continue;
    }

    if (looksLikeOpencodeTrustPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "1");
      accepted = true;
      await sleep(250);
      continue;
    }

    return accepted;
  }

  return accepted;
}
