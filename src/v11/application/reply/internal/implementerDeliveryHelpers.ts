import type { RefreshImplementerContextPort } from "../../../ports/implementerContext.js";
import type { BubbleConfig } from "../../../shared/config/bubbleConfigTypes.js";

/**
 * Resolve initial delay for implementer delivery by refreshing pane context.
 *
 * Mirrors the pattern from pass delivery (reviewerDeliveryHelpers.resolveDeliveryInitialDelayMs):
 * - Respawns the implementer pane with a fresh agent process
 * - Returns warm-up delay to give the pane time to initialize
 * - Ensures consistent handoff behavior: PASS respawns reviewer, REPLY respawns implementer
 *
 * This fixes the asymmetry where existing implementer panes could become stale during handovers.
 */
export async function resolveImplementerDeliveryInitialDelayMs(input: {
  bubbleId: string;
  bubbleConfig: BubbleConfig;
  sessionsPath: string;
  refreshImplementer: RefreshImplementerContextPort;
}): Promise<number | undefined> {
  // Best effort only; protocol/state progression must not fail if tmux refresh fails.
  const refreshResult = await input.refreshImplementer({
    bubbleId: input.bubbleId,
    bubbleConfig: input.bubbleConfig,
    sessionsPath: input.sessionsPath
  }).catch(() => undefined);

  if (refreshResult?.refreshed === true) {
    // Give the respawned implementer agent a short warm-up before delivery injection.
    return 1500;
  }

  return undefined;
}
