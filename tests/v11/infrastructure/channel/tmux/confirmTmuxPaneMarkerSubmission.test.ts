import { describe, expect, it } from "vitest";

import { confirmTmuxPaneMarkerSubmission } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxInput.js";
import type { TmuxRunner, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";

const marker = "[pairflow] bubble=b_confirm_01";

function runnerReturning(stdout: string | ((call: number) => string)): {
  runner: TmuxRunner;
  enterCount: () => number;
} {
  let call = 0;
  let enters = 0;
  const runner: TmuxRunner = async (args: string[]): Promise<TmuxRunResult> => {
    if (args.includes("Enter")) {
      enters += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    const text = typeof stdout === "string" ? stdout : stdout(call);
    call += 1;
    return { stdout: text, stderr: "", exitCode: 0 };
  };
  return { runner, enterCount: () => enters };
}

const noSleep = async (): Promise<void> => undefined;

describe("confirmTmuxPaneMarkerSubmission", () => {
  it("confirms when the marker is visible above the prompt line", async () => {
    const { runner } = runnerReturning(`${marker}\n> `);

    const confirmed = await confirmTmuxPaneMarkerSubmission({
      runner,
      targetPane: "pf:0.2",
      marker,
      attempts: 1,
      settleDelayMs: 0,
      retryDelayMs: 0,
      sleepForDelayMs: noSleep
    });

    expect(confirmed).toBe(true);
  });

  it("does not confirm a busy pane when the marker was never seen", async () => {
    // Regression: a pane mid-turn for unrelated reasons used to be accepted as
    // proof of delivery, so a dropped handoff was reported as delivered.
    const { runner } = runnerReturning("PF-Reviewer working\n  esc interrupt\n");

    const confirmed = await confirmTmuxPaneMarkerSubmission({
      runner,
      targetPane: "pf:0.2",
      marker,
      attempts: 2,
      settleDelayMs: 0,
      retryDelayMs: 0,
      sleepForDelayMs: noSleep
    });

    expect(confirmed).toBe(false);
  });

  it("confirms when the marker was typed and the pane then starts working", async () => {
    // Marker sits in the composer first, then the agent submits it and goes busy.
    const { runner } = runnerReturning((call) =>
      call === 0 ? `> ${marker}` : `working\n  esc interrupt\n`
    );

    const confirmed = await confirmTmuxPaneMarkerSubmission({
      runner,
      targetPane: "pf:0.2",
      marker,
      attempts: 2,
      settleDelayMs: 0,
      retryDelayMs: 0,
      sleepForDelayMs: noSleep
    });

    expect(confirmed).toBe(true);
  });
});
