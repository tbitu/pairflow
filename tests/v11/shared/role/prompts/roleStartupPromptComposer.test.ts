import { describe, expect, it } from "vitest";

import { composeRolePrompt } from "../../../../../src/v11/shared/role/prompts/roleStartupPromptComposer.js";
import type { PairflowCommandProfile } from "../../../../../src/v11/shared/config/bubbleConfigVocabulary.js";

const profile: PairflowCommandProfile = "external";

const baseContext = {
  bubbleId: "b_role_01",
  repoPath: "/tmp/repo/pairflow",
  workspacePath: "/tmp/worktree/role-test",
  taskArtifactPath: "tasks/test.md",
  pairflowCommandProfile: profile
};

describe("composeRolePrompt (non-tmux_paste agents return undefined)", () => {
  it("returns undefined for reasonix on startup (role delivered via artifact file, not paste)", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "implementer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeUndefined();
  });

  it("returns undefined for opencode on startup (role delivered via --agent CLI arg)", () => {
    const prompt = composeRolePrompt({
      agentName: "opencode",
      role: "implementer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeUndefined();
  });

  it("returns undefined for reasonix reviewer on startup", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "reviewer",
      phase: "startup",
      context: {
        ...baseContext,
        policySnapshotPathAbs: "/tmp/bubble/policy.md"
      }
    });

    expect(prompt).toBeUndefined();
  });

  it("returns undefined for reasonix meta-reviewer on startup", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "meta_reviewer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeUndefined();
  });

  it("returns undefined for reasonix on resume", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "implementer",
      phase: "resume",
      context: {
        ...baseContext,
        state: { state: "RUNNING", round: 1, active_agent: "reasonix", active_role: "implementer", active_since: null },
        transcriptSummary: "implements a test task"
      }
    });

    expect(prompt).toBeUndefined();
  });

  it("returns undefined for opencode on resume (role delivered via --agent, not paste)", () => {
    const prompt = composeRolePrompt({
      agentName: "opencode",
      role: "implementer",
      phase: "resume",
      context: {
        ...baseContext,
        state: { state: "RUNNING", round: 1, active_agent: "opencode", active_role: "implementer", active_since: null },
        transcriptSummary: "implements a test task"
      }
    });

    expect(prompt).toBeUndefined();
  });
});
