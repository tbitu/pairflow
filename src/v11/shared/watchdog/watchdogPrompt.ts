/**
 * Canonical watchdog nudge prompt.
 *
 * Short, clear, and unambiguous for LLM agents: reminds them that the process
 * is autonomous (no interactive human in the loop to answer questions) and
 * directs them to complete work and emit.
 */
export const WATCHDOG_NUDGE_PROMPT =
  'Continue autonomously from where you left off. Do not wait for user input — this is an autonomous agentic process. Complete your work and run "pairflow agent emit" when finished.';
