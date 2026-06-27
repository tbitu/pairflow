---
artifact_type: plan
artifact_id: plan_prompt_validation_v1
plan_id: prompt-validation-v1
created_on: "2026-06-20"
title: Prompt Sending and Processing Validation Plan
status: draft
plan_status: draft
prd_ref: null
owners:
  - opencode-agent
task_order:
  - 1a-prompt-delivery-dedup
  - 1b-prompt-weighting-consistency
  - 3-opencode-prompt-overflow-fix
active_task_id: null
archive_group: 2026-06-20-prompt-validation-v1
task_tracker:
  - task_id: 1a-prompt-delivery-dedup
    task_path: plans/tasks/1a-prompt-delivery-dedup.md
    status: draft
  - task_id: 1b-prompt-weighting-consistency
    task_path: plans/tasks/1b-prompt-weighting-consistency.md
    status: draft
  - task_id: 3-opencode-prompt-overflow-fix
    task_path: plans/tasks/3-opencode-prompt-overflow-fix.md
    status: draft
---

# Plan: Prompt Sending and Processing Validation

## Objective

Ensure that all prompts in the Pairflow bubble lifecycle are sent at the correct time, with minimal double-sending risk, and that agent finish-by-emitting requirements are weighted heavy enough in role prompts to prevent agents from bypassing structured handoff.

This plan covers three validation surfaces:
1. **Delivery dedup** — identify and eliminate pathways where the same logical prompt could be delivered twice by independent callers.
2. **Prompt weighting audit** — verify that every role's startup and resume prompts weight agent-emit completion as mandatory, with clear consequences for non-compliance.
3. **Correct-timing validation** — ensure each envelope type reaches its recipient at the expected lifecycle transition point.

## Done Definition

1. A delivery dedup registry exists at the protocol layer that records every delivered `envelope.id` per bubble within a bounded lifetime, and all callers check it before sending.
2. No new caller of `emitDeliveryNotificationAck` can deliver without first checking the dedup registry. Existing callers are audited and migrated or documented as safe (idempotent by envelope uniqueness).
3. Watchdog's `retryStuckAgentInput` is confirmed to not produce duplicate deliveries — it either retries only truly stuck messages or verifies pre-delivery status before acting.
4. Every role's startup prompt (`implementer_start_activation_contract`, `reviewer_start_activation_contract`, `meta_reviewer_idle_contract`) and resume prompt includes an explicit, weighted directive that the agent MUST run `pairflow agent emit` to complete its turn and hand off.
5. Resume prompts carry the same emit-weighting as startup prompts (no regression).
6. A test or lint check exists that validates prompt concern composition for all roles covers emit-handoff weight requirement.

## Capability Closure

| Capability Claim | Closure Classification | Activation Path | Repo-Provided Boundary | External Prerequisites | Last-Mile Proof |
|---|---|---|---|---|---|
| Delivery dedup registry prevents double-sending | end_to_end | New callers check dedup before `emitDeliveryNotificationAck`; watchdog retry path verified | `src/v11/infrastructure/channel/tmux/deliveryDedup.ts` (new) | N/A | Integration test in `tests/core/runtime/` proving dedup blocks duplicate delivery |
| Role prompts weight agent-emit as mandatory requirement | hook_only | Prompt concern catalog validated; lint/test check added | Role prompt files in `src/v11/shared/role/prompts/` | Agents must follow CLI guidance (external to repo) | Audit report showing all roles have explicit emit directive at equal or higher priority than resume context |

## Guiding Principles

1. **Business invariant:** The bubble lifecycle must advance deterministically through handoff envelopes. No envelope type may reach a recipient twice for the same logical transition, and no agent may complete its turn without emitting a structured result.
2. **Control model:** Delivery dedup is controlled by a centralized registry at the protocol layer (`deliveryDedup.ts`), not by individual callers making independent checks. Agent-emit weighting is controlled by prompt concern catalog entries that are composed into every role's startup and resume prompts.
3. **Read-path rule:** The dedup registry reads from an in-memory set per bubble, backed optionally by a transient file for crash recovery across watchdog invocations.
4. **Forbidden fallback:** Do not rely on envelope ID uniqueness alone to prevent double-delivery — the delivery layer must actively reject duplicates rather than silently accepting them.
5. **Allowed resolution path:** If two callers attempt to deliver the same logical prompt, the first caller succeeds and subsequent callers receive a `DELIVERY_ACK_DUPLICATE` rejection with the original envelope ID reference.
6. **Missing-data rule:** If the dedup registry is unavailable (crash, file corruption), delivery fails closed — no prompt is sent until the registry recovers or is re-initialized from persisted state.

## Canonical Contract Anchors

1. **Source-of-truth anchors:**
   - `src/v11/infrastructure/channel/tmux/tmuxDelivery.ts` — `emitDeliveryNotificationAck` (single delivery entrypoint)
   - `src/v11/shared/protocol/protocolEnvelopeContract.ts` — `envelope.id` as unique message identifier
   - `src/v11/shared/role/prompts/rolePromptConcerns.ts` — prompt concern catalog and composition
   - `tests/core/runtime/tmuxDelivery.test.ts` — existing delivery tests

2. **Closed canonical elements:**
   - All callers of `emitDeliveryNotificationAck` must pass through the dedup registry (new mandatory rule).
   - Envelope ID (`envelope.id`) is the unique key for dedup, not payload content or sequence number.
   - Role prompt concerns `implementer_emit_handoff_contract`, `reviewer_pass_output_contract_guidance`, and equivalent reviewer/meta-reviewer concerns must explicitly weight emit-handoff as mandatory (P0).

3. **Explicitly authorized reinterpretation:** N/A — no existing contract terms are reinterpreted.

4. **Downstream task impact:**
   - Task 1a (`prompt-delivery-dedup`) touches all callers of `emitDeliveryNotificationAck`. Each caller is a review surface for whether it was independently delivering or relying on the centralized entrypoint.
   - Task 1b (`prompt-weighting-consistency`) touches `rolePromptConcerns.ts` and all role-specific prompt builders; tests must be updated to verify new emit-weighting expectations.

## Current Status

### Completed Work

1. N/A — this is a new plan with no prior implementation work.

### Open Work

1. Implement delivery dedup registry at the protocol layer.
2. Audit and migrate all callers of `emitDeliveryNotificationAck` to use the dedup registry.
3. Validate watchdog retry path for duplicate safety.
4. Audit role prompt concerns for emit-handoff weighting consistency.
5. Add test/lint validation for prompt concern composition.

### Deferred / Future Work

1. Cross-bubble delivery coordination (only same-bubble dedup is in scope).
2. Persisted dedup state surviving full system restart (in-memory only with optional transient file fallback for watchdog-level recovery).
3. Metrics and observability for delivery dedup hits (future hardening).

## Open Task List

| Task ID | Task Path | Purpose | Depends On | Closes Gap | Status |
|---|---|---|---|---|---|
| `1a-prompt-delivery-dedup` | `null` | Build delivery dedup registry and audit/migrate callers | N/A | Delivery double-send prevention | not_created |
| `1b-prompt-weighting-consistency` | `null` | Audit role prompts for agent-emit weighting; add validation test | N/A | Agent finish-by-emit enforcement consistency | not_created |
| `3-opencode-prompt-overflow-fix` | `plans/tasks/3-opencode-prompt-overflow-fix.md` | Fix opencode prompt overflow and duplicate handover/refresh prompts | N/A | Opencode input pane overflow and duplicate handover prompts | draft |

## Coverage Map

| Plan Gap | Closed By | Notes |
|---|---|---|
| Multiple callers can independently deliver the same envelope type | `1a-prompt-delivery-dedup` | Dedup registry + caller audit covers all entry points in one task since they share a common dependency (`emitDeliveryNotificationAck`) and the fix is centralized. |
| Watchdog retry could produce duplicates | `1a-prompt-delivery-dedup` | Included in dedup task — watchdog's `retryStuckAgentInput` must use same dedup registry to verify pre-retry status. |
| Agent-emit directive varies across roles/phases | `1b-prompt-weighting-consistency` | Prompt concern catalog audit + validation test. |
| Opencode input pane overflow and duplicate prompts during handover/refresh | `3-opencode-prompt-overflow-fix` | Minimizes handover delivery prompts and avoids duplicate context refresh pastes for opencode. |

## Dependencies and Order

1. Tasks 1a and 1b are independent — they touch different code surfaces (delivery layer vs prompt layer). They can be executed in parallel or either order.
2. No sequencing dependency between them; plan completion requires both to be done/archived.

## Risks and Assumptions

1. **Risk:** The dedup registry introduces a new file-system dependency (for crash recovery) that could add latency or failure modes to delivery. Mitigation: keep in-memory set as primary path; transient file is optional and only used for watchdog-level recovery across process restarts, not per-delivery.
2. **Assumption:** All callers of `emitDeliveryNotificationAck` currently pass a unique `envelope.id`, making dedup by envelope ID safe without content comparison. This must be verified during the caller audit.
3. **Risk:** Role prompt changes could affect agent behavior in unexpected ways (e.g., agents become overly cautious). Mitigation: validation testing with minimal, targeted wording changes — only tighten emit-weighting where it is currently missing or weak.

## Validation Strategy

1. **Delivery dedup:** Unit tests for the registry covering insert-check-reject semantics; integration test verifying two simultaneous callers get exactly one delivery and one rejection.
2. **Prompt weighting:** Static analysis / lint check that iterates all role prompt concern IDs used in startup/resume paths and verifies emit-handoff weight concern is present with correct severity ordering (before resume context, not after).
