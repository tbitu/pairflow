import type { MetaReviewGateResult } from "../../shared/metaReviewGate/metaReviewGateResultContract.js";
import {
  runCurrentRunMetaReviewGateFinalization
} from "./internal/currentRun/finalizationPipeline.js";
import type { FinalizeCurrentRunMetaReviewGateInput } from "../../shared/metaReviewGate/metaReviewGateCurrentRunTypes.js";

export type {
  MetaReviewApproveValidationCommandRunInput
} from "../../shared/metaReviewGate/metaReviewGateCurrentRunTypes.js";

export type {
  FinalizeCurrentRunMetaReviewGateInput
} from "../../shared/metaReviewGate/metaReviewGateCurrentRunTypes.js";

export async function finalizeCurrentRunMetaReviewGate(
  input: FinalizeCurrentRunMetaReviewGateInput
): Promise<MetaReviewGateResult> {
  const result = await runCurrentRunMetaReviewGateFinalization(input);

  // Cleanup: After the meta-review result is finalized and routed (regardless of outcome),
  // deactivate the meta-reviewer pane so it stops executing and awaits the next role.
  // This applies to rework (back to implementer), approval/human-gate (terminal), inconclusive,
  // and error/fallback routes. Best-effort cleanup: if deactivation fails, it does not
  // change the finalized result.
  if (input.setMetaReviewerPane !== undefined) {
    const sessionsPath = input.resolved.bubblePaths.sessionsPath;
    if (sessionsPath !== undefined) {
      await input.setMetaReviewerPane({
        active: false,
        sessionsPath,
        bubbleId: input.resolved.bubbleId
      }).catch((error: unknown) => {
        // Log but do not propagate cleanup failures; the result is already persisted.
        console.error(
          `[meta-review cleanup] pane deactivation failed for bubble=${input.resolved.bubbleId}: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }

  return result;
}
