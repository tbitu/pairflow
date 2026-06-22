import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";

/**
 * Determine whether a startup prompt should be submitted via tmux paste.
 *
 * Opencode receives its startup prompt through CLI arguments and does not need
 * tmux-based submission.
 */
export function shouldSubmitStartupPrompt(
  agentName: AgentName,
  startupPrompt: string | undefined
): boolean {
  // Opencode receives its startup prompt via CLI arguments.
  return false;
}
