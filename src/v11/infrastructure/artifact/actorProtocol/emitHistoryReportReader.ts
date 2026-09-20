import { readFile } from "node:fs/promises";
import type { AgentEmitAttemptEntry } from "../../../shared/actorProtocol/emitHistoryStore.js";

export interface ReadEmitHistoryEntriesInput {
  logPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tolerant parser for one `emit-history.ndjson` line.
 *
 * The log is written best-effort and may contain a partially written trailing
 * line (an `agent emit` killed mid-append). Unparseable or shape-invalid lines
 * are skipped rather than failing the whole report.
 */
export function parseEmitHistoryLine(line: string): AgentEmitAttemptEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const status = parsed.status;
  if (status !== "success" && status !== "rejected") {
    return null;
  }
  const ts = parsed.ts;
  if (typeof ts !== "string") {
    return null;
  }
  const args = parsed.args;
  return {
    ts,
    status,
    args: Array.isArray(args)
      ? args.filter((arg): arg is string => typeof arg === "string")
      : [],
    bubble_id: typeof parsed.bubble_id === "string" ? parsed.bubble_id : null,
    repo: typeof parsed.repo === "string" ? parsed.repo : null,
    role: typeof parsed.role === "string" ? parsed.role : null,
    kind: typeof parsed.kind === "string" ? parsed.kind : null,
    error_reason:
      typeof parsed.error_reason === "string" ? parsed.error_reason : null,
    ...(typeof parsed.duration_ms === "number"
      ? { duration_ms: parsed.duration_ms }
      : {})
  };
}

/**
 * Read every parseable emit attempt from a log file. A missing log returns an
 * empty list: the log is created lazily on the first attempt, so "no file" means
 * "no attempts recorded", not an error.
 */
export async function readEmitHistoryEntries(
  input: ReadEmitHistoryEntriesInput
): Promise<AgentEmitAttemptEntry[]> {
  let raw: string;
  try {
    raw = await readFile(input.logPath, "utf8");
  } catch (error) {
    if (
      isRecord(error)
      && (error as { code?: unknown }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const entries: AgentEmitAttemptEntry[] = [];
  for (const line of raw.split("\n")) {
    const parsed = parseEmitHistoryLine(line);
    if (parsed !== null) {
      entries.push(parsed);
    }
  }
  return entries;
}
