import { describe, expect, it } from "vitest";

import { resolveResumeKickoffMessages } from "../../../../src/v11/application/start/internal/prompts/startCommandResumeKickoffMessages.js";
import type { PersistedBubbleStateSnapshot } from "../../../../src/v11/domain/state/snapshot/persistedBubbleStateSnapshot.js";

function createRunningMetaReviewerState(
  activeAgent: "opencode" | "reasonix",
  activeRole: "implementer" | "reviewer" | "meta_reviewer" = "meta_reviewer"
): PersistedBubbleStateSnapshot {
  return {
    bubble_id: "b_resume_kickoff_meta_01",
    state: "RUNNING",
    round: 4,
    active_agent: activeAgent,
    active_since: "2026-04-26T12:00:00.000Z",
    active_role: activeRole,
    execution_context: null,
    round_role_history: [],
    last_command_at: "2026-04-26T12:00:00.000Z"
  };
}

function createBaseInput(state: PersistedBubbleStateSnapshot) {
  return {
    bubbleId: "b_resume_kickoff_meta_01",
    repoPath: "/tmp/repo",
    workspacePath: "/tmp/worktree",
    taskArtifactPath: "/tmp/worktree/.pairflow/task.md",
    reviewArtifactType: "code" as const,
    pairflowCommandProfile: "external" as const,
    state,
    transcriptSummary: "resume-summary: meta-review active",
    implementerAgent: "opencode" as const,
    reviewerAgent: "opencode" as const,
    metaReviewerAgent: "opencode" as const
  };
}

describe("startCommandResumeKickoffMessages", () => {
  it("sends the meta-reviewer kickoff only when RUNNING meta-review authority matches the configured agent", () => {
    const resolved = resolveResumeKickoffMessages(
      createBaseInput(createRunningMetaReviewerState("opencode"))
    );

    expect(resolved.metaReviewerKickoffMessage).toContain(
      "resume kickoff (meta-reviewer)"
    );
    expect(resolved.kickoffDiagnostic).toBeUndefined();
    expect(resolved.implementerKickoffMessage).toBeUndefined();
    expect(resolved.reviewerKickoffMessage).toBeUndefined();
  });

  it("fails closed with a diagnostic when RUNNING meta-review authority does not match the configured agent", () => {
    const resolved = resolveResumeKickoffMessages(
      createBaseInput(createRunningMetaReviewerState("review-gpt" as never))
    );

    expect(resolved.metaReviewerKickoffMessage).toBeUndefined();
    expect(resolved.kickoffDiagnostic).toContain(
      "RUNNING meta-review state active context is inconsistent;"
    );
    expect(resolved.kickoffDiagnostic).toContain("active_role=meta_reviewer,");
    expect(resolved.kickoffDiagnostic).toContain("active_agent=review-gpt.");
    expect(resolved.kickoffDiagnostic).toContain(
      "configured_meta_reviewer=opencode."
    );
  });

  it("routes a reasonix meta-reviewer resume through the full guidance builder (no minimal stripping)", () => {
    const resolved = resolveResumeKickoffMessages({
      ...createBaseInput(createRunningMetaReviewerState("reasonix")),
      metaReviewerAgent: "reasonix" as const
    });

    expect(resolved.metaReviewerKickoffMessage).toBeDefined();
    // The full guidance form includes pairflow-command guidance, which the
    // minimal opencode kickoff strips.
    expect(resolved.metaReviewerKickoffMessage).toContain(
      "Default command profile is `external`"
    );
    expect(resolved.kickoffDiagnostic).toBeUndefined();
  });

  it("routes a reasonix implementer resume through the full guidance builder", () => {
    const resolved = resolveResumeKickoffMessages({
      ...createBaseInput(createRunningMetaReviewerState("reasonix", "implementer")),
      implementerAgent: "reasonix" as const
    });

    expect(resolved.implementerKickoffMessage).toBeDefined();
    expect(resolved.implementerKickoffMessage).toContain(
      "Default command profile is `external`"
    );
    expect(resolved.implementerKickoffMessage).toContain(
      "resume kickoff (implementer)"
    );
    expect(resolved.kickoffDiagnostic).toBeUndefined();
  });
});
