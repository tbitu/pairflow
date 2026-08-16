import { relative } from "node:path";

import { buildAgentCommand } from "../../startCommandPromptRuntime.js";
import { createStartBubbleError } from "./startCommandRuntime.js";
import {
  buildImplementerIdeationKickoffMessage,
  buildImplementerKickoffMessage,
  buildStatusPaneCommand
} from "../prompts/startCommandPrompts.js";
import {
  buildResumeImplementerStartupPrompt,
  buildResumeMetaReviewerStartupPrompt,
  buildResumeReviewerStartupPrompt
} from "../prompts/startCommandResumePrompts.js";
import {
  resolveCommandStartupPrompt
} from "./startCommandStartupPromptRouting.js";
import { shouldSubmitStartupPrompt } from "../../../../shared/command/startupPromptGate.js";
import { getAgentRuntimeProfile } from "../../../../shared/agent/agentRuntimeProfiles.js";
import { composeRolePrompt } from "../../../../shared/role/prompts/roleStartupPromptComposer.js";
import type { resolveResumeKickoffMessages } from "../prompts/startCommandResumePrompts.js";
import type { ResolvedStartBubbleDependencies } from "../../startCommandOrchestration.js";
import type { StartExecutionContext } from "./startCommandContext.js";
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import type { AgentRole } from "../../../../../contracts/kernel/agentIdentity.js";
import { DEFAULT_REVIEW_POLICY_REVIEWER_BLOCKING_MIN_SEVERITY } from "../../../../../config/defaults.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../../config/defaults.js";
import type { PairflowRemoteWorkspaceAuthority } from "../../../../shared/command/pairflowCommandBootstrap.js";
import type { RoleMcpPolicy } from "../../../../shared/config/bubbleConfigVocabulary.js";
import type { PairflowCommandProfile, ReviewArtifactType } from "../../../../shared/config/bubbleConfigVocabulary.js";
import type { BubbleCommandsConfig } from "../../../../shared/command/commandConfigTypes.js";
import type { BubbleReviewAutoReworkSeverity } from "../../../../shared/reviewPolicy/reviewPolicyTypes.js";
import type { ReviewerFocusExtractionResult } from "../../../../shared/reviewer/reviewerBrief.js";
import type { RolePromptStateSnapshot } from "../../../../shared/role/prompts/rolePromptConcernTypes.js";

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

interface ActiveResumeStartupPrompts {
  implementerStartupPrompt?: string | undefined;
  reviewerStartupPrompt?: string | undefined;
  metaReviewerStartupPrompt?: string | undefined;
  launchImplementerAgent?: boolean | undefined;
  launchReviewerAgent?: boolean | undefined;
  launchMetaReviewerAgent?: boolean | undefined;
}

interface RoleStartupCommon {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  pairflowCommandProfile: PairflowCommandProfile;
  state: RolePromptStateSnapshot;
  transcriptSummary: string;
  agentName: AgentName;
  kickoffDiagnostic?: string;
}

function resolveResumeImplementerStartupPrompt(input: {
  common: RoleStartupCommon;
  reviewArtifactType: ReviewArtifactType;
  validationCommands: BubbleCommandsConfig;
}): string | undefined {
  const base = buildResumeImplementerStartupPrompt({
    ...input.common,
    reviewArtifactType: input.reviewArtifactType,
    validationCommands: input.validationCommands
  });
  if (base.trim().length > 0) {
    return base;
  }
  return composeRolePrompt({
    agentName: input.common.agentName,
    role: "implementer",
    phase: "resume",
    context: {
      ...input.common,
      reviewArtifactType: input.reviewArtifactType,
      validationCommands: input.validationCommands
    }
  });
}

function resolveResumeReviewerStartupPrompt(input: {
  common: RoleStartupCommon;
  policySnapshotPathAbs: string;
  reviewArtifactType: ReviewArtifactType;
  reviewerBlockingMinSeverity: BubbleReviewAutoReworkSeverity;
  reviewerTestDirectiveLine?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
  reviewerBriefText?: string;
}): string | undefined {
  const base = buildResumeReviewerStartupPrompt({
    ...input.common,
    policySnapshotPathAbs: input.policySnapshotPathAbs,
    reviewArtifactType: input.reviewArtifactType,
    reviewerBlockingMinSeverity: input.reviewerBlockingMinSeverity,
    ...(input.reviewerTestDirectiveLine !== undefined
      ? { reviewerTestDirectiveLine: input.reviewerTestDirectiveLine }
      : {}),
    ...(input.reviewerFocus !== undefined
      ? { reviewerFocus: input.reviewerFocus }
      : {}),
    ...(input.reviewerBriefText !== undefined
      ? { reviewerBriefText: input.reviewerBriefText }
      : {})
  });
  if (base.trim().length > 0) {
    return base;
  }
  return composeRolePrompt({
    agentName: input.common.agentName,
    role: "reviewer",
    phase: "resume",
    context: {
      ...input.common,
      policySnapshotPathAbs: input.policySnapshotPathAbs,
      reviewArtifactType: input.reviewArtifactType,
      reviewerBlockingMinSeverity: input.reviewerBlockingMinSeverity,
      ...(input.reviewerTestDirectiveLine !== undefined
        ? { reviewerTestDirectiveLine: input.reviewerTestDirectiveLine }
        : {}),
      ...(input.reviewerFocus !== undefined
        ? { reviewerFocus: input.reviewerFocus }
        : {}),
      ...(input.reviewerBriefText !== undefined
        ? { reviewerBriefText: input.reviewerBriefText }
        : {})
    }
  });
}

function resolveResumeMetaReviewerStartupPrompt(input: {
  common: RoleStartupCommon;
}): string | undefined {
  const base = buildResumeMetaReviewerStartupPrompt(input.common);
  if (base.trim().length > 0) {
    return base;
  }
  return composeRolePrompt({
    agentName: input.common.agentName,
    role: "meta_reviewer",
    phase: "resume",
    context: input.common
  });
}

function buildActiveResumeStartupPrompts(input: {
  context: StartExecutionContext;
  launchWorkspacePath: string;
  transcriptSummary: string;
  reviewerTestDirectiveLine?: string;
  kickoffDiagnostic?: string;
}): ActiveResumeStartupPrompts {
  const loadedState = input.context.loadedState.state;
  if (loadedState.state !== "RUNNING") {
    return {};
  }

  const activeRole = loadedState.active_role;
  const activeAgent = loadedState.active_agent;
  const bubbleConfig = input.context.resolved.bubbleConfig;
  const relativeTaskArtifactPath = relative(
    input.launchWorkspacePath,
    input.context.resolved.bubblePaths.taskArtifactPath
  );
  const common: RoleStartupCommon = {
    bubbleId: input.context.resolved.bubbleId,
    repoPath: input.context.resolved.repoPath,
    workspacePath: input.launchWorkspacePath,
    taskArtifactPath: relativeTaskArtifactPath,
    pairflowCommandProfile: bubbleConfig.pairflow_command_profile,
    state: loadedState,
    transcriptSummary: input.transcriptSummary,
    agentName: activeAgent,
    ...(input.kickoffDiagnostic !== undefined
      ? { kickoffDiagnostic: input.kickoffDiagnostic }
      : {})
  };

  if (activeRole === "implementer" && activeAgent === bubbleConfig.agents.implementer) {
    return {
      implementerStartupPrompt: resolveResumeImplementerStartupPrompt({
        common,
        reviewArtifactType: bubbleConfig.review_artifact_type,
        validationCommands: bubbleConfig.commands
      }),
      launchImplementerAgent: true,
      launchReviewerAgent: false,
      launchMetaReviewerAgent: false
    };
  }

  if (activeRole === "reviewer" && activeAgent === bubbleConfig.agents.reviewer) {
    return {
      reviewerStartupPrompt: resolveResumeReviewerStartupPrompt({
        common,
        policySnapshotPathAbs: input.context.policySnapshotPathAbs,
        reviewArtifactType: bubbleConfig.review_artifact_type,
        reviewerBlockingMinSeverity:
          bubbleConfig.review_policy?.reviewer_blocking_min_severity
          ?? DEFAULT_REVIEW_POLICY_REVIEWER_BLOCKING_MIN_SEVERITY,
        ...(input.reviewerTestDirectiveLine !== undefined
          ? { reviewerTestDirectiveLine: input.reviewerTestDirectiveLine }
          : {}),
        ...(input.context.reviewerFocus !== undefined
          ? { reviewerFocus: input.context.reviewerFocus }
          : {}),
        ...(input.context.reviewerBriefText !== undefined
          ? { reviewerBriefText: input.context.reviewerBriefText }
          : {})
      }),
      launchImplementerAgent: false,
      launchReviewerAgent: true,
      launchMetaReviewerAgent: false
    };
  }

  if (activeRole === "meta_reviewer" && activeAgent === bubbleConfig.agents.meta_reviewer) {
    return {
      metaReviewerStartupPrompt: resolveResumeMetaReviewerStartupPrompt({
        common
      }),
      launchImplementerAgent: false,
      launchReviewerAgent: false,
      launchMetaReviewerAgent: true
    };
  }

  return {};
}

function resolveFreshImplementerStartupPrompt(input: {
  context: StartExecutionContext;
  launchWorkspacePath: string;
  implementerAgent: AgentName;
}): string | undefined {
  const bubbleConfig = input.context.resolved.bubbleConfig;
  // Phase 4: Do not pre-build prompts. Pass metadata for agents to reconstruct context.
  // reasonix (tmux_paste) receives its role-identity instructions as the pasted
  // startup prompt instead of via an `--agent` CLI flag; opencode gets them via
  // `--agent PF-*`. roleStartupPromptDelivery handles this distinction.
  return composeRolePrompt({
    agentName: input.implementerAgent,
    role: "implementer",
    phase: "startup",
    context: {
      bubbleId: input.context.resolved.bubbleId,
      repoPath: input.context.resolved.repoPath,
      workspacePath: input.launchWorkspacePath,
      taskArtifactPath: relative(
        input.launchWorkspacePath,
        input.context.resolved.bubblePaths.taskArtifactPath
      ),
      pairflowCommandProfile: bubbleConfig.pairflow_command_profile,
      reviewArtifactType: bubbleConfig.review_artifact_type,
      validationCommands: bubbleConfig.commands
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
  const remoteWorkspaceAuthority = resolveRemoteWorkspaceAuthority(input.context);
  const metaReviewerAgent = input.context.resolved.bubbleConfig.agents.meta_reviewer;
  const implementerAgent = input.context.resolved.bubbleConfig.agents.implementer;
  const reviewerAgent = input.context.resolved.bubbleConfig.agents.reviewer;
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
      startupPrompt: undefined
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
      startupPrompt: undefined
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
