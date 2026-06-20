---
artifact_type: Task
artifact_id: task_prompt_weighting_consistency_v1
status: draft
phase: null
target_files:
  - src/v11/shared/role/prompts/rolePromptConcernIds.ts
  - src/v11/shared/role/prompts/rolePromptConcerns.ts
  - tests/v11/application/start/startCommandImplementerPrompts.test.ts
prd_ref: null
plan_ref: plans/prompt-validation-plan-v1.md
system_context_ref: docs/actor-runtime-interface/execution-authority-contract-note-v1.md
task_family_id: prompt-weighting-consistency
sequence_key: "1b"
task_id: 1b-prompt-weighting-consistency
doc_bubble_id: null
impl_bubble_id: null
supersedes: []
superseded_by: null
---

# 1b-prompt-weighting-consistency

## L0: Policy and Bounded Scope

### Primary Task Shape
`contract_or_persisted_authority_foundation`

### Business Invariant
All role prompts (implementer, reviewer, meta-reviewer) across all lifecycle phases (startup, resume) must consistently and explicitly weight the finish-by-emit requirement as a P0 directive, preventing agents from bypassing structured handoff or exiting without a formal emission. Resume prompts must carry the same emit-weighting as startup prompts (no regression).

### Control Model
Prompt composition is controlled by the role concern mapping in `rolePromptConcernIds.ts` and concern strings in `rolePromptConcerns.ts`. Enforce emit/submit directives by ensuring that:
1. `implementer_emit_handoff_contract` is present in both implementer startup and resume concern mappings.
2. `reviewer_findings_pass_instruction` (which details `--finding` parameters) is present in both reviewer startup and resume concern mappings.
3. `meta_review_submit_command_template` is present in both meta-reviewer startup and resume concern mappings.
4. Validation checks are executed via vitest to assert the presence of these concerns.

### Scope Reality Proof

**Inspected entrypoints:**
1. **`src/v11/shared/role/prompts/rolePromptConcernIds.ts`**
   - Defines arrays for role startup and resume prompt concern lists:
     - `implementerStartupPromptConcernIds` / `implementerResumePromptConcernIds`
     - `reviewerStartupPromptConcernIds` / `reviewerResumePromptConcernIds`
     - `metaReviewerStartupPromptConcernIds` / `metaReviewerResumePromptConcernIds`
   - Currently, `implementerResumePromptConcernIds` misses `implementer_emit_handoff_contract`.
   - Currently, `reviewerResumePromptConcernIds` misses `reviewer_findings_pass_instruction`.
   - Currently, `metaReviewerResumePromptConcernIds` misses `meta_review_submit_command_template`, `meta_review_submit_approve_parity_note`, and `meta_review_finding_severity_contract`.

2. **`src/v11/shared/role/prompts/rolePromptConcerns.ts`**
   - Renders concerns from the catalog. Needs to ensure the wording for emit directives (`AGENT_EMIT_DIRECTIVE` in `sharedPromptDirectives.ts`) remains weighted heavily and clearly states that emitting is mandatory before ending a turn.

3. **`tests/v11/application/start/startCommandImplementerPrompts.test.ts`**
   - The test suite for verifying prompt rendering. We will add a static concern coverage test that iterates through all roles and phases to verify handoff/emit concerns are present in every active state.

### Complexity Risk Gate
- **risk_score:** 3
- **authority_risk:** 0 — no public runtime API, db schema, or event/message transport changes.
- **surface_spread:** 1 — touches only prompt concern definitions and prompt test files.
- **identity_join_risk:** 0
- **activation_coupling:** 0
- **prerequisite_risk:** 0
- **acceptance_multiplicity:** 2 — unit tests check prompt strings and concern mappings.

**split_decision:** Split not required. Risk score is low (<= 3), and changes are bounded within the static prompt assembly layer.

### Authority Boundary Map
| Boundary | Status |
|---|---|
| authority_producer | This task — `rolePromptConcernIds.ts` defines the concern structures |
| persisted_authority_or_schema | Absent |
| internal_execution_consumers | Present — `startCommandPrompts.ts` and `startCommandResumePrompts.ts` build prompt lines using the catalog |
| workflow_orchestration_consumers | Absent |
| read_model_consumers | Absent |
| cleanup_recovery_consumers | Absent |
| validator_gate_consumers | Present — `startCommandImplementerPrompts.test.ts` asserts correct rendering and concern presence |
| external_integration_consumers | Absent |

### Closure-Budget Gate
| Bucket | Status | Evidence |
|---|---|---|
| authority_producer | present | Modifying prompt mappings and definitions |
| shared_contract | absent | No public API or database changes |
| internal_execution_consumers | present | Handled in the same task via prompt construction |
| validator_gate_consumers | present | Validation test added to the test suite |

**Decision:** 3 buckets present, none representing database schema or external API contract changes. Collapse is safe. No split required.

### Capability Closure
| Capability Claim | Closure Classification | Activation Path | Repo-Provided Boundary | External Prerequisites | Last-Mile Proof |
|---|---|---|---|---|---|
| Prompt concerns enforce emit directives for all roles | end_to_end | Build and run vitest tests | `src/v11/shared/role/prompts/` | N/A | Statically checks concern lists via new test in `startCommandImplementerPrompts.test.ts` |

---

## L1: Implementation Contract

### Prompt Concern Mapping Matrix
| ID | Role | Phase | Target Concern | Action / Acceptance Criteria | Severity |
|----|------|-------|----------------|------------------------------|----------|
| MAP_1 | `implementer` | `resume` | `implementer_emit_handoff_contract` | Add to `implementerResumePromptConcernIds` directly after `canonical_actor_emit_lookup_guidance`. | P0 |
| MAP_2 | `reviewer` | `resume` | `reviewer_findings_pass_instruction` | Add to `reviewerResumePromptConcernIds` directly after `reviewer_pass_output_contract_guidance`. | P0 |
| MAP_3 | `meta_reviewer` | `resume` | `meta_review_submit_command_template` | Add to `metaReviewerResumePromptConcernIds` directly after `canonical_actor_emit_lookup_guidance`. | P0 |
| MAP_4 | `meta_reviewer` | `resume` | `meta_review_submit_approve_parity_note` | Add to `metaReviewerResumePromptConcernIds` directly after `meta_review_submit_command_template`. | P1 |
| MAP_5 | `meta_reviewer` | `resume` | `meta_review_finding_severity_contract` | Add to `metaReviewerResumePromptConcernIds` directly after `meta_review_submit_approve_parity_note`. | P1 |

### Prompt Wording Check Matrix
| ID | Target File / Constant | Expected Directive / Constraint | Severity |
|----|------------------------|---------------------------------|----------|
| WORD_1 | `sharedPromptDirectives.ts:AGENT_EMIT_DIRECTIVE` | Must explicitly state: "mandatory final step before stopping work or ending your turn. Do not stop work without emitting first." | P0 |
| WORD_2 | `sharedPromptDirectives.ts:META_REVIEWER_SUBMIT_DIRECTIVE` | Must explicitly state: "mandatory final step before stopping work or ending your turn. Do not stop work without emitting first." | P0 |

### Test Matrix
| ID | Test Scenario | Assertion | Depends On | Severity |
|----|---------------|-----------|------------|----------|
| T_COMP_1 | Verify implementer resume prompt contains emit instructions | Rendering `buildResumeImplementerStartupPrompt` output contains `pairflow agent emit --kind pass`. | MAP_1 | P0 |
| T_COMP_2 | Verify reviewer resume prompt contains findings instructions | Rendering `buildResumeReviewerStartupPrompt` output contains `pairflow agent emit --kind pass ... --finding`. | MAP_2 | P0 |
| T_COMP_3 | Verify meta-reviewer resume prompt contains submit template | Rendering `buildResumeMetaReviewerStartupPrompt` output contains `pairflow agent emit` or structured submit template. | MAP_3 | P0 |
| T_COMP_4 | Static concern completeness assertion | A new unit test iterates all active roles (`implementer`, `reviewer`, `meta_reviewer`) and phases (`startup`, `resume`) and asserts that: (a) implementer has `implementer_emit_handoff_contract`, (b) reviewer has `reviewer_findings_pass_instruction` (or `reviewer_canonical_command_gate_lines` which mandates routing), and (c) meta-reviewer has `meta_review_submit_command_template`. | MAP_1, MAP_2, MAP_3 | P0 |

---

## L2: Hardening Backlog

- **H_LINT_1:** A build or lint script that scans the role prompt configuration definitions at build-time to ensure no new resume configuration can be registered without corresponding handoff/emit concerns.

---

## Baseline Preservation

| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP_1 | Ideation-pending implementer bypass | Resume/startup prompts for ideation-pending (`round=0`) bubbles must continue to bypass normal task read/validation contracts and remain idle, without demanding an active emit instruction. |
| BP_2 | Document refinement Mode A/B rules | Document-scope specific checks (primary artifact reviewer guardrails, docs-only skip/checks claim) must not be affected. |

---

## Review Scope Fence

1. **Only prompt configuration mapping and static text are in scope.** No changes to tmux orchestration, watchdog execution logic, or actual command line client emission parameters.
2. **Reviewer command gate rounds configuration is out of scope.** Only the rendering of instructions to the reviewer in their terminal prompt is verified.
