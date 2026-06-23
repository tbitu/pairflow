import {
  type ReviewerFocusExtractionResult
} from "../../../../shared/reviewer/reviewerBrief.js";
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
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import { buildRolePromptConcernLines } from "../../../../shared/role/prompts/rolePromptConcerns.js";
import { joinPromptLines } from "../../../../shared/role/prompts/resumePromptShared.js";
export { buildResumeImplementerStartupPrompt } from "./startCommandResumeImplementerPrompt.js";

export function buildResumeMetaReviewerStartupPrompt(input: {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  pairflowCommandProfile: PairflowCommandProfile;
  state: RolePromptStateSnapshot;
  transcriptSummary: string;
  agentName?: AgentName;
  kickoffDiagnostic?: string;
}): string {
  // AC2: For opencode agents, do not inject generic startup prompts.
  if (input.agentName === "opencode") {
    return "";
  }

  return joinPromptLines(
    buildRolePromptConcernLines({
      role: "meta_reviewer",
      phase: "resume",
      context: input
    })
  );
}

export function buildResumeReviewerStartupPrompt(input: {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  policySnapshotPathAbs: string;
  pairflowCommandProfile: PairflowCommandProfile;
  state: RolePromptStateSnapshot;
  transcriptSummary: string;
  agentName?: AgentName;
  kickoffDiagnostic?: string;
  reviewArtifactType: ReviewArtifactType;
  reviewerBlockingMinSeverity?: BubbleReviewAutoReworkSeverity;
  reviewerTestDirectiveLine?: string;
  reviewerBriefText?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
}): string {
  // AC2: For opencode agents, do not inject generic startup prompts.
  if (input.agentName === "opencode") {
    return "";
  }

  return joinPromptLines(
    buildRolePromptConcernLines({
      role: "reviewer",
      phase: "resume",
      context: input
    })
  );
}

export { resolveResumeKickoffMessages } from "./startCommandResumeKickoffMessages.js";
