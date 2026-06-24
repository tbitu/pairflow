---
artifact_type: Task
artifact_id: task_opencode_migration_test_fixes_v1
status: archived
phase: null
target_files:
  - tests/core/runtime/reviewerContext.test.ts
  - tests/core/runtime/tmuxDelivery.test.ts
  - tests/core/runtime/tmuxManager.test.ts
prd_ref: null
plan_ref: null
system_context_ref: docs/pairflow-initial-design.md
task_family_id: opencode-migration-test-fixes
sequence_key: "1c"
task_id: 1c-opencode-migration-test-fixes
doc_bubble_id: null
impl_bubble_id: 1c-opencode-migration-test-fixes
supersedes: []
superseded_by: null
---

# Task: 1c-opencode-migration-test-fixes

## L0 - Policy

### Goal

Align and fix the Pairflow core test suite (`reviewerContext.test.ts`, `tmuxDelivery.test.ts`, and `tmuxManager.test.ts`) following the removal of `codex` and `claude` agents in favor of `opencode`. Ensure all mock assertions, pane formats, and startup prompt expectations match the new agent mapping.

### Domain / Control Model Summary

1. Business invariant: N/A - test alignment only.
2. Control model: N/A.
3. Read-path rule: N/A.
4. Forbidden fallback: N/A.
5. Allowed resolution path: N/A.
6. Missing-data rule: N/A.
7. Phase boundary:
   - contract closure: owned here
   - producer closure: owned here
   - internal execution closure: owned here
   - workflow/orchestration closure: owned here
   - read-model closure: owned here
   - activation closure: owned here
   - cleanup/recovery closure: owned here

### Plan Linkage

N/A

### Canonical Contract Anchors

N/A

### Scope Reality / Shape Proof

1. Inspected entrypoints / call-sites:
   - `tests/core/runtime/reviewerContext.test.ts`
   - `tests/core/runtime/tmuxDelivery.test.ts`
   - `tests/core/runtime/tmuxManager.test.ts`
2. Actual touched scope: consumer-family alignment (aligning tests with the opencode-only engine model).
3. Mutation entrypoints in scope: N/A.
4. Hidden scope ruled out: No changes to production source logic; only modifying test files.
5. Branch inventory note: Reused tests updated for opencode parameters family.
6. Why the declared task shape matches reality: Changes are entirely bounded within test assertions and mocks.

### Refactor Classification

1. Classification: local_cleanup
2. Classification triggers: Test suite formatting and mock value updates to match deprecated agent removal.
3. Preparatory modifier: no

### Authority Boundary Map

1. Authority producer: N/A.
2. Stored authority: N/A.
3. In-scope consumers: tests/
4. Explicit out-of-scope consumers: src/
5. Export surfaces closed in this phase: N/A.

### Baseline Preservation

1. Must-preserve behaviors: The logic for opencode prompt delivery (via tmux send-keys after spawn for startup prompts) must remain correctly covered in `reviewerContext.test.ts`.
2. Allowed resolution paths: N/A.
3. Forbidden regression interpretations: N/A.
4. Replacement proof required if removed: N/A.

### Success / Completion Proof Boundary

N/A

### Precondition and Side-Effect Boundary

1. Primary bounded task shape: consumer_family_alignment
2. Secondary shape (if any): N/A.
3. Preconditions that must pass before side effects: N/A.
4. Side effects forbidden before preconditions pass: N/A.
5. Invalid/precondition-failure behavior: N/A.
6. Coordination primitives in scope: N/A.

### In Scope

- Updating expected outputs in `tmuxDelivery.test.ts` from `# [pairflow] r1 PASS codex->claude` to `# [pairflow] r1 PASS opencode->opencode`.
- Updating expected `pane-border-format` strings in `tmuxManager.test.ts` to expect `opencode` labels.
- Updating reviewer context tests to assert correct opencode-style send-keys prompt delivery post-spawn rather than expecting prompt text in the initial spawn command.

### Out of Scope

- Modifying the production logic of tmux management, delivery, or prompt construction.

### Safety Defaults

- Do not modify files in `src/` inside the implementation bubble.

### Scoped Invariants

N/A

### Review Scope Fence

N/A

### Contract Boundary / Blast Radius

1. `contract_boundary_override`: no

### Gate Detail Budget

| Gate | Detail Level | Evidence / Reason |
|---|---|---|
| Control-Model Readiness | not_triggered | No production control-model changes. |
| Closed-Contract Drift | not_triggered | No production contracts modified. |
| Authority Fan-out | not_triggered | Bounded to test suite files only. |
| Complexity Risk | triggered_low_risk | Simple local cleanup of tests, risk score 3. |

### Complexity Risk Gate

1. `authority_risk`: 0
2. `surface_spread`: 1 (tests/ only)
3. `identity_join_risk`: 0
4. `activation_coupling`: 0
5. `prerequisite_risk`: 0
6. `acceptance_multiplicity`: 2 (test suite runs)
7. `risk_score`: 3
8. `single-task allowed`: yes
9. Identity/join note: N/A
10. Authority/source-of-truth note: N/A
11. Closure-budget triage: N/A
12. Bounded-task-shape decision:
    - primary shape: consumer_family_alignment
    - secondary shape: N/A
13. Scoped-invariant decision:
    - gate triggered: no
14. Review-scope-fence decision:
    - fence needed: no
15. Contract-dense decision:
    - gate triggered: no

---

## L1 - Change Contract

### 0) Domain / Control Contract

| Item | Rule | Implementation Consequence | Priority | Timing |
|---|---|---|---|---|
| Business invariant | Test assertions must accurately reflect opencode configuration | Update all mocks and expect clauses | P1 | required-now |

### 1) Call-site Matrix

N/A

### 2) Data and Interface Contract

N/A

### 3) Side Effects Contract

| Area | Allowed | Forbidden | Notes | Priority | Timing |
|---|---|---|---|---|---|
| FS | Modifying test files under `tests/` | Modifying `src/` files | Bounded to test alignment | P1 | required-now |

### 4) Error and Fallback Contract

N/A

### 5) Dependency Constraints

N/A

### 6) Test Matrix

| ID | Scenario | Given | When | Then | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|
| T1 | Run tests/core/runtime/reviewerContext.test.ts | modified files | `pnpm exec vitest run tests/core/runtime/reviewerContext.test.ts` | all tests pass | P1 | required-now | test run |
| T2 | Run tests/core/runtime/tmuxDelivery.test.ts | modified files | `pnpm exec vitest run tests/core/runtime/tmuxDelivery.test.ts` | all tests pass | P1 | required-now | test run |
| T3 | Run tests/core/runtime/tmuxManager.test.ts | modified files | `pnpm exec vitest run tests/core/runtime/tmuxManager.test.ts` | all tests pass | P1 | required-now | test run |
| T4 | Run full test suite | modified files | `pnpm test` | all tests pass | P1 | required-now | test run |

## Review Control

1. Every finding must include: `priority`, `timing`, `layer`, `evidence`.
2. Blocker scope is bounded by the test failures identified in the three target test files.

## Spec Lock

Mark task as `IMPLEMENTABLE` when all tests in the target files pass.
