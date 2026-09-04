import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  WATCHDOG_PANE_ACTIVITY_CAPTURE_START_LINE,
  sampleWatchdogPaneActivity
} from "../../../../../../src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivitySampler.js";
import type { TmuxRunner } from "../../../../../../src/v11/ports/tmuxSessions.js";
import type { PaneActivitySampleResult } from "../../../../../../src/v11/application/watchdog/watchdogCommandContract.js";
import { BubbleWatchdogError } from "../../../../../../src/v11/shared/watchdog/watchdogCommandError.js";
import {
  resolveWatchdogTargetPaneIndex
} from "../../../../../../src/v11/shared/watchdog/watchdogPaneTargeting.js";
import type { BubbleConfig } from "../../../../../../src/v11/shared/config/bubbleConfigTypes.js";

const bubbleConfig: BubbleConfig = {
  id: "b_watchdog_sampler_01",
  repo_path: "/tmp/pairflow",
  base_branch: "main",
  bubble_branch: "bubble/b_watchdog_sampler_01",
  work_mode: "worktree",
  quality_mode: "strict",
  review_artifact_type: "code",
  pairflow_command_profile: "external",
  reviewer_context_mode: "fresh",
  watchdog_timeout_minutes: 30,
  max_rounds: 3,
  severity_gate_round: 2,
  commit_requires_approval: true,
  agents: {
    implementer: "opencode",
    reviewer: "opencode",
    meta_reviewer: "opencode"
  },
  commands: {
    test: "pnpm test",
    typecheck: "pnpm typecheck"
  },
  notifications: {
    enabled: false
  },
  doc_contract_gates: {
    round_gate_applies_after: 1
  }
};

describe("watchdogPaneActivitySampler", () => {
  it("resolves the meta_reviewer pane index from canonical topology bindings", () => {
    expect(resolveWatchdogTargetPaneIndex("meta_reviewer")).toBe(3);
  });

  it("preserves BubbleWatchdogError fail-closed boundary for invalid active roles", () => {
    expect(() => resolveWatchdogTargetPaneIndex("human" as never)).toThrow(
      BubbleWatchdogError
    );
  });

  it("returns no_session when the runtime session is missing", async () => {
    const runner = vi.fn<TmuxRunner>();

    const result = await sampleWatchdogPaneActivity({
      bubbleId: "b_watchdog_sampler_missing",
      bubbleConfig,
      sessionsPath: "/tmp/runtime-sessions.json",
      activeRole: "implementer",
      now: new Date("2026-03-27T20:20:00.000Z"),
      runner,
      readSessionsRegistry: () => Promise.resolve({})
    });

    expect(result).toEqual({
      status: "no_session",
      sampled_at: "2026-03-27T20:20:00.000Z",
      error: "runtime session missing for bubble b_watchdog_sampler_missing"
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns pane_unreadable when tmux capture-pane fails", async () => {
    const runner = vi.fn<TmuxRunner>(() =>
      Promise.resolve({
        stdout: "",
        stderr: "can't find pane: pf-watchdog-sampler:0.2",
        exitCode: 1
      })
    );

    const result = await sampleWatchdogPaneActivity({
      bubbleId: "b_watchdog_sampler_unreadable",
      bubbleConfig,
      sessionsPath: "/tmp/runtime-sessions.json",
      activeRole: "reviewer",
      now: new Date("2026-03-27T20:21:00.000Z"),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve({
          b_watchdog_sampler_unreadable: {
            bubbleId: "b_watchdog_sampler_unreadable",
            repoPath: "/tmp/pairflow",
            worktreePath: "/tmp/pairflow-worktree",
            tmuxSessionName: "pf-watchdog-sampler",
            updatedAt: "2026-03-27T20:20:30.000Z"
          }
        })
    });

    expect(result).toEqual({
      status: "pane_unreadable",
      sampled_at: "2026-03-27T20:21:00.000Z",
      error: "can't find pane: pf-watchdog-sampler:0.2",
      session_name: "pf-watchdog-sampler",
      target_pane: "pf-watchdog-sampler:0.2"
    });
    expect(runner).toHaveBeenCalledWith(
      [
        "capture-pane",
        "-pt",
        "pf-watchdog-sampler:0.2",
        "-S",
        WATCHDOG_PANE_ACTIVITY_CAPTURE_START_LINE
      ],
      { allowFailure: true }
    );
  });

  it("returns changed=false when the sampled pane hash matches priorPaneHash", async () => {
    const stdout = "watchdog pane output\n";
    const paneHash = createHash("sha1").update(stdout).digest("hex");
    const runner = vi.fn<TmuxRunner>(() =>
      Promise.resolve({
        stdout,
        stderr: "",
        exitCode: 0
      })
    );

    const result = await sampleWatchdogPaneActivity({
      bubbleId: "b_watchdog_sampler_stable",
      bubbleConfig,
      sessionsPath: "/tmp/runtime-sessions.json",
      activeRole: "implementer",
      priorPaneHash: paneHash,
      now: new Date("2026-03-27T20:22:00.000Z"),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve({
          b_watchdog_sampler_stable: {
            bubbleId: "b_watchdog_sampler_stable",
            repoPath: "/tmp/pairflow",
            worktreePath: "/tmp/pairflow-worktree",
            tmuxSessionName: "pf-watchdog-sampler",
            updatedAt: "2026-03-27T20:21:30.000Z"
          }
        })
    });

    expect(result).toEqual({
      status: "sampled",
      sampled_at: "2026-03-27T20:22:00.000Z",
      pane_hash: paneHash,
      changed: false,
      session_name: "pf-watchdog-sampler",
      target_pane: "pf-watchdog-sampler:0.1",
      has_esc_interrupt: false
    });
    expect(runner).toHaveBeenCalledWith(
      [
        "capture-pane",
        "-pt",
        "pf-watchdog-sampler:0.1",
        "-S",
        WATCHDOG_PANE_ACTIVITY_CAPTURE_START_LINE
      ],
      { allowFailure: true }
    );
  });

  it("returns has_esc_interrupt=true when the sampled pane stdout contains 'esc interrupt'", async () => {
    const stdout = "some text\n[esc] interrupt\n";
    const paneHash = createHash("sha1").update(stdout).digest("hex");
    const runner = vi.fn<TmuxRunner>(() =>
      Promise.resolve({
        stdout,
        stderr: "",
        exitCode: 0
      })
    );

    const result = await sampleWatchdogPaneActivity({
      bubbleId: "b_watchdog_sampler_active",
      bubbleConfig,
      sessionsPath: "/tmp/runtime-sessions.json",
      activeRole: "implementer",
      now: new Date("2026-03-27T20:23:00.000Z"),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve({
          b_watchdog_sampler_active: {
            bubbleId: "b_watchdog_sampler_active",
            repoPath: "/tmp/pairflow",
            worktreePath: "/tmp/pairflow-worktree",
            tmuxSessionName: "pf-watchdog-sampler",
            updatedAt: "2026-03-27T20:21:30.000Z"
          }
        })
    });

    expect(result).toEqual({
      status: "sampled",
      sampled_at: "2026-03-27T20:23:00.000Z",
      pane_hash: paneHash,
      changed: true,
      session_name: "pf-watchdog-sampler",
      target_pane: "pf-watchdog-sampler:0.1",
      has_esc_interrupt: true
    });
  });

  describe("agent-specific busy detection", () => {
    const reasonixBubbleConfig: BubbleConfig = {
      ...bubbleConfig,
      agents: {
        implementer: "reasonix",
        reviewer: "reasonix",
        meta_reviewer: "reasonix"
      }
    };

    async function sampleWith(input: {
      config: BubbleConfig;
      stdout: string;
    }): Promise<PaneActivitySampleResult> {
      return sampleWatchdogPaneActivity({
        bubbleId: "b_watchdog_sampler_busy",
        bubbleConfig: input.config,
        sessionsPath: "/tmp/runtime-sessions.json",
        activeRole: "implementer",
        now: new Date("2026-03-27T20:24:00.000Z"),
        runner: vi.fn<TmuxRunner>(() =>
          Promise.resolve({ stdout: input.stdout, stderr: "", exitCode: 0 })
        ),
        readSessionsRegistry: () =>
          Promise.resolve({
            b_watchdog_sampler_busy: {
              bubbleId: "b_watchdog_sampler_busy",
              repoPath: "/tmp/pairflow",
              worktreePath: "/tmp/pairflow-worktree",
              tmuxSessionName: "pf-watchdog-sampler",
              updatedAt: "2026-03-27T20:21:30.000Z"
            }
          })
      });
    }

    // Captured from a live reasonix pane that was mid-turn while the watchdog
    // queued repeated nudges onto it.
    const reasonixWorkingPane = [
      "  ⎿  ⠦ working · 5s",
      "  ⣟  working · 177s · ↓4.2K · ✎ 4 in inbox",
      "────────────────────────────────────────────",
      " ❯"
    ].join("\n");

    const reasonixIdlePane = [
      "◆ reasonix  · deepseek-v4-flash",
      "  Context is kept across turns. Type 'exit' or Ctrl-D to quit.",
      "────────────────────────────────────────────",
      " ❯",
      "   YOLO  · tool approvals skipped · Shift+Tab ask/auto/plan"
    ].join("\n");

    it("treats a working reasonix pane as busy so the watchdog does not nudge it", async () => {
      const result = await sampleWith({
        config: reasonixBubbleConfig,
        stdout: reasonixWorkingPane
      });

      expect(result).toMatchObject({
        status: "sampled",
        has_esc_interrupt: true
      });
    });

    it("treats an idle reasonix composer as not busy", async () => {
      const result = await sampleWith({
        config: reasonixBubbleConfig,
        stdout: reasonixIdlePane
      });

      expect(result).toMatchObject({
        status: "sampled",
        has_esc_interrupt: false
      });
    });

    it("does not treat reasonix progress text as busy for an opencode pane", async () => {
      const result = await sampleWith({
        config: bubbleConfig,
        stdout: reasonixWorkingPane
      });

      expect(result).toMatchObject({
        status: "sampled",
        has_esc_interrupt: false
      });
    });
  });
});
