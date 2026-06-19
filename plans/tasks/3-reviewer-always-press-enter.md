---
artifact_type: task
artifact_id: task_reviewer_enter_v1
task_family_id: reviewer-always-press-enter
sequence_key: "3"
task_id: 3-reviewer-always-press-enter
title: "Reviewer Always Press Enter"
status: draft
phase: phase1
target_files:
  - "src/v11/shared/role/prompts/sharedPromptDirectives.ts"
  - "src/v11/shared/role/prompts/rolePromptConcerns.ts"
prd_ref: null
plan_ref: null
system_context_ref: docs/pairflow-initial-design.md
owners:
  - "antigravity"
doc_bubble_id: null
impl_bubble_id: null
supersedes: []
superseded_by: null
archive_group: null
---

# Task: Reviewer Always Press Enter

## L0 - Policy

### Goal

Ensure the reviewer agent always executes commands by pressing Enter, avoiding situations where a command is typed in the terminal prompt but left unsent.

### Domain / Control Model Summary

1. Business invariant: N/A
2. Control model: Reviewer prompt directives control reviewer command-execution behavior.
3. Read-path rule: N/A
4. Forbidden fallback: N/A
5. Allowed resolution path: N/A
6. Missing-data rule: N/A
7. Phase boundary:
   - contract closure: owned here
   - producer closure: owned here
   - internal execution closure: owned here
   - workflow/orchestration closure: N/A
   - read-model closure: N/A
   - activation closure: N/A
   - cleanup/recovery closure: N/A

### Plan Linkage

N/A

### Canonical Contract Anchors

N/A

### Scope Reality / Shape Proof

1. Inspected entrypoints / call-sites:
   - `src/v11/shared/role/prompts/sharedPromptDirectives.ts`
   - `src/v11/shared/role/prompts/rolePromptConcerns.ts`
2. Actual touched scope: consumer-family alignment (aligning reviewer prompt concerns)
3. Mutation entrypoints in scope: N/A
4. Hidden scope ruled out: Inspected `tmuxInput.ts` to ensure tmux-level Enter delivery is robust; verified that the issue is specific to the agent's prompt instructions where the agent types but does not execute.
5. Branch inventory note: N/A
6. Why the declared task shape matches reality: Fits within prompt concerns configuration.

### Refactor Classification

N/A

### Authority Boundary Map

1. Authority producer: N/A
2. Stored authority: N/A
3. In-scope consumers: reviewer agent startup and resume prompts
4. Explicit out-of-scope consumers: implementer/meta-reviewer prompts
5. Export surfaces closed in this phase: N/A

### Baseline Preservation

N/A

### Success / Completion Proof Boundary

N/A

### Precondition and Side-Effect Boundary

N/A

### In Scope

1. Add a shared prompt directive `REVIEWER_ENTER_DIRECTIVE` instructing the reviewer to always press Enter after typing a command.
2. Integrate `REVIEWER_ENTER_DIRECTIVE` into the reviewer's startup and resume prompt concern functions:
   - `buildReviewerStartActivationContract`
   - `buildReviewerResumeArtifactContext`

### Out of Scope

1. Changes to tmux delivery implementation or timing delays.
2. Changes to implementer or meta-reviewer prompts.

### Safety Defaults

1. If no new prompt is configured, fall back to existing prompts.

### Scoped Invariants

N/A

### Review Scope Fence

N/A

### Contract Boundary / Blast Radius

1. `contract_boundary_override`: no

### Gate Detail Budget

| Gate | Detail Level | Evidence / Reason |
|---|---|---|
| Control-Model | not_triggered | No new business state or control model is introduced. |
| Closed-Contract Drift | not_triggered | Prompt wording is additive and does not reinterpret existing system semantics. |
| Bounded-Task-Shape | triggered_low_risk | Compact record is sufficient as it is pure prompt/instruction refinement. |
| Complexity Risk | triggered_low_risk | Risk score is low (1). |

### Complexity Risk Gate

1. `authority_risk`: 0
2. `surface_spread`: 0
3. `identity_join_risk`: 0
4. `activation_coupling`: 0
5. `prerequisite_risk`: 0
6. `acceptance_multiplicity`: 1
7. `risk_score`: 1
8. `single-task allowed`: yes

## L1 - Change Contract

### 0) Domain / Control Contract

| Item | Rule | Implementation Consequence | Priority | Timing |
|---|---|---|---|---|
| Phase boundary | Prompt updates are closed inside this task. | The reviewer agent receives the new Enter directive. | P1 | required-now |

### 1) Call-site Matrix

| ID | File | Function/Entry | Exact Signature (args -> return) | Insertion Point | Expected Behavior | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|---|
| CS1 | `src/v11/shared/role/prompts/rolePromptConcerns.ts` | `buildReviewerStartActivationContract` | `(input: PromptConcernBuildInput) => readonly string[]` | End of returned array | Append `REVIEWER_ENTER_DIRECTIVE` | P1 | required-now | Verify prompt output |
| CS2 | `src/v11/shared/role/prompts/rolePromptConcerns.ts` | `buildReviewerResumeArtifactContext` | `(input: PromptConcernBuildInput) => readonly string[]` | End of returned array | Append `REVIEWER_ENTER_DIRECTIVE` | P1 | required-now | Verify prompt output |

### 2) Data and Interface Contract

N/A

### 3) Side Effects Contract

Area: FS
Allowed: modifying target files
Forbidden: any other side effects

### 4) Error and Fallback Contract

N/A

### 5) Dependency Constraints

N/A

### 6) Test Matrix

| ID | Scenario | Given | When | Then | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|
| T1 | startup prompt includes Enter directive | reviewer startup concern built | `buildRolePromptConcernLines` called for reviewer startup | output contains `REVIEWER_ENTER_DIRECTIVE` | P1 | required-now | prompt contents |
| T2 | resume prompt includes Enter directive | reviewer resume concern built | `buildRolePromptConcernLines` called for reviewer resume | output contains `REVIEWER_ENTER_DIRECTIVE` | P1 | required-now | prompt contents |

## L2 - Implementation Notes (Optional)

None.
