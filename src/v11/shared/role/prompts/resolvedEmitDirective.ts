import type {
  ReviewArtifactType
} from "../../config/bubbleConfigVocabulary.js";
import type {
  BubbleReviewAutoReworkSeverity
} from "../../reviewPolicy/reviewPolicyTypes.js";
import {
  buildReviewerBlockingThresholdLabel
} from "../../reviewer/reviewerCommandGateGuidance.js";

/**
 * Resolved emit directives for handoff delivery messages.
 *
 * Role startup/resume guidance intentionally stays abstract (round-1 rule,
 * `severity_gate_round` symbolic, placeholder `--repo/--bubble-id`), because
 * it is composed once per role. The delivery message, by contrast, is composed
 * per handoff with the real round, gate round, threshold, repo and bubble id in
 * scope. These builders resolve the parts that were previously left for the
 * agent to derive from `pairflow bubble status --json` and gate arithmetic.
 *
 * The two authority tokens (`--handoff-id`, `--execution-id`) stay explicitly
 * un-resolved on purpose: they are minted per round transition and must be
 * re-read fresh from `executionContext` right before each emit (anti-stale
 * design; see docs/agent-emit-troubleshooting.md).
 */

function resolveAuthorityTokenRefreshClause(): string {
  return "refresh `--handoff-id` and `--execution-id` from `executionContext` in `pairflow bubble status --json` immediately before emitting (never reuse stale tokens)";
}

function buildResolvedCommandArguments(input: {
  repoPath: string;
  bubbleId: string;
}): string {
  return `--repo ${input.repoPath} --bubble-id ${input.bubbleId} --handoff-id <fresh executionContext.handoffId> --execution-id <fresh executionContext.executionId>`;
}

/**
 * Reviewer decision rule resolved to this round's real numbers. Mirrors the
 * runtime gate in `validateReviewerPassGate` (src/v11/domain/pass/reviewerDecision.ts):
 * pre-gate rounds always emit `pass` (findings or bare `--no-findings`);
 * post-gate rounds forbid `--no-findings`, `pass` is valid only when a finding
 * meets the blocking threshold, and clean/advisory-only outcomes converge.
 */
export function buildResolvedReviewerEmitDirective(input: {
  round: number;
  severityGateRound: number;
  reviewerBlockingMinSeverity?: BubbleReviewAutoReworkSeverity;
  reviewArtifactType?: ReviewArtifactType;
  repoPath: string;
  bubbleId: string;
}): string {
  const postGate = input.round >= input.severityGateRound;
  const thresholdLabel = buildReviewerBlockingThresholdLabel({
    ...(input.reviewerBlockingMinSeverity !== undefined
      ? { reviewerBlockingMinSeverity: input.reviewerBlockingMinSeverity }
      : {})
  });
  const documentScopeNote =
    input.reviewArtifactType === "document"
      ? " Document scope: unqualified `P0/P1` findings route as `P2` for the threshold; blocker-grade document findings require strict `timing=required-now` + `layer=L1` qualifiers that the CLI `--finding` flag cannot encode."
      : "";
  const rule =
    postGate
      ? [
          `Round ${input.round} >= severity_gate_round ${input.severityGateRound} (post-gate; threshold \`${thresholdLabel}\`): \`--no-findings\` is forbidden.`,
          `Clean outcome -> \`--kind convergence\` with no finding flags.`,
          `Advisory-only findings (below threshold) -> \`--kind convergence\` with \`--finding "P2|P3:Title"\` entries.`,
          `Any finding at or above the threshold -> \`--kind pass\` with \`--finding\` entries (P0/P1 require finding-level refs).${documentScopeNote}`
        ].join(" ")
      : [
          `Round ${input.round} < severity_gate_round ${input.severityGateRound} (pre-gate): every outcome uses \`--kind pass\`.`,
          `Findings -> repeatable \`--finding "<P0|P1|P2|P3>:Title[|artifact refs]"\` entries.`,
          `Truly clean -> bare \`--no-findings\` (never \`--no-findings=<value>\`).`
        ].join(" ");
  return [
    `Resolved emit rule for this round: ${rule}`,
    `Command (arguments resolved except the two authority tokens): \`pairflow agent emit --kind <pass|convergence> ${buildResolvedCommandArguments(input)}\` -- choose \`--kind\` per the rule above; ${resolveAuthorityTokenRefreshClause()}.`
  ].join(" ");
}

/**
 * Implementer emit command with `--repo`/`--bubble-id` pre-filled. Implementers
 * only ever emit `pass` (or `human_question` for blockers), so no kind choice
 * is required here.
 */
export function buildResolvedImplementerEmitCommand(input: {
  repoPath: string;
  bubbleId: string;
}): string {
  return `Resolved handoff command: \`pairflow agent emit --kind pass ${buildResolvedCommandArguments(input)} --summary "<what changed + validation>"\` with available evidence \`--ref\` log paths; ${resolveAuthorityTokenRefreshClause()}.`;
}
