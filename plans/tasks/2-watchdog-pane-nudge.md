---
artifact_type: Task
artifact_id: 2-watchdog-pane-nudge
status: approved
phase: E
target_files:
  - src/v11/ports/tmuxDelivery.ts
  - src/v11/ports/watchdogPaneActivity.ts
  - src/v11/shared/watchdog/watchdogPaneActivityStore.ts
  - src/v11/application/watchdog/watchdogCommandContract.ts
  - src/v11/application/watchdog/watchdogCommandApi.ts
  - src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivitySampler.ts
  - src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivityMonitoring.ts
  - src/v11/defaults/watchdog/watchdogCommandDefaults.ts
prd_ref: null
plan_ref: null
system_context_ref: null
task_family_id: watchdog-pane-nudge
sequence_key: "2"
task_id: 2-watchdog-pane-nudge
doc_bubble_id: 2-watchdog-pane-nudge-doc
impl_bubble_id: 2-watchdog-pane-nudge-impl
supersedes: null
superseded_by: null
---

# 2-watchdog-pane-nudge

## L0: Policy and Bounded Scope

### Primary Task Shape
`fail_closed_hardening`

### Business Invariant
When the agent is actively working in its tmux pane, it displays a status menu at the bottom containing "esc interrupt". If it has stopped displaying this indicator for a minute or two while in the `RUNNING` state, it has stalled/stopped working (e.g. due to LLM laziness or truncation) and must be nudged back to execution by typing a continuation message.

### Control Model
1. The pane activity sampler captures the active agent's pane content and checks for the case-insensitive presence of `"esc interrupt"`.
2. The watchdog monitors the pane activity. If the indicator is missing (`has_esc_interrupt: false`) for $\ge 2$ minutes, and the agent has not been nudged in the last $\ge 2$ minutes, the watchdog types and submits a nudge message to the tmux pane:
   `Continue exactly where you left off. Do not summarize or repeat the previous text. Remember your task only ends when you run "pairflow agent emit", never before.`
3. This is done best-effort inside the watchdog loop via `sendAndSubmitTmuxPaneMessage` without mutating the canonical state of the bubble.

### Scope Reality Proof
- **Target Entrypoints:**
  - Sampler: `src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivitySampler.ts` (computes `has_esc_interrupt`)
  - Monitor: `src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivityMonitoring.ts` (tracks last seen/nudge time and sends the keys)
- **Dependency Isolation:** The nudging logic is kept within clean architecture boundaries by defining the `SendAndSubmitTmuxPaneMessagePort` port in the ports layer and dependency-injecting the infrastructure implementation through `watchdogCommandDefaults.ts`.

### Complexity Risk Gate
- **risk_score:** 3
- **split_decision:** None. The task only touches best-effort monitoring and pane interaction, leaving state machine updates completely intact.

## L1: Implementation Contract

### Call-site & Data Matrix
| ID | Contract Element | Acceptance Criteria / Rule |
|----|------------------|----------------------------|
| AC1 | Sampler Indicator Detection | Parse the captured pane output in `sampleWatchdogPaneActivity` for `"esc interrupt"` (case-insensitive) or `\besc\b.*?\binterrupt\b` to determine if the agent is actively processing. |
| AC2 | Tracking State Properties | Store `last_seen_esc_interrupt_at` and `last_nudge_at` inside `WatchdogPaneActivityRecord` to determine elapsed time between idle states and nudges. |
| AC3 | Nudge Injection | If `has_esc_interrupt` is false for 2 minutes and last nudge was at least 2 minutes ago, call `sendAndSubmitTmuxPaneMessage` with the continuation prompt. |
| AC4 | Architecture Port Boundary | Ensure `watchdogPaneActivityMonitoring.ts` does not directly import from `infrastructure/`. Use the `SendAndSubmitTmuxPaneMessagePort` port interface. |

### Baseline Preservation
| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP1 | Normal Timeout Escalation | The watchdog's primary 10-minute timeout for human escalation must remain fully functional. |
| BP2 | Stuck Input Check | The existing `retryStuckAgentInput` check (Enter key retry) continues to run as fallback. |

## L2: Hardening Backlog
- Make the nudge message configurable in `bubbleConfig` or repository configuration.
- Log the nudging events as explicit entries in the watchdog trace logs.
