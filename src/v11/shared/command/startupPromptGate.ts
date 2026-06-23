import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";

/**
 * Determine whether a startup prompt should be submitted via tmux paste.
 *
 * Opencode receives its startup prompt through CLI arguments and does not need
 * tmux-based submission.
 */
export function shouldSubmitStartupPrompt(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  agentName: AgentName,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  startupPrompt: string | undefined
): boolean {
  // Opencode receives its startup prompt via CLI arguments.
  return false;
}
