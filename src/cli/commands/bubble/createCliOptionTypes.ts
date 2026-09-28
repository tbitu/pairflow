import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type {
  CreateReviewArtifactType,
  PairflowCommandProfile
} from "../../../v11/shared/config/bubbleConfigVocabulary.js";

export interface BubbleCreateCommandOptions {
  id?: string;
  repo?: string;
  base?: string;
  reviewArtifactType?: CreateReviewArtifactType;
  ideation?: boolean;
  task?: string;
  taskFile?: string;
  reviewerBrief?: string;
  reviewerBriefFile?: string;
  bootstrapCommand?: string;
  validationTarget?: string;
  pairflowCommandProfile?: PairflowCommandProfile;
  accuracyCritical?: boolean;
  remote?: string;
  implementer?: AgentName;
  implementerModel?: string;
  reviewer?: AgentName;
  reviewerModel?: string;
  metaReviewer?: AgentName;
  metaReviewerModel?: string;
  help: boolean;
}
