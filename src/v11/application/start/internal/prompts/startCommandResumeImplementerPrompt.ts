import type {
  PairflowCommandProfile,
  ReviewArtifactType
} from "../../../../shared/config/bubbleConfigVocabulary.js";
import type {
  BubbleCommandsConfig
} from "../../../../shared/command/commandConfigTypes.js";
import { joinPromptLines } from "../../../../shared/role/prompts/resumePromptShared.js";
import { buildRolePromptConcernLines } from "../../../../shared/role/prompts/rolePromptConcerns.js";
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
  // AC2: For opencode agents, do not inject generic startup prompts.
  if (input.agentName === "opencode") {
    return "";
  }

  return joinPromptLines(
    buildRolePromptConcernLines({
      role: "implementer",
      phase: "resume",
      context: input
    })
  );
}
