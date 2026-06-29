---
task_id: P3-T1
plan_id: phase-3-unified-delivery-orchestration
title: Create UnifiedDeliveryOrchestrator contract + factory
created_on: 2026-06-29
effort_estimate_hours: 3
target_files:
  - src/v11/contracts/delivery/unifiedDeliveryOrchestrator.ts
  - src/v11/ports/unifiedDeliveryOrchestrator.ts
  - src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts
  - src/v11/infrastructure/channel/tmux/tmuxManager.ts (update exports)
---

# P3-T1: Create UnifiedDeliveryOrchestrator Contract + Factory

## L0: Objective

Establish the unified delivery orchestrator interface and factory implementation that parameterizes delivery strategies (upfront startup, post-readiness startup, none) and cleanup policies (persist, deactivate, lazy-reactivate). This becomes the single entry point for all 4 delivery paths (implementer, reviewer, meta-reviewer, converged).

## L1: Scope & Boundaries

**What This Task Creates**:
1. `UnifiedDeliveryOrchestrator` interface: Single method `deliverToRole(input)` returning parameterized DeliveryResult
2. Enum types: `StartupStrategy` (upfront_cli, post_readiness_tmux, none), `CleanupPolicy` (persist, deactivate, lazy_reactivate), `ConvergencePolicy` (respawn, assume_running)
3. Result union: DeliveryResult = success | timeout | pane_not_ready | instruction_delivery_failed | cleanup_failed
4. Factory: `createDefaultUnifiedDeliveryOrchestrator()` that wraps RolePaneLifecycle, delivery targeting, tmux runtime

**What This Task Does NOT Do**:
- Does not migrate any entry points (implementer, reviewer, meta-review, converged) — that's P3-T2 through P3-T5
- Does not change existing test suites — validation happens in migration tasks
- Does not add new delivery targeting logic (reuses existing tmuxDeliveryTargeting)
- Does not add observable telemetry; basic logging only for debugging

**Touched Entrypoints**:
- `src/v11/infrastructure/channel/tmux/tmuxManager.ts`: Add exports for new orchestrator

**Integration Points**:
- Imports from: RolePaneLifecycle (from Phase 1), tmuxDeliveryTargeting, tmuxDeliveryRuntime, ProtocolEnvelope types
- Consumed by: P3-T2/T3/T4/T5 (delivery module migrations)
- Test validated by: P3-T6 (via indirect validation through migrated entry point tests)

## L1: Data Contract (Canonical)

### Input: `UnifiedDeliveryOrchestratorInput`

```typescript
{
  bubbleId: string;                    // Bubble identifier
  envelope: ProtocolEnvelope;          // Message payload + metadata
  bubbleConfig: BubbleConfig;          // Pane readiness config, timeouts
  sessionsPath: string;                // Tmux sessions registry directory
  role?: AgentRole;                    // "implementer" | "reviewer" | "meta_reviewer" (optional; defaults based on envelope)
  
  // Strategy parameters (mutually configured, not per-delivery):
  strategy: StartupStrategy;           // Enum: "upfront_cli", "post_readiness_tmux", "none"
  cleanupPolicy: CleanupPolicy;        // Enum: "persist", "deactivate", "lazy_reactivate"
  convergencePolicy?: ConvergencePolicy; // Enum: "respawn", "assume_running" (optional; defaults to respawn)
  
  runner?: TmuxRunner;                 // Optional tmux runner override for testing
}
```

### Output: `DeliveryResult` (Union Type)

```typescript
type DeliveryResult =
  | { ok: true; resultCode: "delivery_ok" }
  | { ok: false; reason: "pane_not_ready"; maxRetryAttempts: number; lastError: string }
  | { ok: false; reason: "instruction_delivery_failed"; envelope: ProtocolEnvelope; underlyingError: unknown }
  | { ok: false; reason: "cleanup_failed"; afterDeliveryOk: boolean; cleanupError: unknown }
  | { ok: false; reason: "timeout"; phase: "readiness" | "confirmation"; durationMs: number };
```

### Enum Definitions

```typescript
enum StartupStrategy {
  UpfrontCli = "upfront_cli",           // Submit prompt at pane start (implementer, meta-reviewer)
  PostReadinessTmux = "post_readiness_tmux", // Submit via tmux after pane ready (reviewer)
  None = "none"                        // No prompt submission (converged, ask-human future)
}

enum CleanupPolicy {
  Persist = "persist",                 // Keep pane alive for reuse (implementer, reviewer)
  Deactivate = "deactivate",           // Deactivate pane after delivery (meta-reviewer)
  LazyReactivate = "lazy_reactivate"   // Deactivate but allow reactivation (future)
}

enum ConvergencePolicy {
  Respawn = "respawn",                 // Activate pane (respawn if needed)
  AssumeRunning = "assume_running"     // Assume pane already running; no respawn
}
```

## L1: Behavioral Contracts

### Unified Delivery Lifecycle

```
Input → Resolve Role from Envelope or Param
       ↓
       Resolve Pane Index (via tmuxDeliveryTargeting)
       ↓
       Activate Pane (via RolePaneLifecycle.activatePaneForRole)
         - ConvergencePolicy.AssumeRunning: skip activation, verify readiness only
         - ConvergencePolicy.Respawn: full activation (respawn + readiness)
       ↓
       Apply Startup Strategy:
         - UpfrontCli: prompt already in pane startup CLI args (no-op here)
         - PostReadinessTmux: submit via RolePaneLifecycle or submitStartupPrompt
         - None: skip
       ↓
       Deliver Envelope (tmux send-keys + wait confirmation)
       ↓
       Apply Cleanup Policy:
         - Persist: pane remains active
         - Deactivate: call tmux kill-pane or pane deactivation marker
         - LazyReactivate: deactivate but allow reactivation next time
       ↓
       Return DeliveryResult (ok | error with reason)
```

### Error Semantics

1. **pane_not_ready**: After max retries, pane never signaled readiness marker. Caller may escalate (alert, retry later, abort handoff).
2. **instruction_delivery_failed**: Tmux send-keys or confirmation check failed. Likely pane crashed or tmux session lost.
3. **cleanup_failed**: Delivery succeeded, but cleanup (deactivate/lazy-reactivate) failed. Delivery considered ok; cleanup error is advisory.
4. **timeout**: Readiness poll or confirmation check exceeded configured timeout. Caller may retry or escalate.

### No-Op Contracts

- **If strategy=None and startup prompt required**: Caller is responsible for providing prompt via CLI args at pane start. Orchestrator skips submission.
- **If convergencePolicy=AssumeRunning and pane not ready**: Return error immediately; do not attempt respawn.
- **If envelope missing recipient and role not provided**: Cannot resolve pane index; return error.

## L2: Implementation Details

### Factory: `createDefaultUnifiedDeliveryOrchestrator()`

```typescript
export function createDefaultUnifiedDeliveryOrchestrator(input: {
  rolePaneLifecycle: RolePaneLifecycle;
  // (could add override ports in future for advanced use cases)
}): UnifiedDeliveryOrchestrator {
  return {
    async deliverToRole(input): Promise<DeliveryResult> {
      // 1. Resolve role from envelope.recipient or param
      // 2. Resolve pane index via getSharedTopologySlotPaneIndexForRole
      // 3. Activate pane (conditional on convergencePolicy)
      // 4. Apply startup strategy
      // 5. Deliver envelope
      // 6. Apply cleanup policy
      // 7. Return result
      
      // Each step wrapped in try-catch mapping to appropriate DeliveryResult variant
    }
  };
}
```

### File Structure

| File | Responsibility |
|------|-----------------|
| `src/v11/contracts/delivery/unifiedDeliveryOrchestrator.ts` | Interface definition + enum types + result union |
| `src/v11/ports/unifiedDeliveryOrchestrator.ts` | Port definition for DI + re-exports |
| `src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts` | Factory + implementation logic |
| `src/v11/infrastructure/channel/tmux/tmuxManager.ts` | Export factory from this hub |

### Import Path Strategy

- From contract → port: `../../contracts/delivery/unifiedDeliveryOrchestrator`
- From defaults → contract: `../../../contracts/delivery/unifiedDeliveryOrchestrator`
- From defaults → existing infrastructure: relative to tmux folder (e.g., `./rolePaneLifecycleDefaults.ts`, `./tmuxDeliveryRuntime.ts`)

## L2: Testing Strategy (Indirect Validation)

This task is validated indirectly through P3-T2 through P3-T5, where orchestrator is integrated into each delivery path and existing test suites verify no regressions.

**Validation checklist** (performed in P3-T6):
- ✅ Typecheck: No TS errors
- ✅ Lint: No violations
- ✅ Fitness: 13/13 checks passing
- ✅ Implementer delivery tests: 14/14 passing
- ✅ Reviewer delivery tests: 23/23 passing
- ✅ Meta-reviewer delivery tests: 9/9 passing
- ✅ Converged delivery tests: 18/18 passing

## L2: Dependencies & Assumptions

**Prerequisites**:
- ✅ Phase 1 complete: RolePaneLifecycle exists and is imported correctly
- ✅ Phase 2 complete: Startup prompt builders unified; ready for parameterized submission

**Assumptions**:
1. RolePaneLifecycle.activatePaneForRole already handles all respawn + readiness logic correctly (no changes needed)
2. ProtocolEnvelope structure with `recipient` field is stable (P1-confirmed)
3. TmuxRunner and session registry structure unchanged (infra-stable)
4. BubbleConfig.paneReadinessConfig already contains all needed timeout/retry params

**Known Constraints**:
- Converged delivery assumes agents are pre-warmed before orchestrator is called (caller responsibility)
- Ask-human delivery not included in this phase (deferred to Phase 4)
- No message queuing or broadcast; single-destination only

## Completion Checklist

- [ ] Create `src/v11/contracts/delivery/unifiedDeliveryOrchestrator.ts` with interface, enums, result types
- [ ] Create `src/v11/ports/unifiedDeliveryOrchestrator.ts` with port definition
- [ ] Create `src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts` with factory
- [ ] Update `src/v11/infrastructure/channel/tmux/tmuxManager.ts` to export factory + types
- [ ] Verify `pnpm typecheck` passes (0 errors)
- [ ] Verify `pnpm lint` passes (0 violations)
- [ ] Verify `pnpm fitness:check:ci` passes (13/13)
- [ ] Mark task complete; proceed to P3-T2 (implementer delivery migration)
