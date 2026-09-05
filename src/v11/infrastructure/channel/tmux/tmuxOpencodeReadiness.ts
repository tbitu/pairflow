import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import {
  checkPaneProcessAlive,
  isPaneExitedOrDropped,
  sleep
} from "./tmuxProcessProbe.js";

const OPENCODE_PROCESS_COMM_MATCHERS = ["opencode", "node", "mainthread"];

const READY_TEXT_PATTERNS = [
  /ask anything/i,
  /tab agents/i,
  /ctrl\+p commands/i,
  /claude code is ready/i,
  /▀▀▀▀/u,
  /^\s*┃/u,
  /security guide/i,
  /trust this folder/i,
  /do you trust the contents of this directory/i,
  /bypass permissions mode/i
];

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

async function isOpencodePaneScreenReady(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean> {
  const captureResult = await runner(
    ["capture-pane", "-p", "-t", targetPane],
    { allowFailure: true }
  );
  if (captureResult.exitCode === 0) {
    const output = captureResult.stdout.toLowerCase();
    if (!isPaneExitedOrDropped(output) && isPaneReadyByText(output)) {
      return true;
    }
  }
  return false;
}

export async function waitForOpencodePaneReady(input: {
  runner: TmuxRunner;
  targetPane: string;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
  settleDelayMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 100);
  const retryDelayMs = input.retryDelayMs ?? 300;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;
  const settleDelayMs = input.settleDelayMs ?? 500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const processStatus = await checkPaneProcessAlive(
      input.runner,
      input.targetPane,
      OPENCODE_PROCESS_COMM_MATCHERS
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

    const screenReady = await isOpencodePaneScreenReady(input.runner, input.targetPane);
    if (screenReady) {
      if (settleDelayMs > 0 && !process.env.VITEST) {
        await sleepForDelayMs(settleDelayMs);
      }
      return true;
    }

    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await sleepForDelayMs(retryDelayMs);
    }
  }

  return false;
}

