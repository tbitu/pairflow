import type {
  PairflowCommandProfile,
  ReviewArtifactType
} from "../../../../shared/config/bubbleConfigVocabulary.js";
import type {
  BubbleCommandsConfig
} from "../../../../shared/command/commandConfigTypes.js";
import type {
  RolePromptStateSnapshot
} from "../../../../shared/role/prompts/rolePromptConcernTypes.js";
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";

export function buildResumeImplementerStartupPrompt(input: {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  reviewArtifactType: ReviewArtifactType;
  pairflowCommandProfile: PairflowCommandProfile;
  state: RolePromptStateSnapshot;
  transcriptSummary: string;
  agentName?: AgentName;
  kickoffDiagnostic?: string;
  validationCommands?: BubbleCommandsConfig;
}): string {
  void input;
  // Phase 4: No longer build prompts. Agents reconstruct based on role and metadata.
  // This function is retained for backward compatibility but returns empty string.
  return "";
}
