import { relative } from "node:path";

import {
  buildResumeImplementerStartupPrompt,
  buildResumeMetaReviewerStartupPrompt,
  buildResumeReviewerStartupPrompt
} from "../prompts/startCommandResumePrompts.js";
import { composeRolePrompt } from "../../../../shared/role/prompts/roleStartupPromptComposer.js";
import type { StartExecutionContext } from "./startCommandContext.js";
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import { DEFAULT_REVIEW_POLICY_REVIEWER_BLOCKING_MIN_SEVERITY } from "../../../../../config/defaults.js";
import type { PairflowCommandProfile, ReviewArtifactType } from "../../../../shared/config/bubbleConfigVocabulary.js";
import type { BubbleCommandsConfig } from "../../../../shared/command/commandConfigTypes.js";
import type { BubbleReviewAutoReworkSeverity } from "../../../../shared/reviewPolicy/reviewPolicyTypes.js";
import type { ReviewerFocusExtractionResult } from "../../../../shared/reviewer/reviewerBrief.js";
import type { RolePromptStateSnapshot } from "../../../../shared/role/prompts/rolePromptConcernTypes.js";

export interface ActiveResumeStartupPrompts {
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

export function buildActiveResumeStartupPrompts(input: {
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
  const common: RoleStartupCommon = {
    bubbleId: input.context.resolved.bubbleId,
    repoPath: input.context.resolved.repoPath,
    workspacePath: input.launchWorkspacePath,
    taskArtifactPath: relative(
      input.launchWorkspacePath,
      input.context.resolved.bubblePaths.taskArtifactPath
    ),
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

export function resolveFreshImplementerStartupPrompt(input: {
  context: StartExecutionContext;
  launchWorkspacePath: string;
  implementerAgent: AgentName;
}): string | undefined {
  void input;
  // Phase 4: do not pre-build prompts. The implementer's initial instructions
  // are delivered as the short single-line kickoff paste. In particular the
  // long multiline role-startup prompt must NOT be pasted for tmux_paste
  // agents (reasonix): it overflows reasonix's composer and Enter stops
  // submitting, so the agent would never receive its task. Returning
  // `undefined` makes the seed skip the startup prompt and paste the kickoff.
  return undefined;
}

export type { RolePromptStateSnapshot };
