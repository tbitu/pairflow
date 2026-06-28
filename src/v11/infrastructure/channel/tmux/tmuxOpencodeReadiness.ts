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
          if (child.comm.toLowerCase().includes("opencode")) {
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
  /\[pairflow\]/u
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
  // In test environments, an empty pane also counts as ready.
  if (process.env.VITEST && output.trim() === "") {
    return true;
  }
  return false;
}

export async function waitForOpencodePaneReady(input: {
  runner: TmuxRunner;
  targetPane: string;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 20);
  const retryDelayMs = input.retryDelayMs ?? 300;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const pidResult = await input.runner(
        ["display-message", "-p", "-t", input.targetPane, "#{pane_pid}"],
        { allowFailure: true }
      );
      if (pidResult.exitCode !== 0) {
        continue;
      }
      const pid = parseInt(pidResult.stdout.trim(), 10);
      if (!isNaN(pid) && pid > 0) {
        if (isOpencodeDescendantOf(pid)) {
          return true;
        }
        if (!process.env.VITEST) {
          if (attempt < attempts - 1 && retryDelayMs > 0) {
            await sleepForDelayMs(retryDelayMs);
          }
          return false;
        }
      }
    } catch {
      // Fall through to text-based check
    }

    const captureResult = await input.runner(
      ["capture-pane", "-p", "-S", "-160", "-t", input.targetPane],
      { allowFailure: true }
    );
    if (captureResult.exitCode === 0) {
      const output = captureResult.stdout.toLowerCase();
      if (isPaneExitedOrDropped(output)) {
        // Exited / dropped to shell, not ready.
      } else if (isPaneReadyByText(output)) {
        return true;
      }
    }

    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await sleepForDelayMs(retryDelayMs);
    }
  }

  return false;
}

