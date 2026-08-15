import { join } from "node:path";

export interface AgentEmitAttemptEntry {
  ts: string;
  bubble_id?: string | null;
  repo?: string | null;
  role?: string | null;
  kind?: string | null;
  status: "success" | "rejected";
  error_reason?: string | null;
  args: string[];
  duration_ms?: number;
}

export function getBubbleEmitHistoryPath(bubbleDir: string): string {
  return join(bubbleDir, "emit-history.ndjson");
}

export function getRuntimeEmitHistoryPath(runtimeDir: string): string {
  return join(runtimeDir, "emit-history.ndjson");
}
