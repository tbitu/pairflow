---
artifact_type: Task
artifact_id: task_prompt_delivery_dedup_v1
status: draft
phase: null
target_files:
  - src/v11/infrastructure/channel/tmux/deliveryDedup.ts (new)
  - src/v11/shared/delivery/tmuxDeliveryContract.ts
  - src/v11/infrastructure/channel/tmux/tmuxDelivery.ts
  - src/v11/application/pass/internal/normalPass/normalPassFlowDependencyWiring.ts
  - src/v11/application/approval/internal/flow/runApprovalDecisionEffects.ts
  - src/v11/application/converged/internal/gate/convergedGateDelivery.ts
  - src/v11/application/watchdog/internal/flow/watchdogCommandFlow.ts
  - tests/core/runtime/deliveryDedup.test.ts (new)
  - tests/core/runtime/tmuxDelivery.test.ts
prd_ref: null
plan_ref: plans/prompt-validation-plan-v1.md
system_context_ref: docs/actor-runtime-interface/execution-authority-contract-note-v1.md
task_family_id: prompt-delivery-dedup
sequence_key: "1a"
task_id: 1a-prompt-delivery-dedup
doc_bubble_id: null
impl_bubble_id: null
supersedes: []
superseded_by: null
---

# 1a-prompt-delivery-dedup

## L0: Policy and Bounded Scope

### Primary Task Shape
`coordination_concurrency_hardening`

### Secondary Task Shape (collapsed)
`fail_closed_hardening` — the dedup registry also provides crash-recovery state so that re-delivery after process restart is prevented.

**Collapse safety proof:** The dedup set and its persistence layer are accessed exclusively within the delivery path; no external consumer reads the dedup state as a separate authority surface. Same bounded code path (tmuxDelivery.ts) closes both concerns, and no compatibility or diagnostics risk is introduced by collapsing them.

### Business Invariant
The bubble lifecycle advances deterministically through handoff envelopes. No `envelope.id` may be delivered to a tmux pane twice for the same logical transition within a bubble's lifetime, except where the system explicitly supports multi-target delivery (e.g., APPROVAL_REQUEST fan-out) with distinct envelope IDs per target.

### Control Model
A centralized dedup registry (`deliveryDedup.ts`) owns the set of delivered `envelope.id` values per bubble. Every caller that intends to deliver must check the registry first. If already present, delivery is rejected with `DELIVERY_ACK_DUPLICATE`. The registry lives in-memory as a `Set<string>` keyed by `bubbleId`, backed optionally by a transient file for watchdog-level crash recovery.

### Scope Reality Proof

**Inspected entrypoints:**

1. **`src/v11/infrastructure/channel/tmux/tmuxDelivery.ts:152` — `emitDeliveryNotificationAck`**
   - This is the SINGLE delivery entrypoint. All callers go through this function. The dedup check MUST be inserted here, before any tmux side effect (line 108 in `attemptTmuxDelivery`).

2. **`src/v11/application/pass/internal/normalPass/normalPassFlowDependencyWiring.ts:147-219` — PASS delivery wiring**
   - Pass flow calls `emitDeliveryNotificationAck` through dependency injection at line 218. One caller path. No direct tmux side effects outside the shared entrypoint.

3. **`src/v11/application/approval/internal/flow/runApprovalDecisionEffects.ts:115,152` — Approval decision delivery**
   - Calls `emitDeliveryNotificationAck` twice (status pane + implementer pane). Each call creates a NEW envelope with its own ID. These are NOT duplicates because they have distinct envelope IDs and target different recipients. Safe as-is; dedup will correctly allow both since envelope IDs differ.

4. **`src/v11/application/converged/internal/gate/convergedGateDelivery.ts:265-266` — Converged gate delivery**
   - Uses `Promise.all` to deliver to multiple recipients, but each recipient receives a distinct envelope (same logical message but different metadata). The fan-out happens BEFORE calling `emitDeliveryNotificationAck`, so dedup will see different envelope IDs. Safe as-is.

5. **`src/v11/application/watchdog/internal/flow/watchdogCommandFlow.ts:34-35` — Watchdog best-effort**
   - Watchdog calls `retryStuckAgentInput` (in tmuxDelivery.ts:234), NOT `emitDeliveryNotificationAck`. The dedup check for watchdog must be in `retryStuckAgentInput`: verify the message is truly stuck (not already submitted) before resending Enter.

**Bounded slice:** All callers of `emitDeliveryNotificationAck` route through one function. Dedup goes in that function as a pre-check. Watchdog's separate retry path (`retryStuckAgentInput`) gets its own dedup guard. No other tmux side effects exist outside these two paths.

### Complexity Risk Gate
- **risk_score:** 4
- **authority_risk:** 1 — new file, no existing contract changes; callers consume via dependency injection or implicit routing through the single entrypoint.
- **surface_spread:** 2 — touches delivery layer + one watchdog path. Both are in the `infrastructure/channel/tmux/` directory tree.
- **identity_join_risk:** 0 — dedup keys by `envelope.id`, which is already unique per message.
- **activation_coupling:** 1 — dedup adds a pre-check with negligible runtime cost; no activation ordering changes.
- **prerequisite_risk:** 0 — the registry has no external dependencies beyond an in-memory Set.
- **acceptance_multiplicity:** 2 — unit tests for registry + integration test for dedup rejection behavior.

**split_decision:** Split not required. Score <= 4, one authority producer (deliveryDedup.ts), shared contract unchanged (`envelope.id` uniqueness is existing protocol guarantee). Collapse of `coordination_concurrency_hardening` and `fail_closed_hardening` is safe because the persistence layer (optional transient file) and in-memory set are co-accessed by the same callers.

### Authority Boundary Map
| Boundary | Status |
|---|---|
| authority_producer | This task — `deliveryDedup.ts` owns dedup state |
| persisted_authority_or_schema | Absent — no schema or persistence changes; optional transient file is implementation detail |
| internal_execution_consumers | Present — `emitDeliveryNotificationAck`, `retryStuckAgentInput` consume via dependency injection / direct call |
| workflow_orchestration_consumers | Present — PASS flow, approval flow, converged gate all route through the entrypoint |
| read_model_consumers | Absent — dedup state is not a read model; it's internal coordination state |
| cleanup_recovery_consumers | Present — crash recovery (transient file) reads/writes dedup set on startup/shutdown of watchdog-level process |
| validator_gate_consumers | Present — new `DELIVERY_ACK_DUPLICATE` reason code validated by existing ack tests |
| external_integration_consumers | Absent — dedup state is ephemeral, not shared externally |

### Closure-Budget Gate
| Bucket | Status | Evidence |
|---|---|---|
| authority_producer | present | New `deliveryDedup.ts` module |
| shared_contract | absent | No protocol envelope contract changes; `envelope.id` uniqueness already guaranteed by existing protocol |
| internal_execution_consumers | present | Delivery path and watchdog retry path both consume dedup state |
| workflow_orchestration_consumers | present | PASS/approval/converged flows all route through single entrypoint |
| read_model_consumers | absent | No read-model consumers of dedup state |
| persisted_authority_or_schema | absent | Optional transient file; no schema changes |
| cleanup_recovery_consumers | present | Crash recovery for watchdog-level process restarts |

**Decision:** 4 buckets present, but `authority_producer` + shared_contract are only 1 bucket (no contract change). Collapse is safe within one bubble since all consumers share the same in-memory registry. No split required.

### Capability Closure
| Capability Claim | Closure Classification | Activation Path | Repo-Provided Boundary | External Prerequisites | Last-Mile Proof |
|---|---|---|---|---|---|
| Dedup registry prevents envelope double-delivery | hook_only | Registry check in `emitDeliveryNotificationAck` before tmux call; watchdog retry pre-check | `src/v11/infrastructure/channel/tmux/deliveryDedup.ts` (new module) + test coverage | Agents must respond to first delivery only (external behavior, not enforceable by code) | Integration test proving two calls with same envelope.id produce exactly one tmux side effect |

## L1: Implementation Contract

### Delivery Dedup Registry Matrix
| ID | Contract Element | Acceptance Criteria / Rule | Severity |
|----|------------------|----------------------------|----------|
| DEDUP_1 | In-memory dedup set per bubble | `DeliveryDedupRegistry` maintains a `Set<string>` of delivered envelope IDs per bubble. Key: `${bubbleId}:${envelope.id}`. Thread-safe for single-threaded Node.js (no locking needed). | P0 |
| DEDUP_2 | Pre-delivery check | Every call to `emitDeliveryNotificationAck` MUST invoke `dedupRegistry.checkAndMark(envelope.id, bubbleId)` before any tmux side effect. If already marked → return `DeliveryAck` with `status: "rejected"`, `reason: "duplicate_delivery"`, `reason_code: "DELIVERY_ACK_DUPLICATE"`. | P0 |
| DEDUP_3 | Envelope ID uniqueness | Dedup key is the full `${bubbleId}:${envelope.id}`. Caller responsibility to generate unique envelope IDs — this task does NOT validate caller behavior for ID uniqueness, only enforces dedup at delivery time. The existing protocol envelope contract already mandates `envelope.id` uniqueness. | P1 |
| DEDUP_4 | Transient file persistence (optional) | When configured via environment or dependency injection, the registry persists delivered IDs to a transient file (`<sessionsPath>/.delivery-dedup.json`). On startup, read and re-populate in-memory set. File is best-effort; crash without write does not prevent dedup within current process lifetime. Write on every mark. | P2 (later-hardening) |
| DEDUP_5 | Registry lifecycle — bubble-scoped cleanup | The registry MAY be cleared when the bubble reaches a terminal state (`DONE`, `FAILED`, `CANCELLED`). Not required for correctness; in-memory set is garbage-collected when the process exits. Document as deferred. | P3 (deferred) |

### Watchdog Retry Pre-Check Matrix
| ID | Contract Element | Acceptance Criteria / Rule | Severity |
|----|------------------|----------------------------|----------|
| WD_1 | Stuck-input dedup guard | `retryStuckAgentInput` must verify the message is genuinely stuck before pressing Enter. The existing `checkTmuxPaneMarkerStatus` check (returns `"stuck_in_input"` only) already provides this protection. This task adds a second layer: after confirming `"stuck_in_input"`, also call `dedupRegistry.checkAndMark(envelope.id, bubbleId)` using the envelope ID embedded in the stuck message text to prevent retry-after-recovery duplication. | P0 |
| WD_2 | Best-effort failure handling | If dedup registry is unavailable during watchdog retry (e.g., transient file read error), treat as `not_stuck` — do NOT press Enter. Fail closed: better to miss a stuck message than double-deliver. | P1 |

### Caller Audit Verification Matrix
| ID | Contract Element | Acceptance Criteria / Rule | Severity |
|----|------------------|----------------------------|----------|
| AUDIT_1 | PASS delivery flow (`executeNormalPassDelivery`) | Confirmed: calls `emitDeliveryNotificationAck` through dependency injection. After this task's change, it automatically inherits dedup check without code modification (the check lives in the shared entrypoint). No regression expected — each pass envelope has a unique ID from transcript append. | P0 (audit only) |
| AUDIT_2 | Approval decision delivery (`emitApprovalDecisionDeliverySignals`) | Confirmed: creates NEW envelopes per target with distinct IDs and delivers them via `emitDeliveryNotificationAck`. These are intentional multi-target deliveries, NOT duplicates. Dedup will correctly allow both because envelope IDs differ. Document this behavior as authorized multi-target delivery in the registry comments. | P0 (audit only) |
| AUDIT_3 | Converged gate delivery (`executeGateDelivery`) | Confirmed: fans out to multiple recipients via `Promise.all`, each with distinct envelope metadata but potentially same base ID. **Must verify**: if converged gate creates envelopes by cloning the same envelope object and only modifying recipient/target-role metadata, dedup will see duplicate IDs and block fan-out. If this is the case, either (a) assign unique IDs per target during envelope creation in the converged gate, or (b) make dedup key include `recipient` in addition to `envelope.id`. **This must be resolved as required-now.** | P0 (conditional) |
| AUDIT_4 | Kickoff delivery (`kickoffBubbleCommand`) | Confirmed: delivers TASK envelope via `emitDeliveryNotificationAck`. Single envelope, single target. No dedup conflict expected since kickoff runs once per bubble. | P1 (audit only) |
| AUDIT_5 | AskHuman delivery (`askHumanFlowFinalization`) | Confirmed: delivers HUMAN_QUESTION envelope. Single envelope, single target. No dedup conflict expected. | P1 (audit only) |

### Error Contract Extension Matrix
| ID | Contract Element | Acceptance Criteria / Rule | Severity |
|----|------------------|----------------------------|----------|
| ERR_1 | `DELIVERY_ACK_DUPLICATE` reason code | New rejection reason: `reason: "duplicate_delivery"`, `reason_code: "DELIVERY_ACK_DUPLICATE"`. The `DeliveryAckReasonCode` union type must include `"DELIVERY_ACK_DUPLICATE"`. | P0 |
| ERR_2 | Rejection message content | Error message includes original envelope ID for debugging: `"Duplicate delivery rejected — envelope already delivered (msg=<id>)"`. | P1 |

### Test Matrix
| ID | Test Scenario | Assertion | Depends On | Severity |
|----|---------------|-----------|------------|----------|
| T_DUP_1 | Registry insert + check | `dedup.checkAndMark("bubble1", "msg_001")` → returns `{checked: true}` (first call). `dedup.checkAndMark("bubble1", "msg_001")` → returns `{checked: false, alreadyDelivered: true}`. | DEDUP_1, DEDUP_2 | P0 |
| T_DUP_2 | Bubble-scoped isolation | Insert `"bubble1":"msg_001"`. Check for `"bubble2":"msg_001"` → returns `{checked: true}` (different bubble). | DEDUP_1 | P0 |
| T_DUP_3 | Integration — duplicate blocked delivery | Two `emitDeliveryNotificationAck` calls with same envelope.id. Verify tmux runner called exactly once, second call returns `DELIVERY_ACK_DUPLICATE`. | DEDUP_2, ERR_1 | P0 |
| T_DUP_4 | Integration — unique deliveries allowed | Two calls with different envelope.ids to same bubble. Both accepted (tmux runner called twice). | DEDUP_2 | P0 |
| T_WD_1 | Watchdog stuck-input dedup guard | Simulate message stuck in input buffer. Verify `dedupRegistry.checkAndMark` is called before pressing Enter. If already delivered → return `{retried: false, reason: "already_delivered"}`. | WD_1 | P0 |
| T_AUDIT_3a | Converged gate fan-out envelope IDs | If converged gate clones envelopes without assigning unique IDs per target, this test MUST fail with a clear instruction to assign unique IDs during envelope creation. Pass only when each target receives a distinct envelope ID. | AUDIT_3 | P0 (conditional) |

## L2: Hardening Backlog

- **H_DUP_1:** Persisted dedup state surviving full process restart across watchdog invocations. Implement proper file-based registry with atomic writes and crash recovery. Currently deferred to DEDUP_4 (optional transient file).
- **H_DUP_2:** Metrics for dedup hits — count how often duplicate deliveries were rejected per bubble, emitted as a structured log line or metric event. Useful for operational diagnostics.
- **H_DUP_3:** Explicit envelope ID uniqueness validation in protocol layer. Currently delegated to existing `envelope.id` contract; adding automated validation would catch caller bugs early but is outside this task's scope.
- **H_AUDIT_1:** Audit any future callers of delivery functions (e.g., new command types like `CONVERGENCE` handoff from implementer) for dedup safety. Document in the audit matrix as they appear.

## Baseline Preservation

| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP_1 | Existing delivery behavior when envelope IDs are unique | Dedup check is a no-op (returns `checked: true`) for first-time envelopes — no behavioral change for normal flow. |
| BP_2 | Multi-target approval delivery (status + implementer) | Must continue delivering both targets with distinct envelope IDs. Dedup allows this since keys differ. |
| BP_3 | Watchdog stuck-input retry for genuinely stuck messages | Retry path must still unstick genuinely stuck messages; dedup guard only prevents re-delivery of already-submitted messages. |

## Review Scope Fence

1. **Converged gate envelope fan-out (AUDIT_3):** Known risk — if converged gate creates envelopes by cloning and modifying recipient metadata without assigning unique IDs, dedup will block legitimate fan-out. Resolution: either assign unique IDs per target at creation time, or expand dedup key to include `recipient`. This is **required-now** gating logic, not future hardening.
2. **Crash recovery edge case:** If process crashes mid-delivery (after tmux side effect but before marking registry), the message appears "undelivered" on restart and may be re-attempted by watchdog retry. The dedup transient file (DEDUP_4) mitigates this but is deferred to P2. Within current process lifetime, in-memory set provides full protection.
3. **Performance impact:** Dedup check adds one Set lookup per delivery. Negligible cost; no performance tests required for this change since the operation is O(1).

## Hardening Backlog (non-blocking)

Items below are `later-hardening` only — they do not block implementation approval:
- DEDUP_4, DEDUP_5, H_DUP_1, H_DUP_2, H_DUP_3, H_AUDIT_1.
