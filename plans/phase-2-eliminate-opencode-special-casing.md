---
plan_id: phase-2-eliminate-opencode-special-casing
created_on: 2026-06-29
archive_group: "2026-06-29-phase-2-eliminate-opencode-special-casing"
plan_status: active
status: open
---

# Phase 2: Eliminate Remaining Opencode Special-Casing

## Objective

Remove all remaining conditional `agentName === "opencode"` checks scattered across prompt builders, delivery modules, and pane lifecycle code. Consolidate opencode-specific behavior into unified abstraction patterns established in Phase 1.

**Outcome:** Codebase treats opencode as first-class citizen with no special conditional branching. All agents (opencode, codex, claude) use same delivery abstraction.

## Done Definition

1. ✅ All `agentName === "opencode"` conditional checks removed from:
   - startup prompt builders
   - delivery message construction
   - pane lifecycle logic
   - reviewer context refresh
   
2. ✅ Startup prompt behavior unified:
   - No empty-string returns based on agent name
   - Prompt builders return identical contract for all agents
   - Agent-specific rendering deferred to role instruction builders or delivery abstraction
   
3. ✅ Phase 1 abstraction extended to cover:
   - Startup prompt submission decisions
   - Delivery message formatting
   - Pane readiness checking per agent
   
4. ✅ All tests updated to reflect unified behavior
5. ✅ Full verification: typecheck ✅ lint ✅ fitness ✅ tests ✅

## Current Status

**Completed:** Phase 1 - RolePaneLifecycle abstraction created and integrated
**In Progress:** Phase 2 gap analysis and task decomposition
**Blocked:** None

## Guiding Principles

1. **Interface-first:** Create abstractions before removing conditionals
2. **Preserve behavior:** No user-visible behavior changes, only code structure
3. **Test-driven:** All tests must pass before moving to next phase
4. **Minimal coupling:** Opencode behavior expressed through configuration, not conditionals
5. **Symmetric treatment:** All agents use same code paths with agent-specific configuration

## Opencode Special-Casing Inventory

### 1. Startup Prompt Builders (Currently Return `""` for Opencode)

| File | Function | Current Behavior | Line(s) |
|------|----------|------------------|---------|
| `src/v11/application/start/internal/prompts/startCommandPrompts.ts` | `buildMetaReviewerStartupPrompt` | Returns `""` if `agentName === "opencode"` | 106 |
| `src/v11/application/start/internal/prompts/startCommandPrompts.ts` | `buildReviewerStartupPrompt` | Returns `""` if `agentName === "opencode"` | 131 |
| `src/v11/application/start/internal/prompts/startCommandImplementerPrompts.ts` | `buildImplementerStartupPrompt` | Returns `""` if `agentName === "opencode"` | 29 |
| `src/v11/application/start/internal/prompts/startCommandImplementerPrompts.ts` | `buildResumeImplementerStartupPrompt` | Returns `""` if `agentName === "opencode"` | 50 |

### 2. Reviewer Delivery (Special Pane Submission Logic)

| File | Function | Current Behavior | Line(s) |
|------|----------|------------------|---------|
| `src/v11/infrastructure/channel/tmux/reviewerContext.ts` | `shouldSendStartupPromptPostSpawn` | Checks `agentName === "opencode"` before submitting | 41 |
| `src/v11/infrastructure/channel/tmux/reviewerContext.ts` | `maybeSubmitReviewerStartupPrompt` | Conditionally calls tmux submission | 53, 60-68 |

### 3. Startup Prompt Routing (Conditional Submission Gate)

| File | Function | Current Behavior | Line(s) |
|------|----------|------------------|---------|
| `src/v11/application/start/internal/runtime/startCommandStartupPromptRouting.ts` | (main routing logic) | Checks `if (agentName === "opencode")` for routing decision | 86 |
| `src/v11/shared/command/startupPromptGate.ts` | `shouldSubmitStartupPrompt` | Always returns `false` (already simplified in Phase 0) | 9-15 |

### 4. Test Comments Referencing Double-Paste Avoidance

| File | Context | Comment |
|------|---------|---------|
| `tests/v11/application/pass/reviewerDelivery.test.ts` | Multiple test specs | "OVERFLOW_3: opencode reviewer should not receive startup prompt (avoids double-paste)" |

## Open Work

### Task O1: Unify Startup Prompt Builder Contracts

**Purpose:** Remove conditional returns of `""` from startup prompt builders

**Target Files:**
- `src/v11/application/start/internal/prompts/startCommandPrompts.ts`
- `src/v11/application/start/internal/prompts/startCommandImplementerPrompts.ts`

**Changes:**
1. Remove `if (agentName === "opencode") { return ""; }` checks
2. Let builders return full prompt text for all agents
3. Defer agent-specific filtering to delivery/instruction layers (via RolePaneLifecycle or role instruction builders)

**Verification:**
- reviewerDelivery tests: confirm reviewer startup prompt behavior unchanged
- implementer tests: confirm implementer startup prompt behavior unchanged
- meta-review tests: confirm meta-reviewer startup prompt behavior unchanged

### Task O2: Consolidate Reviewer Pane Submission Logic

**Purpose:** Move opencode-specific startup prompt submission decision into abstraction

**Target Files:**
- `src/v11/infrastructure/channel/tmux/reviewerContext.ts`
- `src/v11/shared/channel/rolePaneLifecycle.ts` (extend)

**Changes:**
1. Remove `shouldSendStartupPromptPostSpawn(agentName, startupPrompt)` conditional
2. Extend `RolePaneLifecycle` with optional startup prompt submission hook
3. In `activatePaneForRole`, optionally submit startup prompt after pane readiness
4. Configure submission behavior via role-specific pane lifecycle config

**Verification:**
- reviewerContext tests: confirm pane activation and prompt submission behavior unchanged
- tmuxDelivery tests: confirm no regressions in reviewer delivery flow

### Task O3: Eliminate Startup Prompt Routing Conditionals

**Purpose:** Unify startup prompt routing decision logic

**Target Files:**
- `src/v11/application/start/internal/runtime/startCommandStartupPromptRouting.ts`
- `src/v11/shared/command/startupPromptGate.ts`

**Changes:**
1. Remove `if (agentName === "opencode")` routing branches
2. Update `shouldSubmitStartupPrompt` to use unified logic (currently stub returning false)
3. Route all agents through same submission path
4. Use RolePaneLifecycle config to control actual tmux interaction

**Verification:**
- start command tests: confirm startup prompt routing behavior unchanged
- pass phase tests: confirm reviewer startup prompt submission unchanged
- end-to-end tests: confirm bubble startup behavior unchanged

### Task O4: Simplify Test Assertions

**Purpose:** Update tests to remove "double-paste avoidance" special-casing references

**Target Files:**
- `tests/v11/application/pass/reviewerDelivery.test.ts`
- Any other tests with "OVERFLOW_3" comments

**Changes:**
1. Remove "OVERFLOW_3" test comments
2. Update test descriptions to reflect unified behavior
3. Verify assertions pass with unified code paths

**Verification:**
- All existing test assertions continue to pass
- No new special cases added to test expectations

## Sequencing Dependencies

1. **O1 (Prompt Builders)** → O2 (Reviewer Submission) → O3 (Routing) → O4 (Tests)
   - Prompt builders must not return `""` before changing submission logic
   - Submission logic must be unified before changing routing
   - Tests updated after all code changes complete

## Deferred Work (Phase 3+)

- Unify all delivery module paths (implementer, meta-review, converged, ask-human) using RolePaneLifecycle
- Create UnifiedPaneDelivery orchestrator
- Remove legacy ports and enable full delivery abstraction

## Risk Assessment

**Low Risk:**
- All changes are internal code structure, no public contracts changed
- Behavior preservation verified via existing test suite
- RolePaneLifecycle abstraction already established in Phase 1

**Mitigation:**
1. Run full test suite after each task
2. Verify fitness checks pass (no boundary violations)
3. Manual smoke test of bubble start/resume with opencode agent

## Validation Strategy

**Per-Task:**
- Typecheck: 0 TypeScript errors
- Lint: 0 linting violations
- Fitness: All architecture checks pass
- Tests: Specific test file passes (e.g., reviewerContext.test.ts)

**Phase Completion:**
- `pnpm test`: Full suite passes (target: 3786 tests)
- `pnpm fitness:check:ci`: No hard-fail violations
- `pnpm typecheck`: Clean
- `pnpm lint`: Clean

## Success Criteria

✅ No `agentName === "opencode"` conditionals remain in production code (excluding comments/docs)
✅ All 4 tasks completed with passing tests
✅ Full test suite passes without regressions
✅ Fitness checks pass with no new violations
✅ Code review confirms behavior preservation

---

## Appendix: Control-Model Stability

**Invariant:** Opencode agent receives full startup prompt context, submitted via tmux after pane readiness, not duplicated during startup.

**Authority:** RolePaneLifecycle abstraction (Phase 1) owns pane activation and readiness checking. Role instruction builders and delivery message formatters own prompt content.

**Forbidden Fallback:** No agent should check its own name to decide whether to submit a prompt. All decisions must flow through abstraction configuration.

**Missing-Data Rule:** If startup prompt is undefined or empty, submission is skipped by RolePaneLifecycle regardless of agent name.
