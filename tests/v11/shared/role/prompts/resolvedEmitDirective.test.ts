import { describe, expect, it } from "vitest";

import {
  buildResolvedImplementerEmitCommand,
  buildResolvedReviewerEmitDirective
} from "../../../../../src/v11/shared/role/prompts/resolvedEmitDirective.js";

const base = {
  repoPath: "/repo/path",
  bubbleId: "bubble-123"
};

describe("buildResolvedReviewerEmitDirective", () => {
  it("resolves the pre-gate branch with real numbers and prefilled repo/bubble-id", () => {
    const directive = buildResolvedReviewerEmitDirective({
      round: 2,
      severityGateRound: 5,
      ...base
    });
    expect(directive).toContain("Round 2 < severity_gate_round 5 (pre-gate)");
    expect(directive).toContain("every outcome uses `--kind pass`");
    expect(directive).toContain("bare `--no-findings`");
    expect(directive).toContain("never `--no-findings=<value>`");
    expect(directive).toContain("--repo /repo/path");
    expect(directive).toContain("--bubble-id bubble-123");
    expect(directive).toContain("refresh `--handoff-id` and `--execution-id` from `executionContext`");
  });

  it("resolves the post-gate branch including threshold label and convergence rule", () => {
    const directive = buildResolvedReviewerEmitDirective({
      round: 5,
      severityGateRound: 5,
      ...base
    });
    expect(directive).toContain("Round 5 >= severity_gate_round 5 (post-gate");
    expect(directive).toContain("`--no-findings` is forbidden");
    expect(directive).toContain("Clean outcome -> `--kind convergence` with no finding flags");
    expect(directive).toContain("`--kind convergence` with `--finding \"P2|P3:Title\"` entries");
    expect(directive).toContain("threshold `review_policy.reviewer_blocking_min_severity=P3`");
    expect(directive).not.toContain("bare `--no-findings`");
  });

  it("uses the configured blocking min severity in the threshold label", () => {
    const directive = buildResolvedReviewerEmitDirective({
      round: 6,
      severityGateRound: 5,
      reviewerBlockingMinSeverity: "P2",
      ...base
    });
    expect(directive).toContain("threshold `review_policy.reviewer_blocking_min_severity=P2`");
    expect(directive).toContain("Any finding at or above the threshold -> `--kind pass`");
  });

  it("adds the document-scope qualifier note for document artifacts", () => {
    const directive = buildResolvedReviewerEmitDirective({
      round: 6,
      severityGateRound: 5,
      reviewArtifactType: "document",
      ...base
    });
    expect(directive).toContain("Document scope: unqualified `P0/P1` findings route as `P2`");
  });
});

describe("buildResolvedImplementerEmitCommand", () => {
  it("prefills repo and bubble id into the pass command and keeps authority tokens fresh", () => {
    const command = buildResolvedImplementerEmitCommand(base);
    expect(command).toContain("Resolved handoff command");
    expect(command).toContain("pairflow agent emit --kind pass --repo /repo/path --bubble-id bubble-123");
    expect(command).toContain("--handoff-id <fresh executionContext.handoffId>");
    expect(command).toContain("--execution-id <fresh executionContext.executionId>");
    expect(command).toContain("refresh `--handoff-id` and `--execution-id` from `executionContext`");
  });
});
