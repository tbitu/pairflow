import { describe, expect, it } from "vitest";

import {
  assertSummaryStructuredParity
} from "../../../../src/v11/application/metaReview/internal/submit/parity.js";
import {
  buildMetaReviewSubmitCorrectedReportJson
} from "../../../../src/v11/shared/metaReview/metaReviewSubmitGuidance.js";

function captureSummaryStructuredParity(input: {
  recommendation: "approve" | "rework" | "inconclusive";
  summary: string;
  reportJson: Record<string, unknown>;
}): { message: string; reason: string } {
  try {
    assertSummaryStructuredParity(input);
  } catch (error) {
    const metaReviewError = error as { message: string; context?: { reason?: string } };
    return {
      message: metaReviewError.message,
      reason: metaReviewError.context?.reason ?? ""
    };
  }
  throw new Error("Expected assertSummaryStructuredParity to reject the payload.");
}

describe("meta-review submit parity diagnostics", () => {
  it("names the top-level keys and returns the corrected payload when the claim pair is missing", () => {
    const captured = captureSummaryStructuredParity({
      recommendation: "approve",
      summary: "Meta-review clean, approving.",
      reportJson: { findings: [{ claim_state: "verified", claim_source: "src" }] }
    });

    expect(captured.reason).toBe("structured_claim_fields_missing");
    expect(captured.message).toContain(
      "missing the required top-level claim keys findings_claim_state and findings_claim_source"
    );
    expect(captured.message).toContain("never nested inside a `findings` entry");
    expect(captured.message).toContain(
      `'${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "approve" })}'`
    );
    expect(captured.message).toContain("does not accept a file path");
  });

  it("returns the rework payload when a rework submit omits the claim pair", () => {
    const captured = captureSummaryStructuredParity({
      recommendation: "rework",
      summary: "Blocking findings remain.",
      reportJson: {}
    });

    expect(captured.message).toContain(
      `'${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "rework" })}'`
    );
  });

  it("returns the corrected payload when findings_count is missing or invalid", () => {
    const missing = captureSummaryStructuredParity({
      recommendation: "inconclusive",
      summary: "Meta-review remains inconclusive.",
      reportJson: {
        findings_claim_state: "unknown",
        findings_claim_source: "meta_review_artifact"
      }
    });
    expect(missing.reason).toBe("findings_count_missing");
    expect(missing.message).toContain(
      `'${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "inconclusive" })}'`
    );

    const invalid = captureSummaryStructuredParity({
      recommendation: "inconclusive",
      summary: "Meta-review remains inconclusive.",
      reportJson: {
        findings_claim_state: "unknown",
        findings_claim_source: "meta_review_artifact",
        findings_count: "0"
      }
    });
    expect(invalid.reason).toBe("findings_count_invalid");
    expect(invalid.message).toContain("must be a non-negative integer");
    expect(invalid.message).toContain(
      `'${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "inconclusive" })}'`
    );
  });

  it("accepts the corrected payload it advertises for every recommendation", () => {
    const inconclusive = buildMetaReviewSubmitCorrectedReportJson({
      recommendation: "inconclusive"
    });
    expect(() =>
      assertSummaryStructuredParity({
        recommendation: "inconclusive",
        summary: "Meta-review remains inconclusive.",
        reportJson: JSON.parse(inconclusive) as Record<string, unknown>
      })
    ).not.toThrow();
  });
});
