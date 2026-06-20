---
artifact_type: Task
artifact_id: 1-codex-emit-interruption
status: draft
phase: E
target_files:
  - src/cli/commands/agent/emit.ts
prd_ref: null
plan_ref: null
system_context_ref: null
task_family_id: codex-emit-interruption
sequence_key: "1"
task_id: 1-codex-emit-interruption
doc_bubble_id: 1-codex-emit-interruption-doc
impl_bubble_id: 1-codex-emit-interruption-impl
supersedes: null
superseded_by: null
---

# 1-codex-emit-interruption

## L0: Policy and Bounded Scope

### Primary Task Shape
`coordination_concurrency_hardening`

### Business Invariant
The LLM (codex process) can only handle one worker at a time. The previous tmux pane must be fully idle before the next one starts. No overlap in execution or waiting is allowed.

### Control Model
The execution of `pairflow agent emit` must ensure that its caller (the codex process) is interrupted (killed or stopped) as soon as the emit action is successfully completed. Nothing of value is produced by the LLM after the emit happens. The exact interruption mechanism (watchdog, parent process kill, or tmux specific command) must be discovered and implemented as part of this feature.

### Scope Reality Proof
- **Target Entrypoints:** `src/cli/commands/agent/emit.ts` and related runner/execution wrappers.
- **Bounded Slice:** Ensures that upon successful emission, the codex tool call runner is reliably terminated.

### Complexity Risk Gate
- **risk_score:** 3
- **split_decision:** None needed. This single task owns discovery and implementation of the local interruption mechanism.

## L1: Implementation Contract

### Execution & Interruption Matrix
| ID | Contract Element | Acceptance Criteria / Rule |
|----|------------------|----------------------------|
| AC1 | Discovery & Mechanism | Implement a reliable way to interrupt the codex process running the `agent emit` tool call. Use two Escape key presses (`Escape`, `Escape`) in the originating tmux pane after emit completes, instead of signal-based termination. |
| AC2 | Post-Emit Interruption | The interruption must occur strictly *after* the emit has successfully registered, ensuring no data or state is lost. |
| AC3 | No Concurrent Workers | The interruption mechanism must ensure the previous pane is fully idle, preventing the next pane from starting concurrently. |

### Baseline Preservation
| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP1 | Emit Correctness | The existing protocol emission (pass, converged, human_question) must complete fully before the process is terminated. |

## L2: Hardening Backlog
- Review fallback behavior if the chosen interruption mechanism fails (e.g., fallback to a forceful kill).
- Consider adding a configuration flag to bypass process interruption for local debugging of the codex runner.
