import { describe, expect, it } from "vitest";

import {
  buildRoleAgentStandingPromptBody,
  renderOpencodeRoleAgentFile,
  renderReasonixRoleAgentProfileFile,
  roleAgentDefinitions,
  roleAgentNames
} from "../../../../src/v11/shared/agent/roleAgentStandingPrompts.js";

describe("role agent standing prompts", () => {
  it("covers every Pairflow role", () => {
    expect([...roleAgentNames]).toEqual([
      "PF-implementer",
      "PF-reviewer",
      "PF-meta-reviewer"
    ]);
    expect(roleAgentDefinitions.map((entry) => entry.role)).toEqual([
      "implementer",
      "reviewer",
      "meta_reviewer"
    ]);
  });

  it("carries the shared authority and kind-lock rules for every role", () => {
    for (const name of roleAgentNames) {
      const body = buildRoleAgentStandingPromptBody(name);
      expect(body).toContain("Authority values are machine-minted");
      expect(body).toContain("no active `executionContext`");
      expect(body).toContain("Role-to-kind lock");
      expect(body).toContain("UsePairflow");
      expect(body).toContain("references/agent-emit-recipes.md");
      expect(body).toContain("~/.reasonix/skills");
      expect(body).toContain("pairflow bubble emit-log");
      expect(body).toContain("pairflow bubble emit-log");
    }
  });

  it("gives the implementer the pass handoff and evidence-ref rule", () => {
    const body = buildRoleAgentStandingPromptBody("PF-implementer");

    expect(body).toContain("--kind pass");
    expect(body).toContain("Finding flags are reviewer-only");
    expect(body).toContain("`.pairflow/evidence/*.log`");
    expect(body).toContain("--kind human_question");
  });

  it("gives the reviewer the decision gate, intent rules and severity ontology", () => {
    const body = buildRoleAgentStandingPromptBody("PF-reviewer");

    expect(body).toContain("Reviewer decision gate");
    expect(body).toContain("--intent fix_request");
    expect(body).toContain("Severity Ontology v1 reminder");
    expect(body).not.toContain("findings_claim_state");
  });

  it("gives the meta-reviewer the required report-json keys and payload examples", () => {
    const body = buildRoleAgentStandingPromptBody("PF-meta-reviewer");

    expect(body).toContain("findings_claim_state");
    expect(body).toContain("findings_claim_source");
    expect(body).toContain("findings_count");
    expect(body).toContain("Never nest");
    expect(body).toContain("Minimal clean approve payload");
    expect(body).toContain("Minimal rework payload");
    expect(body).toContain("Minimal inconclusive payload");
    expect(body).toContain("emit `--kind meta_review_result` only");
  });

  it("renders an opencode agent file with managed description and preserved model", () => {
    const rendered = renderOpencodeRoleAgentFile({
      name: "PF-reviewer",
      existingContent:
        "---\ndescription: SENTINEL_OLD_DESCRIPTION\nmodel: lmstudio/pairflow-reviewer\n---\nSENTINEL_OLD_BODY\n"
    });

    expect(rendered.startsWith("---\n")).toBe(true);
    expect(rendered).toContain(
      "description: 'Pairflow Reviewer: review the implementation against the Pairflow severity ontology"
    );
    expect(rendered).toContain("model: lmstudio/pairflow-reviewer");
    expect(rendered).not.toContain("SENTINEL_OLD_DESCRIPTION");
    expect(rendered).not.toContain("SENTINEL_OLD_BODY");
    expect(rendered).toContain("Authority values are machine-minted");
  });

  it("renders a reasonix profile with its own frontmatter dialect", () => {
    const rendered = renderReasonixRoleAgentProfileFile({
      name: "PF-meta-reviewer",
      existingContent: "---\nmodel: lmstudio/pairflow-meta-reviewer\n---\nOld\n"
    });

    expect(rendered).toContain("name: PF-meta-reviewer");
    expect(rendered).toContain("invocation: manual");
    expect(rendered).toContain("runAs: subagent");
    expect(rendered).toContain("todos: false");
    expect(rendered).toContain("model: lmstudio/pairflow-meta-reviewer");
    expect(rendered).toContain("Minimal clean approve payload");
  });

  it("renders a valid file when no previous definition exists", () => {
    const rendered = renderOpencodeRoleAgentFile({
      name: "PF-implementer",
      existingContent: null
    });

    expect(rendered.split("---\n")).toHaveLength(3);
    expect(rendered).toContain("Pairflow Implementer");
  });
});
