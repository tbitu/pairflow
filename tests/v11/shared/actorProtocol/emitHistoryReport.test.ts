import { describe, expect, it } from "vitest";

import {
  buildEmitAttemptFlagSkeleton,
  buildEmitHistoryReport
} from "../../../../src/v11/shared/actorProtocol/emitHistoryReport.js";
import type { AgentEmitAttemptEntry } from "../../../../src/v11/shared/actorProtocol/emitHistoryStore.js";

function entry(
  overrides: Partial<AgentEmitAttemptEntry> & Pick<AgentEmitAttemptEntry, "status">
): AgentEmitAttemptEntry {
  return {
    ts: "2026-08-15T22:00:00.000Z",
    args: ["--kind", "pass"],
    ...overrides
  };
}

describe("emitHistoryReport", () => {
  it("counts totals, kinds and failure rate", () => {
    const report = buildEmitHistoryReport({
      logPath: "/repo/.pairflow/bubbles/b-1/emit-history.ndjson",
      entries: [
        entry({ status: "success", kind: "pass" }),
        entry({ status: "success", kind: "pass" }),
        entry({ status: "rejected", kind: "pass", error_reason: "boom" })
      ]
    });

    expect(report.log_path).toBe(
      "/repo/.pairflow/bubbles/b-1/emit-history.ndjson"
    );
    expect(report.total).toBe(3);
    expect(report.success).toBe(2);
    expect(report.rejected).toBe(1);
    expect(report.failure_rate).toBeCloseTo(1 / 3, 5);
    expect(report.success_by_kind).toEqual({ pass: 2 });
    expect(report.rejected_by_kind).toEqual({ pass: 1 });
  });

  it("reports a null failure rate when no attempts were recorded", () => {
    const report = buildEmitHistoryReport({ logPath: null, entries: [] });

    expect(report.total).toBe(0);
    expect(report.failure_rate).toBeNull();
    expect(report.signatures).toEqual([]);
  });

  it("clusters repeated rejections into one signature ordered by count", () => {
    const report = buildEmitHistoryReport({
      logPath: null,
      entries: [
        entry({
          status: "rejected",
          kind: "meta_review_result",
          bubble_id: "b-1",
          error_reason: "claim keys missing",
          ts: "2026-08-15T22:00:00.000Z"
        }),
        entry({
          status: "rejected",
          kind: "meta_review_result",
          bubble_id: "b-1",
          error_reason: "claim keys missing",
          ts: "2026-08-16T09:00:00.000Z"
        }),
        entry({
          status: "rejected",
          kind: "pass",
          bubble_id: "b-1",
          error_reason: "handoff mismatch",
          ts: "2026-08-15T23:00:00.000Z"
        })
      ]
    });

    expect(report.signatures).toHaveLength(2);
    const [first, second] = report.signatures;
    expect(first?.error_reason).toBe("claim keys missing");
    expect(first?.count).toBe(2);
    expect(first?.kinds).toEqual({ meta_review_result: 2 });
    expect(first?.first_ts).toBe("2026-08-15T22:00:00.000Z");
    expect(first?.last_ts).toBe("2026-08-16T09:00:00.000Z");
    expect(second?.error_reason).toBe("handoff mismatch");
    expect(second?.count).toBe(1);
  });

  it("attributes rejections per bubble and per kind including unknown values", () => {
    const report = buildEmitHistoryReport({
      logPath: null,
      entries: [
        entry({ status: "rejected", kind: "pass", bubble_id: "b-1" }),
        entry({ status: "rejected", kind: null, bubble_id: null }),
        entry({ status: "rejected", kind: "pass", bubble_id: "b-2" })
      ]
    });

    expect(report.rejected_by_bubble).toEqual({
      "b-1": 1,
      "b-2": 1,
      "<unknown>": 1
    });
    expect(report.rejected_by_kind).toEqual({ pass: 2, "<unknown>": 1 });
  });

  it("records a placeholder signature when no error reason was logged", () => {
    const report = buildEmitHistoryReport({
      logPath: null,
      entries: [entry({ status: "rejected", kind: "pass", error_reason: null })]
    });

    expect(report.signatures[0]?.error_reason).toBe(
      "<no error reason recorded>"
    );
  });

  it("keeps the most recent example argv for a signature", () => {
    const report = buildEmitHistoryReport({
      logPath: null,
      entries: [
        entry({
          status: "rejected",
          error_reason: "same",
          args: ["--kind", "pass", "--bubble-id", "b-1"]
        }),
        entry({
          status: "rejected",
          error_reason: "same",
          args: ["--kind", "convergence", "--bubble-id", "b-1"]
        })
      ]
    });

    expect(report.signatures[0]?.example_args).toEqual([
      "--kind",
      "convergence",
      "--bubble-id",
      "b-1"
    ]);
  });

  it("reduces argv to its flag skeleton", () => {
    expect(
      buildEmitAttemptFlagSkeleton([
        "--kind",
        "pass",
        "--summary",
        "a long summary that must not be echoed",
        "--ref",
        "one.log",
        "--json"
      ])
    ).toBe("--kind --summary --ref --json");

    expect(
      buildEmitAttemptFlagSkeleton(["--kind=pass", "--no-findings"])
    ).toBe("--kind=<value> --no-findings");
  });
});
