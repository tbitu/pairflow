import {
  agentRoles,
  resolveRoleAgent,
  resolveRoleModel,
  type AgentName,
  type AgentRole,
  type BubbleAgentsConfig
} from "../../../contracts/kernel/agentIdentity.js";

export function resolveConfiguredAgentForRole(input: {
  agents: BubbleAgentsConfig;
  role: AgentRole;
}): AgentName {
  return resolveRoleAgent(input.agents, input.role);
}

export function resolveConfiguredModelForRole(input: {
  agents: BubbleAgentsConfig;
  role: AgentRole;
}): string | undefined {
  return resolveRoleModel(input.agents, input.role);
}

export function resolveUniquelyConfiguredRoleForAgent(input: {
  agents: BubbleAgentsConfig;
  agent: AgentName;
  roles?: readonly AgentRole[];
}): AgentRole | undefined {
  const roles = input.roles ?? agentRoles;
  let matchedRole: AgentRole | undefined;
  for (const role of roles) {
    if (
      resolveConfiguredAgentForRole({
        agents: input.agents,
        role
      }) !== input.agent
    ) {
      continue;
    }
    if (matchedRole !== undefined) {
      return undefined;
    }
    matchedRole = role;
  }
  return matchedRole;
}
