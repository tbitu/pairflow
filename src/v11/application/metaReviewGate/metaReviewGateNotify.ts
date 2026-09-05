import {
  buildMetaReviewGateRunPrompt
} from "./internal/prompts/metaReviewGatePrompt.js";
import type {
  MetaReviewRuntimeDeliveryObservation,
  NotifyMetaReviewerSubmissionRequestDependencies,
  NotifyMetaReviewerSubmissionRequestInput
} from "../../shared/metaReviewGate/index.js";
import type {
  MetaReviewGateNotifyTmuxCapabilities
} from "../../shared/metaReviewGate/metaReviewGateRuntimeCapabilities.js";
import {
  resolveMetaReviewGateNotifyTmuxCapabilities
} from "./metaReviewGateRuntimeCapabilityResolution.js";
import { resolveTmuxPasteOptions } from "../../shared/agent/agentRuntimeProfiles.js";

const metaReviewerPaneExitedReasonCode = "META_REVIEWER_PANE_EXITED";
const metaReviewRequestDeliveryUnconfirmedReasonCode =
  "META_REVIEW_REQUEST_DELIVERY_UNCONFIRMED";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function paneShowsExitedAgentShell(input: {
  text: string;
  metaReviewerAgent: string;
}): boolean {
  const pattern = new RegExp(
    `${escapeRegex(input.metaReviewerAgent)} exited \\(code \\d+\\)\\. Dropping to interactive shell\\.`,
    "u"
  );
  return pattern.test(input.text);
}

/**
 * Confirm the structured submit-request marker was submitted, first failing
 * fast when the meta-reviewer pane dropped back to an interactive shell.
 */
async function assertMetaReviewRequestSubmitted(input: {
  paneRunner: NonNullable<MetaReviewGateNotifyTmuxCapabilities["runner"]>;
  confirmSubmission: NonNullable<
    MetaReviewGateNotifyTmuxCapabilities["confirmSubmission"]
  >;
  targetPane: string;
  marker: string;
  metaReviewerAgent: string;
}): Promise<MetaReviewRuntimeDeliveryObservation> {
  const capture = await input.paneRunner(
    ["capture-pane", "-p", "-t", input.targetPane, "-S", "-"],
    { allowFailure: true }
  );
  if (
    capture.exitCode === 0
    && paneShowsExitedAgentShell({
      text: capture.stdout,
      metaReviewerAgent: input.metaReviewerAgent
    })
  ) {
    return {
      status: "failed",
      reasonCode: metaReviewerPaneExitedReasonCode,
      message:
        `meta-reviewer pane fell back to interactive shell after ${input.metaReviewerAgent} exit.`
    };
  }

  const confirmed = await input.confirmSubmission({
    runner: input.paneRunner,
    targetPane: input.targetPane,
    marker: input.marker
  });
  if (confirmed) {
    return {
      status: "confirmed",
      reasonCode: null,
      message:
        "meta-review submit request delivery confirmed from pane scrollback."
    };
  }

  return {
    status: "uncertain",
    reasonCode: metaReviewRequestDeliveryUnconfirmedReasonCode,
    message: "meta-reviewer pane did not confirm structured submit request delivery."
  };
}

export async function notifyMetaReviewerSubmissionRequest(
  input: NotifyMetaReviewerSubmissionRequestInput,
  dependencies: NotifyMetaReviewerSubmissionRequestDependencies = {}
): Promise<MetaReviewRuntimeDeliveryObservation> {
  const tmux = resolveMetaReviewGateNotifyTmuxCapabilities(dependencies.runtime);
  const runner = tmux?.runner;
  const resolveAgentPaneAdapter = tmux?.resolveAgentPaneAdapter;
  const sendSubmissionRequestMessage = tmux?.sendSubmissionRequestMessage;
  const confirmSubmission = tmux?.confirmSubmission;
  if (
    runner === undefined
    || sendSubmissionRequestMessage === undefined
    || confirmSubmission === undefined
  ) {
    return {
      status: "failed",
      reasonCode: "META_REVIEW_REQUEST_DELIVERY_RUNTIME_UNAVAILABLE",
      message: "meta-review gate notify runtime capabilities are unavailable."
    };
  }

  const paneAgent = resolveAgentPaneAdapter?.(input.metaReviewerAgent);
  const requestMarker = `bubble=${input.bubbleId} meta-review request round=${input.round}.`;
  const message = buildMetaReviewGateRunPrompt({
    bubbleId: input.bubbleId,
    round: input.round,
    repoPath: "<repo>",
    taskArtifactPath: "artifacts/task.md"
  });

  if (paneAgent !== undefined) {
    await paneAgent.acceptTrustPrompt(runner, input.targetPane).catch(
      () => undefined
    );
  }
  try {
    await sendSubmissionRequestMessage(runner, input.targetPane, message, {
      ...(paneAgent !== undefined
        ? paneAgent.resolvePasteOptions()
        : { maxChunkLength: 1024, ...resolveTmuxPasteOptions(input.metaReviewerAgent) })
    });
  } catch (error) {
    return {
      status: "failed",
      reasonCode: "META_REVIEW_REQUEST_DELIVERY_FAILED",
      message: error instanceof Error ? error.message : String(error)
    };
  }
  return assertMetaReviewRequestSubmitted({
    paneRunner: runner,
    confirmSubmission,
    targetPane: input.targetPane,
    marker: requestMarker,
    metaReviewerAgent: input.metaReviewerAgent
  });
}
