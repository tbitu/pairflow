import type { RefreshImplementerContextPort } from "../../../ports/implementerContext.js";
import type { RefreshReviewerContextPort } from "../../../ports/reviewerContext.js";
import type { BubbleConfig } from "../../../shared/config/bubbleConfigTypes.js";
import type { AgentRole } from "../../../../contracts/kernel/agentIdentity.js";

/**
 * Resolve initial delay for delivery by refreshing the pane corresponding to the active role.
 *
 * Unlike the old implementer-specific helper, this supports all three roles:
 * - implementer: uses refreshImplementer port
 * - reviewer, meta_reviewer: use refreshReviewer port (meta_reviewer is still a reviewer role)
 *
 * This ensures that resume correctly refreshes whichever pane is active, not just implementer.
 * Fixes bug where resuming to reviewer or meta_reviewer roles had stale panes.
 */
export async function resolveDeliveryInitialDelayMsByRole(input: {
  bubbleId: string;
  bubbleConfig: BubbleConfig;
  sessionsPath: string;
  activeRole: AgentRole;
  refreshImplementer: RefreshImplementerContextPort;
  refreshReviewer: RefreshReviewerContextPort;
}): Promise<number | undefined> {
  // Best effort only; protocol/state progression must not fail if tmux refresh fails.
  const refreshResult = await (input.activeRole === "implementer"
    ? input.refreshImplementer({
        bubbleId: input.bubbleId,
        bubbleConfig: input.bubbleConfig,
        sessionsPath: input.sessionsPath
      })
    : // Both reviewer and meta_reviewer use the reviewer context port
      input.refreshReviewer({
        bubbleId: input.bubbleId,
        bubbleConfig: input.bubbleConfig,
        sessionsPath: input.sessionsPath
      })
  ).catch(() => undefined);

  if (refreshResult?.refreshed === true) {
    // Give the respawned agent pane a short warm-up before delivery injection.
    return 1500;
  }

  return undefined;
}
