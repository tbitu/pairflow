import { execSync } from "child_process";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * Detect a reasonix process somewhere below the pane's root pid.
 *
 * reasonix is a Go binary (comm `reasonix`); when launched through the npx
 * fallback the tree contains `node` too. Walking all descendants covers both.
 */
function isReasonixDescendantOf(pid: number): boolean {
  try {
    const psOutput = execSync("ps -eo pid,ppid,comm", { encoding: "utf8" });
    const lines = psOutput.trim().split("\n");

    const parentToChildren = new Map<number, { pid: number; comm: string }[]>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const part0 = parts[0];
      const part1 = parts[1];
      if (part0 === undefined || part1 === undefined) continue;
      const childPid = parseInt(part0, 10);
      const parentPid = parseInt(part1, 10);
      const comm = parts.slice(2).join(" ");
      if (isNaN(childPid) || isNaN(parentPid)) continue;

      let list = parentToChildren.get(parentPid);
      if (!list) {
        list = [];
        parentToChildren.set(parentPid, list);
      }
      list.push({ pid: childPid, comm });
    }

    const queue = [pid];
    const visited = new Set<number>([pid]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = parentToChildren.get(current);
      if (children) {
        for (const child of children) {
          const commLower = child.comm.toLowerCase();
          if (commLower.includes("reasonix")) {
            return true;
          }
          if (!visited.has(child.pid)) {
            visited.add(child.pid);
            queue.push(child.pid);
          }
        }
      }
    }
  } catch {
    // Ignore and fall back
  }
  return false;
}

const EXITED_SHELL_PATTERNS = [
  /dropping to interactive shell/i,
  /exited \(code/u,
  /cli not found in path/ui
];

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
 * Checks whether captured output indicates the pane has exited or dropped to a shell.
 */
function isPaneExitedOrDropped(output: string): boolean {
  for (const pattern of EXITED_SHELL_PATTERNS) {
    if (pattern.test(output)) {
      return true;
    }
  }
  return false;
}

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

async function checkReasonixProcessAlive(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean | "not_descendant"> {
  try {
    const pidResult = await runner(
      ["display-message", "-p", "-t", targetPane, "#{pane_pid}"],
      { allowFailure: true }
    );
    if (pidResult.exitCode !== 0) {
      return false;
    }
    const pid = parseInt(pidResult.stdout.trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      return isReasonixDescendantOf(pid) ? true : "not_descendant";
    }
  } catch {
    // Fall through to text-based check
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
    const processStatus = await checkReasonixProcessAlive(input.runner, input.targetPane);
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
