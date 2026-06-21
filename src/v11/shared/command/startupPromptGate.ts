import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";

/**
 * Determine whether a startup prompt should be submitted via tmux paste.
 *
 * Claude receives its startup prompt through CLI arguments and does not need
 * tmux-based submission. All other agents (codex, opencode) receive their
 * startup context by pasting the prompt into the pane after launch.
 */
export function shouldSubmitStartupPrompt(
  agentName: AgentName,
  startupPrompt: string | undefined
): boolean {
  if (agentName === "claude") {
    return false;
  }

  // codex and opencode receive their startup prompt via tmux paste after launch.
  return (startupPrompt?.trim().length ?? 0) > 0;
}
