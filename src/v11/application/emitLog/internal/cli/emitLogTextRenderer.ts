import {
  buildEmitAttemptFlagSkeleton
} from "../../../../shared/actorProtocol/emitHistoryReport.js";
import type { BubbleEmitLogResult } from "../../emitLogCommandContract.js";

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatKindCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}=${count}`);
  return parts.length === 0 ? "none" : parts.join(" ");
}

/**
 * Render the emit attempt report as operator-readable text.
 *
 * The first line is the summary; every subsequent block is one failure
 * signature ordered by descending count, so the most expensive repeated mistake
 * is always immediately visible.
 */
export function renderBubbleEmitLogText(result: BubbleEmitLogResult): string {
  const { report } = result;
  const scopeLabel =
    result.scope === "bubble"
      ? `bubble ${result.bubbleId ?? "<unknown>"}`
      : result.scope === "file"
        ? "explicit log file"
        : "repo runtime log";
  const lines: string[] = [
    `Emit log: ${scopeLabel}`,
    `Log file: ${report.log_path ?? "<unresolved>"}`,
    `Attempts: ${report.total} total, ${report.success} success, ${report.rejected} rejected (failure rate ${formatRate(report.failure_rate)})`,
    `Kinds: success ${formatKindCounts(report.success_by_kind)} | rejected ${formatKindCounts(report.rejected_by_kind)}`
  ];

  const rejectedBubbles = Object.entries(report.rejected_by_bubble).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  if (rejectedBubbles.length > 1) {
    lines.push(
      `Rejections by bubble: ${rejectedBubbles
        .map(([bubble, count]) => `${bubble}=${count}`)
        .join(" ")}`
    );
  }

  if (report.signatures.length === 0) {
    lines.push("");
    lines.push("No rejected emit attempts recorded.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`Failure signatures (${report.signatures.length}):`);
  report.signatures.forEach((signature, index) => {
    lines.push(
      `${index + 1}. ${signature.count}x  kinds: ${formatKindCounts(signature.kinds)}`
    );
    lines.push(`   error: ${signature.error_reason}`);
    lines.push(
      `   window: ${signature.first_ts ?? "<unknown>"} -> ${signature.last_ts ?? "<unknown>"}`
    );
    lines.push(`   flags: ${buildEmitAttemptFlagSkeleton(signature.example_args)}`);
  });

  return lines.join("\n");
}
