/**
 * Shared prompt directive constants used across role prompts.
 *
 * These directives enforce consistent lifecycle and execution semantics: agents must always
 * emit or submit their results before stopping work, and reviewers must always press Enter after typing commands in the terminal prompt — regardless of role.
 */

/**
 * Emit directive for implementers and reviewers.
 *
 * Lifecycle contract (role-agnostic): the emit directive applies at the conclusion
 * of an agent's active execution window — i.e., after completing implementation work
 * or a review, but never while idle, waiting for orchestration signals, or in a passive state.
 */
export const AGENT_EMIT_DIRECTIVE =
  "Always execute the canonical actor emit command (`pairflow agent emit`) as the mandatory final step before stopping work or ending your turn. Do not stop work without emitting first. This directive applies at the end of an active implementation or review session — do not emit while idle or waiting for orchestration signals.";

/**
 * Submit directive for meta-reviewers.
 *
 * Lifecycle contract (role-agnostic): the submit directive applies at the conclusion
 * of a meta-review session, but never while idle or waiting for orchestration signals.
 */
export const META_REVIEWER_SUBMIT_DIRECTIVE =
  "Always execute the final structured submit/decision command before finishing your turn. Do not stop work without emitting first. This directive applies at the end of an active meta-review session — do not emit while idle or waiting for signals.";

/**
 * Generic idle-contract directive used in meta-reviewer startup/resume prompts.
 *
 * Slightly different wording from META_REVIEWER_SUBMIT_DIRECTIVE because it appears
 * in static pane instructions (not tied to a specific run). The semantics are identical:
 * always submit before stopping.
 */
export const META_REVIEWER_IDLE_EMIT_DIRECTIVE =
  "Always execute the final structured submit/decision command before finishing your turn. Do not stop work or wait for human intervention to emit. This directive applies at the end of an active session — do not emit while idle or waiting for signals.";

/**
 * Enter-execute directive for reviewers.
 *
 * Lifecycle contract (reviewer-specific): the reviewer must always press Enter
 * after typing a command in the terminal prompt, avoiding situations where a
 * command is typed but left unsent.
 */
export const REVIEWER_ENTER_DIRECTIVE =
  "Always execute commands by pressing Enter — never leave a typed command unsent at the terminal prompt.";

/**
 * Handoff instruction: canonical emit before stopping.
 *
 * Used inline in delivery-action guidance to tell agents how to hand off
 * after completing their work.  All role contracts reference this single
 * constant so wording stays consistent across implementer, reviewer and
 * meta-reviewer prompts.
 */
export const CANONICAL_EMIT_HANDOFF_INSTRUCTION =
  "hand off with canonical actor emit (`pairflow agent emit --kind pass ...`) directly";

/**
 * Evidence-ref instruction for implementation bubbles.
 *
 * Tells agents to attach `.pairflow/evidence/*.log` refs when evidence logs exist.
 */
export const EVIDENCE_REF_INSTRUCTION =
  "If `.pairflow/evidence/*.log` files exist, include them as `--ref` (lint/typecheck/test). If only a subset ran, attach refs for that subset and state what was intentionally not executed.";

/**
 * Evidence-ref instruction for implementation bubbles — short form.
 */
export const EVIDENCE_REF_INSTRUCTION_SHORT =
  "Include available `.pairflow/evidence/*.log` refs on PASS.";

/**
 * Docs-only Mode A (skip-claim) description.
 */
export const DOC_BUBBLE_MODE_A_SKIP_CLAIM =
  "Mode A (skip-claim): summary says runtime checks were intentionally not executed -> attach no `.pairflow/evidence/*.log` refs.";

/**
 * Docs-only Mode B (checks executed) description — placeholder for variable guidance.
 */
export const DOC_BUBBLE_MODE_B_CHECKS_SUFFIX =
  "attach refs only for commands you actually ran, and do not claim checks were intentionally not executed.";
