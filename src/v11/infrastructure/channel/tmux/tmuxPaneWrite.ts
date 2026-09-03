import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * Default temp-file writer used by the paste-via-buffer path. Writes `content`
 * to a fresh temp file and returns its path; the caller deletes the file.
 */
export async function writeTmuxPasteTempFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pairflow-tmux-paste-"));
  const path = join(dir, "message.txt");
  await writeFile(path, content, "utf8");
  return path;
}

async function removeTempFile(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true }).catch(() => undefined);
}

export interface SendAndSubmitTmuxPaneMessageOptions {
  requireSuccess?: boolean;
  submitDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  maxChunkLength?: number;
  /** Gap between literal send-keys chunks. Defaults to 200ms. */
  interChunkDelayMs?: number;
  /**
   * Submit each chunk as its own turn (Enter per chunk) instead of pasting all
   * chunks then a single Enter. Required for agents whose composer input field
   * is capacity-limited (reasonix): a long paste overflows the field and the
   * composer then rejects further keystrokes including Enter.
   */
  submitPerChunk?: boolean;
  /**
   * Paste the whole message via the tmux paste buffer (load-buffer +
   * paste-buffer) instead of sending keystrokes. Some agents — reasonix is a
   * Bubble Tea TUI — insert long messages only on a genuine terminal paste
   * event (tea.PasteMsg); send-keys keystrokes overflow their single-line
   * composer and lock it. The buffer is deleted after pasting.
   */
  pasteViaBuffer?: boolean;
  /** Buffer name for the paste-buffer path (default: a per-call unique name). */
  pasteBufferName?: string;
  /** Override the temp-file writer for the paste-buffer path (testing). */
  writeTempFile?: (content: string) => Promise<string>;
  /**
   * Collapse newline sequences to a single space before pasting, keeping the
   * message single-line (reasonix's composer only submits single-line input).
   */
  collapseNewlines?: boolean;
  /**
   * Extra delay before the message is pasted (after readiness detection), so a
   * TUI that rendered its prompt but isn't yet ready to accept input receives
   * the paste. reasonix needs ~25s; opencode/unknown leave it unset.
   */
  settleMs?: number;
}

function resolveDynamicSubmitDelayMs(message: string): number {
  const minimumDelayMs = 500;
  const maximumDelayMs = 20000;
  const lineCount = message.split("\n").length;
  const lengthDelayMs = Math.ceil(message.length * 1.6);
  const structureDelayMs = Math.max(0, lineCount - 1) * 20;
  return Math.min(
    maximumDelayMs,
    Math.max(minimumDelayMs, lengthDelayMs + structureDelayMs)
  );
}

function splitForTmuxLiteralSend(message: string, maxChunkLength: number): string[] {
  if (message.length <= maxChunkLength) {
    return [message];
  }
  const chunks: string[] = [];
  for (let index = 0; index < message.length; index += maxChunkLength) {
    chunks.push(message.slice(index, index + maxChunkLength));
  }
  return chunks;
}

/** Collapse newline/carriage-return sequences to a single space. */
function collapseNewlines(message: string): string {
  return message.replace(/\s*\r?\n\s*/gu, " ");
}

/** Represents a tmux run result for the buffer-paste check. */
interface BufferPasteCheckResult {
  /** tmux command that failed, or undefined when all succeeded. */
  operation: "load-buffer" | "paste-buffer" | "delete-buffer" | "temp-file";
  exitCode: number | null;
  stderr: string;
}

/**
 * Paste `message` into the pane via the tmux paste buffer so a genuine
 * terminal paste event reaches the agent (required for agents whose TUI only
 * inserts long text on a real paste, e.g. reasonix's Bubble Tea composer).
 *
 * Fails loud: if any tmux buffer command fails, it throws with context so the
 * caller never reports success with nothing delivered (a silent drop leaves
 * the agent with no input). `runHostCommand` mirrors the runner fixture shape
 * used by tests.
 */
async function pasteMessageViaBuffer(input: {
  runner: TmuxRunner;
  targetPane: string;
  message: string;
  bufferName: string;
  writeTempFile?: (content: string) => Promise<string>;
}): Promise<void> {
  const writeTempFile = input.writeTempFile ?? writeTmuxPasteTempFile;
  let tempPath: string | undefined;
  let failure: BufferPasteCheckResult | undefined;
  try {
    try {
      tempPath = await writeTempFile(input.message);
    } catch (error) {
      failure = {
        operation: "temp-file",
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error)
      };
    }
    if (failure === undefined && tempPath !== undefined) {
      const load = await input.runner(
        ["load-buffer", "-b", input.bufferName, tempPath],
        { allowFailure: true }
      );
      if (load.exitCode !== 0) {
        failure = { operation: "load-buffer", exitCode: load.exitCode, stderr: load.stderr };
      }
    }
    if (failure === undefined) {
      const paste = await input.runner(
        ["paste-buffer", "-b", input.bufferName, "-t", input.targetPane],
        { allowFailure: true }
      );
      if (paste.exitCode !== 0) {
        failure = { operation: "paste-buffer", exitCode: paste.exitCode, stderr: paste.stderr };
      }
    }
    if (failure === undefined) {
      const del = await input.runner(
        ["delete-buffer", "-b", input.bufferName],
        { allowFailure: true }
      );
      if (del.exitCode !== 0) {
        // Deleting the buffer is best-effort cleanup; a failure here should not
        // fail the whole delivery if the paste already went through.
        void del;
      }
    }
  } finally {
    if (tempPath !== undefined) {
      await removeTempFile(tempPath);
    }
  }
  if (failure !== undefined) {
    throw new Error(
      `TMUX_BUFFER_PASTE_FAILED: context operation_id=${failure.operation} target_pane=${input.targetPane} exit_code=${failure.exitCode ?? "null"} stderr=${JSON.stringify(failure.stderr)}`
    );
  }
}

/**
 * Unify sending a message into a tmux agent pane and submitting it with Enter.
 *
 * Verified against a real terminal instance: the Enter MUST arrive as a
 * separate tmux `send-keys` command with a brief gap after the text. Embedding
 * CR/LF in the literal text does NOT trigger submit in ink-based TUIs.
 *
 * Two delivery paths:
 * - `pasteViaBuffer` — load the message into a tmux paste buffer and paste it,
 *   so a genuine terminal paste event (tea.PasteMsg) reaches reasonix's
 *   paste-aware composer (inserts wrapped blocks instead of overflowing).
 * - default matching the proven detect-clear-suffix hook:
 *   `tmux send-keys -l "text" && sleep 0.3 && tmux send-keys Enter`
 *
 * Also supports `submitPerChunk` (Enter after each chunk) so no single
 * composer input field exceeds its capacity.
 */
export async function sendAndSubmitTmuxPaneMessage(
  runner: TmuxRunner,
  targetPane: string,
  rawMessage: string,
  options: SendAndSubmitTmuxPaneMessageOptions = {}
): Promise<void> {
  // reasonix's composer only submits single-line input; collapse newlines so
  // Enter stays the send key instead of inserting a newline in multiline mode.
  const message = options.collapseNewlines ? collapseNewlines(rawMessage) : rawMessage;
  // Some TUIs render their readiness prompt before they accept input; give
  // them a settle window (reasonix ~25s) so the paste isn't dropped.
  if (options.settleMs !== undefined && options.settleMs > 0) {
    await sleep(options.settleMs);
  }
  if (options.pasteViaBuffer) {
    try {
      await submitPasteViaBuffer(runner, targetPane, message, options);
      return;
    } catch (error) {
      // Buffer paste is not reliably available everywhere. Fall back to the
      // keystroke path (small chunks + per-chunk submit) rather than reporting
      // success with the input silently dropped. Only rethrow when the caller
      // demanded strict success and the keystroke path also cannot deliver.
      const keystrokeResult = await sendKeystrokes(runner, targetPane, message, options);
      if (!keystrokeResult) {
        if (options.requireSuccess) {
          throw error;
        }
        return;
      }
      await submitPaneEnter(runner, targetPane, message, options);
      return;
    }
  }
  await maybeExitTmuxCopyMode(runner, targetPane, options.requireSuccess ?? false);
  await sendKeystrokes(runner, targetPane, message, options);
  await submitPaneEnter(runner, targetPane, message, options);
}

async function submitPasteViaBuffer(
  runner: TmuxRunner,
  targetPane: string,
  message: string,
  options: SendAndSubmitTmuxPaneMessageOptions
): Promise<void> {
  const bufferName = options.pasteBufferName ?? `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pasteMessageViaBuffer({
    runner,
    targetPane,
    message,
    bufferName,
    ...(options.writeTempFile !== undefined
      ? { writeTempFile: options.writeTempFile }
      : {})
  });
  await submitPaneEnter(runner, targetPane, message, options);
}

async function maybeExitTmuxCopyMode(
  runner: TmuxRunner,
  targetPane: string,
  requireSuccess: boolean
): Promise<void> {
  const paneMode = await runner(
    ["display-message", "-p", "-t", targetPane, "#{pane_in_mode}"],
    { allowFailure: true }
  );
  if (paneMode.exitCode !== 0) {
    if (requireSuccess) {
      throw new Error(
        `TMUX_PANE_MODE_CHECK_FAILED: context operation_id=tmux_input_preflight target_pane=${targetPane}.`
      );
    }
    return;
  }
  const paneModeValue = Number.parseInt(paneMode.stdout.trim(), 10);
  if (!Number.isFinite(paneModeValue) || paneModeValue <= 0) {
    return;
  }
  await runner(["copy-mode", "-q", "-t", targetPane], { allowFailure: true }).catch(
    () => undefined
  );
}

async function sendKeystrokes(
  runner: TmuxRunner,
  targetPane: string,
  message: string,
  options: SendAndSubmitTmuxPaneMessageOptions
): Promise<boolean> {
  const maxChunkLength =
    options.maxChunkLength !== undefined
      ? Math.max(1, Math.floor(options.maxChunkLength))
      : Number.POSITIVE_INFINITY;
  const interChunkDelayMs = Math.max(0, options.interChunkDelayMs ?? 200);
  const chunks = splitForTmuxLiteralSend(message, maxChunkLength);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const messageChunk = chunks[chunkIndex] as string;
    const writeResult = await runner(
      ["send-keys", "-t", targetPane, "-l", messageChunk],
      { allowFailure: true }
    );
    if (writeResult.exitCode !== 0) {
      if (options.requireSuccess) {
        throw new Error(
          `TMUX_MESSAGE_WRITE_FAILED: context operation_id=tmux_input_send target_pane=${targetPane}.`
        );
      }
      return false;
    }
    await sleep(interChunkDelayMs);
    if (options.submitPerChunk && chunkIndex < chunks.length - 1) {
      // Submit this chunk as its own turn so no single composer input field
      // can overflow. Only the last chunk carries the framing that expects a
      // pairflow marker; intermediate chunks are ordinary continuation turns.
      await runner(["send-keys", "-t", targetPane, "Enter"], {
        allowFailure: true
      });
      await sleep(interChunkDelayMs);
    }
  }
  return true;
}

async function submitPaneEnter(
  runner: TmuxRunner,
  targetPane: string,
  message: string,
  options: SendAndSubmitTmuxPaneMessageOptions
): Promise<void> {
  const submitDelayMs = options.submitDelayMs ?? resolveDynamicSubmitDelayMs(message);
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

/** Send a bare Enter to a tmux pane (retry after the initial send failed). */
export async function submitTmuxPaneInput(
  runner: TmuxRunner,
  targetPane: string
): Promise<void> {
  await runner(["send-keys", "-t", targetPane, "Enter"], {
    allowFailure: true
  });
}
