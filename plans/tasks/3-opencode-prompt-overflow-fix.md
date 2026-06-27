---
artifact_type: Task
artifact_id: task_opencode_prompt_overflow_fix_v1
status: draft
phase: null
target_files:
  - src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts
  - src/v11/application/pass/internal/reviewerDelivery/reviewerDeliveryHelpers.ts
  - src/v11/infrastructure/channel/tmux/reviewerContext.ts
  - src/v11/application/start/internal/prompts/startCommandPrompts.ts
  - tests/core/runtime/reviewerContext.test.ts
  - tests/v11/application/pass/reviewerDelivery.test.ts
prd_ref: null
plan_ref: null
system_context_ref: docs/v3/convergence/core-model.html
task_family_id: opencode-prompt-overflow-fix
sequence_key: "3"
task_id: 3-opencode-prompt-overflow-fix
doc_bubble_id: null
impl_bubble_id: null
supersedes: []
superseded_by: null
---

# 3-opencode-prompt-overflow-fix

## L0: Policy and Bounded Scope

### Primary Task Shape
`consumer_family_alignment` — aligning the orchestrator prompt formatting and context refresh delivery logic with `opencode` agent constraints.

### Business Invariant
`opencode` agent inputs must never exceed the TUI input pane buffer capacity, ensuring prompt submissions are successful and that handover notifications are minimal and free of duplicate/general specs.

### Control Model
Prompt formatting for `opencode` is recipient-aware:
- If the recipient agent name is `"opencode"`, all generic/general instructions, remind ontology blocks, and command gate projections are omitted.
- Duplicate startup prompts are prevented during handover by not passing `reviewerStartupPrompt` to `refreshReviewerContext` when the reviewer agent is `"opencode"`.

### Scope Reality Proof

**Inspected entrypoints:**
1. `src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts` — `buildTmuxDeliveryMessage` (the formatting builder for delivery messages).
2. `src/v11/application/pass/internal/reviewerDelivery/reviewerDeliveryHelpers.ts` — `resolveDeliveryInitialDelayMs` (the context refresh caller during pass delivery).
3. `src/v11/infrastructure/channel/tmux/reviewerContext.ts` — `refreshReviewerContext` (the post-spawn send-keys helper).
4. `src/v11/application/start/internal/prompts/startCommandPrompts.ts` — `buildMetaReviewerStartupPrompt` (fresh launch startup prompt builder).

**Bounded slice:**
Modifying these four files isolates all prompt formatting and double-paste issues for `opencode` across start/resume and handover transitions.

### Complexity Risk Gate
- **risk_score:** 3 (low risk, local formatting logic changes and calling argument updates).
- **split_decision:** `no_split` (score <= 4, self-contained cleanup).

### Authority Boundary Map
| Boundary | Status | Evidence / Note |
|---|---|---|
| authority_producer | present | Dynamic prompt formatting rules for `opencode` |
| persisted_authority_or_schema | absent | No schema or persistence changes |
| internal_execution_consumers | present | Tmux delivery and pane refreshing |
| workflow_orchestration_consumers | present | Handoff/pass execution |
| read_model_consumers | absent | No read models touched |
| cleanup_recovery_consumers | absent | No cleanup/recovery changes |
| validator_gate_consumers | present | Unit/integration testing |
| external_integration_consumers | absent | No external integrations touched |

### Closure-Budget Gate
- **authority_producer:** present
- **shared_contract:** absent
- **internal_execution_consumers:** present
- **workflow_orchestration_consumers:** present
- **read_model_consumers:** absent
- **persisted_authority_or_schema:** absent
- **cleanup_recovery_consumers:** absent
- **Decision:** No split required.

### Capability Closure
- Minimal handover notifications and zero-duplicate inputs for `opencode` are hook-only, verified by unit/integration tests.

---

## L1: Implementation Contract

### Opencode Prompt Refinement Matrix
| ID | Contract Element | Acceptance Criteria / Rule | Severity |
|----|------------------|----------------------------|----------|
| OVERFLOW_1 | Omit general specs from reviewer delivery prompt | If `agents.reviewer === "opencode"`, `buildReviewerDeliveryAction` must only return `"Implementer handoff received. Run a fresh review now."` and the `testDirective` (when present), omitting ontology reminders, agent selection, expansion, and direct execution guidance. | P0 |
| OVERFLOW_2 | Omit general specs from implementer/meta-reviewer delivery prompts | If `recipientAgentName === "opencode"`, `buildImplementerDeliveryAction` and the meta-reviewer delivery text must only return the minimal role-specific actions (e.g. `"Reviewer feedback received. Implement fixes."`), omitting command guidance, validation guidance, and env-specific templates. | P0 |
| OVERFLOW_3 | Avoid duplicate reviewer startup prompts | In `resolveDeliveryInitialDelayMs` (`reviewerDeliveryHelpers.ts`), do not pass `reviewerStartupPrompt` to `refreshReviewer` if `bubbleConfig.agents.reviewer === "opencode"`. The clean-spawned pane will receive the brief/focus via the single delivery message instead of two separate pastes. | P0 |
| OVERFLOW_4 | Omit general specs from fresh meta-reviewer startup prompts | In `buildMetaReviewerStartupPrompt` (`startCommandPrompts.ts`), return `""` if `agentName === "opencode"`. | P1 |

### Test Matrix
| ID | Test Scenario | Assertion | Depends On | Severity |
|----|---------------|-----------|------------|----------|
| T_OVERFLOW_1 | Reviewer delivery minimal format | Verify `buildReviewerDeliveryAction` with `agents.reviewer = "opencode"` contains only the handoff message and test directive. | OVERFLOW_1 | P0 |
| T_OVERFLOW_2 | Implementer/meta-reviewer delivery minimal format | Verify `buildImplementerDeliveryAction` and meta-reviewer text with `opencode` contain only minimal action instructions. | OVERFLOW_2 | P0 |
| T_OVERFLOW_3 | Handover refresh does not double-paste | Verify `executePassDelivery` with `opencode` reviewer does not pass `reviewerStartupPrompt` to the mock `refreshReviewerContext`. Update `reviewerDelivery.test.ts` assertions accordingly. | OVERFLOW_3 | P0 |
| T_OVERFLOW_4 | Meta-reviewer startup prompt empty | Verify `buildMetaReviewerStartupPrompt` returns `""` for `opencode`. | OVERFLOW_4 | P1 |

---

## L2: Hardening Backlog
- None.

---

## Baseline Preservation

| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP_1 | Non-opencode / fallback delivery message formats | If the agent is not `"opencode"`, the existing verbose instruction formatting, ontology reminders, and direct command execution guidance must be retained exactly. |
| BP_2 | Startup prompts for non-opencode agents | Fresh/resume startup prompts for any non-opencode agents must remain unmodified. |

---

## Review Scope Fence
- This task strictly modifies the orchestrator-side prompt assembly and tmux pasting logic. It does not modify the `PF-implementer` or `PF-reviewer` agent role files or user-local config profiles themselves.
