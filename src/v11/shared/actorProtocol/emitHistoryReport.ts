import type { AgentEmitAttemptEntry } from "./emitHistoryStore.js";

/**
 * Read-side contract for the emit attempt log (`emit-history.ndjson`).
 *
 * The store records every `pairflow agent emit` attempt (success and rejection)
 * with its argv. This report collapses the raw attempt stream into failure
 * signatures so repeated identical mistakes are visible instead of silently
 * accruing round after round.
 */
export interface EmitHistoryFailureSignature {
  error_reason: string;
  count: number;
  kinds: Record<string, number>;
  first_ts: string | null;
  last_ts: string | null;
  example_args: string[];
}

export interface EmitHistoryReport {
  log_path: string | null;
  total: number;
  success: number;
  rejected: number;
  failure_rate: number | null;
  success_by_kind: Record<string, number>;
  rejected_by_kind: Record<string, number>;
  rejected_by_bubble: Record<string, number>;
  signatures: EmitHistoryFailureSignature[];
}

const unknownKindLabel = "<unknown>";
const maxExampleArgLength = 240;

/**
 * Collapse a raw argv into the flag skeleton of the command: flag names are
 * kept, flag *values* are replaced by a placeholder. The result shows which
 * flags a failing attempt used (and which it missed) without dumping a whole
 * summary payload into the report.
 */
export function buildEmitAttemptFlagSkeleton(args: readonly string[]): string {
  const skeleton: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg.startsWith("--")) {
      const hasInlineValue = arg.includes("=");
      const hasSeparateValue =
        !hasInlineValue
        && index + 1 < args.length
        && !(args[index + 1] ?? "").startsWith("--");
      skeleton.push(hasInlineValue ? `${arg.slice(0, arg.indexOf("="))}=<value>` : arg);
      index += hasSeparateValue ? 2 : 1;
      continue;
    }
    skeleton.push(arg);
    index += 1;
  }
  return skeleton.join(" ");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function normalizeSignatureKey(errorReason: string | null | undefined): string {
  const trimmed = (errorReason ?? "").trim();
  return trimmed.length === 0 ? "<no error reason recorded>" : trimmed;
}

function countKind(
  target: Record<string, number>,
  rawKind: string | null | undefined
): void {
  const kind = rawKind !== null && rawKind !== undefined && rawKind.length > 0
    ? rawKind
    : unknownKindLabel;
  target[kind] = (target[kind] ?? 0) + 1;
}

function toTimestampMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Aggregate raw emit attempts into totals plus per-error-signature clusters.
 * Signatures are sorted by descending count, then by first occurrence, so the
 * most expensive mistake is always the first line of the report.
 */
export function buildEmitHistoryReport(input: {
  entries: readonly AgentEmitAttemptEntry[];
  logPath: string | null;
}): EmitHistoryReport {
  const successByKind: Record<string, number> = {};
  const rejectedByKind: Record<string, number> = {};
  const rejectedByBubble: Record<string, number> = {};
  const signatures = new Map<
    string,
    {
      count: number;
      kinds: Record<string, number>;
      firstTs: string | null;
      firstTsMs: number | null;
      lastTs: string | null;
      lastTsMs: number | null;
      exampleArgs: string[];
    }
  >();

  let success = 0;
  let rejected = 0;

  for (const entry of input.entries) {
    if (entry.status === "success") {
      success += 1;
      countKind(successByKind, entry.kind);
      continue;
    }

    rejected += 1;
    countKind(rejectedByKind, entry.kind);
    countKind(rejectedByBubble, entry.bubble_id ?? null);
    const key = normalizeSignatureKey(entry.error_reason);
    const bucket = signatures.get(key) ?? {
      count: 0,
      kinds: {},
      firstTs: null,
      firstTsMs: null,
      lastTs: null,
      lastTsMs: null,
      exampleArgs: entry.args
    };
    bucket.count += 1;
    countKind(bucket.kinds, entry.kind);
    if (entry.args.length > 0) {
      bucket.exampleArgs = entry.args;
    }
    const tsMs = toTimestampMs(entry.ts);
    if (tsMs !== null) {
      if (bucket.firstTsMs === null || tsMs < bucket.firstTsMs) {
        bucket.firstTsMs = tsMs;
        bucket.firstTs = entry.ts;
      }
      if (bucket.lastTsMs === null || tsMs > bucket.lastTsMs) {
        bucket.lastTsMs = tsMs;
        bucket.lastTs = entry.ts;
      }
    }
    signatures.set(key, bucket);
  }

  const orderedSignatures = [...signatures.entries()]
    .map(([errorReason, bucket]): EmitHistoryFailureSignature => ({
      error_reason: errorReason,
      count: bucket.count,
      kinds: bucket.kinds,
      first_ts: bucket.firstTs,
      last_ts: bucket.lastTs,
      example_args: bucket.exampleArgs.map((arg) =>
        truncate(arg, maxExampleArgLength)
      )
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return (left.first_ts ?? "").localeCompare(right.first_ts ?? "");
    });

  const total = success + rejected;
  return {
    log_path: input.logPath,
    total,
    success,
    rejected,
    failure_rate: total === 0 ? null : rejected / total,
    success_by_kind: successByKind,
    rejected_by_kind: rejectedByKind,
    rejected_by_bubble: rejectedByBubble,
    signatures: orderedSignatures
  };
}
