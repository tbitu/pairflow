import { describe, expect, it } from "vitest";

import {
  buildEmitFailureFix,
  buildEmitFailureHint,
  emitFailureFixTable,
  emitRecipeLocationLine
} from "../../../../src/v11/shared/actorProtocol/emitFailureGuidance.js";

describe("emitFailureGuidance", () => {
  it("keeps every table row complete and uniquely identifiable", () => {
    expect(emitFailureFixTable.length).toBeGreaterThan(20);
    const signatures = new Set<string>();
    for (const row of emitFailureFixTable) {
      expect(row.signature.trim().length).toBeGreaterThan(0);
      expect(row.fix.trim().length).toBeGreaterThan(0);
      expect(signatures.has(row.signature)).toBe(false);
      signatures.add(row.signature);
    }
  });

  it("maps the recorded rejections to a fix", () => {
    const cases: Array<{ message: string; expect: string }> = [
      {
        message:
          "meta-review submit report_json requires findings_claim_state and findings_claim_source fields",
        expect: "top-level keys of the `--report-json` object"
      },
      {
        message:
          "Active actor authority is unavailable for state WAITING_HUMAN; cannot materialize canonical actor emit context.",
        expect: "you do not owe an emit"
      },
      {
        message:
          "Canonical actor emit handoff mismatch: expected msg_20260815_018, active reviewer:1-core-types:round:6:attempt:1.",
        expect: "copy `executionContext.handoffId` verbatim"
      },
      {
        message:
          "Implementer PASS does not accept findings flags; findings are reviewer-only.",
        expect: "findings are reviewer-only"
      },
      {
        message:
          "REVIEWER_INTENT_OVERRIDE_INVALID: Reviewer PASS with findings cannot use intent=review.",
        expect: "--intent fix_request"
      },
      {
        message:
          "CONVERGED_SUMMARY_FINDINGS_CONTRADICTION: Summary indicates open findings but no structured findings were provided.",
        expect: "add `--finding` entries"
      },
      {
        message:
          "Invalid --report-json value. Must be valid JSON object. Unexpected token '/', \"/tmp/meta_\"... is not valid JSON",
        expect: "a file path"
      },
      {
        message: "spawn git ENOENT",
        expect: "git"
      },
      {
        message: "ACTOR_EMIT_INPUT_EXECUTION_ID_MISSING: Missing required option: --execution-id",
        expect: "executionContext.executionId"
      },
      {
        message: "CLAIM_SOURCE_INVALID: previous reviewer PASS findings_claim_source is required when findings_claim_state is provided.",
        expect: "meta_review_artifact"
      }
    ];

    for (const testCase of cases) {
      expect(buildEmitFailureFix(testCase.message)).toContain(testCase.expect);
    }
  });

  it("builds a hint with the fix and the recipe pointer", () => {
    const hint = buildEmitFailureHint("spawn git ENOENT");
    expect(hint).toContain("Fix: ");
    expect(hint).toContain("git");
    expect(hint).toContain("pairflow agent emit --help");
  });

  it("still points at the recipe for an unmapped signature", () => {
    const hint = buildEmitFailureHint("SOME_NEW_UNMAPPED_FAILURE: ???");
    expect(hint).toContain("No mapped fix");
    expect(hint).toContain("pairflow agent emit --help");
  });

  it("names only resolvable recipe roots", () => {
    expect(emitRecipeLocationLine).toContain("~/.reasonix/skills");
    expect(emitRecipeLocationLine).toContain("~/.config/opencode/skills");
    expect(emitRecipeLocationLine).toContain("~/.opencode/skills");
    expect(emitRecipeLocationLine).toContain("~/.claude/skills");
    expect(emitRecipeLocationLine).toContain("~/.gemini/config/skills");
    // `~/.agents/skills` is not an install destination, so the
    // recipe is not resolvable from there.
    expect(emitRecipeLocationLine).not.toContain("~/.agents/skills");
  });
});
