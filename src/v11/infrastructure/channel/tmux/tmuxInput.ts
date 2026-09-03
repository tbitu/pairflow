import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import {
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput
} from "./tmuxPaneWrite.js";

// Re-export the tmux pane write/send machinery from tmuxPaneWrite.ts so
// existing imports stay source-compatible.
export {
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput,
  writeTmuxPasteTempFile,
  type SendAndSubmitTmuxPaneMessageOptions
} from "./tmuxPaneWrite.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
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
  // Some terminal layouts prefix prompt lines with pane border glyphs
  // (for example `│ ›`, `│ ❯`, `| >`). Treat those as prompt lines too.
  // `›` (U+203A) is reasonix's composer prompt glyph.
  return /^\s*(?:[|│┃]\s*)*[>❯›]/u.test(line);
}

export async function waitForTuiReady(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean> {
  const attempts = 60; // 30 seconds
  for (let i = 0; i < attempts; i++) {
    const capture = await runner(["capture-pane", "-p", "-t", targetPane], {
      allowFailure: true
    });
    if (capture.exitCode === 0) {
      const lines = capture.stdout.split("\n");
      const isOpencode =
        lines.some((line) => /▀▀▀▀/u.test(line)) ||
        capture.stdout.toLowerCase().includes("ask anything") ||
        capture.stdout.toLowerCase().includes("tab agents") ||
        capture.stdout.toLowerCase().includes("ctrl+p commands") ||
        lines.some((line) => /^\s*┃/u.test(line));
      const hasOpencodeReady = capture.stdout.toLowerCase().includes("ask anything") || capture.stdout.toLowerCase().includes("tab agents") || capture.stdout.toLowerCase().includes("ctrl+p commands");
      const hasPrompt = isOpencode ? hasOpencodeReady : lines.some((line) => isAgentPromptLine(line));
      if (hasPrompt) {
        // Extra settle time to ensure the TUI's internal event loop is ready
        await sleep(2000);
        return true;
      }
    }
    await sleep(500);
  }
  return false;
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
  let lastPromptIdx = findLastIndex(lines, isAgentPromptLine);
  if (lastPromptIdx < 0) {
    // Opencode (Antigravity) fallback: find the bottom boundary of the input box
    const bottomBarIdx = findLastIndex(lines, (line) => /▀▀▀▀/u.test(line));
    if (bottomBarIdx > 0) {
      let topOfInputIdx = bottomBarIdx - 1;
      while (topOfInputIdx >= 0 && /^\s*┃/u.test(lines[topOfInputIdx]!)) {
        topOfInputIdx -= 1;
      }
      lastPromptIdx = topOfInputIdx + 1;
    }
  }

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

const INTERRUPT_PROMPT_PATTERNS = [
  /esc again to interrupt/iu,
  /esc to interrupt/u,
  /escape to interrupt/u,
  /esc interrupt/ui
];

/**
 * Checks whether captured pane output contains any interrupt prompt text.
 */
function hasInterruptPrompt(output: string): boolean {
  const lower = output.toLowerCase();
  for (const pattern of INTERRUPT_PROMPT_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether the pane shows a visible agent prompt line.
 */
function hasVisiblePromptLine(capture: { exitCode: number; stdout: string }): boolean {
  if (capture.exitCode !== 0) {
    return false;
  }
  const lines = capture.stdout.split("\n");

  // Opencode-specific markers
  const isOpencode = lines.some((line) => /▀▀▀▀/u.test(line))
    || /ask anything/iu.test(capture.stdout)
    || /tab agents/iu.test(capture.stdout)
    || /ctrl\+p commands/iu.test(capture.stdout)
    || lines.some((line) => /^\s*┃/u.test(line));

  if (isOpencode) {
    return true;
  }

  return lines.some((line) => isAgentPromptLine(line));
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
    const capture = await input.runner(
      ["capture-pane", "-p", "-t", input.targetPane],
      { allowFailure: true }
    );
    if (capture.exitCode === 0) {
      const lowerOutput = capture.stdout.toLowerCase();
      if (hasInterruptPrompt(lowerOutput)) {
        return true;
      }
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

      if (!hasVisiblePromptLine(promptCheck)) {
        // Pane is still processing previous input; wait longer instead of
        // blindly resending Enter.
        if (retryDelayMs > 0) {
          await sleepForDelayMs(retryDelayMs);
        }

        continue;
      }

      if (retryDelayMs > 0) {
        await sleepForDelayMs(retryDelayMs);
      }
      await submitTmuxPaneInput(input.runner, input.targetPane);
    }
  }

  return false;
}

export function isOpencodePromptLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    (lower.includes("security guide") && lower.includes("trust this folder"))
    || (lower.includes("do you trust the contents of this directory"))
    || (lower.includes("bypass permissions mode") && lower.includes("accept"))
  );
}

export async function detectOpencodeReadiness(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean> {
  const capture = await runner(["capture-pane", "-pt", targetPane], {
    allowFailure: true
  });
  if (capture.exitCode !== 0) {
    return false;
  }
  const lower = capture.stdout.toLowerCase();
  return (
    lower.includes("opencode code is ready")
    || lower.includes("opencode ready")
    || lower.includes("ready.")
  );
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
    if (
      normalized.includes("ask anything")
      || normalized.includes("tab agents")
      || normalized.includes("ctrl+p commands")
    ) {
      return accepted;
    }

    const looksLikeOpencodeFolderTrustPrompt =
      normalized.includes("security guide") &&
      normalized.includes("trust this folder");
    const looksLikeOpencodeBypassPermissionsPrompt =
      normalized.includes("bypass permissions mode") &&
      normalized.includes("accept");
    const looksLikeOpencodeTrustPrompt =
      normalized.includes("do you trust the contents of this directory");

    if (looksLikeOpencodeFolderTrustPrompt || looksLikeOpencodeBypassPermissionsPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "Enter");
      accepted = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    if (looksLikeOpencodeTrustPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "1");
      accepted = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    return accepted;
  }

  return accepted;
}
