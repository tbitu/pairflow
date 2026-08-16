import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import { getAgentRuntimeProfile } from "../agent/agentRuntimeProfiles.js";

/**
 * Determine whether a startup prompt should be submitted via tmux paste.
 *
 * opencode receives its startup prompt through CLI arguments and does not need
 * tmux-based submission. reasonix has no `--prompt` flag, so its startup
 * prompt must be pasted into the TUI (profile.startupPromptDelivery).
 */
export function shouldSubmitStartupPrompt(
  agentName: AgentName,
  startupPrompt: string | undefined
): boolean {
  if (
    getAgentRuntimeProfile(agentName).startupPromptDelivery !== "tmux_paste"
  ) {
    return false;
  }
  return (startupPrompt?.trim().length ?? 0) > 0;
}
