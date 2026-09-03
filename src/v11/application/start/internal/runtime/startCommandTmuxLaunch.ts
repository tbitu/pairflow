import { relative } from "node:path";

import { buildAgentCommand } from "../../startCommandPromptRuntime.js";
import { createStartBubbleError } from "./startCommandRuntime.js";
import { buildRoleAgentLaunchCommand } from "./startRoleAgentLaunchCommand.js";
import {
  buildActiveResumeStartupPrompts,
  resolveFreshImplementerStartupPrompt
} from "./resumeStartupPrompts.js";
import {
  buildImplementerIdeationKickoffMessage,
  buildImplementerKickoffMessage,
  buildStatusPaneCommand
} from "../prompts/startCommandPrompts.js";
import {
  resolveCommandStartupPrompt
} from "./startCommandStartupPromptRouting.js";
import { shouldSubmitStartupPrompt } from "../../../../shared/command/startupPromptGate.js";
import { getAgentRuntimeProfile } from "../../../../shared/agent/agentRuntimeProfiles.js";
import type { resolveResumeKickoffMessages } from "../prompts/startCommandResumePrompts.js";
import type { ResolvedStartBubbleDependencies } from "../../startCommandOrchestration.js";
import type { StartExecutionContext } from "./startCommandContext.js";
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import type { AgentRole } from "../../../../../contracts/kernel/agentIdentity.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../../config/defaults.js";
import type { PairflowRemoteWorkspaceAuthority } from "../../../../shared/command/pairflowCommandBootstrap.js";
import type { RoleMcpPolicy } from "../../../../shared/config/bubbleConfigVocabulary.js";

function buildStatusPaneLabel(bubbleId: string): string {
  return `[orchestrator/status]-[${bubbleId}]`;
}

function resolveRemoteWorkspaceAuthority(
  context: StartExecutionContext
): PairflowRemoteWorkspaceAuthority | undefined {
  const externalPairflowCommand = context.remoteStartContext?.externalPairflowCommand;
  if (context.remoteStartContext === undefined) {
    return undefined;
  }

  return {
    workspaceRoot: context.remoteStartContext.workspaceRoot,
    ...(externalPairflowCommand !== undefined
      ? { externalPairflowCommand }
      : {})
  };
}

function buildAgentLaunchCommand(input: {
  agentName: AgentName;
  roleName: AgentRole;
  roleMcpPolicy: RoleMcpPolicy;
  model?: string;
  bubbleId: string;
  workspacePath: string;
  pairflowCommandProfile: StartExecutionContext["resolved"]["bubbleConfig"]["pairflow_command_profile"];
  startupPrompt?: string | undefined;
  externalPairflowCommand?: string;
  remoteWorkspaceAuthority?: PairflowRemoteWorkspaceAuthority;
}): string {
  return buildAgentCommand({
    agentName: input.agentName,
    roleName: input.roleName,
    roleMcpPolicy: input.roleMcpPolicy,
    ...(input.model !== undefined ? { model: input.model } : {}),
    bubbleId: input.bubbleId,
    workspacePath: input.workspacePath,
    pairflowCommandProfile: input.pairflowCommandProfile,
    ...(input.externalPairflowCommand !== undefined
      ? { externalPairflowCommand: input.externalPairflowCommand }
      : {}),
    ...(input.remoteWorkspaceAuthority !== undefined
      ? { remoteWorkspaceAuthority: input.remoteWorkspaceAuthority }
      : {}),
    startupPrompt: resolveCommandStartupPrompt(
      input.agentName,
      input.startupPrompt
    )
  });
}

function assertRunningLaunchAck(input: {
  bubbleId: string;
  ack: Awaited<ReturnType<ResolvedStartBubbleDependencies["launchSessionAck"]>>;
}): { sessionName: string } {
  if (input.ack.status === "running") {
    return {
      sessionName: input.ack.sessionName
    };
  }

  throw createStartBubbleError({
    reasonCode: input.ack.reason_code,
    message: input.ack.error_message,
    context: {
      bubble_id: input.bubbleId,
      stage: "launch_tmux",
      failure_kind: input.ack.failure_kind,
      ...(input.ack.sessionName !== undefined
        ? { tmux_session_name: input.ack.sessionName }
        : {})
    }
  });
}

export async function launchFreshTmuxSession(input: {
  context: StartExecutionContext;
  deps: ResolvedStartBubbleDependencies;
  ideationPending: boolean;
  launchWorkspacePath: string;
}): Promise<{ sessionName: string }> {
  const externalPairflowCommand =
    input.context.remoteStartContext?.externalPairflowCommand;
  const metaReviewerAgent = input.context.resolved.bubbleConfig.agents.meta_reviewer;
  const implementerAgent = input.context.resolved.bubbleConfig.agents.implementer;
  const reviewerAgent = input.context.resolved.bubbleConfig.agents.reviewer;
  const launchInput = {
    bubbleId: input.context.resolved.bubbleId,
    config: input.context.resolved.bubbleConfig,
    workspacePath: input.launchWorkspacePath,
    repoPath: input.context.resolved.repoPath,
    externalPairflowCommand,
    authority: resolveRemoteWorkspaceAuthority(input.context)
  };
  const implementerStartupPrompt: string | undefined =
    resolveFreshImplementerStartupPrompt({
      context: input.context,
      launchWorkspacePath: input.launchWorkspacePath,
      implementerAgent
    });
  // Agents that cannot run concurrent panes (reasonix enforces a machine-wide
  // single active interactive session) launch only the initially active
  // implementer pane; reviewer/meta-reviewer panes are respawned lazily by
  // their first delivery.
  const allRolesSupportConcurrentPanes = [
    implementerAgent,
    reviewerAgent,
    metaReviewerAgent
  ].every((agent) => getAgentRuntimeProfile(agent).supportsConcurrentPanes);
  const ack = await input.deps.launchSessionAck({
    bubbleId: input.context.resolved.bubbleId,
    workspacePath: input.launchWorkspacePath,
    statusCommand: buildStatusPaneCommand(
      input.context.resolved.bubbleId,
      input.context.resolved.repoPath,
      input.launchWorkspacePath,
      input.context.resolved.bubbleConfig.pairflow_command_profile,
      externalPairflowCommand
    ),
    statusPaneLabel: buildStatusPaneLabel(input.context.resolved.bubbleId),
    implementerPaneLabel: `[${implementerAgent}/implementer]`,
    reviewerPaneLabel: `[${reviewerAgent}/reviewer]`,
    metaReviewerPaneLabel: `[${metaReviewerAgent}/meta-reviewer]`,
    implementerSubmitStartupPrompt: shouldSubmitStartupPrompt(
      implementerAgent,
      implementerStartupPrompt
    ),
    reviewerSubmitStartupPrompt: shouldSubmitStartupPrompt(reviewerAgent, undefined),
    metaReviewerSubmitStartupPrompt: shouldSubmitStartupPrompt(metaReviewerAgent, undefined),
    ...(allRolesSupportConcurrentPanes
      ? {}
      : { launchReviewerAgent: false, launchMetaReviewerAgent: false }),
    implementerCommand: buildRoleAgentLaunchCommand({
      ...launchInput,
      roleName: "implementer",
      startupPrompt: implementerStartupPrompt
    }),
    reviewerCommand: buildRoleAgentLaunchCommand({
      ...launchInput,
      roleName: "reviewer"
    }),
    metaReviewerCommand: buildRoleAgentLaunchCommand({
      ...launchInput,
      roleName: "meta_reviewer"
    }),
    implementerKickoffMessage: input.ideationPending
      ? buildImplementerIdeationKickoffMessage({
          bubbleId: input.context.resolved.bubbleId,
          workspacePath: input.launchWorkspacePath,
          taskArtifactPath: relative(
            input.launchWorkspacePath,
            input.context.resolved.bubblePaths.taskArtifactPath
          ),
          pairflowCommandProfile: input.context.resolved.bubbleConfig.pairflow_command_profile,
          agentName: input.context.resolved.bubbleConfig.agents.implementer
        })
      : buildImplementerKickoffMessage({
          bubbleId: input.context.resolved.bubbleId,
          workspacePath: input.launchWorkspacePath,
          taskArtifactPath: relative(
            input.launchWorkspacePath,
            input.context.resolved.bubblePaths.taskArtifactPath
          ),
          reviewArtifactType: input.context.resolved.bubbleConfig.review_artifact_type,
          pairflowCommandProfile: input.context.resolved.bubbleConfig.pairflow_command_profile,
          validationCommands: input.context.resolved.bubbleConfig.commands,
          agentName: input.context.resolved.bubbleConfig.agents.implementer
        })
  });

  return assertRunningLaunchAck({
    bubbleId: input.context.resolved.bubbleId,
    ack
  });
}

export async function launchResumeTmuxSession(input: {
  context: StartExecutionContext;
  deps: ResolvedStartBubbleDependencies;
  launchWorkspacePath: string;
  transcriptSummary: string;
  reviewerTestDirectiveLine?: string;
  kickoffDiagnostic?: string;
  resumeKickoffMessages: Omit<
    ReturnType<typeof resolveResumeKickoffMessages>,
    "kickoffDiagnostic"
  >;
}): Promise<{ sessionName: string }> {
  const externalPairflowCommand =
    input.context.remoteStartContext?.externalPairflowCommand;
  const remoteWorkspaceAuthority = resolveRemoteWorkspaceAuthority(input.context);
  const metaReviewerAgent = input.context.resolved.bubbleConfig.agents.meta_reviewer;
  const {
    implementerStartupPrompt,
    reviewerStartupPrompt,
    metaReviewerStartupPrompt,
    launchImplementerAgent = implementerStartupPrompt !== undefined,
    launchReviewerAgent = reviewerStartupPrompt !== undefined,
    launchMetaReviewerAgent = metaReviewerStartupPrompt !== undefined
  } = buildActiveResumeStartupPrompts(input);
  const ack = await input.deps.launchSessionAck({
    bubbleId: input.context.resolved.bubbleId,
    workspacePath: input.launchWorkspacePath,
    statusCommand: buildStatusPaneCommand(
      input.context.resolved.bubbleId,
      input.context.resolved.repoPath,
      input.launchWorkspacePath,
      input.context.resolved.bubbleConfig.pairflow_command_profile,
      externalPairflowCommand
    ),
    statusPaneLabel: buildStatusPaneLabel(input.context.resolved.bubbleId),
    implementerPaneLabel: `[${input.context.resolved.bubbleConfig.agents.implementer}/implementer]`,
    reviewerPaneLabel: `[${input.context.resolved.bubbleConfig.agents.reviewer}/reviewer]`,
    metaReviewerPaneLabel: `[${metaReviewerAgent}/meta-reviewer]`,
    implementerSubmitStartupPrompt: shouldSubmitStartupPrompt(
      input.context.resolved.bubbleConfig.agents.implementer,
      implementerStartupPrompt
    ),
    reviewerSubmitStartupPrompt: shouldSubmitStartupPrompt(
      input.context.resolved.bubbleConfig.agents.reviewer,
      reviewerStartupPrompt
    ),
    metaReviewerSubmitStartupPrompt: shouldSubmitStartupPrompt(
      metaReviewerAgent,
      metaReviewerStartupPrompt
    ),
    implementerStartupPrompt,
    reviewerStartupPrompt,
    metaReviewerStartupPrompt,
    launchImplementerAgent,
    launchReviewerAgent,
    launchMetaReviewerAgent,
    implementerCommand: buildAgentLaunchCommand({
      agentName: input.context.resolved.bubbleConfig.agents.implementer,
      roleName: "implementer",
      roleMcpPolicy:
        input.context.resolved.bubbleConfig.role_mcp?.implementer
        ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.implementer,
      ...(input.context.resolved.bubbleConfig.agents.implementer_model !== undefined
        ? { model: input.context.resolved.bubbleConfig.agents.implementer_model }
        : {}),
      bubbleId: input.context.resolved.bubbleId,
      workspacePath: input.launchWorkspacePath,
      pairflowCommandProfile: input.context.resolved.bubbleConfig.pairflow_command_profile,
      ...(externalPairflowCommand !== undefined ? { externalPairflowCommand } : {}),
      ...(remoteWorkspaceAuthority !== undefined ? { remoteWorkspaceAuthority } : {}),
      startupPrompt: implementerStartupPrompt
    }),
    reviewerCommand: buildAgentLaunchCommand({
      agentName: input.context.resolved.bubbleConfig.agents.reviewer,
      roleName: "reviewer",
      roleMcpPolicy:
        input.context.resolved.bubbleConfig.role_mcp?.reviewer
        ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.reviewer,
      ...(input.context.resolved.bubbleConfig.agents.reviewer_model !== undefined
        ? { model: input.context.resolved.bubbleConfig.agents.reviewer_model }
        : {}),
      bubbleId: input.context.resolved.bubbleId,
      workspacePath: input.launchWorkspacePath,
      pairflowCommandProfile: input.context.resolved.bubbleConfig.pairflow_command_profile,
      ...(externalPairflowCommand !== undefined ? { externalPairflowCommand } : {}),
      ...(remoteWorkspaceAuthority !== undefined ? { remoteWorkspaceAuthority } : {}),
      startupPrompt: reviewerStartupPrompt
    }),
    metaReviewerCommand: buildAgentLaunchCommand({
      agentName: metaReviewerAgent,
      roleName: "meta_reviewer",
      roleMcpPolicy:
        input.context.resolved.bubbleConfig.role_mcp?.meta_reviewer
        ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.meta_reviewer,
      ...(input.context.resolved.bubbleConfig.agents.meta_reviewer_model !== undefined
        ? { model: input.context.resolved.bubbleConfig.agents.meta_reviewer_model }
        : {}),
      bubbleId: input.context.resolved.bubbleId,
      workspacePath: input.launchWorkspacePath,
      pairflowCommandProfile: input.context.resolved.bubbleConfig.pairflow_command_profile,
      ...(externalPairflowCommand !== undefined ? { externalPairflowCommand } : {}),
      ...(remoteWorkspaceAuthority !== undefined ? { remoteWorkspaceAuthority } : {}),
      startupPrompt: metaReviewerStartupPrompt
    }),
    ...input.resumeKickoffMessages
  });

  return assertRunningLaunchAck({
    bubbleId: input.context.resolved.bubbleId,
    ack
  });
}
