import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import {
  buildMetaReviewSubmitAuthorityGuardLine,
  buildMetaReviewSubmitCorrectedReportJson,
  buildMetaReviewSubmitRequiredReportJsonFieldsLine
} from "../metaReview/metaReviewSubmitGuidance.js";
import {
  buildReviewerCanonicalCommandGateLines
} from "../reviewer/reviewerCommandGateGuidance.js";
import { buildReviewerSeverityOntologyReminder } from "../reviewer/reviewerSeverityOntology.js";
import {
  emitRecipeLocationLine
} from "../actorProtocol/emitFailureGuidance.js";
import {
  AGENT_EMIT_DIRECTIVE,
  AUTHORITY_MACHINE_MINTED_RULE,
  AUTHORITY_UNAVAILABLE_RULE,
  EVIDENCE_REF_INSTRUCTION,
  EMIT_OWED_RULE,
  FINDING_OWNERSHIP_AND_INTENT_RULE,
  LITERAL_ARGUMENT_RULE,
  META_REVIEWER_SUBMIT_DIRECTIVE,
  ROLE_KIND_LOCK_RULE
} from "../role/prompts/sharedPromptDirectives.js";
import { buildImplementerDeliveryValidationGuidance } from "../role/prompts/roleActionGuidance.js";
import { buildResolvedImplementerEmitCommand } from "../role/prompts/resolvedEmitDirective.js";
import type { BubbleConfig } from "../config/bubbleConfigTypes.js";

/**
 * Role instruction generator for file-based role instruction artifacts
 * (`role-implementer.md`, `role-reviewer.md`, `role-meta-reviewer.md`).
 */

export const roleAgentRecipePointer = [
  `Full recipes and the failure-signature to fix table: ${emitRecipeLocationLine}.`,
  "`pairflow agent emit --help` prints the authority rule, the role-to-kind lock, the per-case commands and the failure->fix table;",
  "every rejected emit records itself in `.pairflow/bubbles/<id>/emit-history.ndjson` (`pairflow bubble emit-log`).",
  "A rejected emit's own message carries the mapped fix, so correct the command and retry once instead of exploring the source tree."
].join(" ");

function buildImplementerStandingLines(): string[] {
  return [
    "Your role is to implement the requested changes carefully in small verifiable increments.",
    `Hand off with the canonical implementer emit: \`pairflow agent emit --kind pass --repo <repo> --bubble-id <id> --handoff-id <executionContext.handoffId> --execution-id <executionContext.executionId> --summary "<what changed + validation>"\`, attaching available evidence logs with \`--ref\`.`,
    EVIDENCE_REF_INSTRUCTION,
    "For a blocker that needs a human decision, use `pairflow agent emit --kind human_question` instead of hand-writing protocol state."
  ];
}

function buildReviewerStandingLines(): string[] {
  return [
    "Your role is to review the implementation against the task's L0/L1/L2 expectations and the Pairflow severity ontology.",
    "Reviewer decision gate:",
    ...buildReviewerCanonicalCommandGateLines()
  ];
}

function buildMetaReviewerStandingLines(): string[] {
  return [
    "Your role is to meta-review converged changes and the reviewer's findings, then submit exactly one structured result.",
    buildMetaReviewSubmitAuthorityGuardLine(),
    buildMetaReviewSubmitRequiredReportJsonFieldsLine(),
    `Minimal clean approve payload: ${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "approve" })}`,
    `Minimal rework payload: ${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "rework" })}`,
    `Minimal inconclusive payload: ${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "inconclusive" })}`
  ];
}

/**
 * Role standing instructions shared by every agent dialect. Role-specific lines
 * are appended by the caller.
 */
function buildCommonStandingLines(role: AgentRole): string[] {
  const submitDirective =
    role === "meta_reviewer"
      ? META_REVIEWER_SUBMIT_DIRECTIVE
      : AGENT_EMIT_DIRECTIVE;
  return [
    `You are the Pairflow ${
      role === "meta_reviewer"
        ? "Meta-Reviewer"
        : role === "reviewer"
          ? "Reviewer"
          : "Implementer"
    } for this bubble.`,
    "Make a plan before starting; the last step of that plan is always the canonical emit.",
    submitDirective,
    AUTHORITY_MACHINE_MINTED_RULE,
    AUTHORITY_UNAVAILABLE_RULE,
    EMIT_OWED_RULE,
    ROLE_KIND_LOCK_RULE,
    ...(role === "meta_reviewer" ? [] : [FINDING_OWNERSHIP_AND_INTENT_RULE]),
    LITERAL_ARGUMENT_RULE,
    roleAgentRecipePointer
  ];
}

function buildRoleSpecificStandingLines(role: AgentRole): string[] {
  switch (role) {
    case "implementer":
      return buildImplementerStandingLines();
    case "reviewer":
      return [...buildReviewerStandingLines(), buildReviewerSeverityOntologyReminder()];
    case "meta_reviewer":
      return buildMetaReviewerStandingLines();
  }
}

export function buildRoleStandingPromptBody(role: AgentRole): string {
  return [
    ...buildCommonStandingLines(role),
    ...buildRoleSpecificStandingLines(role)
  ].join("\n\n");
}

export interface RoleInstructionContext {
  bubbleConfig?: BubbleConfig;
  repoPath?: string;
  bubbleId?: string;
}

function buildImplementerBubbleContextSection(context?: RoleInstructionContext): string[] {
  if (context === undefined) {
    return [];
  }
  const parts: string[] = [];
  if (context.bubbleConfig?.commands !== undefined) {
    const validationGuidance = buildImplementerDeliveryValidationGuidance(
      context.bubbleConfig.commands
    );
    parts.push(`## Configured Validation Commands\n\n${validationGuidance}`);
  }
  const repoPath = context.repoPath ?? context.bubbleConfig?.repo_path;
  const bubbleId = context.bubbleId ?? context.bubbleConfig?.id;
  if (repoPath !== undefined && bubbleId !== undefined) {
    const emitCommand = buildResolvedImplementerEmitCommand({
      repoPath,
      bubbleId
    });
    parts.push(`## Resolved Handoff Command Template\n\n${emitCommand}`);
  }
  return parts;
}

export function renderRoleInstructionMarkdown(
  role: AgentRole,
  context?: RoleInstructionContext
): string {
  const title =
    role === "meta_reviewer"
      ? "Meta-Reviewer"
      : role === "reviewer"
        ? "Reviewer"
        : "Implementer";
  const sections = [
    `# Pairflow ${title} Instructions`,
    "",
    buildRoleStandingPromptBody(role)
  ];
  if (role === "implementer") {
    const contextLines = buildImplementerBubbleContextSection(context);
    if (contextLines.length > 0) {
      sections.push("", ...contextLines);
    }
  }
  return sections.join("\n");
}
