import type { BubbleConfig } from "../shared/config/bubbleConfigTypes.js";

/**
 * @deprecated
 * This port is retained for backward compatibility during Phase 5 consolidation.
 * Phase 5b will migrate all usages to RolePaneLifecyclePort for unified pane management.
 * See: src/v11/ports/rolePaneLifecycle.ts
 */
export interface RefreshReviewerContextInput {
  bubbleId: string;
  bubbleConfig: BubbleConfig;
  sessionsPath: string;
  reviewerStartupPrompt?: string;
}

export type RefreshReviewerContextFailureReason =
  | "no_runtime_session"
  | "registry_read_failed"
  | "tmux_respawn_failed"
  | "readiness_timeout";

export interface RefreshReviewerContextResult {
  refreshed: boolean;
  reason?: RefreshReviewerContextFailureReason;
}

export type RefreshReviewerContextPort = (
  input: RefreshReviewerContextInput
) => Promise<RefreshReviewerContextResult>;
