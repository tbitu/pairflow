import { describe, expect, it } from "vitest";

import type { TmuxRunner, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";
import { waitForReasonixPaneReady } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxReasonixReadiness.js";

function runnerReturning(stdout: string): TmuxRunner {
  return async (args: string[]): Promise<TmuxRunResult> => {
    if (args[0] === "display-message") {
      return { stdout: "12345", stderr: "", exitCode: 0 };
    }
    return { stdout, stderr: "", exitCode: 0 };
  };
}

describe("waitForReasonixPaneReady", () => {
  it("reports ready when the composer prompt line is visible", async () => {
    const ready = await waitForReasonixPaneReady({
      runner: runnerReturning("reasonix TUI content\n> "),
      targetPane: "pf:0.1",
      attempts: 3,
      retryDelayMs: 1
    });
    expect(ready).toBe(true);
  });

  it("fails closed when a known startup failure text is visible", async () => {
    const ready = await waitForReasonixPaneReady({
      runner: runnerReturning(
        "error: this session is in use by another Reasonix window or process"
      ),
      targetPane: "pf:0.1",
      attempts: 3,
      retryDelayMs: 1
    });
    expect(ready).toBe(false);
  });

  it("fails closed when a provider API key is missing", async () => {
    const ready = await waitForReasonixPaneReady({
      runner: runnerReturning("error: provider \"deepseek-flash\": missing env DEEPSEEK_API_KEY"),
      targetPane: "pf:0.1",
      attempts: 3,
      retryDelayMs: 1
    });
    expect(ready).toBe(false);
  });

  it("does not report ready for a dropped interactive shell", async () => {
    const ready = await waitForReasonixPaneReady({
      runner: runnerReturning("reasonix exited (code 1). Dropping to interactive shell."),
      targetPane: "pf:0.1",
      attempts: 3,
      retryDelayMs: 1
    });
    expect(ready).toBe(false);
  });
});
