import {
  buildCanonicalActorEmitLookupGuidance,
  buildAgentEvidenceHandoffGuidance as buildAgentEvidenceHandoffGuidanceFromRegistry,
  buildRolePromptConcernLines
} from "../../../../shared/role/prompts/rolePromptConcerns.js";
import { buildDocumentBubbleSourceEditGuard } from "../../../../shared/document/documentBubbleSourceEditGuard.js";
import { buildPairflowCommandGuidance } from "../../startCommandPromptRuntime.js";
import type {
  PairflowCommandProfile,
  ReviewArtifactType
} from "../../../../shared/config/bubbleConfigVocabulary.js";
import type {
  BubbleCommandsConfig
} from "../../../../shared/command/commandConfigTypes.js";

export function buildImplementerStartupPrompt(input: {
  bubbleId: string;
  repoPath: string;
  workspacePath: string;
  taskArtifactPath: string;
  reviewArtifactType: ReviewArtifactType;
  pairflowCommandProfile: PairflowCommandProfile;
  ideationPending: boolean;
  validationCommands?: BubbleCommandsConfig;
}): string {
  return buildRolePromptConcernLines({
    role: "implementer",
    phase: "startup",
    context: input
  }).join(" ");
}

export function buildImplementerIdeationKickoffMessage(input: {
  bubbleId: string;
  workspacePath: string;
  taskArtifactPath: string;
  pairflowCommandProfile: PairflowCommandProfile;
}): string {
  return [
    `# [pairflow] bubble=${input.bubbleId} kickoff (ideation pending).`,
    "State is RUNNING at round 0.",
    "No implementer action is required right now.",
    "Stay idle and wait for explicit human instruction.",
    "Do not run `pairflow bubble kickoff` yourself."
  ].join(" ");
}

export function buildImplementerKickoffMessage(input: {
  bubbleId: string;
  workspacePath: string;
  taskArtifactPath: string;
  reviewArtifactType: ReviewArtifactType;
  pairflowCommandProfile: PairflowCommandProfile;
  validationCommands?: BubbleCommandsConfig;
}): string {
  return [
    `# [pairflow] bubble=${input.bubbleId} kickoff.`,
    `Read task file now: ${input.taskArtifactPath}.`,
    buildImplementerKickoffScopeInstruction(input.reviewArtifactType),
    buildPairflowCommandGuidance(
      input.workspacePath,
      input.pairflowCommandProfile
    ),
    buildAgentEvidenceHandoffGuidanceFromRegistry(
      input.reviewArtifactType,
      input.validationCommands
    ),
    buildCanonicalActorEmitLookupGuidance({
      bubbleId: input.bubbleId,
      repoPath: "<repo>"
    }),
    "When done with validation, hand off with `pairflow agent emit --kind pass --repo <repo> --bubble-id <id> --handoff-id <handoff-id> --execution-id <execution-id> --summary \"<what changed + validation>\"` and include available evidence `--ref` log paths."
  ].join(" ");
}

export function buildImplementerKickoffScopeInstruction(
  reviewArtifactType: ReviewArtifactType
): string {
  if (reviewArtifactType === "document") {
    return [
      "Document refinement mode (`review_artifact_type=document`): continue only task/spec/progress/docs refinement.",
      buildDocumentBubbleSourceEditGuard(),
      "Do not implement product/runtime/source-code changes in this bubble.",
      "If the remaining work requires code changes, stop and emit a blocker or route-back/replan request instead of editing source."
    ].join(" ");
  }

  return "Continue active implementation.";
}

export function buildAgentEvidenceHandoffGuidance(
  reviewArtifactType: ReviewArtifactType,
  validationCommands?: BubbleCommandsConfig
): string {
  return buildAgentEvidenceHandoffGuidanceFromRegistry(
    reviewArtifactType,
    validationCommands
  );
}
