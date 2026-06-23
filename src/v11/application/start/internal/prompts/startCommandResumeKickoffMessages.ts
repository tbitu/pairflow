import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import type {
  BubbleReviewAutoReworkSeverity
} from "../../../../shared/reviewPolicy/reviewPolicyTypes.js";
import type {
  RolePromptStateSnapshot
} from "../../../../shared/role/prompts/rolePromptConcernTypes.js";
import type {
  PairflowCommandProfile,
  ReviewArtifactType
} from "../../../../shared/config/bubbleConfigVocabulary.js";
import {
  buildResumeImplementerKickoffMessage,
  buildResumeMetaReviewerKickoffMessage,
  buildResumeReviewerKickoffMessage,
  formatResumeStateValue,
  inferResumeReviewerProjectionVariant
} from "./startCommandResumeKickoffMessageBuilders.js";

/** Build a minimal opencode implementer kickoff message (bubble ID + task path only). */
function buildOpencodeImplementerKickoff(input: {
  bubbleId: string;
  taskArtifactPath: string;
}): string {
  return [
    `# [pairflow] bubble=${input.bubbleId} resume kickoff (implementer).`,
    `Read task file now: ${input.taskArtifactPath}.`
  ].join(" ");
}

/** Build a minimal opencode reviewer kickoff message. */
function buildOpencodeReviewerKickoff(input: {
  bubbleId: string;
  round: number;
  reviewerTestDirectiveLine?: string;
}): string {
  const lines = [
    `# [pairflow] bubble=${input.bubbleId} resume kickoff (reviewer).`,
    `State is RUNNING at round ${input.round}.`
  ];
  if (input.reviewerTestDirectiveLine !== undefined) {
    lines.push(`Test directive: ${input.reviewerTestDirectiveLine}`);
  }
  return lines.join(" ");
}

/** Build a minimal opencode meta-reviewer kickoff message. */
function buildOpencodeMetaReviewerKickoff(input: {
  bubbleId: string;
}): string {
  return `# [pairflow] bubble=${input.bubbleId} resume kickoff (meta-reviewer).`;
}

export function resolveResumeKickoffMessages(input: {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  reviewArtifactType: ReviewArtifactType;
  pairflowCommandProfile: PairflowCommandProfile;
  state: RolePromptStateSnapshot;
  transcriptSummary: string;
  implementerAgent: AgentName;
  reviewerAgent: AgentName;
  metaReviewerAgent: AgentName;
  reviewerTestDirectiveLine?: string;
  reviewerBlockingMinSeverity?: BubbleReviewAutoReworkSeverity;
}): {
  implementerKickoffMessage?: string;
  reviewerKickoffMessage?: string;
  metaReviewerKickoffMessage?: string;
  kickoffDiagnostic?: string;
} {
  if (
    input.state.state === "RUNNING" &&
    input.state.active_role === "meta_reviewer"
  ) {
    if (input.state.active_agent === input.metaReviewerAgent) {
      const isOpencode = input.metaReviewerAgent === "opencode";
      return {
        metaReviewerKickoffMessage: isOpencode
          ? buildOpencodeMetaReviewerKickoff({ bubbleId: input.bubbleId })
          : buildResumeMetaReviewerKickoffMessage({
              bubbleId: input.bubbleId,
              repoPath: input.repoPath,
              workspacePath: input.workspacePath,
              round: input.state.round,
              pairflowCommandProfile: input.pairflowCommandProfile
            })
      };
    }
    return {
      kickoffDiagnostic: [
        "RUNNING meta-review state active context is inconsistent;",
        `active_role=${formatResumeStateValue(input.state.active_role)},`,
        `active_agent=${formatResumeStateValue(input.state.active_agent)}.`,
        `configured_meta_reviewer=${input.metaReviewerAgent}.`,
        "No meta-review kickoff was sent; continue from transcript/state and reconcile lifecycle ownership before acting."
      ].join(" ")
    };
  }

  if (input.state.state !== "RUNNING") {
    return {};
  }

  const activeImplementer = input.state.active_role === "implementer" &&
    input.state.active_agent === input.implementerAgent;

  if (activeImplementer) {
    // Opencode agents receive minimal kickoff messages (no redundant guidance).
    if (input.implementerAgent === "opencode") {
      return {
        implementerKickoffMessage: buildOpencodeImplementerKickoff({
          bubbleId: input.bubbleId,
          taskArtifactPath: input.taskArtifactPath
        })
      };
    }
    return {
      implementerKickoffMessage: buildResumeImplementerKickoffMessage({
        bubbleId: input.bubbleId,
        repoPath: input.repoPath,
        workspacePath: input.workspacePath,
        taskArtifactPath: input.taskArtifactPath,
        round: input.state.round,
        reviewArtifactType: input.reviewArtifactType,
        pairflowCommandProfile: input.pairflowCommandProfile
      })
    };
  }

  const activeReviewer = input.state.active_role === "reviewer" &&
    input.state.active_agent === input.reviewerAgent;

  if (activeReviewer) {
    const projectionVariant = inferResumeReviewerProjectionVariant({
      round: input.state.round,
      transcriptSummary: input.transcriptSummary
    });
    // Opencode reviewers receive minimal kickoff messages.
    if (input.reviewerAgent === "opencode") {
      return {
        reviewerKickoffMessage: buildOpencodeReviewerKickoff({
          bubbleId: input.bubbleId,
          round: input.state.round,
          ...(input.reviewerTestDirectiveLine !== undefined
            ? { reviewerTestDirectiveLine: input.reviewerTestDirectiveLine }
            : {})
        })
      };
    }
    return {
      reviewerKickoffMessage: buildResumeReviewerKickoffMessage({
        bubbleId: input.bubbleId,
        repoPath: input.repoPath,
        workspacePath: input.workspacePath,
        round: input.state.round,
        reviewArtifactType: input.reviewArtifactType,
        pairflowCommandProfile: input.pairflowCommandProfile,
        projectionVariant,
        ...(input.reviewerBlockingMinSeverity !== undefined
          ? { reviewerBlockingMinSeverity: input.reviewerBlockingMinSeverity }
          : {}),
        ...(input.reviewerTestDirectiveLine !== undefined
          ? { reviewerTestDirectiveLine: input.reviewerTestDirectiveLine }
          : {})
      })
    };
  }

  return {
    kickoffDiagnostic: [
      "RUNNING state active context is inconsistent;",
      `active_role=${formatResumeStateValue(input.state.active_role)},`,
      `active_agent=${formatResumeStateValue(input.state.active_agent)}.`,
      "No kickoff was sent; continue using status pane + transcript/state context."
    ].join(" ")
  };
}
