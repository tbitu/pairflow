import { resolve } from "node:path";
import {
  type DeliveryAck,
  type EmitDeliveryNotificationAckPort
} from "../../../../ports/tmuxDelivery.js";
import {
  formatReviewerTestExecutionDirective,
  type ReviewerTestExecutionDirective
} from "../../../../shared/reviewer/testEvidence.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered
} from "../../../../shared/agent/agentRuntimeProfiles.js";
import { composeRolePrompt } from "../../../../shared/role/prompts/roleStartupPromptComposer.js";
import { reviewerPolicySnapshotFileName } from "../../../../shared/reviewer/reviewerPolicySnapshot.js";
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
  resolveDeliveryInitialDelayMs
} from "./reviewerDeliveryHelpers.js";
import { executeRoleHandoffDelivery } from "../../../../shared/delivery/roleHandoffDelivery.js";
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

/** Without this the reviewer silently receives nothing while `emit` reports success. */
function reportUndeliveredReviewerHandoff(input: {
  bubbleId: string;
  envelopeId: string;
  deliveryResult: DeliveryAck | undefined;
  retried: boolean;
}): void {
  if (input.deliveryResult?.status === "accepted") {
    return;
  }
  console.error(
    `[pass delivery] reviewer handoff was not delivered for bubble=${input.bubbleId} envelope=${input.envelopeId}`
    + ` (status=${input.deliveryResult?.status ?? "none"}, reason=${input.deliveryResult?.reason ?? "unknown"}, retried=${String(input.retried)}).`
  );
}

function composePassReviewerStartupPrompt(input: {
  executeInput: ExecutePassDeliveryInput;
  reviewerBriefText?: string | undefined;
  reviewerFocus?: ReturnType<typeof loadReviewerStartupPrompt> extends Promise<{ reviewerFocus: infer F }> ? F : never;
}): string | undefined {
  const reviewerAgent = input.executeInput.bubbleConfig.agents.reviewer;
  if (
    !isAgentNameRegistered(reviewerAgent)
    || getAgentRuntimeProfile(reviewerAgent).startupPromptDelivery !== "tmux_paste"
  ) {
    return undefined;
  }

  const bubbleConfig = input.executeInput.bubbleConfig;
  return composeRolePrompt({
    agentName: reviewerAgent,
    role: "reviewer",
    phase: "startup",
    context: {
      bubbleId: input.executeInput.bubbleId,
      repoPath: bubbleConfig.repo_path,
      workspacePath: bubbleConfig.repo_path,
      taskArtifactPath: resolve(
        bubbleConfig.repo_path,
        `.pairflow/bubbles/${input.executeInput.bubbleId}/artifacts/task.md`
      ),
      pairflowCommandProfile:
        bubbleConfig.pairflow_command_profile ?? "external",
      policySnapshotPathAbs: resolve(
        bubbleConfig.repo_path,
        `.pairflow/bubbles/${input.executeInput.bubbleId}/artifacts/${reviewerPolicySnapshotFileName}`
      ),
      reviewArtifactType: bubbleConfig.review_artifact_type,
      reviewerBlockingMinSeverity:
        bubbleConfig.review_policy?.reviewer_blocking_min_severity,
      reviewerTestDirectiveLine:
        input.executeInput.reviewerTestDirective !== undefined
          ? formatReviewerTestExecutionDirective(input.executeInput.reviewerTestDirective)
          : undefined,
      reviewerBriefText: input.reviewerBriefText,
      reviewerFocus: input.reviewerFocus
    }
  });
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
  let reviewerBriefText: string | undefined;
  let reviewerFocus: Awaited<ReturnType<ReadReviewerFocusArtifactPort>> | undefined;
  let deliveryInitialDelayMs: number | undefined;

  if (input.recipientRole === "reviewer") {
    const loaded = await loadReviewerStartupPrompt({
      reviewerBriefArtifactPath: input.reviewerBriefArtifactPath,
      reviewerFocusArtifactPath: input.reviewerFocusArtifactPath,
      readReviewerBriefArtifact:
        dependencies.readReviewerBriefArtifact
        ?? reviewerDeliveryDefaults.readReviewerBriefArtifact,
      readReviewerFocusArtifact:
        dependencies.readReviewerFocusArtifact
        ?? reviewerDeliveryDefaults.readReviewerFocusArtifact
    });
    reviewerBriefText = loaded.reviewerBriefText;
    reviewerFocus = loaded.reviewerFocus;

    const refreshReviewer =
      dependencies.refreshReviewerContext
      ?? reviewerDeliveryDefaults.refreshReviewerContext;

    const reviewerStartupPrompt = composePassReviewerStartupPrompt({
      executeInput: input,
      reviewerBriefText,
      reviewerFocus
    });

    deliveryInitialDelayMs = await resolveDeliveryInitialDelayMs({
      executeInput: input,
      reviewerStartupPrompt,
      refreshReviewer
    });
  }

  const deliveryInput = buildPassDeliveryInput({
    executeInput: input,
    reviewerBriefText,
    reviewerFocus,
    initialDelayMs: deliveryInitialDelayMs,
    resolveDeliveryMessageRef: resolveMessageRef
  });

  return executeRoleHandoffDelivery({
    deliveryInput,
    strategy: input.recipientRole === "reviewer"
      ? StartupStrategy.PostReadinessTmux
      : StartupStrategy.UpfrontCli,
    convergencePolicy: ConvergencePolicy.Respawn,
    cleanupPolicy: CleanupPolicy.Persist,
    emitDelivery,
    onUndelivered: (deliveryResult, retried) => {
      reportUndeliveredReviewerHandoff({
        bubbleId: input.bubbleId,
        envelopeId: input.envelope.id,
        deliveryResult,
        retried
      });
    }
  });
}
