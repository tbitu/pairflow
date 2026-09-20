import { describe, expect, it } from "vitest";

import {
  buildMetaReviewSubmitAuthorityGuardLine,
  buildMetaReviewSubmitAdvisoryOnlyCorrectionNote,
  buildMetaReviewSubmitCommandTemplate,
  buildMetaReviewSubmitCorrectedReportJson,
  buildMetaReviewSubmitFailureRecoveryChecklist,
  buildMetaReviewSubmitRequiredReportJsonFieldsLine,
  buildMetaReviewSubmitUsageLine
} from "../../../src/v11/shared/metaReview/metaReviewSubmitGuidance.js";
import { getAgentEmitHelpText } from "../../../src/cli/commands/agent/emit.js";
import { buildMetaReviewerStartupPrompt } from "../../../src/v11/application/start/internal/prompts/startCommandPrompts.js";

describe("metaReviewSubmitGuidance", () => {
  it("keeps startup prompt aligned with the shared submit command contract", () => {
    const prompt = buildMetaReviewerStartupPrompt({
      bubbleId: "bubble_demo",
      repoPath: "/tmp/repo",
      workspacePath: "/tmp/repo/.pairflow-worktrees/bubble_demo",
      taskArtifactPath: "/tmp/repo/.pairflow/bubbles/bubble_demo/artifacts/task.md",
      pairflowCommandProfile: "external"
    });

    // Phase 4 consolidation: Prompts are not built locally. Agents reconstruct from metadata.
    expect(prompt).toBe("");
  });

  it("keeps agent emit help aligned with the shared submit usage line", () => {
    const helpText = getAgentEmitHelpText();
    const submitUsageLine = helpText.split("\n").find((line) =>
      line.includes("meta_review_result")
    );

    expect(submitUsageLine).toBe(`  ${buildMetaReviewSubmitUsageLine()}`);
    expect(helpText).not.toContain("--report-markdown");
  });

  it("keeps the advisory-only corrective note explicit in shared guidance", () => {
    const note = buildMetaReviewSubmitAdvisoryOnlyCorrectionNote();

    expect(note).toContain("keep recommendation=approve");
    expect(note).toContain("do not switch to inconclusive");
    expect(note).toContain("findings_claim_state=open_findings");
  });

  it("keeps meta-review emit authority-kind lock explicit in shared guidance", () => {
    const line = buildMetaReviewSubmitAuthorityGuardLine();

    expect(line).toContain("emit `--kind meta_review_result` only");
    expect(line).toContain("never `pass`, `convergence`, or `human_question`");
  });

  it("keeps class-level submit failure recovery checklist explicit", () => {
    const checklist = buildMetaReviewSubmitFailureRecoveryChecklist();

    expect(checklist).toContain("Invalid --report-json");
    expect(checklist).toContain("CLAIM_SOURCE_INVALID");
    expect(checklist).toContain("findings_count required/invalid");
    expect(checklist).toContain("META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT");
  });

  it("states the raw --report-json required keys and the wrong shape explicitly", () => {
    const line = buildMetaReviewSubmitRequiredReportJsonFieldsLine();

    expect(line).toContain("findings_claim_state");
    expect(line).toContain("findings_claim_source");
    expect(line).toContain("findings_count");
    expect(line).toContain("top-level keys");
    expect(line).toContain("Never nest");
    expect(line).toContain("never a file path");
  });

  it("keeps the meta-review command template and required-fields line in agreement", () => {
    const template = buildMetaReviewSubmitCommandTemplate({ bubbleId: "b-1", round: 3 });
    const requiredLine = buildMetaReviewSubmitRequiredReportJsonFieldsLine();

    for (const key of [
      "findings_claim_state",
      "findings_claim_source",
      "findings_count"
    ]) {
      expect(template).toContain(key);
      expect(requiredLine).toContain(key);
    }
    expect(template).toContain("--handoff-id <handoff-id>");
  });

  it("advertises a corrected report-json payload per recommendation", () => {
    const approve = JSON.parse(
      buildMetaReviewSubmitCorrectedReportJson({ recommendation: "approve" })
    ) as Record<string, unknown>;
    expect(approve).toMatchObject({
      findings_claim_state: "clean",
      findings_claim_source: "meta_review_artifact",
      findings_count: 0,
      findings_claimed_open_total: 0,
      findings_blocking_open_total: 0,
      findings_advisory_open_total: 0
    });

    const rework = JSON.parse(
      buildMetaReviewSubmitCorrectedReportJson({
        recommendation: "rework"
      }).replaceAll("<open-count>", "2").replaceAll("<blocking-count>", "2").replaceAll("<advisory-count>", "0")
    ) as Record<string, unknown>;
    expect(rework).toMatchObject({
      findings_claim_state: "open_findings",
      findings_count: 2,
      findings_claimed_open_total: 2
    });

    const inconclusive = JSON.parse(
      buildMetaReviewSubmitCorrectedReportJson({ recommendation: "inconclusive" })
    ) as Record<string, unknown>;
    expect(inconclusive).toMatchObject({
      findings_claim_state: "unknown",
      findings_claim_source: "meta_review_artifact",
      findings_count: 0
    });
  });

  it("returns full prompt for all agents including opencode", () => {
    const promptOpencode = buildMetaReviewerStartupPrompt({
      bubbleId: "bubble_demo",
      repoPath: "/tmp/repo",
      workspacePath: "/tmp/repo/.pairflow-worktrees/bubble_demo",
      taskArtifactPath: "/tmp/repo/.pairflow/bubbles/bubble_demo/artifacts/task.md",
      pairflowCommandProfile: "external",
      agentName: "opencode"
    });

    // Phase 4 consolidation: Prompts are not built locally. Agents reconstruct from metadata.
    expect(promptOpencode).toBe("");
  });

  it("returns full prompt when agent is not opencode", () => {
    const prompt = buildMetaReviewerStartupPrompt({
      bubbleId: "bubble_demo",
      repoPath: "/tmp/repo",
      workspacePath: "/tmp/repo/.pairflow-worktrees/bubble_demo",
      taskArtifactPath: "/tmp/repo/.pairflow/bubbles/bubble_demo/artifacts/task.md",
      pairflowCommandProfile: "external",
      agentName: "codex" as never
    });

    // Phase 4 consolidation: Prompts are not built locally. Agents reconstruct from metadata.
    expect(prompt).toBe("");
  });
});
