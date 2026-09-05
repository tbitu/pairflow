import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedBubbleTmuxPaneMessages, shouldSkipKickoffAfterStartup } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.js";

describe("shouldSkipKickoffAfterStartup (two-paste model)", () => {
  it("does not skip the per-task kickoff when no startup prompt was submitted", () => {
    expect(shouldSkipKickoffAfterStartup("reasonix", false)).toBe(false);
    expect(shouldSkipKickoffAfterStartup("opencode", false)).toBe(false);
    expect(shouldSkipKickoffAfterStartup(undefined, false)).toBe(false);
  });

  it("keeps delivering the kickoff for reasonix (tmux_paste) after a role startup prompt", () => {
    // reasonix: role-identity startup paste + per-task kickoff paste are both
    // intended ("two paste" model), so the kickoff must NOT be skipped.
    expect(shouldSkipKickoffAfterStartup("reasonix", true)).toBe(false);
  });

  it("skips the kickoff for opencode after its CLI --agent role prompt", () => {
    // opencode receives the role via `--agent PF-*`; a duplicate kickoff paste
    // would be "double input" steering confusion.
    expect(shouldSkipKickoffAfterStartup("opencode", true)).toBe(true);
  });

  it("keeps the historical skip for unknown/undefined agents", () => {
    expect(shouldSkipKickoffAfterStartup(undefined, true)).toBe(true);
  });
});

describe("seed kickoff paste: settle window, drop recovery, loud failure", () => {
  const KICKOFF_MESSAGE =
    "[pairflow] bubble=b_seed_unit kickoff. Read the task file and implement it in this workspace.";

  type RunnerArgs = string[];

  interface SeedRunnerFixture {
    runner: (args: RunnerArgs) => Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
    calls: RunnerArgs[];
  }

  function createSeedRunner(input: {
    /** Text returned for readiness captures (non -S captures). */
    readyText: string;
    /** Text returned for marker captures (-S -200 captures). */
    markerPaneText: string;
  }): SeedRunnerFixture {
    const calls: RunnerArgs[] = [];
    const runner = async (args: RunnerArgs) => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        const isMarkerCapture = args.includes("-S");
        return {
          stdout: isMarkerCapture ? input.markerPaneText : input.readyText,
          stderr: "",
          exitCode: 0
        };
      }
      // display-message (pane_pid / pane_in_mode preflight): fail so the
      // reasonix readiness process-tree walk is skipped and the preflight
      // short-circuits (both are covered by the screen-text checks).
      if (args[0] === "display-message") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    return { runner, calls };
  }

  function seedInput(
    fixture: SeedRunnerFixture,
    agentName: "reasonix" | "opencode"
  ): Parameters<typeof seedBubbleTmuxPaneMessages>[0] {
    return {
      runner: fixture.runner,
      implementerPaneId: "pf-b_seed_unit:0.1",
      reviewerPaneId: "pf-b_seed_unit:0.1",
      metaReviewerPaneId: "pf-b_seed_unit:0.1",
      implementerAgentName: agentName,
      reviewerAgentName: agentName,
      metaReviewerAgentName: agentName,
      launchReviewerAgent: false,
      launchMetaReviewerAgent: false,
      implementerKickoffMessage: KICKOFF_MESSAGE
    };
  }

  function textSendCalls(calls: RunnerArgs[]): RunnerArgs[] {
    return calls.filter(
      (args) => args[0] === "send-keys" && args[3] === "-l"
    );
  }

  function enterCalls(calls: RunnerArgs[]): RunnerArgs[] {
    return calls.filter(
      (args) => args[0] === "send-keys" && args[3] === "Enter"
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settleUntilResolved(
    promise: Promise<void>,
    budgetMs: number
  ): Promise<void> {
    let done = false;
    void promise.finally(() => {
      done = true;
    });
    for (let step = 0; step < 60 && !done; step += 1) {
      await vi.advanceTimersByTimeAsync(budgetMs);
      await Promise.resolve();
    }
    await promise;
  }

  it("reasonix: the first seed paste waits out the startup settle window before any keystroke is sent", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createSeedRunner({
      readyText: "❯",
      markerPaneText: `${KICKOFF_MESSAGE}\n❯`
    });
    const promise = seedBubbleTmuxPaneMessages(seedInput(fixture, "reasonix"));

    // reasonix renders its composer ~25s before its input loop attaches; the
    // seed must not type during that window or the kickoff is silently dropped.
    await vi.advanceTimersByTimeAsync(24_000);
    await Promise.resolve();
    expect(textSendCalls(fixture.calls)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve();
    expect(textSendCalls(fixture.calls).length).toBeGreaterThanOrEqual(1);

    await settleUntilResolved(promise, 5_000);
    const allErrors = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(allErrors).not.toContain("KICKOFF_DELIVERY_FAILED");
    consoleSpy.mockRestore();
  });

  it("reasonix: a paste whose marker never appears is re-sent once, then fails loud", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createSeedRunner({
      // Ready composer, but the kickoff marker never lands in the pane
      // (simulates reasonix swallowing the paste during warm-up).
      readyText: "❯",
      markerPaneText: "❯"
    });
    const promise = seedBubbleTmuxPaneMessages(seedInput(fixture, "reasonix"));
    await settleUntilResolved(promise, 10_000);

    // First paste + one recovery re-send, never more (bounded).
    expect(textSendCalls(fixture.calls)).toHaveLength(2);
    // Each paste submits with Enter.
    expect(enterCalls(fixture.calls).length).toBeGreaterThanOrEqual(2);

    const allErrors = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(allErrors).toContain("KICKOFF_DELIVERY_FAILED");
    consoleSpy.mockRestore();
  });

  it("opencode: unchanged — no settle window and no duplicate paste", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createSeedRunner({
      readyText: "Ask anything...\ntab agents",
      markerPaneText: `${KICKOFF_MESSAGE}\n❯`
    });
    const promise = seedBubbleTmuxPaneMessages(seedInput(fixture, "opencode"));

    // opencode has no startup settle: keystrokes go out without waiting out a
    // 25s window (verify text is sent after only a tiny advance).
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(textSendCalls(fixture.calls).length).toBeGreaterThanOrEqual(1);

    await settleUntilResolved(promise, 5_000);
    // Marker confirmed on first paste: exactly one text send (no recovery
    // re-send, which would be "double input" for opencode).
    expect(textSendCalls(fixture.calls)).toHaveLength(1);
    const allErrors = consoleSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(allErrors).not.toContain("KICKOFF_DELIVERY_FAILED");
    consoleSpy.mockRestore();
  });
});
