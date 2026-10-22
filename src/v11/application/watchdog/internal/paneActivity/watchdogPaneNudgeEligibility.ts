import type { WatchdogPaneActivityRecord } from "../../../../ports/watchdogPaneActivity.js";
import type { BubbleStateSnapshot } from "../../../../domain/state/snapshot/bubbleStateSnapshot.js";
import { resolveTurnStartMs } from "../../../../shared/watchdog/watchdogTurnTiming.js";

export { resolveTurnStartMs };

export type NudgeEligibility =
  | { eligible: false }
  | { eligible: true; elapsedSinceLastSeenMs: number; elapsedSinceLastNudgeMs: number };

export const WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS = 2 * 60_000;

function parseIsoTimestamp(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSameExecutionStep(
  state: BubbleStateSnapshot,
  record: WatchdogPaneActivityRecord | null
): boolean {
  const currentExecutionId = state.execution_context?.execution_id;
  const recordedExecutionId = record?.last_nudge_execution_id;
  if (currentExecutionId !== undefined && recordedExecutionId !== undefined) {
    return currentExecutionId === recordedExecutionId;
  }
  return (
    state.active_role !== undefined
    && record?.last_nudge_role === state.active_role
    && state.round !== undefined
    && record?.last_nudge_round === state.round
  );
}

/**
 * Determines whether a watchdog nudge should be attempted, using early returns.
 */
export function shouldAttemptNudge(input: {
  state: BubbleStateSnapshot;
  currentRecord: WatchdogPaneActivityRecord | null;
  hasEscInterrupt: boolean;
  now: Date;
}): NudgeEligibility {
  if (input.state.state !== "RUNNING" || input.hasEscInterrupt) {
    return { eligible: false };
  }

  const turnStartMs = resolveTurnStartMs(input.state);
  if (
    turnStartMs > 0
    && input.now.getTime() - turnStartMs < WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS
  ) {
    return { eligible: false };
  }

  const isSameExecution = isSameExecutionStep(input.state, input.currentRecord);
  const fallbackBaselineMs = turnStartMs > 0 ? turnStartMs : input.now.getTime();

  const lastSeenMs = isSameExecution
    ? (parseIsoTimestamp(input.currentRecord?.last_seen_esc_interrupt_at) ?? input.now.getTime())
    : fallbackBaselineMs;
  const elapsedSinceLastSeenMs = input.now.getTime() - lastSeenMs;

  const lastNudgeMs = isSameExecution
    ? (parseIsoTimestamp(input.currentRecord?.last_nudge_at) ?? 0)
    : 0;
  const elapsedSinceLastNudgeMs = lastNudgeMs > 0
    ? input.now.getTime() - lastNudgeMs
    : input.now.getTime() - fallbackBaselineMs;

  return { eligible: true, elapsedSinceLastSeenMs, elapsedSinceLastNudgeMs };
}
