import {
  buildMetaReviewSubmitApproveParityNote,
  buildMetaReviewSubmitCommandTemplate
} from "../../../../shared/metaReview/metaReviewSubmitGuidance.js";
import { META_REVIEWER_SUBMIT_DIRECTIVE } from "../../../../shared/role/prompts/sharedPromptDirectives.js";

/**
 * Build meta-review gate prompt with emit directive.
 *
 * Lifecycle contract (consistent with all agent roles): the emit directive applies at the
 * conclusion of an active execution window — after completing the autonomous meta-review,
 * but never while idle or waiting for orchestration signals. The "meta-review session" here
 * refers to the period from receiving this prompt until submitting results through the
 * structured Pairflow CLI. This matches the unified lifecycle policy documented in
 * roleActionGuidance.ts buildAgentEvidenceHandoffGuidance, ensuring that whether an
 * agent is implementing code, conducting a review, or performing meta-review, it always
 * submits before stopping work.
 */
export function buildMetaReviewGateRunPrompt(input: {
  bubbleId: string;
  round: number;
  repoPath: string;
  taskArtifactPath: string;
}): string {
  return [
    `[pairflow] bubble=${input.bubbleId} meta-review request round=${input.round}.`,
    META_REVIEWER_SUBMIT_DIRECTIVE,
    "Perform autonomous meta-review now, then submit through structured Pairflow CLI (no pane markers).",
    `Repository: ${input.repoPath}.`,
    `Task: ${input.taskArtifactPath}.`,
    "Before emit, fetch fresh actor authority with `pairflow bubble status --json` and use the current `executionContext.handoffId` and `executionContext.executionId`.",
    `Required command (include --report-json parity fields): ${buildMetaReviewSubmitCommandTemplate({ bubbleId: input.bubbleId, round: input.round })}.`,
    buildMetaReviewSubmitApproveParityNote(),
    "Tool-call safety: never invoke terminal/bash tools with an empty command or missing required arguments.",
    "Do not modify transcript, inbox, or state files manually."
  ].join(" ");
}
