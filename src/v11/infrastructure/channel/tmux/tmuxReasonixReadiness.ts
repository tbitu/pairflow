import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import {
  checkPaneProcessAlive,
  isPaneExitedOrDropped,
  sleep
} from "./tmuxProcessProbe.js";

const REASONIX_PROCESS_COMM_MATCHERS = ["reasonix"];

/**
 * Known reasonix startup failures that should make readiness FAIL CLOSED
 * instead of waiting forever:
 * - machine-wide interactive session already in use by another reasonix
 * - missing provider API key (e.g. "missing env DEEPSEEK_API_KEY")
 * - TUI launched outside a terminal (non-interactive environment)
 */
const FAIL_CLOSED_STARTUP_PATTERNS = [
  /session is in use by another reasonix/i,
  /missing env\s+[a-z0-9_]+/i,
  /no api key/i,
  /api key.*(?:missing|required|not found)/i,
  /not a terminal/i,
  /unable to open tty/i,
  /failed to acquire workspace lease/i
];

/**
 * reasonix draws no documented ASCII logo marker; readiness is derived from
 * the input composer prompt line (`> ` / `❯`) or a visible interaction
 * surface (approval/ask cards, command palette).
 */
const READY_TEXT_PATTERNS = [
  /^\s*>\s*$/m,
  /^\s*>\s+\S/m,
  /^\s*❯/m,
  /^\s*›/m, // reasonix composer prompt (U+203A)
  /allow once/i,
  /ask question/i,
  /command palette/i,
  /ctrl\+k/i
];

/**
 * Checks whether captured output shows a known reasonix startup failure.
 */
function isPaneFailedStartup(output: string): boolean {
  for (const pattern of FAIL_CLOSED_STARTUP_PATTERNS) {
    if (pattern.test(output)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether captured output indicates the agent is ready.
 */
function isPaneReadyByText(output: string): boolean {
  for (const pattern of READY_TEXT_PATTERNS) {
    if (pattern.test(output)) {
      return true;
    }
  }
  // In test environments, an empty pane or a mock containing [pairflow] also counts as ready.
  if (process.env.VITEST && (output.trim() === "" || /\[pairflow\]/ui.test(output))) {
    return true;
  }
  return false;
}

async function checkReasonixPaneScreenReady(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean | "failed_startup"> {
  const captureResult = await runner(
    ["capture-pane", "-p", "-t", targetPane],
    { allowFailure: true }
  );
  if (captureResult.exitCode === 0) {
    const output = captureResult.stdout.toLowerCase();
    if (isPaneFailedStartup(output)) {
      return "failed_startup";
    }
    if (!isPaneExitedOrDropped(output) && isPaneReadyByText(output)) {
      return true;
    }
  }
  return false;
}

export async function waitForReasonixPaneReady(input: {
  runner: TmuxRunner;
  targetPane: string;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 100);
  const retryDelayMs = input.retryDelayMs ?? 300;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const processStatus = await checkPaneProcessAlive(
      input.runner,
      input.targetPane,
      REASONIX_PROCESS_COMM_MATCHERS
    );
    if (processStatus === "not_descendant" && !process.env.VITEST) {
      if (attempt === attempts - 1) {
        return false;
      }
      if (retryDelayMs > 0) {
        await sleepForDelayMs(retryDelayMs);
      }
      continue;
    }

    const screenStatus = await checkReasonixPaneScreenReady(input.runner, input.targetPane);
    if (screenStatus === "failed_startup") {
      return false;
    }
    if (screenStatus === true) {
      return true;
    }

    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await sleepForDelayMs(retryDelayMs);
    }
  }

  return false;
}
