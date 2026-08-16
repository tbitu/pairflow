// Supported pairflow coding agents. opencode remains the default; reasonix is
// supported alongside it (launch via `npx reasonix code`). Agent-specific
// runtime behavior lives in the per-agent profiles under
// src/v11/shared/agent/agentRuntimeProfiles.ts — do not add agent-specific
// conditionals outside that registry.
export const agentNames = ["opencode", "reasonix"] as const;

export type AgentName = (typeof agentNames)[number];

// Adding a new AgentRole is not a local enum-only change. Re-open the deferred
// Opportunity 3 successor slice first:
// - plans/actor-runtime-interface-post-phaseE-successor-plan-v1.md (`O3-T5`)
// - docs/actor-runtime-interface/onboarding-extension-surface-contract-note-v1.md
export const agentRoles = ["implementer", "reviewer", "meta_reviewer"] as const;

export type AgentRole = (typeof agentRoles)[number];

export interface BubbleAgentsConfig {
  implementer: AgentName;
  implementer_model?: string;
  reviewer: AgentName;
  reviewer_model?: string;
  meta_reviewer: AgentName;
  meta_reviewer_model?: string;
}

export function isAgentName(value: unknown): value is AgentName {
  return (
    typeof value === "string" && (agentNames as readonly string[]).includes(value)
  );
}

export function isAgentRole(value: unknown): value is AgentRole {
  return (
    typeof value === "string" && (agentRoles as readonly string[]).includes(value)
  );
}

/**
 * Render the supported agent names as a human-readable enumeration for
 * validation error messages (e.g. "Must be one of: opencode, reasonix").
 */
export function describeAgentNames(): string {
  return agentNames.join(", ");
}
