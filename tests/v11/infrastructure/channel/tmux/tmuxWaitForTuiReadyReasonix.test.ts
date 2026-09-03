import { describe, expect, it } from "vitest";

import type { TmuxRunner, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";
import { waitForTuiReady } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxInput.js";

function captureRunner(initialOutput: string): {
  runner: TmuxRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  let output = initialOutput;
  const runner: TmuxRunner = async (args: string[]): Promise<TmuxRunResult> => {
    calls.push(args);
    if (args[0] === "capture-pane") {
      // Emulate the reasonix composer prompt appearing after a few polls.
      if (calls.length > 3) {
        output = "│   › Continue exactly where you left off.";
      }
      return { stdout: output, stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { runner, calls };
}

describe("waitForTuiReady recognizes reasonix prompt glyph", () => {
  it("returns true when the composer shows reasonix's '›' prompt (U+203A)", async () => {
    const { runner } = captureRunner("reasonix TUI booting...");
    const ready = await waitForTuiReady(runner, "%11");
    expect(ready).toBe(true);
  });

  it("returns true when the composer shows a '❯' prompt (opencode/reasonix fallback)", async () => {
    const { runner } = captureRunner("reasonix TUI booting...\n❯ ");
    const ready = await waitForTuiReady(runner, "%11");
    expect(ready).toBe(true);
  });
});
