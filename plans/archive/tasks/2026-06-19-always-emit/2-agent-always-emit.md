---
artifact_type: task
artifact_id: task_agent_always_emit_instruction_hardening_phaseE_v1
task_family_id: agent-always-emit
sequence_key: "2"
task_id: 2-agent-always-emit
title: "Enforce Agent ALWAYS Emit Before Stopping Work & Merged Seeding"
status: archived
phase: phaseE
target_files:
  - "src/v11/shared/role/prompts/rolePromptConcerns.ts"
  - "src/v11/shared/role/prompts/roleActionGuidance.ts"
  - "src/v11/application/metaReviewGate/internal/prompts/metaReviewGatePrompt.ts"
  - "src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts"
  - "src/v11/infrastructure/channel/tmux/tmuxInput.ts"
prd_ref: null
plan_ref: null
system_context_ref: docs/pairflow-initial-design.md
owners:
  - "felho"
doc_bubble_id: 2-agent-always-emit-doc
impl_bubble_id: 2-agent-always-emit-impl
supersedes: []
superseded_by: null
archive_group: "2026-06-19-always-emit"
---

# Task: Enforce Agent ALWAYS Emit Before Stopping Work & Merged Seeding

## L0 - Policy

### Goal

1. Ensure that agent instructions across all roles (Implementer, Reviewer, Meta-Reviewer) and all workflow phases (startup, resume, active run/execution loops) explicitly state that the agent must ALWAYS execute the final emit command (e.g. `pairflow agent emit` or the appropriate meta-review submit/decision commands) before stopping work or ending its turn.
2. Ensure pane bootstrap/kickoff instructions are merged and sent in a single operation to the tmux pane on start/resume.
3. Clean up the merged instructions by removing duplicate lines or paragraphs to keep the prompt clean and token-efficient.
4. Guarantee that `Enter` is reliably received after pasting instructions into tmux panes (specifically hardening reviewer pane delivery by attaching comment markers and retrying).

### Domain / Control Model Summary

1. Business invariant: N/A
2. Control model: N/A
3. Read-path rule: N/A
4. Forbidden fallback: N/A
5. Allowed resolution path: N/A
6. Missing-data rule: N/A
7. Phase boundary:
   - contract closure: owned here
   - producer closure: N/A
   - internal execution closure: owned here
   - workflow/orchestration closure: N/A
   - read-model closure: N/A
   - activation closure: owned here
   - cleanup/recovery closure: N/A

### Plan Linkage

N/A

### Canonical Contract Anchors

N/A

### Scope Reality / Shape Proof

1. Inspected entrypoints / call-sites:
   - `src/v11/shared/role/prompts/rolePromptConcerns.ts`
   - `src/v11/shared/role/prompts/roleActionGuidance.ts`
   - `src/v11/application/metaReviewGate/internal/prompts/metaReviewGatePrompt.ts`
   - `src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts`
   - `src/v11/infrastructure/channel/tmux/tmuxInput.ts`
2. Actual touched scope: `activation/read-model` (prompt instructions and pane seeding)
3. Mutation entrypoints in scope: N/A
4. Hidden scope ruled out: Checked that no other prompt builder modules or runner prompt handlers exist outside the identified files.
5. Branch inventory note: N/A
6. Why the declared task shape matches reality: The task modifies prompt strings and tmux pane seeding/input delivery mechanisms.

### Refactor Classification

N/A

### Authority Boundary Map

1. Authority producer: N/A
2. Stored authority: N/A
3. In-scope consumers: N/A
4. Explicit out-of-scope consumers: N/A
5. Export surfaces closed in this phase: N/A

### Baseline Preservation

1. Must-preserve behaviors: Existing placeholders, argument structures, and validation rules in prompts (like `--ref` attachments, severity qualifiers, block/advisory handling) must remain fully intact.
2. Allowed resolution paths: N/A
3. Forbidden regression interpretations: N/A
4. Replacement proof required if removed: N/A

### Success / Completion Proof Boundary

N/A

### Precondition and Side-Effect Boundary

1. Primary bounded task shape: `activation_or_read_model`
2. Secondary shape (if any): N/A
3. Preconditions that must pass before side effects: N/A
4. Side effects forbidden before preconditions pass: N/A
5. Invalid/precondition-failure behavior: N/A
6. Coordination primitives in scope: N/A

### In Scope

1. Hardening instructions in `src/v11/shared/role/prompts/rolePromptConcerns.ts` (e.g. `implementer_emit_handoff_contract`, `meta_reviewer_resume_activation_contract`) to command the agent to always run emit before finishing its turn.
2. Clarifying guidance in `src/v11/shared/role/prompts/roleActionGuidance.ts` (e.g. `buildImplementerEvidenceHandoffGuidance`) to emphasize execution of the canonical emit as the mandatory final step.
3. Hardening instructions in `src/v11/application/metaReviewGate/internal/prompts/metaReviewGatePrompt.ts` (e.g. `buildMetaReviewGateRunPrompt`) to explicitly command the meta-reviewer agent to submit its report before completing its turn.
4. Modifying `seedBubbleTmuxPaneMessages` in `src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts` to merge the bootstrap and kickoff messages for each pane (implementer, reviewer, meta-reviewer) before sending them.
5. Implementing a paragraph/line-based merge & deduplication helper in `tmuxManagerPaneSeed.ts` to strip redundant instructions.
6. Guaranteeing `Enter` delivery in `src/v11/infrastructure/channel/tmux/tmuxInput.ts` (appending structured comment markers to any pasted instruction/bootstrap message lacking it, forcing `confirmTmuxPaneMarkerSubmission` to run and retry sending `Enter` if input remains unsubmitted).

### Out of Scope

1. Changes to the underlying command implementation of `pairflow agent emit` or `pairflow bubble meta-review submit`.
2. Modifying state machine behavior or lifecycle status logic.

### Safety Defaults

1. Default prompts must fall back to recommending standard emit commands if no specific action-state qualifiers are matched.

### Scoped Invariants

| Invariant | Applies To | Does Not Apply To | Proof Surface | Deferred / External Surfaces | Reviewer Non-Goals |
|---|---|---|---|---|---|
| ALWAYS emit instruction | All role prompts (Implementer, Reviewer, Meta-Reviewer) | Non-agent interfaces/CLI wrappers | Prompt output text assertions in unit tests | Downstream LLM agent behavior (outside prompt template correctness) | Verifying whether the actual LLM executes the command correctly |

### Review Scope Fence

N/A

### Contract Boundary / Blast Radius

1. `contract_boundary_override`: `no`

### Gate Detail Budget

| Gate | Detail Level | Evidence / Reason |
|---|---|---|
| Complexity Risk Gate | triggered_low_risk | Low-risk prompt template and delivery adjustment. |
| Scoped Invariant Gate | triggered_low_risk | Simple check of instruction presence. |
| Authority Fan-out Scan | not_triggered | No authority changes. |
| Closure-Budget Gate | not_triggered | No database, API, or contract mutation. |

### Complexity Risk Gate

1. `authority_risk`: 0
2. `surface_spread`: 1
3. `identity_join_risk`: 0
4. `activation_coupling`: 0
5. `prerequisite_risk`: 0
6. `acceptance_multiplicity`: 1
7. `risk_score`: 2
8. `single-task allowed`: yes
9. If `no`, required split: N/A
10. Identity/join note: N/A
11. Authority/source-of-truth note: N/A
12. Closure-budget triage:
    - closure buckets touched: N/A
    - intentionally collapsed closures: N/A
    - explicitly deferred closures: N/A
13. Bounded-task-shape decision:
    - primary shape: `activation_or_read_model`
    - secondary shape: N/A
    - decomposed closures: N/A
    - adjacent call-site/consumer-family scan: N/A
    - why this bounded mix is safe: N/A
14. Scoped-invariant decision:
    - gate triggered: yes
    - scoped invariant records: "Scoped Invariants" table above
    - unbounded invariant route-back: no
15. Review-scope-fence decision:
    - fence needed: no
    - fenced families: N/A
    - invalid fence route-back: no
16. Contract-dense decision:
    - gate triggered: no
    - trigger reasons: N/A
    - canonical matrix source: N/A
    - mirrored surfaces: N/A

## L1 - Change Contract

### 0) Domain / Control Contract

| Item | Rule | Implementation Consequence | Priority | Timing |
|---|---|---|---|---|
| Business invariant | Prompt templates must command the active agent to execute the canonical emit/submit command before stopping work. | Every agent prompt generated must carry a clear command directive stating that emitting is mandatory and the final action of its turn. | P1 | required-now |
| Merged Seeding | Instructions must be sent in a single operation to tmux. | Bootstrap and kickoff messages are merged and deduplicated before transmission. | P1 | required-now |
| Guaranteed Enter | Pasted messages must receive Enter reliably. | Any instruction message sent to a pane is formatted with a structured comment marker, forcing confirmation and input submission retries. | P1 | required-now |

### 1) Call-site Matrix

| ID | File | Function/Entry | Exact Signature (args -> return) | Insertion Point | Expected Behavior | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|---|
| CS1 | `src/v11/shared/role/prompts/rolePromptConcerns.ts` | `implementer_emit_handoff_contract` / other concern builders | `() => string[]` | Concern builder implementations | Add "Always execute the emit command as the final step before ending your turn. Do not stop work or wait for human intervention to emit." or similar wording. | P1 | required-now | Code Inspection |
| CS2 | `src/v11/shared/role/prompts/roleActionGuidance.ts` | `buildImplementerEvidenceHandoffGuidance` / `buildImplementerStartActionLine` | various guidance string formatters | Guidance function bodies | Include explicit wording requiring the agent to execute the canonical emit/pass/human_question commands rather than stopping without emitting. | P1 | required-now | Code Inspection |
| CS3 | `src/v11/application/metaReviewGate/internal/prompts/metaReviewGatePrompt.ts` | `buildMetaReviewGateRunPrompt` | `(input: { ... }) => string` | Return string construction | Include explicit instruction to ALWAYS execute the final structured submit command before finishing execution. | P1 | required-now | Code Inspection |
| CS4 | `src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts` | `seedBubbleTmuxPaneMessages` | `(input: SeedBubbleTmuxPaneMessagesInput) => Promise<void>` | Seeding execution flow | Merge and deduplicate `Bootstrap` and `Kickoff` messages for each pane before calling `sendPaneMessage` on each pane. | P1 | required-now | Code Inspection |
| CS5 | `src/v11/infrastructure/channel/tmux/tmuxInput.ts` | `sendPaneMessage` / `sendAndSubmitTmuxPaneMessage` | various functions | Message sending flow | Ensure every message has a resolved comment marker, and enforce submission retry verification. | P1 | required-now | Code Inspection |

### 2) Data and Interface Contract

N/A

### 3) Side Effects Contract

Area: FS
Allowed: None (excluding standard debug/test logs).
Forbidden: Writing configuration state files or modifying workspace source code outside target files.

### 4) Error and Fallback Contract

N/A

### 5) Dependency Constraints

N/A

### 6) Test Matrix

| ID | Scenario | Given | When | Then | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|
| T1 | Implementer prompt test | Implementer startup prompts are constructed | Testing `startCommandImplementerPrompts.test.ts` / related tests | Verify the generated output contains the ALWAYS emit instruction. | P1 | required-now | Test output logs |
| T2 | Reviewer prompt test | Reviewer startup/resume prompts are constructed | Testing `reviewerDelivery.test.ts` / related tests | Verify the generated output contains the ALWAYS emit instruction. | P1 | required-now | Test output logs |
| T3 | Meta-Reviewer prompt test | Meta-Reviewer prompts are constructed | Testing `metaReviewGateNotify.test.ts` / related tests | Verify the generated output contains the ALWAYS emit instruction. | P1 | required-now | Test output logs |
| T4 | Seeding merge test | Seeding inputs are provided with bootstrap and kickoff | Testing `tmuxManager.test.ts` / related tests | Verify the implementer and reviewer receive a single merged/deduplicated message. | P1 | required-now | Test output logs |
| T5 | Enter submission verification | Instructions are pasted into panes | Testing `tmuxInput.test.ts` / related tests | Verify that Enter is sent and retried if the pane is initially stuck. | P1 | required-now | Test output logs |

## L2 - Implementation Notes (Optional)

1. [later-hardening] Document the rationale of ALWAYS emit and merged seeding in `docs/architecture/` if useful for onboarding new developers.

## Spec Lock

Mark task as `IMPLEMENTABLE` when all `P0/P1 + required-now` items are closed.
