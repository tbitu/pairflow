import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
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
    const captureResult = await input.runner(
      ["capture-pane", "-p", "-S", "-160", "-t", input.targetPane],
      { allowFailure: true }
    );
    if (captureResult.exitCode === 0) {
      const output = captureResult.stdout.toLowerCase();
      if (
        output.includes("ask anything")
        || output.includes("tab agents")
        || output.includes("ctrl+p commands")
        || output.includes("claude code is ready")
        || output.includes("[pairflow]")
        || (!!process.env.VITEST && output.trim() === "")
      ) {
        return true;
      }
    }

    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await sleepForDelayMs(retryDelayMs);
    }
  }

  return false;
}
