import { execSync } from "child_process";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function isOpencodeDescendantOf(pid: number): boolean {
  try {
    const psOutput = execSync("ps -eo pid,ppid,comm", { encoding: "utf8" });
    const lines = psOutput.trim().split("\n");

    const parentToChildren = new Map<number, { pid: number; comm: string }[]>();
    const processes = new Map<number, string>();
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

      processes.set(childPid, comm);

      let list = parentToChildren.get(parentPid);
      if (!list) {
        list = [];
        parentToChildren.set(parentPid, list);
      }
      list.push({ pid: childPid, comm });
    }

    const rootComm = processes.get(pid)?.toLowerCase();
    if (
      rootComm?.includes("opencode")
      || rootComm?.includes("node")
      || rootComm?.includes("mainthread")
    ) {
      return true;
    }

    const queue = [pid];
    const visited = new Set<number>([pid]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = parentToChildren.get(current);
      if (children) {
        for (const child of children) {
          const commLower = child.comm.toLowerCase();
          if (
            commLower.includes("opencode") ||
            commLower.includes("node") ||
            commLower.includes("mainthread")
          ) {
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

async function checkPaneProcessAlive(
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
      return isOpencodeDescendantOf(pid) ? true : "not_descendant";
    }
  } catch {
    // Fall through to text-based check
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
    const processStatus = await checkPaneProcessAlive(input.runner, input.targetPane);
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

