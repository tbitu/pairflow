import type { AgentName, AgentRole } from "../../../../contracts/kernel/agentIdentity.js";
import {
  buildRolePromptConcernLines
} from "./rolePromptConcerns.js";
import type {
  ResumePromptConcernBuildInput,
  ReviewerResumePromptConcernBuildInput,
  ReviewerStartupPromptConcernBuildInput,
  StartupPromptConcernBuildInput
} from "./rolePromptConcernTypes.js";
import {
  getAgentRuntimeProfile
} from "../../agent/agentRuntimeProfiles.js";

type NonReviewerRole = Exclude<AgentRole, "reviewer">;

type RoleStartupPromptComposeInput =
  | {
      agentName: AgentName;
      role: NonReviewerRole;
      phase: "startup";
      context: StartupPromptConcernBuildInput;
    }
  | {
      agentName: AgentName;
      role: "reviewer";
      phase: "startup";
      context: ReviewerStartupPromptConcernBuildInput;
    }
  | {
      agentName: AgentName;
      role: NonReviewerRole;
      phase: "resume";
      context: ResumePromptConcernBuildInput;
    }
  | {
      agentName: AgentName;
      role: "reviewer";
      phase: "resume";
      context: ReviewerResumePromptConcernBuildInput;
    };

function isReviewerRole(role: AgentRole): role is "reviewer" {
  return role === "reviewer";
}

/**
 * Compose the role-identity prompt for agents that receive their role context
 * through the TUI (startupPromptDelivery === "tmux_paste", i.e. reasonix)
 * rather than via a CLI `--agent <profile>` flag (opencode).
 *
 * opencode's `--agent PF-implementer|PF-reviewer|PF-meta-reviewer` injects the
 * role's standing instructions at launch. reasonix has no such flag, so the
 * same role concern lines are delivered as the startup prompt pasted into the
 * TUI. This keeps the role text (constant, role-only) separate from per-task
 * guidance, which pairflow continues to deliver as a later kickoff paste.
 *
 * Returns undefined when there is nothing to paste (not a tmux_paste agent, or
 * no role lines were produced).
 */
export function composeRolePrompt(
  input: RoleStartupPromptComposeInput
): string | undefined {
  if (getAgentRuntimeProfile(input.agentName).startupPromptDelivery !== "tmux_paste") {
    return undefined;
  }

  if (isReviewerRole(input.role)) {
    const lines =
      input.phase === "startup"
        ? buildRolePromptConcernLines({
            role: "reviewer",
            phase: "startup",
            context: input.context as ReviewerStartupPromptConcernBuildInput
          })
        : buildRolePromptConcernLines({
            role: "reviewer",
            phase: "resume",
            context: input.context as ReviewerResumePromptConcernBuildInput
          });
    const joined = lines.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }

  const lines =
    input.phase === "startup"
      ? buildRolePromptConcernLines({
          role: input.role,
          phase: "startup",
          context: input.context as StartupPromptConcernBuildInput
        })
      : buildRolePromptConcernLines({
          role: input.role,
          phase: "resume",
          context: input.context as ResumePromptConcernBuildInput
        });
  const joined = lines.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}
