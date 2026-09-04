import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type { WatchdogTimeoutMinutesByAgent } from "../../../config/bubbleConfig/watchdogTimeoutByAgent.js";

/**
 * Resolves the watchdog timeout that applies for a specific agent about to
 * become active, honoring an optional per-agent override
 * (`watchdog_timeout_minutes_by_agent`) before falling back to the bubble's
 * flat `watchdog_timeout_minutes`. Use at every site that mints a fresh
 * execution context deadline for a newly active role/agent.
 */
export function resolveWatchdogTimeoutMinutesForAgent(
  config: {
    watchdog_timeout_minutes: number;
    watchdog_timeout_minutes_by_agent?: WatchdogTimeoutMinutesByAgent | undefined;
  },
  agentName: AgentName | null | undefined
): number {
  if (agentName === null || agentName === undefined) {
    return config.watchdog_timeout_minutes;
  }
  return (
    config.watchdog_timeout_minutes_by_agent?.[agentName]
    ?? config.watchdog_timeout_minutes
  );
}
