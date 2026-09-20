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

/**
 * Repo-owned standing instructions for the per-role coding-agent definitions.
 *
 * The loop agents receive role identity from their own agent runtime, not from
 * Pairflow's pasted prompts:
 *
 * - opencode resolves `--agent PF-<role>` from its `agent` config block or from
 *   `<config>/agent(s)/PF-<role>.md` files;
 * - reasonix reads `PF-<role>` profiles from its skill/subagent roots.
 *
 * Those definitions previously lived only outside this repository, so Pairflow's
 * runtime guidance and the agents' standing instructions could drift apart (the
 * opencode meta-reviewer prompt did not mention `--report-json` at all). These
 * builders compose the SAME shared rule constants that the pasted prompts use,
 * so one edit updates every surface.
 */
export const roleAgentNames = [
  "PF-implementer",
  "PF-reviewer",
  "PF-meta-reviewer"
] as const;

export type RoleAgentName = (typeof roleAgentNames)[number];

export interface RoleAgentDefinition {
  name: RoleAgentName;
  role: AgentRole;
  description: string;
}

export const roleAgentDefinitions = [
  {
    name: "PF-implementer",
    role: "implementer",
    description:
      "Pairflow Implementer: implement the requested changes in small verifiable increments and emit the canonical handoff."
  },
  {
    name: "PF-reviewer",
    role: "reviewer",
    description:
      "Pairflow Reviewer: review the implementation against the Pairflow severity ontology and emit the canonical handoff or convergence."
  },
  {
    name: "PF-meta-reviewer",
    role: "meta_reviewer",
    description:
      "Pairflow Meta-Reviewer: meta-review converged changes and submit rework, approve, or inconclusive via --kind meta_review_result."
  }
] as const satisfies readonly RoleAgentDefinition[];

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

export function buildRoleAgentStandingPromptBody(name: RoleAgentName): string {
  const definition = roleAgentDefinitions.find((entry) => entry.name === name);
  if (definition === undefined) {
    throw new Error(
      `ROLE_AGENT_UNKNOWN: context=role_agent_standing_prompt name=${name}.`
    );
  }
  return [
    ...buildCommonStandingLines(definition.role),
    ...buildRoleSpecificStandingLines(definition.role)
  ].join("\n\n");
}

function parseFrontmatter(content: string | null): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (content === null || !content.startsWith("---\n")) {
    return { frontmatter: {}, body: content ?? "" };
  }
  const endIndex = content.indexOf("\n---\n", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of content.slice(4, endIndex).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key.length > 0) {
      frontmatter[key] = rawValue.replace(/^'(.*)'$/u, "$1").replace(/^"(.*)"$/u, "$1");
    }
  }
  return { frontmatter, body: content.slice(endIndex + 5) };
}

function formatFrontmatterValue(value: string): string {
  return /^[A-Za-z0-9_.\-/]+$/u.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}

/**
 * Render a managed agent definition, preserving frontmatter keys that Pairflow
 * does not own (notably the operator's `model` selection) so a refresh cannot
 * silently drop local runtime configuration.
 */
function renderManagedAgentFile(input: {
  existingContent: string | null;
  managedFrontmatter: Record<string, string>;
  body: string;
}): string {
  const existing = parseFrontmatter(input.existingContent);
  const preservedEntries = Object.entries(existing.frontmatter).filter(
    ([key]) => !(key in input.managedFrontmatter)
  );
  const frontmatterLines = [
    ...Object.entries(input.managedFrontmatter),
    ...preservedEntries
  ].map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);
  return `---\n${frontmatterLines.join("\n")}\n---\n${input.body}\n`;
}

export function renderOpencodeRoleAgentFile(input: {
  name: RoleAgentName;
  existingContent?: string | null;
}): string {
  const definition = roleAgentDefinitions.find((entry) => entry.name === input.name);
  if (definition === undefined) {
    throw new Error(
      `ROLE_AGENT_UNKNOWN: context=opencode_role_agent_file name=${input.name}.`
    );
  }
  return renderManagedAgentFile({
    existingContent: input.existingContent ?? null,
    managedFrontmatter: { description: definition.description },
    body: buildRoleAgentStandingPromptBody(input.name)
  });
}

export function renderReasonixRoleAgentProfileFile(input: {
  name: RoleAgentName;
  existingContent?: string | null;
}): string {
  const definition = roleAgentDefinitions.find((entry) => entry.name === input.name);
  if (definition === undefined) {
    throw new Error(
      `ROLE_AGENT_UNKNOWN: context=reasonix_role_agent_file name=${input.name}.`
    );
  }
  return renderManagedAgentFile({
    existingContent: input.existingContent ?? null,
    managedFrontmatter: {
      name: definition.name,
      description: definition.description,
      invocation: "manual",
      runAs: "subagent",
      todos: "false"
    },
    body: buildRoleAgentStandingPromptBody(input.name)
  });
}

export function renderRoleInstructionMarkdown(role: AgentRole): string {
  const definition = roleAgentDefinitions.find((entry) => entry.role === role);
  if (definition === undefined) {
    throw new Error(
      `ROLE_AGENT_UNKNOWN: context=role_instruction_markdown role=${role}.`
    );
  }
  const title =
    role === "meta_reviewer"
      ? "Meta-Reviewer"
      : role === "reviewer"
        ? "Reviewer"
        : "Implementer";
  return [
    `# Pairflow ${title} Instructions`,
    "",
    buildRoleAgentStandingPromptBody(definition.name)
  ].join("\n");
}
