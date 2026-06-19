/**
 * Shared prompt directive constants used across role prompts.
 *
 * These directives enforce consistent lifecycle semantics: agents must always
 * emit or submit their results before stopping work, regardless of role.
 */

/**
 * Emit directive for implementers and reviewers.
 *
 * Lifecycle contract (role-agnostic): the emit directive applies at the conclusion
 * of an agent's active execution window — i.e., after completing implementation work
 * or a review, but never while idle, waiting for orchestration signals, or in a passive state.
 */
export const IMPLEMENTER_EMIT_DIRECTIVE =
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
