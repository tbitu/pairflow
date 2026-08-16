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

describe("composeRolePrompt (reasonix role-identity startup prompt)", () => {
  it("returns role concern lines for the implementer on a tmux_paste agent", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "implementer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeGreaterThan(0);
    // Role-specific implementer guidance should be present.
    expect(prompt!).toContain("pairflow agent emit --kind pass");
  });

  it("returns undefined for opencode (no tmux-paste role delivery)", () => {
    const prompt = composeRolePrompt({
      agentName: "opencode",
      role: "implementer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeUndefined();
  });

  it("produces reviewer role guidance including the severity ontology reminder", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "reviewer",
      phase: "startup",
      context: {
        ...baseContext,
        policySnapshotPathAbs: "/tmp/bubble/policy.md"
      }
    });

    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it("produces meta-reviewer role guidance", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "meta_reviewer",
      phase: "startup",
      context: baseContext
    });

    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it("returns implementer role guidance on resume for reasonix", () => {
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

    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeGreaterThan(0);
    expect(prompt!).toContain("pairflow agent emit --kind pass");
  });

  it("returns reviewer role guidance on resume for reasonix", () => {
    const prompt = composeRolePrompt({
      agentName: "reasonix",
      role: "reviewer",
      phase: "resume",
      context: {
        ...baseContext,
        policySnapshotPathAbs: "/tmp/bubble/policy.md",
        state: { state: "RUNNING", round: 2, active_agent: "reasonix", active_role: "reviewer", active_since: null },
        transcriptSummary: "reviews implementation"
      }
    });

    expect(prompt).toBeDefined();
    expect(prompt!.length).toBeGreaterThan(0);
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
