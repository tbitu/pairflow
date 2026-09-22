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
  buildMetaReviewSubmitCommandTemplate,
  buildMetaReviewSubmitRequiredReportJsonFieldsLine
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

function resolveImplementerMinimalIntro(
  envelope: ProtocolEnvelope,
  actorLabel: string | null
): { text: string; terminal: boolean } {
  const event = toImplementerDeliveryEvent(envelope.type);
  switch (event) {
    case "TASK":
      return { text: "Implementation task received. Continue implementation.", terminal: false };
    case "PASS":
      return { text: "Reviewer feedback received. Implement fixes.", terminal: false };
    case "HUMAN_REPLY":
      return { text: "Human response received. Continue implementation using this input.", terminal: false };
    case "APPROVAL_DECISION": {
      if (envelope.type === "APPROVAL_DECISION" && envelope.payload.decision === "rework") {
        const origin = resolveImplementerReworkOrigin(envelope);
        const text = origin === "meta_review_auto_rework"
          ? "Meta-review auto-rework received. Implement fixes."
          : "Rework received. Implement fixes.";
        return { text, terminal: false };
      }
      return {
        text: "Human approved this bubble. Wait for commit/merge flow and do not continue new implementation in this round.",
        terminal: true
      };
    }
    case "APPROVAL_REQUEST": {
      const text = actorLabel === "meta-reviewer"
        ? "Meta-reviewer requested human gate decision. Stop coding and wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now."
        : "Bubble is READY_FOR_HUMAN_APPROVAL. Stop coding and wait for human decision (`bubble approve` or `bubble request-rework`). Do not run canonical pass emit now.";
      return { text, terminal: true };
    }
    default:
      return { text: "Continue protocol from this event.", terminal: false };
  }
}

function buildImplementerDeliveryAction(input: {
  envelope: ProtocolEnvelope;
  bubbleConfig: BubbleConfig;
  actorLabel: string | null;
  roleArtifactPath?: string;
  isOpencodeRecipient?: boolean;
}): string {
  // OVERFLOW_2: For minimal-guidance recipients (e.g. reasonix, opencode), return concise action text
  // with role instructions pointer without large prompt dumps.
  if (input.isOpencodeRecipient) {
    const roleInstruction =
      input.roleArtifactPath !== undefined
        ? `Read role instructions now: ${input.roleArtifactPath}.`
        : "";
    const intro = resolveImplementerMinimalIntro(input.envelope, input.actorLabel);
    if (intro.terminal) {
      return intro.text;
    }
    return [intro.text, roleInstruction].filter((p) => p.length > 0).join(" ");
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

function buildOpencodeReviewerDeliveryAction(
  intro: string,
  reviewerTestDirective?: ReviewerTestExecutionDirective,
  isFreshContext?: boolean,
  roleArtifactPath?: string
): string {
  const parts = [intro];
  if (roleArtifactPath !== undefined) {
    parts.push(`Read role instructions now: ${roleArtifactPath}.`);
  }
  if (reviewerTestDirective !== undefined) {
    parts.push(formatReviewerTestExecutionDirective(reviewerTestDirective));
  } else {
    parts.push(
      [
        "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable.",
        ...(isFreshContext ? [buildReviewerDecisionMatrixReminder()] : [])
      ].join(" ")
    );
  }
  return parts.join(" ");
}

function buildVerboseReviewerDeliveryAction(input: {
  intro: string;
  envelope: ProtocolEnvelope;
  bubbleConfig: BubbleConfig;
  reviewerTestDirective?: ReviewerTestExecutionDirective | undefined;
  reviewerBrief?: string | undefined;
  reviewerFocus?: ReviewerFocusExtractionResult | undefined;
}): string {
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
  const findings =
    "findings" in input.envelope.payload && Array.isArray(input.envelope.payload.findings)
      ? input.envelope.payload.findings
      : undefined;
  const projectionVariant: ReviewerCommandGateProjectionVariant =
    findings !== undefined && findings.length > 0
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
    input.intro,
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

export function buildReviewerDeliveryAction(input: {
  envelope: ProtocolEnvelope;
  bubbleConfig: BubbleConfig;
  actorLabel: string | null;
  reviewerTestDirective?: ReviewerTestExecutionDirective;
  reviewerBrief?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
  roleArtifactPath?: string;
}): string {
  if (input.envelope.type === "PASS" || input.envelope.type === "TASK") {
    const isOpencodeReviewer = isAgentNameRegistered(input.bubbleConfig.agents.reviewer)
      ? getAgentRuntimeProfile(input.bubbleConfig.agents.reviewer).minimalPastedGuidance
      : false;

    const intro = input.envelope.type === "TASK"
      ? "Review task received. Run a fresh review now."
      : "Implementer handoff received. Run a fresh review now.";

    if (isOpencodeReviewer) {
      return buildOpencodeReviewerDeliveryAction(
        intro,
        input.reviewerTestDirective,
        input.bubbleConfig.reviewer_context_mode === "fresh",
        input.roleArtifactPath
      );
    }

    return buildVerboseReviewerDeliveryAction({
      intro,
      envelope: input.envelope,
      bubbleConfig: input.bubbleConfig,
      reviewerTestDirective: input.reviewerTestDirective,
      reviewerBrief: input.reviewerBrief,
      reviewerFocus: input.reviewerFocus
    });
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
  roleArtifactPath?: string;
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
      ...(input.roleArtifactPath !== undefined
        ? { roleArtifactPath: input.roleArtifactPath }
        : {}),
      ...(isOpencodeRecipient ? { isOpencodeRecipient } : {})
    });
  } else if (input.recipientRole === "reviewer") {
    action = buildReviewerDeliveryAction({
      envelope: input.envelope,
      bubbleConfig: input.bubbleConfig,
      actorLabel,
      ...(input.roleArtifactPath !== undefined
        ? { roleArtifactPath: input.roleArtifactPath }
        : {}),
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
    const prefix = input.envelope.type === "HUMAN_REPLY"
      ? "Human response received."
      : "Meta-review task received.";
    const roleInstruction =
      input.roleArtifactPath !== undefined
        ? ` Read role instructions now: ${input.roleArtifactPath}.`
        : "";
    action = isOpencodeRecipient
      ? `${prefix}${roleInstruction} Produce autonomous meta-review output.`
      : `${prefix} Produce autonomous meta-review output and return only through structured submit with required report-json parity fields: \`${buildMetaReviewSubmitCommandTemplate()}\`. ${buildMetaReviewSubmitRequiredReportJsonFieldsLine()} ${buildMetaReviewSubmitApproveParityNote()}`;
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
