import { execSync } from "child_process";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

/** Shared short sleep helper for the tmux channel modules. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * Detect whether the pane root pid has any process whose `comm` contains one of
 * the given tokens somewhere below it (the root itself is checked too).
 *
 * Both opencode (a node/rust binary tree with `opencode`/`node`/`mainthread`)
 * and reasonix (a Go binary `reasonix`, with `node` when launched via the npx
 * fallback) are located by walking all descendants of the pane pid.
 */
export function isProcessDescendantOf(
  pid: number,
  commMatchers: readonly string[]
): boolean {
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

    const commMatches = (comm: string): boolean =>
      commMatchers.some((token) => comm.toLowerCase().includes(token));

    const rootComm = processes.get(pid);
    if (rootComm !== undefined && commMatches(rootComm)) {
      return true;
    }

    const queue = [pid];
    const visited = new Set<number>([pid]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = parentToChildren.get(current);
      if (children) {
        for (const child of children) {
          if (commMatches(child.comm)) {
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
    // Ignore and fall back to text-based readiness checks.
  }
  return false;
}

/**
 * Check whether the pane's root pid has a descendant matching `commMatchers`.
 * Returns `true` when a matching process lives below the pane pid,
 * `"not_descendant"` when the pane is alive but no matching process was found,
 * and `false` when the pane pid could not be read.
 */
export async function checkPaneProcessAlive(
  runner: TmuxRunner,
  targetPane: string,
  commMatchers: readonly string[]
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
      return isProcessDescendantOf(pid, commMatchers) ? true : "not_descendant";
    }
  } catch {
    // Fall through to text-based check
  }
  return false;
}

const EXITED_SHELL_PATTERNS = [
  /dropping to interactive shell/i,
  /exited \(code/u,
  /cli not found in path/ui
];

/** Checks whether captured output indicates the pane has exited or dropped to a shell. */
export function isPaneExitedOrDropped(output: string): boolean {
  for (const pattern of EXITED_SHELL_PATTERNS) {
    if (pattern.test(output)) {
      return true;
    }
  }
  return false;
}
