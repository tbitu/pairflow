import type { StructuredAgentRunnerOutput } from "../../../../shared/planWatchRunner/agentRunnerBridgeContract.js";
import {
  parseStructuredAgentRunnerOutput,
  parseStructuredAgentRunnerRecord
} from "../../../../shared/planWatchRunner/agentRunnerBridgeResult.js";

export interface ParsedReasonixStream {
  rawLines: readonly string[];
  events: readonly ReasonixJsonEvent[];
  /** True when stdout is non-empty but no JSON event lines could be parsed. */
  malformed: boolean;
  finalOutput: StructuredAgentRunnerOutput | null;
  runnerSummary: string | undefined;
  reasonixSessionId?: string | undefined;
}

export interface ReasonixJsonEvent {
  line: string;
  value: Record<string, unknown>;
}

/**
 * Parse `reasonix run --events-jsonl` stdout.
 *
 * reasonix emits redacted structured events as JSONL on stdout (unlike
 * opencode, which writes an events.ndjson file through the agent). Because the
 * exact event vocabulary is version-dependent, extraction is deliberately
 * lenient: any JSON line is kept as an event; message text is pulled from a
 * small set of common field shapes; and the final structured output is found
 * either inside a message or by scanning the whole stdout for the last object
 * that matches the pairflow runner schema (the prompt asks reasonix to end
 * with exactly one such object on its own line).
 */
export function parseReasonixJsonlStream(stdout: string): ParsedReasonixStream {
  const rawLines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  const events: ReasonixJsonEvent[] = [];
  let runnerSummary: string | undefined;
  let reasonixSessionId: string | undefined;

  for (const line of rawLines) {
    const parsed = parseJsonObject(line);
    if (parsed === null) {
      continue;
    }
    events.push({ line, value: parsed });
    reasonixSessionId ??= extractReasonixSessionId(parsed);
    const messageText = extractReasonixMessageText(parsed);
    if (messageText === undefined) {
      continue;
    }
    runnerSummary = messageText;
  }

  // The final structured output may sit inside a message, or as the last JSON
  // object anywhere in the stdout (prompt contract). Prefer the explicit scan
  // so embedded schema objects inside message text are also found.
  const finalOutput = parseStructuredAgentRunnerOutput(stdout);

  return {
    rawLines,
    events,
    malformed: rawLines.length > 0 && events.length === 0,
    finalOutput,
    runnerSummary,
    ...(reasonixSessionId !== undefined ? { reasonixSessionId } : {})
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractReasonixMessageText(event: Record<string, unknown>): string | undefined {
  if (typeof event.text === "string" && event.text.length > 0) {
    return event.text;
  }
  if (typeof event.message === "string" && event.message.length > 0) {
    return event.message;
  }
  if (typeof event.answer === "string" && event.answer.length > 0) {
    return event.answer;
  }
  const item = event.item;
  if (!isRecord(item)) {
    return undefined;
  }
  if (typeof item.text === "string" && item.text.length > 0) {
    return item.text;
  }
  if (typeof item.message === "string" && item.message.length > 0) {
    return item.message;
  }
  if (Array.isArray(item.content) && item.content.length > 0) {
    return item.content
      .map((entry) =>
        isRecord(entry) && typeof entry.text === "string" ? entry.text : ""
      )
      .join("") || undefined;
  }
  return undefined;
}

function extractReasonixSessionId(event: Record<string, unknown>): string | undefined {
  const candidate =
    typeof event.session_id === "string"
      ? event.session_id
      : typeof event.sessionId === "string"
        ? event.sessionId
        : undefined;
  return candidate !== undefined && candidate.length > 0 ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Re-exported for classifiers that need per-message structured parsing.
export function parseStructuredReasonixMessageText(
  text: string
): StructuredAgentRunnerOutput | null {
  const parsed = parseJsonObject(text);
  if (parsed === null) {
    return null;
  }
  return parseStructuredAgentRunnerRecord(parsed);
}
