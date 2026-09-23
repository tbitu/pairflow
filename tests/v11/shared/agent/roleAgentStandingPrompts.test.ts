import { describe, expect, it } from "vitest";

import type { AgentRole } from "../../../../src/contracts/kernel/agentIdentity.js";
import {
  buildRoleStandingPromptBody,
  renderRoleInstructionMarkdown
} from "../../../../src/v11/shared/agent/roleAgentStandingPrompts.js";

const roles: AgentRole[] = ["implementer", "reviewer", "meta_reviewer"];

describe("role standing prompts", () => {
  it("carries the shared authority and kind-lock rules for every role", () => {
    for (const role of roles) {
      const body = buildRoleStandingPromptBody(role);
      expect(body).toContain("Authority values are machine-minted");
      expect(body).toContain("no active `executionContext`");
      expect(body).toContain("Role-to-kind lock");
      expect(body).toContain("UsePairflow");
      expect(body).toContain("references/agent-emit-recipes.md");
      expect(body).toContain("~/.reasonix/skills");
      expect(body).toContain("pairflow bubble emit-log");
    }
  });

  it("gives the implementer the pass handoff and evidence-ref rule", () => {
    const body = buildRoleStandingPromptBody("implementer");

    expect(body).toContain("--kind pass");
    expect(body).toContain("Finding flags are reviewer-only");
    expect(body).toContain("`.pairflow/evidence/*.log`");
    expect(body).toContain("--kind human_question");
  });

  it("gives the reviewer the decision gate, intent rules and severity ontology", () => {
    const body = buildRoleStandingPromptBody("reviewer");

    expect(body).toContain("Reviewer decision gate");
    expect(body).toContain("--intent fix_request");
    expect(body).toContain("Severity Ontology v1 reminder");
    expect(body).not.toContain("findings_claim_state");
  });

  it("gives the meta-reviewer the required report-json keys and payload examples", () => {
    const body = buildRoleStandingPromptBody("meta_reviewer");

    expect(body).toContain("findings_claim_state");
    expect(body).toContain("findings_claim_source");
    expect(body).toContain("findings_count");
    expect(body).toContain("Never nest");
    expect(body).toContain("Minimal clean approve payload");
    expect(body).toContain("Minimal rework payload");
    expect(body).toContain("Minimal inconclusive payload");
    expect(body).toContain("emit `--kind meta_review_result` only");
  });

  it("renders role instruction markdown for each role with heading and standing instructions", () => {
    const implementerMd = renderRoleInstructionMarkdown("implementer");
    expect(implementerMd).toContain("# Pairflow Implementer Instructions");
    expect(implementerMd).toContain("You are the Pairflow Implementer for this bubble.");
    expect(implementerMd).toContain("--kind pass");

    const reviewerMd = renderRoleInstructionMarkdown("reviewer");
    expect(reviewerMd).toContain("# Pairflow Reviewer Instructions");
    expect(reviewerMd).toContain("You are the Pairflow Reviewer for this bubble.");
    expect(reviewerMd).toContain("Reviewer decision gate");

    const metaReviewerMd = renderRoleInstructionMarkdown("meta_reviewer");
    expect(metaReviewerMd).toContain("# Pairflow Meta-Reviewer Instructions");
    expect(metaReviewerMd).toContain("You are the Pairflow Meta-Reviewer for this bubble.");
    expect(metaReviewerMd).toContain("Minimal clean approve payload");
  });
});
