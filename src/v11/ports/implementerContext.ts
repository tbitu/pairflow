import type { BubbleConfig } from "../shared/config/bubbleConfigTypes.js";

/**
 * Port for refreshing implementer pane context on role transitions.
 * Mirrors RefreshReviewerContextPort to ensure symmetric handoff behavior:
 * - Pass delivery (impl → reviewer): respawns reviewer via refreshReviewerContext
 * - Reply delivery (reviewer/human → impl): respawns implementer via refreshImplementerContext
 *
 * This ensures existing panes don't become stale during handovers.
 */

export interface RefreshImplementerContextInput {
  bubbleId: string;
  bubbleConfig: BubbleConfig;
  sessionsPath: string;
}

export type RefreshImplementerContextFailureReason =
  | "no_runtime_session"
  | "registry_read_failed"
  | "tmux_respawn_failed"
  | "readiness_timeout";

export interface RefreshImplementerContextResult {
  refreshed: boolean;
  reason?: RefreshImplementerContextFailureReason;
}

export type RefreshImplementerContextPort = (
  input: RefreshImplementerContextInput
) => Promise<RefreshImplementerContextResult>;
