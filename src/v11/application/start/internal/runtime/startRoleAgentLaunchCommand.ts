import { buildAgentCommand } from "../../startCommandPromptRuntime.js";
import {
  resolveRoleAgent,
  resolveRoleModel,
  type AgentRole
} from "../../../../../contracts/kernel/agentIdentity.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../../config/defaults.js";
import type { PairflowRemoteWorkspaceAuthority } from "../../../../shared/command/pairflowCommandBootstrap.js";
import type { BubbleConfig } from "../../../../shared/config/bubbleConfigTypes.js";

/**
 * Build the tmux agent-launch shell command for a role in a fresh bubble
 * session. Shared by implementer/reviewer/meta-reviewer panes; the startup
 * prompt is only passed for the implementer (opencode via CLI args,
 * reasonix via tmux paste).
 */
export function buildRoleAgentLaunchCommand(input: {
  bubbleId: string;
  config: BubbleConfig;
  workspacePath: string;
  repoPath?: string | undefined;
  externalPairflowCommand: string | undefined;
  authority: PairflowRemoteWorkspaceAuthority | undefined;
  roleName: AgentRole;
  startupPrompt?: string | undefined;
}): string {
  const role = input.roleName;
  const roleMcpPolicy =
    input.config.role_mcp?.[role]
    ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE[role];
  const agent = resolveRoleAgent(input.config.agents, role);
  const model = resolveRoleModel(input.config.agents, role);

  return buildAgentCommand({
    agentName: agent,
    roleName: role,
    roleMcpPolicy,
    ...(model !== undefined ? { model } : {}),
    bubbleId: input.bubbleId,
    workspacePath: input.workspacePath,
    ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
    pairflowCommandProfile: input.config.pairflow_command_profile,
    ...(input.externalPairflowCommand !== undefined ? { externalPairflowCommand: input.externalPairflowCommand } : {}),
    ...(input.authority !== undefined ? { remoteWorkspaceAuthority: input.authority } : {}),
    ...(input.startupPrompt !== undefined ? { startupPrompt: input.startupPrompt } : {})
  });
}
