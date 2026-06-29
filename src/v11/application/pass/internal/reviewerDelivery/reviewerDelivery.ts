import {
  type DeliveryAck,
  type EmitDeliveryNotificationAckPort
} from "../../../../ports/tmuxDelivery.js";
import type { ReviewerTestExecutionDirective } from "../../../../shared/reviewer/testEvidence.js";
import type { BubbleConfig } from "../../../../shared/config/bubbleConfigTypes.js";
import type { ProtocolEnvelope } from "../../../../shared/protocol/protocolEnvelopeContract.js";
import type {
  ReadReviewerBriefArtifactPort,
  ReadReviewerFocusArtifactPort
} from "../../../../ports/reviewerArtifacts.js";
import type {
  ResolveDeliveryMessageRefPort
} from "../../../../ports/tmuxDelivery.js";
import type { RefreshReviewerContextPort } from "../../../../ports/reviewerContext.js";
import type {
  ResolveReviewerTestExecutionDirectiveFromArtifactPort,
  VerifyImplementerTestEvidencePort,
  WriteReviewerTestEvidenceArtifactPort
} from "../../../../ports/reviewerTestEvidenceArtifacts.js";
import type { PassRecipientRole, PassSenderRole } from "../../../../domain/pass/handoff.js";
import {
  buildPassDeliveryInput,
  loadReviewerStartupPrompt,
  resolveDeliveryInitialDelayMs,
  shouldRetryPassDelivery
} from "./reviewerDeliveryHelpers.js";
import { executeImplementerHandoffDelivery } from "../../../../shared/delivery/implementerHandoffDelivery.js";
import {
  createEmitDeliveryOrchestrator,
  mapDeliveryResultToDeliveryAck
} from "../../../../shared/delivery/deliveryOrchestratorFactory.js";
import {
  CleanupPolicy,
  ConvergencePolicy,
  StartupStrategy
} from "../../../../shared/delivery/unifiedDeliveryOrchestrator.js";
import {
  reviewerDeliveryDefaults
} from "../../reviewerDeliveryDefaults.js";

export interface PassDeliveryDependencies {
  emitDeliveryNotificationAck?: EmitDeliveryNotificationAckPort;
  refreshReviewerContext?: RefreshReviewerContextPort;
  readReviewerBriefArtifact?: ReadReviewerBriefArtifactPort;
  readReviewerFocusArtifact?: ReadReviewerFocusArtifactPort;
  resolveDeliveryMessageRef?: ResolveDeliveryMessageRefPort;
  verifyImplementerTestEvidence?: VerifyImplementerTestEvidencePort;
  writeReviewerTestEvidenceArtifact?: WriteReviewerTestEvidenceArtifactPort;
  resolveReviewerTestExecutionDirectiveFromArtifact?:
    ResolveReviewerTestExecutionDirectiveFromArtifactPort;
}

export interface ExecutePassDeliveryInput {
  bubbleId: string;
  bubbleConfig: BubbleConfig;
  sessionsPath: string;
  reviewerBriefArtifactPath: string;
  reviewerFocusArtifactPath: string;
  envelope: ProtocolEnvelope;
  senderRole: PassSenderRole;
  recipientRole: PassRecipientRole;
  reviewerTestDirective?: ReviewerTestExecutionDirective;
}

export interface ExecutePassDeliveryResult {
  result: DeliveryAck | undefined;
  retried: boolean;
}

export async function executePassDelivery(
  input: ExecutePassDeliveryInput,
  dependencies: PassDeliveryDependencies = {}
): Promise<ExecutePassDeliveryResult> {
  const emitDelivery =
    dependencies.emitDeliveryNotificationAck
    ?? reviewerDeliveryDefaults.emitDeliveryNotificationAck;
  const resolveMessageRef =
    dependencies.resolveDeliveryMessageRef
    ?? reviewerDeliveryDefaults.resolveDeliveryMessageRef;
  if (input.recipientRole !== "reviewer") {
    const deliveryInput = buildPassDeliveryInput({
      executeInput: input,
      reviewerBriefText: undefined,
      reviewerFocus: undefined,
      initialDelayMs: undefined,
      resolveDeliveryMessageRef: resolveMessageRef
    });
    return executeImplementerHandoffDelivery({
      deliveryInput,
      emitDelivery
    });
  }

  const {
    reviewerBriefText,
    reviewerFocus
    // Phase 4: Do not load startup prompts; agents reconstruct based on role and metadata.
  } = await loadReviewerStartupPrompt({
    reviewerBriefArtifactPath: input.reviewerBriefArtifactPath,
    reviewerFocusArtifactPath: input.reviewerFocusArtifactPath,
    readReviewerBriefArtifact:
      dependencies.readReviewerBriefArtifact
      ?? reviewerDeliveryDefaults.readReviewerBriefArtifact,
    readReviewerFocusArtifact:
      dependencies.readReviewerFocusArtifact
      ?? reviewerDeliveryDefaults.readReviewerFocusArtifact
  });

  const refreshReviewer =
    dependencies.refreshReviewerContext
    ?? reviewerDeliveryDefaults.refreshReviewerContext;
  // Phase 4: Do not pass reviewer startup prompt to delivery.
  const deliveryInitialDelayMs = await resolveDeliveryInitialDelayMs({
    executeInput: input,
    reviewerStartupPrompt: undefined,
    refreshReviewer
  });

  const deliveryInput = buildPassDeliveryInput({
    executeInput: input,
    reviewerBriefText,
    reviewerFocus,
    initialDelayMs: deliveryInitialDelayMs,
    resolveDeliveryMessageRef: resolveMessageRef
  });
  let deliveryResult = await createEmitDeliveryOrchestrator({ emitDelivery }).deliverToRole({
    bubbleId: deliveryInput.bubbleId,
    bubbleConfig: deliveryInput.bubbleConfig,
    sessionsPath: deliveryInput.sessionsPath,
    envelope: deliveryInput.envelope,
    ...(deliveryInput.recipientRole !== undefined ? { role: deliveryInput.recipientRole } : {}),
    ...(deliveryInput.messageRef !== undefined ? { messageRef: deliveryInput.messageRef } : {}),
    ...(deliveryInput.initialDelayMs !== undefined ? { initialDelayMs: deliveryInput.initialDelayMs } : {}),
    ...(deliveryInput.reviewerBrief !== undefined ? { reviewerBrief: deliveryInput.reviewerBrief } : {}),
    ...(deliveryInput.reviewerFocus !== undefined ? { reviewerFocus: deliveryInput.reviewerFocus } : {}),
    ...(deliveryInput.reviewerTestDirective !== undefined
      ? { reviewerTestDirective: deliveryInput.reviewerTestDirective }
      : {}),
    strategy: StartupStrategy.PostReadinessTmux,
    cleanupPolicy: CleanupPolicy.Persist,
    convergencePolicy: ConvergencePolicy.Respawn
  }).then((result) => mapDeliveryResultToDeliveryAck(result)).catch(() => undefined);
  let deliveryRetried = false;
  const shouldRetryDelivery = shouldRetryPassDelivery({
    executeInput: input,
    deliveryResult
  });
  if (shouldRetryDelivery) {
    deliveryRetried = true;
    deliveryResult = await createEmitDeliveryOrchestrator({ emitDelivery }).deliverToRole({
      bubbleId: deliveryInput.bubbleId,
      bubbleConfig: deliveryInput.bubbleConfig,
      sessionsPath: deliveryInput.sessionsPath,
      envelope: deliveryInput.envelope,
      ...(deliveryInput.recipientRole !== undefined ? { role: deliveryInput.recipientRole } : {}),
      ...(deliveryInput.messageRef !== undefined ? { messageRef: deliveryInput.messageRef } : {}),
      // Respawned reviewer CLIs can take a few seconds to become input-ready.
      // Retry once with a longer warm-up window (30 seconds) before giving up.
      initialDelayMs: 30000,
      deliveryAttempts: 6,
      ...(deliveryInput.reviewerBrief !== undefined ? { reviewerBrief: deliveryInput.reviewerBrief } : {}),
      ...(deliveryInput.reviewerFocus !== undefined ? { reviewerFocus: deliveryInput.reviewerFocus } : {}),
      ...(deliveryInput.reviewerTestDirective !== undefined
        ? { reviewerTestDirective: deliveryInput.reviewerTestDirective }
        : {}),
      strategy: StartupStrategy.PostReadinessTmux,
      cleanupPolicy: CleanupPolicy.Persist,
      convergencePolicy: ConvergencePolicy.Respawn
    }).then((result) => mapDeliveryResultToDeliveryAck(result)).catch(() => deliveryResult);
  }

  return {
    result: deliveryResult,
    retried: deliveryRetried
  };
}
