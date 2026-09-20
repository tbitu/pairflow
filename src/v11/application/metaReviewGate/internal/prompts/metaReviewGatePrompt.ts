import {
  buildMetaReviewSubmitCommandTemplate
} from "../../../../shared/metaReview/metaReviewSubmitGuidance.js";

export function buildMetaReviewGateRunPrompt(input: {
  bubbleId: string;
  round: number;
  repoPath: string;
  taskArtifactPath: string;
  roleArtifactPath?: string;
}): string {
  const roleInstruction =
    input.roleArtifactPath !== undefined
      ? `Read role instructions now: ${input.roleArtifactPath}. `
      : "";
  return [
    `[pairflow] bubble=${input.bubbleId} meta-review request round=${input.round}.`,
    `${roleInstruction}Read task file now: ${input.taskArtifactPath}.`,
    "Perform autonomous meta-review now, then submit with `pairflow agent emit --kind meta_review_result`.",
    `Required command (include --report-json parity fields): \`${buildMetaReviewSubmitCommandTemplate({ bubbleId: input.bubbleId, round: input.round })}\`.`
  ].join(" ");
}
