import type { BubbleStateSnapshot } from "../../domain/state/snapshot/bubbleStateSnapshot.js";

function parseIsoTimestamp(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resolveTurnStartMs(state: BubbleStateSnapshot): number {
  const startedAtMs = parseIsoTimestamp(state.execution_context?.started_at);
  const lastCommandAtMs = parseIsoTimestamp(state.last_command_at ?? undefined);
  const activeSinceMs = parseIsoTimestamp(state.active_since ?? undefined);
  return Math.max(startedAtMs ?? 0, lastCommandAtMs ?? 0, activeSinceMs ?? 0);
}
