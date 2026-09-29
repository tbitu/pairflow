import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import {
  buildMetaReviewSubmitApproveParityNote,
  buildMetaReviewSubmitAuthorityGuardLine,
  buildMetaReviewSubmitCorrectedReportJson,
  buildMetaReviewSubmitRequiredReportJsonFieldsLine
} from "../metaReview/metaReviewSubmitGuidance.js";
import {
  buildReviewerCanonicalCommandGateLines
} from "../reviewer/reviewerCommandGateGuidance.js";
import {
  buildReviewerScoutExpansionWorkflowGuidance,
  buildReviewerPassOutputContractGuidance
} from "../reviewer/reviewerScoutExpansionGuidance.js";
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
    "Your role is to perform an adversarial review of the implementation against the task's L0/L1/L2 expectations, functional correctness, edge cases, test quality, and the Pairflow severity ontology.",
    "Actively search for bugs, regressions, unhandled edge cases, missing test coverage, and specification drift before considering convergence.",
    buildReviewerScoutExpansionWorkflowGuidance(),
    buildReviewerPassOutputContractGuidance(),
    "Reviewer decision gate:",
    ...buildReviewerCanonicalCommandGateLines()
  ];
}

function buildMetaReviewerStandingLines(): string[] {
  return [
    "Your role is to meta-review converged changes and the reviewer's findings, then submit exactly one structured result.",
    "Autonomous verification guardrail: Never submit `recommendation: \"approve\"` without independently validating the changes. You must verify: (1) all reviewer findings have been resolved or classified properly; (2) the implementation satisfies the task requirements without regressions; (3) configured validation commands pass with concrete evidence. If any requirement is unfulfilled, test fails, or unresolved defects exist, submit `recommendation: \"rework\"` with a concrete rework target message.",
    buildMetaReviewSubmitAuthorityGuardLine(),
    buildMetaReviewSubmitRequiredReportJsonFieldsLine(),
    buildMetaReviewSubmitApproveParityNote(),
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
      return [
        ...buildReviewerStandingLines(),
        buildReviewerSeverityOntologyReminder({ includeFullOntology: true })
      ];
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

function buildReviewerBubbleContextSection(context?: RoleInstructionContext): string[] {
  if (context === undefined) {
    return [];
  }
  const parts: string[] = [];
  if (context.bubbleConfig?.commands !== undefined) {
    const validationGuidance = buildImplementerDeliveryValidationGuidance(
      context.bubbleConfig.commands
    );
    parts.push(
      `## Configured Validation Commands\n\nRun or verify these validation commands command-by-command before making a convergence claim:\n\n${validationGuidance}`
    );
  }
  const repoPath = context.repoPath ?? context.bubbleConfig?.repo_path;
  const bubbleId = context.bubbleId ?? context.bubbleConfig?.id;
  if (repoPath !== undefined && bubbleId !== undefined) {
    const passTemplate = `pairflow agent emit --kind pass --repo ${repoPath} --bubble-id ${bubbleId} --handoff-id <fresh executionContext.handoffId> --execution-id <fresh executionContext.executionId> --summary "<review summary>" --finding "<severity>:Title|artifact://ref"`;
    const convergeTemplate = `pairflow agent emit --kind convergence --repo ${repoPath} --bubble-id ${bubbleId} --handoff-id <fresh executionContext.handoffId> --execution-id <fresh executionContext.executionId> --summary "<clean/advisory review summary>"`;
    parts.push(
      `## Resolved Emit Command Templates\n\n- Pass (blocker findings):\n\`${passTemplate}\`\n\n- Convergence (clean or advisory-only post-gate):\n\`${convergeTemplate}\`\n\nAlways refresh \`--handoff-id\` and \`--execution-id\` from \`executionContext\` via \`pairflow bubble status --json\` immediately before emitting.`
    );
  }
  return parts;
}

function buildMetaReviewerBubbleContextSection(context?: RoleInstructionContext): string[] {
  if (context === undefined) {
    return [];
  }
  const parts: string[] = [];
  if (context.bubbleConfig?.commands !== undefined) {
    const validationGuidance = buildImplementerDeliveryValidationGuidance(
      context.bubbleConfig.commands
    );
    parts.push(
      `## Configured Validation Commands\n\nThe kernel executes the configured approve-gate validation commands during the approve gate. Verify these checks pass before submitting an approve recommendation:\n\n${validationGuidance}`
    );
  }
  const repoPath = context.repoPath ?? context.bubbleConfig?.repo_path;
  const bubbleId = context.bubbleId ?? context.bubbleConfig?.id;
  if (repoPath !== undefined && bubbleId !== undefined) {
    const submitApproveTemplate = `pairflow agent emit --kind meta_review_result --repo ${repoPath} --bubble-id ${bubbleId} --handoff-id <fresh executionContext.handoffId> --execution-id <fresh executionContext.executionId> --round <n> --recommendation approve --summary "<summary>" --report-json '${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "approve" })}'`;
    const submitReworkTemplate = `pairflow agent emit --kind meta_review_result --repo ${repoPath} --bubble-id ${bubbleId} --handoff-id <fresh executionContext.handoffId> --execution-id <fresh executionContext.executionId> --round <n> --recommendation rework --summary "<summary>" --rework-target-message "<message>" --report-json '${buildMetaReviewSubmitCorrectedReportJson({ recommendation: "rework" })}'`;
    parts.push(
      `## Resolved Submit Command Templates\n\n- Clean Approve:\n\`${submitApproveTemplate}\`\n\n- Rework:\n\`${submitReworkTemplate}\`\n\nAlways refresh \`--handoff-id\` and \`--execution-id\` from \`executionContext\` via \`pairflow bubble status --json\` immediately before emitting.`
    );
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
  } else if (role === "reviewer") {
    const contextLines = buildReviewerBubbleContextSection(context);
    if (contextLines.length > 0) {
      sections.push("", ...contextLines);
    }
  } else if (role === "meta_reviewer") {
    const contextLines = buildMetaReviewerBubbleContextSection(context);
    if (contextLines.length > 0) {
      sections.push("", ...contextLines);
    }
  }
  return sections.join("\n");
}
