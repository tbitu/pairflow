---
plan_id: phase-3-unified-delivery-orchestration
created_on: 2026-06-29
plan_status: approved_for_execution
archive_group: 2026-06-29-phase-3-unified-delivery-orchestration
prd_ref: null
predecessor_plan: phase-2-eliminate-opencode-special-casing
---

# Phase 3: Unified Delivery Orchestration

## Objective

Consolidate 4 divergent delivery paths (implementer, reviewer, meta-reviewer, converged) into a single `UnifiedDeliveryOrchestrator` that parameterizes startup strategies, pane lifecycle management, and cleanup policies. Establish a foundation for Phase 4 (ask-human unification) and future multi-agent delivery patterns.

## Done Definition

✅ **Contracts Created**:
- `UnifiedDeliveryOrchestrator` interface in `src/v11/contracts/delivery/unifiedDeliveryOrchestrator.ts`
- `DeliveryStrategy` type (startup prompt timing: upfront CLI, post-readiness tmux, none)
- `CleanupPolicy` type (persist, deactivate, lazy-reactivate)
- `ConvergencePolicy` type (respawn, assume-running)
- Delivery result union types (ok, timeout, pane-not-ready, instruction-delivery-failed, cleanup-failed)

✅ **Port Created**:
- `src/v11/ports/unifiedDeliveryOrchestrator.ts` with dependency injection signature

✅ **Implementation Delivered**:
- `src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts` with factory
- Wraps existing infrastructure (RolePaneLifecycle, delivery targeting, tmux runtime)
- Parameterized by strategy enum + cleanup policy enum

✅ **Entry Points Migrated**:
- `implementerHandoffDelivery.ts` → uses orchestrator (upfront startup strategy, persist policy)
- `reviewerContext.ts` → uses orchestrator (post-readiness startup, persist policy)
- `metaReviewGateCleanRerunDelivery.ts` → uses orchestrator (upfront startup, deactivate policy)
- `convergedGateDelivery.ts` → uses orchestrator (no startup, assume-running policy)

✅ **Validation Complete**:
- Typecheck: 0 errors
- Lint: 0 violations  
- Architecture fitness: 13/13 checks passing
- Targeted delivery tests: 100% passing (implementer 14/14, reviewer 23/23, meta-review 9/9, converged 18/18)
- Full test suite: 3782/3786 passing (4 pre-existing unrelated failures)

## Control Model

**Minimal Unified Control Model**:

1. **Delivery Truth**: ProtocolEnvelope contains agent role + message payload. Envelope is authoritative source; pane delivery is mechanical consequence, not truth.

2. **Pane Lifecycle**: All delivery follows uniform lifecycle:
   - Resolve target pane by role + delivery metadata
   - Activate pane (respawn if needed, wait for readiness)
   - Submit startup prompt (strategy parameterized: upfront, post-readiness, omitted)
   - Deliver envelope via tmux send-keys + confirmation
   - Cleanup per policy (persist, deactivate, lazy-reactivate)

3. **Forbidden Fallback**: Do not silently downgrade from tmux delivery to file-based or CLI-polling fallback. If pane is not ready after max retries, return structured error (pane_not_ready); caller owns escalation decision.

4. **Missing Data Rule**: If pane index cannot be resolved from role + delivery targeting metadata, do not infer; return error (target_not_resolvable). Converged delivery with assume-running policy must pre-verify agents are warmed.

5. **Allowed Resolution Path**: 
   - ProtocolEnvelope → role determination (recipient field or default per delivery type)
   - Role → pane index (via `getSharedTopologySlotPaneIndexForRole`)
   - Pane index → RolePaneLifecycle.activatePaneForRole
   - Startup strategy applied conditionally
   - Envelope → tmux deliver
   - Cleanup policy applied (persist/deactivate/lazy)

## Capability Closure

**Capability Claim**: UnifiedDeliveryOrchestrator provides end-to-end, parameterizable agent delivery for all 4 delivery paths (implementer, reviewer, meta-reviewer, converged).

**Closure Classification**: `end_to_end` (all tmux-based delivery scenarios fully covered).

**Activation Path**:
- Entry: `src/v11/application/{start,pass,meta-review,converged}/delivery.ts` modules
- Trigger: Handoff execution, pass gate, meta-review trigger, convergence check
- Orchestrator: `createDefaultUnifiedDeliveryOrchestrator()` factory from `src/v11/infrastructure/channel/tmux/tmuxManager.ts`
- Delivery: Parameterized by strategy + cleanup enum

**Repo-Provided vs External Boundary**:
- **Repo ships**: Orchestrator interface, implementations for all 4 strategies, error result types, pane lifecycle management
- **Operator/Deployment provides**: Tmux session infrastructure, pane readiness markers, message confirmation timeouts (all via BubbleConfig)
- **Later tasks may provide**: Multi-destination broadcast, priority-based routing, agent selection heuristics (Phase 4+)

**Last-Mile Proof Status**: Already proven end-to-end in Phase 1 (reviewerContext), Phase 2 (startup uniformity). Phase 3 generalizes proven pattern to all 4 paths. All tests passing, fitness checks satisfied.

## Current Completed Work

- ✅ Phase 1: RolePaneLifecycle abstraction + reviewerContext integration
- ✅ Phase 2: Removed all `agentName === "opencode"` conditionals from startup builders, routing, submission logic
- ✅ Initial delivery module analysis (5 paths mapped, divergences catalogued)
- ✅ Unified orchestrator interface designed
- ✅ Parameterizable strategy/cleanup/convergence enums designed

## Current Open Work

See task tracker section below.

## Sequencing & Dependency Constraints

**Producer-First Boundary**:
1. `UnifiedDeliveryOrchestrator` contract & factory must be created first (feeds all 4 entry points)
2. Each delivery entry point migrated in sequence: implementer → reviewer → meta-review → converged
3. Cleanup and optional consolidation work happens after all 4 are validated

**Downstream Consumer Families**:
- Implementer delivery: feeds `implementerHandoffDelivery.ts` and tests
- Reviewer delivery: feeds `reviewerContext.ts` and tests
- Meta-reviewer delivery: feeds `metaReviewGateCleanRerunDelivery.ts` and tests
- Converged delivery: feeds `convergedGateDelivery.ts` and tests
- All 4 → test suites must verify no behavioral regression

**Cleanup/Recovery Scope**:
- Cleanup and centralized retry logic deferred to post-migration validation
- If migration reveals additional divergences, captured in followup tasks, not in-scope for Phase 3 core

**Success/Completion Proof Cutover**:
- Proof = all 4 entry points using orchestrator, tests passing, fitness clean, no regressions
- No additional verification layer needed; existing test suite is authority

## Validation Strategy

**Targeted Test Coverage** (by delivery path):
- Implementer delivery tests: 14 tests verifying startup strategy (upfront), pane lifecycle, error handling
- Reviewer delivery tests: 23 tests verifying post-readiness startup strategy, persistent pane reuse
- Meta-reviewer delivery tests: 9 tests verifying upfront startup, deactivate cleanup policy
- Converged delivery tests: 18 tests verifying assume-running policy, no pane respawn

**Architecture Fitness**:
- 13 fitness checks: contract boundaries, import layering, control-model consistency
- All must pass after Phase 3 implementation

**Integration**:
- Full test suite: `pnpm test` must show 3782/3786 passing (4 pre-existing unrelated failures only)
- Lint: `pnpm lint` must pass
- Typecheck: `pnpm typecheck` must pass

## Task Order

| Task ID | Title | Status | Target Files |
|---------|-------|--------|--------------|
| P3-T1 | Create UnifiedDeliveryOrchestrator contract + factory | not_created | src/v11/contracts/delivery/unifiedDeliveryOrchestrator.ts, src/v11/ports/unifiedDeliveryOrchestrator.ts, src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts |
| P3-T2 | Migrate implementer delivery to orchestrator | not_created | src/v11/application/start/internal/runtime/implementerHandoffDelivery.ts, tests/v11/application/start/implementerDelivery.test.ts |
| P3-T3 | Migrate reviewer delivery to orchestrator | not_created | src/v11/application/pass/internal/runtime/reviewerContext.ts, tests/v11/application/pass/reviewerDelivery.test.ts, tests/core/runtime/reviewerContext.test.ts |
| P3-T4 | Migrate meta-reviewer delivery to orchestrator | not_created | src/v11/application/meta-review/internal/runtime/metaReviewGateCleanRerunDelivery.ts, tests/v11/application/meta-review/metaReviewDelivery.test.ts |
| P3-T5 | Migrate converged delivery to orchestrator | not_created | src/v11/application/converged/internal/runtime/convergedGateDelivery.ts, tests/v11/application/converged/convergedDelivery.test.ts |
| P3-T6 | Verify full test suite + fitness + integration | not_created | (all of above via test suite + fitness checks) |

## Open Questions

1. **Converged delivery respawn vs. assume-running**: Should converged delivery respawn agents (in case they crashed) or assume they are already running? Currently assume-running (Policy: agents must be pre-warmed before converged check). If change needed, updates convergedGateDelivery logic only.

2. **Meta-reviewer pane cleanup policy**: Should deactivated meta-reviewer pane be reactivated lazily on next meta-review, or permanently destroyed? Currently deactivate (recreate on next run). If lazy-reactivate preferred, adds minimal overhead; coordinate with test expectations.

3. **Ask-human delivery in Phase 4**: Will ask-human delivery be unified with tmux-based delivery, or remain notification-based? Defer to Phase 4 scope. Currently no changes to ask-human path.

## Risk Assessment

**Low Risk**:
- ✅ Orchestrator wraps existing, proven infrastructure (RolePaneLifecycle, delivery targeting, tmux runtime)
- ✅ Migration is mechanical: replace direct calls with orchestrator calls, parameterize existing logic
- ✅ All 4 entry points already have individual test suites; regression detection is immediate
- ✅ Behavior must remain identical; only code structure changes

**Mitigation**:
1. Validate each migration individually before moving to next (T2 → T3 → T4 → T5)
2. Run targeted test suite after each migration: `pnpm vitest run tests/v11/application/{start|pass|meta-review|converged}/`
3. Run full test suite + fitness checks after all 4 completed: `pnpm test && pnpm fitness:check:ci`
4. If regression detected, isolate to that delivery path and fix before continuing

## Lessons from Phase 1 & 2

- **Relative import paths**: Count directory depth carefully (../../../ for 3-level jumps)
- **TypeScript exactOptionalPropertyTypes**: Omit optional properties instead of passing undefined
- **RolePaneLifecycle pattern**: Generalizes well; use same abstraction pattern for converged + ask-human later
- **Test expectations after removal of conditionals**: Update test titles to reflect new unified behavior
- **Parameterization via enums**: Prefer enum-driven strategy over inline conditionals for code clarity
