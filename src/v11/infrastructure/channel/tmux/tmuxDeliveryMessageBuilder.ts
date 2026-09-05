import { resolve } from "node:path";

import {
  getAgentRuntimeProfile,
  isAgentNameRegistered
} from "../../../shared/agent/agentRuntimeProfiles.js";

import { buildReviewerAgentSelectionGuidance } from "../../../shared/reviewer/reviewerGuidance.js";
import { buildReviewerSeverityOntologyReminder } from "../../../shared/reviewer/reviewerSeverityOntology.js";
import {
  buildReviewerPassOutputContractGuidance,
  buildReviewerScoutExpansionWorkflowGuidance
} from "../../../shared/reviewer/reviewerScoutExpansionGuidance.js";
import {
  buildReviewerFindingsPassInstruction,
  buildReviewerRoundCommandGateProjection,
  type ReviewerCommandGateProjectionVariant
} from "../../../shared/reviewer/reviewerCommandGateGuidance.js";
import {
  buildReviewerDecisionMatrixReminder,
  formatReviewerTestExecutionDirective,
  type ReviewerTestExecutionDirective
} from "../../../shared/reviewer/testEvidence.js";
import {
  formatReviewerBriefDeliveryReminder,
  formatReviewerFocusDeliveryReminder,
  type ReviewerFocusExtractionResult
} from "../../../shared/reviewer/reviewerBrief.js";
import { buildPairflowCommandGuidance } from "../../../shared/command/pairflowCommandBootstrap.js";
import {
  buildImplementerDeliveryActionGuidance,
  buildImplementerDeliveryValidationGuidance,
  type ImplementerDeliveryEvent
} from "../../../shared/role/prompts/roleActionGuidance.js";
import {
  buildResolvedImplementerEmitCommand,
  buildResolvedReviewerEmitDirective
} from "../../../shared/role/prompts/resolvedEmitDirective.js";
import {
  buildMetaReviewSubmitApproveParityNote,
  buildMetaReviewSubmitCommandTemplate
} from "../../../shared/metaReview/metaReviewSubmitGuidance.js";
import { reviewerPolicySnapshotFileName } from "../../../shared/reviewer/reviewerPolicySnapshot.js";
import type { BubbleConfig } from "../../../shared/config/bubbleConfigTypes.js";
import type { ProtocolParticipant } from "../../../../contracts/kernel/protocol.js";
import type { ProtocolEnvelope } from "../../../shared/protocol/protocolEnvelopeContract.js";

export type DeliveryMessageRecipientRole =
  | ProtocolParticipant
  | "implementer"
  | "reviewer"
  | "meta-reviewer"
  | "status";

function resolveReviewerPolicySnapshotPath(bubbleConfig: BubbleConfig): string {
  return resolve(
    bubbleConfig.repo_path,
    `.pairflow/bubbles/${bubbleConfig.id}/artifacts/${reviewerPolicySnapshotFileName}`
  );
}

function resolvePayloadActor(envelope: ProtocolEnvelope): string | null {
  const metadata = envelope.payload.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const actor = (metadata as { actor?: unknown }).actor;
  return typeof actor === "string" && actor.trim().length > 0 ? actor : null;
}

function resolveImplementerReworkOrigin(
  envelope: ProtocolEnvelope
): "meta_review_auto_rework" | "unknown" {
  const actorLabel = resolvePayloadActor(envelope);
  if (actorLabel === "meta-reviewer" || actorLabel === "meta-review-gate") {
    return "meta_review_auto_rework";
  }
  return "unknown";
}

function toImplementerDeliveryEvent(
  type: ProtocolEnvelope["type"]
): ImplementerDeliveryEvent {
  switch (type) {
    case "TASK":
    case "PASS":
    case "HUMAN_REPLY":
    case "APPROVAL_DECISION":
    case "APPROVAL_REQUEST":
      return type;
    default:
      return "OTHER";
  }
}

function buildImplementerDeliveryAction(input: {
  envelope: ProtocolEnvelope;
  bubbleConfig: BubbleConfig;
  actorLabel: string | null;
  isOpencodeRecipient?: boolean;
}): string {
  // OVERFLOW_2: For opencode recipients, return minimal action text only.
  if (input.isOpencodeRecipient) {
    const event = toImplementerDeliveryEvent(input.envelope.type);
    switch (event) {
      case "TASK":
        return "Implementation task received. Continue implementation.";
      case "PASS":
        return "Reviewer feedback received. Implement fixes.";
      case "HUMAN_REPLY":
        return "Human response received. Continue implementation using this input.";
      case "APPROVAL_DECISION": {
        if (input.envelope.type === "APPROVAL_DECISION" && input.envelope.payload.decision === "rework") {
          const origin = resolveImplementerReworkOrigin(input.envelope);
          if (origin === "meta_review_auto_rework") {
            return "Meta-review auto-rework received. Implement fixes.";
          }
          return "Rework received. Implement fixes.";
        }
        return "Human approved this bubble. Wait for commit/merge flow and do not continue new implementation in this round.";
      }
      case "APPROVAL_REQUEST": {
        if (input.actorLabel === "meta-reviewer") {
          return "Meta-reviewer requested human gate decision. Stop coding and wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now.";
        }
        return "Bubble is READY_FOR_HUMAN_APPROVAL. Stop coding and wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now.";
      }
      default:
        return "Continue protocol from this event.";
    }
  }

  const event = toImplementerDeliveryEvent(input.envelope.type);
  const docsOnly = input.bubbleConfig.review_artifact_type === "document";
  const validationGuidance = buildImplementerDeliveryValidationGuidance(
    input.bubbleConfig.commands
  );
  const actionGuidance = buildImplementerDeliveryActionGuidance({
    event,
    docsOnly,
    validationGuidance,
    actorLabel: input.actorLabel,
    ...(input.envelope.type === "APPROVAL_DECISION"
      ? { approvalDecision: input.envelope.payload.decision }
      : {}),
    reworkOrigin: resolveImplementerReworkOrigin(input.envelope)
  });
  const emitsPassAfterEvent =
    event === "TASK"
    || event === "PASS"
    || event === "HUMAN_REPLY"
    || (event === "APPROVAL_DECISION"
      && input.envelope.type === "APPROVAL_DECISION"
      && input.envelope.payload.decision === "rework");
  return emitsPassAfterEvent
    ? `${actionGuidance} ${buildResolvedImplementerEmitCommand({
        repoPath: input.bubbleConfig.repo_path,
        bubbleId: input.bubbleConfig.id
      })}`
    : actionGuidance;
}

function buildReviewerDeliveryAction(input: {
  envelope: ProtocolEnvelope;
  bubbleConfig: BubbleConfig;
  actorLabel: string | null;
  reviewerTestDirective?: ReviewerTestExecutionDirective;
  reviewerBrief?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
}): string {
  if (input.envelope.type === "PASS") {
    const isOpencodeReviewer = isAgentNameRegistered(input.bubbleConfig.agents.reviewer)
    ? getAgentRuntimeProfile(input.bubbleConfig.agents.reviewer).minimalPastedGuidance
    : false;

    // OVERFLOW_1: For opencode reviewers, return minimal handoff text only.
    if (isOpencodeReviewer) {
      const parts = [
        "Implementer handoff received. Run a fresh review now."
      ];
      if (input.reviewerTestDirective !== undefined) {
        parts.push(formatReviewerTestExecutionDirective(input.reviewerTestDirective));
      } else {
        const includeFallbackDecisionMatrixReminder =
          input.bubbleConfig.reviewer_context_mode === "fresh";
        parts.push(
          [
            "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable.",
            ...(includeFallbackDecisionMatrixReminder
              ? [buildReviewerDecisionMatrixReminder()]
              : [])
          ].join(" ")
        );
      }
      return parts.join(" ");
    }

    const reviewerPolicySnapshotPath = resolveReviewerPolicySnapshotPath(
      input.bubbleConfig
    );
    const includeFallbackDecisionMatrixReminder =
      input.bubbleConfig.reviewer_context_mode === "fresh";
    const testDirective =
      input.reviewerTestDirective === undefined
        ? [
            "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable.",
            ...(includeFallbackDecisionMatrixReminder
              ? [buildReviewerDecisionMatrixReminder()]
              : [])
          ].join(" ")
        : formatReviewerTestExecutionDirective(input.reviewerTestDirective);
    const projectionVariant: ReviewerCommandGateProjectionVariant =
      Array.isArray(input.envelope.payload.findings) && input.envelope.payload.findings.length > 0
        ? "findings"
        : "clean";
    const thresholdInput =
      input.bubbleConfig.review_policy?.reviewer_blocking_min_severity
        !== undefined
        ? {
            reviewerBlockingMinSeverity:
              input.bubbleConfig.review_policy.reviewer_blocking_min_severity
          }
        : {};
    const convergenceInstruction = buildReviewerRoundCommandGateProjection({
      round: input.envelope.round,
      ...thresholdInput,
      variant: projectionVariant
    });
    const findingsDetailInstruction =
      input.envelope.round <= 1
        ? "In round 1, use canonical pass emit (`pairflow agent emit --kind pass ...`) and declare findings explicitly (`--finding` when findings exist, `--no-findings` only when truly clean)."
        : buildReviewerFindingsPassInstruction(
            input.bubbleConfig.review_artifact_type,
            thresholdInput
          );
    const reviewerFocusReminder =
      input.reviewerFocus === undefined
        ? ""
        : formatReviewerFocusDeliveryReminder(input.reviewerFocus);
    return [
      "Implementer handoff received. Run a fresh review now.",
      buildReviewerAgentSelectionGuidance(input.bubbleConfig.review_artifact_type),
      buildReviewerSeverityOntologyReminder(),
      `Reviewer policy file: ${reviewerPolicySnapshotPath}`,
      "Read this file before first review action.",
      testDirective,
      buildReviewerScoutExpansionWorkflowGuidance(),
      buildReviewerPassOutputContractGuidance(),
      convergenceInstruction,
      findingsDetailInstruction,
      buildResolvedReviewerEmitDirective({
        round: input.envelope.round,
        severityGateRound: input.bubbleConfig.severity_gate_round,
        ...(input.bubbleConfig.review_policy?.reviewer_blocking_min_severity !== undefined
          ? {
              reviewerBlockingMinSeverity:
                input.bubbleConfig.review_policy.reviewer_blocking_min_severity
            }
          : {}),
        reviewArtifactType: input.bubbleConfig.review_artifact_type,
        repoPath: input.bubbleConfig.repo_path,
        bubbleId: input.bubbleConfig.id
      }),
      input.reviewerBrief !== undefined
        ? formatReviewerBriefDeliveryReminder(input.reviewerBrief)
        : "",
      reviewerFocusReminder,
      "Execute pairflow commands directly (no confirmation prompt)."
    ]
      .filter((part) => part.trim().length > 0)
      .join(" ");
  }
  if (input.envelope.type === "HUMAN_REPLY") {
    return "Human response received. Continue review workflow from this update.";
  }
  if (input.envelope.type === "APPROVAL_REQUEST") {
    return input.actorLabel === "meta-reviewer"
      ? "Meta-reviewer requested human gate decision. Wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now."
      : "Bubble is READY_FOR_HUMAN_APPROVAL. Review is complete; wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now.";
  }
  return "Continue protocol from this event.";
}

export function buildTmuxDeliveryMessage(input: {
  envelope: ProtocolEnvelope;
  messageRef: string;
  bubbleConfig: BubbleConfig;
  workspacePath?: string;
  reviewerTestDirective?: ReviewerTestExecutionDirective;
  reviewerBrief?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
  recipientRole: DeliveryMessageRecipientRole;
}): string {
  const actorLabel = resolvePayloadActor(input.envelope);
  
  // Phase 4: Determine if workspace guidance should be included
  // For opencode agents, omit verbose guidance to keep messages minimal
  const shouldIncludeWorkspaceGuidance = !isOpencodeRecipient(input);
  const workspaceHint =
    !shouldIncludeWorkspaceGuidance
      ? ""
      : input.workspacePath === undefined
        ? "Run pairflow commands from the active workspace root."
        : `Run pairflow commands from workspace root: ${input.workspacePath}. ${buildPairflowCommandGuidance(input.workspacePath, input.bubbleConfig.pairflow_command_profile)}`;

  let action = "Continue protocol from this event.";
  if (input.recipientRole === "implementer") {
    const isOpencodeRecipient = isAgentNameRegistered(input.bubbleConfig.agents.implementer)
    ? getAgentRuntimeProfile(input.bubbleConfig.agents.implementer).minimalPastedGuidance
    : false;
    action = buildImplementerDeliveryAction({
      envelope: input.envelope,
      bubbleConfig: input.bubbleConfig,
      actorLabel,
      ...(isOpencodeRecipient ? { isOpencodeRecipient } : {})
    });
  } else if (input.recipientRole === "reviewer") {
    action = buildReviewerDeliveryAction({
      envelope: input.envelope,
      bubbleConfig: input.bubbleConfig,
      actorLabel,
      ...(input.reviewerTestDirective !== undefined
        ? { reviewerTestDirective: input.reviewerTestDirective }
        : {}),
      ...(input.reviewerBrief !== undefined
        ? { reviewerBrief: input.reviewerBrief }
        : {}),
      ...(input.reviewerFocus !== undefined
        ? { reviewerFocus: input.reviewerFocus }
        : {})
    });
  } else if (input.recipientRole === "meta-reviewer") {
    const isOpencodeRecipient = isAgentNameRegistered(input.bubbleConfig.agents.meta_reviewer)
    ? getAgentRuntimeProfile(input.bubbleConfig.agents.meta_reviewer).minimalPastedGuidance
    : false;
    action = isOpencodeRecipient
      ? "Meta-review task received. Produce autonomous meta-review output."
      : `Meta-review task received. Produce autonomous meta-review output and return only through structured submit with required report-json parity fields: \`${buildMetaReviewSubmitCommandTemplate()}\`. ${buildMetaReviewSubmitApproveParityNote()}`;
  } else if (
    input.recipientRole === "human" ||
    input.recipientRole === "orchestrator" ||
    input.recipientRole === "status"
  ) {
    action = "Check inbox/status and continue human orchestration flow.";
  }

  const messageParts = [
    `[pairflow] r${input.envelope.round} ${input.envelope.type} ${input.envelope.sender}->${input.envelope.recipient} msg=${input.envelope.id} ref=${input.messageRef}. Action: ${action}`,
    workspaceHint
  ].filter(part => part.length > 0);

  return messageParts.join(" ");
}

function isOpencodeRecipient(input: {
  bubbleConfig: BubbleConfig;
  recipientRole: DeliveryMessageRecipientRole;
}): boolean {
  // OVERFLOW_1/OVERFLOW_2: minimal pasted guidance applies only to agents that
  // receive their context via CLI args (opencode). tmux-paste agents
  // (reasonix) need the full guidance text.
  const agent =
    input.recipientRole === "implementer"
      ? input.bubbleConfig.agents.implementer
      : input.recipientRole === "reviewer"
        ? input.bubbleConfig.agents.reviewer
        : input.recipientRole === "meta-reviewer"
          ? input.bubbleConfig.agents.meta_reviewer
          : undefined;
  return (
    agent !== undefined
    && isAgentNameRegistered(agent)
    && getAgentRuntimeProfile(agent).minimalPastedGuidance
  );
}
