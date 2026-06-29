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
import type {
  ReviewerFocusExtractionResult
} from "../../../../shared/reviewer/reviewerBrief.js";
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
  void input;
  // Phase 4: No longer build prompts. Agents reconstruct based on role and metadata.
  // This function is retained for backward compatibility but returns empty string.
  return "";
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
  void input;
  // Phase 4: No longer build prompts. Agents reconstruct based on role and metadata.
  // This function is retained for backward compatibility but returns empty string.
  return "";
}

export { resolveResumeKickoffMessages } from "./startCommandResumeKickoffMessages.js";
