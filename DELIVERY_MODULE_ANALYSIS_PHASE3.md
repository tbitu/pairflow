# Delivery Module Structure Analysis for Phase 3 Planning

**Date**: 2026-06-29  
**Scope**: All delivery module paths currently in the codebase  
**Purpose**: Foundation for unified delivery abstraction in Phase 3

---

## 1. DELIVERY PATHS INVENTORY

### 1.1 Implementer Delivery
**Location**: [src/v11/shared/delivery/implementerHandoffDelivery.ts](src/v11/shared/delivery/implementerHandoffDelivery.ts)

**Entry Points**:
- `executeImplementerHandoffDelivery()` - Main handoff function
- `shouldRetryImplementerHandoffDelivery()` - Determines if retry is needed

**How Implementer Agent is Invoked**:
```
Pass workflow → executeImplementerHandoffDelivery()
→ emitDelivery port (tmux-based)
→ Direct protocol envelope delivery to implementer pane
```

**Characteristics**:
- **Startup Prompt**: Built into agent command line (passed via CLI arg)
- **Pane Lifecycle**: Uses `RolePaneLifecycle` abstraction (see 1.5 below)
  - Pane respawned with new command
  - Waits for pane readiness (opencode startup marker)
  - Command: `buildAgentCommand()` with role="implementer"
- **State Before Delivery**: Implementer pane must exist (created at bubble start)
- **State After Delivery**: Pane remains active for next phase
- **Error Handling**: 
  - Retries once if `no_runtime_session`, `delivery_unconfirmed`, or `command_failed`
  - Uses `initialDelayMs: 30000` and `deliveryAttempts: 6` on retry
- **Agent-Specific Conditionals**: None currently; uses generic delivery targeting

**Delivery Targeting**:
- Resolved via [tmuxDeliveryTargeting.ts](src/v11/infrastructure/channel/tmux/tmuxDeliveryTargeting.ts)
- Recipient → `deliveryTargetRole("implementer")` → pane index from topology
- Falls back to agent config if metadata absent

---

### 1.2 Reviewer Delivery
**Location**: [src/v11/infrastructure/channel/tmux/reviewerContext.ts](src/v11/infrastructure/channel/tmux/reviewerContext.ts)

**Entry Point**:
- `refreshReviewerContext()` - Activate reviewer, submit startup prompt

**How Reviewer Agent is Invoked**:
```
Pass validation → refreshReviewerContext()
→ RolePaneLifecycle.activatePaneForRole("reviewer")
→ Respawn pane with reviewer command
→ Wait for readiness
→ Send startup prompt via tmux send-keys
```

**Characteristics**:
- **Startup Prompt**: 
  - Delivered separately after pane readiness via `submitReviewerStartupPrompt()`
  - Uses `sendAndSubmitTmuxPaneMessage()` (tmux send-keys, not paste)
  - Default delay: 1500ms after readiness before submitting
- **Pane Lifecycle**: 
  - Uses unified `RolePaneLifecycle` (already adopted)
  - Entry point: `createDefaultRolePaneLifecycle()`
  - Calls `activatePaneForRole()` → respawn → wait for ready → return paneIndex
- **State Before Delivery**: Reviewer pane must exist (created at bubble start)
- **State After Delivery**: Pane idle, ready for next phase
- **Error Handling**: 
  - Maps lifecycle errors to `RefreshReviewerContextResult` reasons:
    - `respawn_failed` → `tmux_respawn_failed`
    - `readiness_timeout` → `readiness_timeout`
- **Dependencies**:
  - `readRuntimeSessionsRegistry()` - Get session metadata
  - `resolveRuntimeSessionWorkspaceAuthority()` - Resolve workspace path
  - `buildAgentCommand()` - Build reviewer agent command
  - Role MCP policy from `DEFAULT_ROLE_MCP_POLICY_BY_ROLE`

---

### 1.3 Meta-Reviewer Delivery (Clean Rerun)
**Location**: [src/v11/application/metaReviewGate/internal/cleanRerun/metaReviewGateCleanRerunDelivery.ts](src/v11/application/metaReviewGate/internal/cleanRerun/metaReviewGateCleanRerunDelivery.ts)

**Entry Point**:
- `buildCleanRerunRuntimeDelivery()` - Construct runtime delivery state
- `deactivateCleanRerunMetaReviewerPane()` - Tear down meta-reviewer pane

**How Meta-Reviewer Agent is Invoked**:
```
Converged flow → FinalizeCurrentRunMetaReviewGateInput
→ resolvePaneWarning() (calls meta-reviewer agent)
→ paneResult.delivery captured
→ buildCleanRerunRuntimeDelivery() records delivery state
→ deactivateCleanRerunMetaReviewerPane() cleanup
```

**Characteristics**:
- **Startup Prompt**: 
  - Managed by `metaReviewGateRuntimeCapabilities` (ref line 84: `startupPrompt?: string`)
  - Submitted during pane activation (not shown in this file, happens in calling flow)
- **Pane Lifecycle**: 
  - Uses `RolePaneLifecycle` for activation (implied via call site)
  - After delivery completes, pane is **deactivated** (not persisted like implementer/reviewer)
  - `setMetaReviewerPane()` called with `active: false`
- **State Before Delivery**: Meta-reviewer pane created on-demand for clean rerun
- **State After Delivery**: Pane deactivated and binding cleared
- **Error Handling**: 
  - `deactivateCleanRerunMetaReviewerPane()` catches errors and returns reason string
  - Deactivation errors appended to delivery message via `withDeactivateTelemetryOnDelivery()`
- **Pane Binding**: 
  - Uses `setMetaReviewerPane()` from [metaReviewerPaneBinding.ts](src/v11/infrastructure/channel/tmux/metaReviewerPaneBinding.ts)
  - Stores binding in runtime sessions registry
  - Checks for pane collision with status/implementer panes

---

### 1.4 Converged Delivery
**Location**: [src/v11/application/converged/internal/gate/convergedGateDelivery.ts](src/v11/application/converged/internal/gate/convergedGateDelivery.ts)

**Entry Point**:
- (Multiple) Converged orchestration → `emitDeliveryNotificationAck` port
- Delivers via `executeImplementerHandoffDelivery()` for implementer/reviewer/meta-reviewer

**How Agents are Invoked**:
```
Agents converge (implementer, reviewer, meta-reviewer)
→ Gate delivery routes each protocol message to correct recipient
→ Delivery target role resolved from:
  1. Explicit metadata (deliveryTargetRoleMetadataKey)
  2. Recipient agent name → agent config role mapping
  3. Legacy "meta_reviewer" recipient literal
  4. Fallback to compatible primary roles (implementer, reviewer only)
→ executeImplementerHandoffDelivery() for actual pane delivery
```

**Characteristics**:
- **Startup Prompt**: Not submitted; converged agents already running
- **Pane Lifecycle**: Already established (implementer/reviewer created at start, meta-reviewer on-demand)
- **State Before Delivery**: All agents already active in their panes
- **State After Delivery**: Agents remain in place
- **Error Handling**: 
  - Retry logic delegated to `executeImplementerHandoffDelivery()`
  - Normalizes delivery ACK to `ConvergedDeliveryResult` (status, reason, reason_code, retried)
- **Delivery Targeting**: 
  - Primary logic: `resolveConvergedDeliveryTargetRole()` 
  - Parses envelope metadata, falls back to agent-role mapping
  - Supports both explicit delivery target role and implicit agent identity fallback
- **Agent-Specific Conditionals**: 
  - Only `compatPrimaryDeliveryRoles = ["implementer", "reviewer"]` get role-mapped fallback
  - Meta-reviewer requires explicit recipient or metadata; no agent-name-only fallback

---

### 1.5 Ask-Human Delivery
**Location**: [src/v11/application/askHuman/internal/delivery/askHumanDeliveryPortsContract.ts](src/v11/application/askHuman/internal/delivery/askHumanDeliveryPortsContract.ts)

**Entry Point**:
- `EmitAskHumanBubbleNotificationPort` type
- Emitted from `emitBubbleNotification` port in askHuman command flow

**How Human is Asked for Input**:
```
AskHuman command → notification emission
→ emitBubbleNotification(config, kind)
→ External notification system (not tmux-based)
→ kind: "waiting-human" | "converged"
```

**Characteristics**:
- **Startup Prompt**: N/A (no pane involved)
- **Pane Lifecycle**: None; this is bubble-level notification, not pane-based
- **State Before Delivery**: Human notification system available
- **State After Delivery**: Notification sent; human expected to respond externally
- **Error Handling**: Generic async error handling (port returns `unknown`)
- **Delivery Targeting**: 
  - Config-driven (no pane targeting)
  - Kind determines notification type (human waiting vs. agents converged)

---

## 2. SHARED DELIVERY INFRASTRUCTURE

### 2.1 RolePaneLifecycle Abstraction
**Location**: [src/v11/shared/channel/rolePaneLifecycle.ts](src/v11/shared/channel/rolePaneLifecycle.ts)

**Definition**:
```typescript
interface RolePaneLifecycle {
  activatePaneForRole(input: {
    sessionName: string;
    role: AgentRole;
    command: string;
    cwd: string;
    runner: TmuxRunner;
  }): Promise<PaneLifecycleResult>;

  isPaneReady(input: {
    sessionName: string;
    paneIndex: number;
    runner: TmuxRunner;
  }): Promise<boolean>;

  getPaneIndexForRole(role: AgentRole): number;

  getReadinessConfig(): PaneReadinessConfig;
}
```

**Lifecycle Contract**:
1. Pane exists for entire bubble lifetime (created at bubble start)
2. On each handoff to a role:
   - Respawn pane with new command (kills old process)
   - Wait for pane readiness marker (opencode startup indicator)
   - Send startup prompt via tmux send-keys
3. Between handoffs: Pane remains idle
4. On cleanup: Pane killed with session

**Current Usage**:
- ✅ **reviewerContext.ts**: `createDefaultRolePaneLifecycle()` → `activatePaneForRole("reviewer")`
- ✅ **implementerHandoffDelivery.ts**: Implicitly via tmux delivery targeting (pane index resolved)
- ✅ **metaReviewGateCleanRerunDelivery.ts**: Implied in calling flow
- ❓ **Converged delivery**: Uses via `executeImplementerHandoffDelivery()` → tmux targeting

**Default Implementation**:
- [src/v11/infrastructure/channel/tmux/rolePaneLifecycleDefaults.ts](src/v11/infrastructure/channel/tmux/rolePaneLifecycleDefaults.ts)
- `createDefaultRolePaneLifecycle()` factory
- Uses tmux respawn, readiness polling, and sender utilities

**Pane Readiness Config**:
```typescript
interface PaneReadinessConfig {
  respawnWarmupMs: number;     // 0ms (check immediately)
  markerSettleMs: number;       // 300ms (opencode startup latency)
  maxRetryAttempts: number;     // 20 (covers ~6 sec retry window)
  retryDelayMs: number;         // 300ms (between attempts)
}
```

---

### 2.2 Tmux Delivery Runtime Mechanics
**Location**: [src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.ts](src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.ts)

**Delivery Execution Flow**:
```
attemptTmuxDelivery(input: {
  runner: TmuxRunner;
  targetPane: string;
  message: string;
  initialDelayMs?: number;
  deliveryAttempts?: number;
  ...
}) → DeliveryAck
```

**Key Functions**:
- `readDeliverySessionContext()` - Load session from registry
- `ensureOpencodePaneReady()` - Quick probe → fallback respawn → extended probe
- `attemptTmuxDelivery()` - Send message + confirm delivery marker
- `confirmTmuxPaneMarkerSubmission()` - Poll for marker (3 attempts, 300ms each)

**Message Submission Path**:
1. Initial delay (default varies)
2. `sendAndSubmitTmuxPaneMessage()` to target pane
3. Poll for marker confirmation (up to `deliveryAttempts`)
4. Return `AcceptedDeliveryAck` or `RejectedDeliveryAck`

**Error Handling**:
- No session found → `rejected` + `no_runtime_session`
- Marker not confirmed → `rejected` + `delivery_unconfirmed`
- Command error → `rejected` + `command_failed`

---

### 2.3 Delivery Targeting & Routing
**Location**: [src/v11/infrastructure/channel/tmux/tmuxDeliveryTargeting.ts](src/v11/infrastructure/channel/tmux/tmuxDeliveryTargeting.ts)

**Targeting Logic**:
```
resolveEnvelopeTargetPane(envelope, bubbleConfig, explicitRecipientRole?)
→ EnvelopeTargetPaneResolution {
    targetPaneIndex: number | undefined;
    recipientRole: DeliveryMessageRecipientRole;
    deliveryTargetReasonCode?: DeliveryTargetReasonCode;
  }
```

**Resolution Order**:
1. **Explicit recipient role** (if provided as param) → pane index
2. **Envelope metadata** (`deliveryTargetRoleMetadataKey`) → parse and map to pane
3. **Recipient agent/literal**:
   - `"human"`, `"orchestrator"` → `"status"` pane
   - `"meta_reviewer"` (legacy) → `"meta_reviewer"` pane
   - Agent name → agent → role mapping (if unique in config)
4. **Fallback** → undefined pane + reason code

**Pane Index Resolution**:
- Uses `getSharedTopologySlotPaneIndexForRole()` for role-based panes
- Uses `getSharedTopologySlotPaneIndex("status")` for status pane
- Defined in [src/v11/shared/topology/topologySlotPaneProjection.ts](src/v11/shared/topology/topologySlotPaneProjection.ts)

**Reason Codes** (when targeting fails):
- `DELIVERY_TARGET_ROLE_ABSENT` - No metadata, no agent mapping
- `DELIVERY_TARGET_ROLE_INVALID` - Malformed metadata
- `DELIVERY_TARGET_ROLE_UNMAPPED` - Role → pane mapping failed
- `DELIVERY_TARGET_REGISTRY_READ_FAILED` - Session registry error

---

### 2.4 Startup Prompt Logic
**Location**: [src/v11/shared/role/prompts/rolePromptConcernIds.ts](src/v11/shared/role/prompts/rolePromptConcernIds.ts) and [src/v11/shared/command/startupPromptGate.ts](src/v11/shared/command/startupPromptGate.ts)

**Prompt Concern IDs** (per role):
- **Implementer**: `STARTUP_IMPLEMENTER_PRIORITY`, `STARTUP_IMPLEMENTER_CONTEXT_ASSEMBLY`, ...
- **Reviewer**: `STARTUP_REVIEWER_PROMPT`, `STARTUP_REVIEWER_BRIEF`, ...
- **Meta-Reviewer**: `STARTUP_META_REVIEWER_TASK`, `STARTUP_META_REVIEWER_CONFLICT`, ...

**Submission Modes**:
- **Implementer/Meta-Reviewer**: Built into agent command line (CLI arg)
- **Reviewer**: Submitted post-pane-readiness via `sendAndSubmitTmuxPaneMessage()`

**Gate Logic**:
```typescript
shouldSubmitStartupPrompt(ports): boolean
  // Returns true if startup submission supported
```

---

### 2.5 Tmux Message Building
**Location**: [src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts](src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts)

**Message Construction**:
```
buildTmuxDeliveryMessage(input: {
  envelope: ProtocolEnvelope;
  messageRef?: string;
  bubbleConfig: BubbleConfig;
  reviewerTestDirective?: ReviewerTestExecutionDirective;
  reviewerBrief?: string;
  reviewerFocus?: ReviewerFocusExtractionResult;
}) → string
```

**Recipients** (DeliveryMessageRecipientRole):
- `"implementer"` | `"reviewer"` | `"meta-reviewer"` | other string (fallback)

**Special Logic**:
- Reviewer: Injects brief and focus extraction if provided
- Test mode: Includes reviewer test directive if present
- Message ref: Resolved from envelope refs or built from transcript fallback

---

## 3. CURRENT PATTERNS & DIVERGENCES

### 3.1 Commonalities Across All Delivery Paths

| Pattern | Implementer | Reviewer | Meta-Reviewer | Converged | Ask-Human |
|---------|------------|----------|--------------|-----------|-----------|
| **Entry Point Type** | Shared function | Pane refresh | Pane delivery+deactivate | Gate delivery | Bubble notify |
| **Session Registry** | ✅ Used | ✅ Used | ✅ Used | ✅ Used (via impl) | ❌ N/A |
| **Delivery Targeting** | ✅ Via recipient | ✅ Role literal | ✅ Via agent | ✅ Metadata-first | ❌ N/A |
| **Error Handling** | Retry + fail | Map errors | Append telemetry | Retry + fail | Generic async |
| **State Persistence** | Runtime reg | Runtime reg | Runtime reg | Runtime reg | Config-based |

### 3.2 Divergences in Pane Lifecycle Management

| Aspect | Implementer | Reviewer | Meta-Reviewer | Converged |
|--------|------------|----------|--------------|-----------|
| **Pane Creation** | Bubble start | Bubble start | On-demand | Bubble start |
| **Pane Persistence** | ✅ Persistent (across phases) | ✅ Persistent | ❌ Temporary (deactivated) | ✅ Persistent |
| **Respawn Behavior** | Implicit via delivery | Explicit: `RolePaneLifecycle.activatePaneForRole()` | Implicit in flow | Implicit via delivery |
| **Startup Prompt Timing** | CLI arg (upfront) | Post-readiness (async) | CLI arg (upfront) | N/A (already running) |
| **Pane Binding Registry** | ❌ None | ❌ None | ✅ `RuntimeMetaReviewerPaneBinding` | ❌ None |

### 3.3 Startup Prompt Submission Patterns

**Pattern A: CLI Argument (Implementer, Meta-Reviewer)**
```
buildAgentCommand(..., startupPrompt: "...prompt...")
→ Command includes prompt as last argument
→ Pane launched with prompt already in context
```
**Pros**: Atomic; prompt available immediately  
**Cons**: Cannot adjust after pane start; large command line

**Pattern B: Post-Readiness (Reviewer)**
```
activatePaneForRole(...)
→ Wait for readiness marker
→ sendAndSubmitTmuxPaneMessage(..., prompt)
→ Pane accepts input after warmup
```
**Pros**: Flexible; can condition on readiness; smaller command line  
**Cons**: Async submission window; potential timing issues

---

## 4. MINIMAL UNIFIED ABSTRACTION PROPOSAL

### 4.1 Target State: Unified Delivery Orchestrator

**Goal**: Replace 5 divergent entry points with single abstraction.

**Proposed Interface**:
```typescript
interface UnifiedDeliveryOrchestrator {
  /**
   * Route and deliver to agent pane or human notification system.
   * Handles pane lifecycle, startup prompt, message delivery, cleanup.
   */
  deliverToRole(input: {
    bubbleId: string;
    envelope: ProtocolEnvelope;
    bubbleConfig: BubbleConfig;
    sessionsPath: string;
    role?: DeliveryTargetRole;  // explicit override
    runner?: TmuxRunner;        // optional test injection
  }): Promise<DeliveryResult>;
}

interface DeliveryResult {
  status: "accepted" | "rejected";
  sessionName?: string;
  targetPaneIndex?: number;
  reason?: string;
  reason_code?: string;
  retried?: boolean;
  // For ask-human: notification kind
  notificationKind?: "waiting-human" | "converged";
}
```

### 4.2 Consolidation Strategy

**Phase 3.1: Unify Pane-Based Deliveries** (Implementer, Reviewer, Meta-Reviewer, Converged)
```
Current:
  executeImplementerHandoffDelivery()  }
  refreshReviewerContext()             } → 4 entry points
  metaReviewGateCleanRerunDelivery()   }
  convergedGateDelivery()              }

Unified:
  DeliveryOrchestrator.deliverToRole()  → 1 entry point
    ├─ resolveTargetRole()
    ├─ activatePane() or skipPane() (if already running)
    ├─ deliverMessage()
    └─ cleanupPane() or skipCleanup()
```

**Phase 3.2: Extend for Ask-Human** (if notification system is tmux-based in future)
```
Current:
  EmitAskHumanBubbleNotificationPort  → External system

Future Option:
  DeliveryOrchestrator.deliverToRole(role: "human")
    → Route to ask-human notification port
    → Consistent error handling & telemetry
```

### 4.3 Abstraction Layers

**Layer 1: Delivery Targeting** (already shared)
- `resolveEnvelopeTargetPane()` - Generic (reuse as-is)
- `resolveTargetRole()` - Extract from receiver-specific logic

**Layer 2: Pane Lifecycle Management** (already shared via `RolePaneLifecycle`)
- `activatePaneForRole()` - Already unified ✅
- `isPaneReady()` - Reuse for all pane-based roles
- `getPaneIndexForRole()` - Reuse

**Layer 3: Delivery Mechanics** (already shared)
- `attemptTmuxDelivery()` - Generic (reuse for all tmux targets)
- `sendAndSubmitTmuxPaneMessage()` - Generic (reuse for all message sends)

**Layer 4: Startup Prompt Handling** (needs unification)
- **Problem**: Implementer/Meta-Reviewer use CLI arg; Reviewer uses post-readiness
- **Solution**: Extract to configurable strategy:
  ```typescript
  interface StartupPromptStrategy {
    shouldSubmit(role: AgentRole): boolean;
    submitMode(role: AgentRole): "cli-arg" | "post-readiness";
    buildPrompt(input: StartupPromptInput): string;
  }
  ```

**Layer 5: Pane Persistence & Cleanup** (needs unification)
- **Problem**: Meta-reviewer deactivates; others persist
- **Solution**: Parameterize cleanup:
  ```typescript
  interface PaneCleanupPolicy {
    deactivateAfterDelivery(role: AgentRole): boolean;
    cleanupStrategy(role: AgentRole): "persist" | "deactivate" | "none";
  }
  ```

### 4.4 File Consolidation Plan

**Minimal set of new/changed files**:
1. **`src/v11/shared/delivery/unifiedDeliveryOrchestrator.ts`** (new)
   - Core orchestration logic (combines implementations)
   - Entry point for Phase 3 callers

2. **`src/v11/infrastructure/channel/tmux/unifiedDeliveryDefaults.ts`** (new)
   - Default strategies for startup prompts, cleanup, timing

3. **`src/v11/shared/delivery/deliveryStartupPromptStrategy.ts`** (new)
   - Abstraction for startup prompt submission modes

4. **Refactors** (no new files, consolidate existing):
   - `tmuxDeliveryRuntime.ts` - Extract `attemptTmuxDelivery()` into port interface
   - `reviewerContext.ts` - Adopt unified orchestrator
   - `implementerHandoffDelivery.ts` - Delegate to unified orchestrator
   - `convergedGateDelivery.ts` - Delegate to unified orchestrator

---

## 5. RISK ASSESSMENT & BLOCKERS

### 5.1 Known Complexities

| Area | Issue | Impact | Mitigation |
|------|-------|--------|-----------|
| **Startup Prompt Timing** | Implementer (CLI) vs. Reviewer (post-readiness) | Different submission windows | Parameterize via strategy pattern |
| **Meta-Reviewer Lifecycle** | Pane deactivation vs. persistence | Divergent cleanup | Parameterize cleanup policy |
| **Ask-Human System** | Not tmux-based (bubble notifications) | Can't unify with pane delivery | Keep separate; align error contract only |
| **Delivery Retry Logic** | Implementer retries; others don't (currently) | Inconsistent resilience | Lift retry to orchestrator layer |
| **Role-Specific Prompts** | Role-specific concern IDs | Needs role context in strategy | Pass role to strategy methods |

### 5.2 Remaining Questions for Phase 3

1. **Should converged delivery reuse implementer pane lifecycle**, or does it need a different model?
   - Current: Agents already running; no respawn needed
   - Option A: Skip pane activation if agent already running
   - Option B: Always respawn (replaces process) for consistency

2. **Should meta-reviewer pane be persistent** (like implementer/reviewer) or temporary (current)?
   - Current: Deactivated after clean rerun
   - Option A: Persist for future uses (lazy reactivation)
   - Option B: Keep temporary (current design)

3. **Is ask-human delivery fundamentally different**, or will it become tmux-based in Phase 4?
   - Current: Bubble notification (external system)
   - Plan: Confirm whether Phase 4 adds tmux pane delivery for human

4. **Should startup prompt submission modes be runtime-configurable** (for testing) or fixed per role?
   - Current: Fixed at build time (CLI arg vs. post-readiness)
   - Option: Allow test overrides in delivery input

---

## 6. RECOMMENDED NEXT STEPS

### 6.1 Phase 3 Scope (Unified Orchestrator)

**Must-Have**:
1. ✅ Extract common delivery targeting logic (already done via `tmuxDeliveryTargeting.ts`)
2. ✅ Consolidate RolePaneLifecycle usage (already adopted in `reviewerContext.ts`)
3. 🔄 Create `UnifiedDeliveryOrchestrator` interface
4. 🔄 Migrate pane-based deliveries to use orchestrator
5. 🔄 Add integration tests for each delivery path through unified entry point

**Should-Have**:
- Parameterized startup prompt strategy
- Parameterized cleanup policy
- Telemetry/observability for each delivery type

**Nice-to-Have**:
- Ask-human integration (if time permits; else defer to Phase 4)

### 6.2 Phase 3 Validation

**Per-Delivery Tests**:
- [ ] Implementer delivery via orchestrator
- [ ] Reviewer delivery via orchestrator
- [ ] Meta-reviewer delivery via orchestrator
- [ ] Converged delivery via orchestrator
- [ ] Ask-human delivery (separate port, if applicable)

**Edge Cases**:
- [ ] Pane readiness timeout → retry logic
- [ ] Session registry unavailable
- [ ] Role targeting ambiguity (multiple agents per role)
- [ ] Startup prompt delivery timing issues

---

## 7. FILE REFERENCE GUIDE

### Delivery Entry Points
| Path | Purpose |
|------|---------|
| `src/v11/shared/delivery/implementerHandoffDelivery.ts` | Implementer delivery orchestration |
| `src/v11/infrastructure/channel/tmux/reviewerContext.ts` | Reviewer pane refresh & delivery |
| `src/v11/application/metaReviewGate/internal/cleanRerun/metaReviewGateCleanRerunDelivery.ts` | Meta-reviewer delivery & cleanup |
| `src/v11/application/converged/internal/gate/convergedGateDelivery.ts` | Converged agent routing |
| `src/v11/application/askHuman/internal/delivery/askHumanDeliveryPortsContract.ts` | Ask-human notification port |

### Core Infrastructure
| Path | Purpose |
|------|---------|
| `src/v11/shared/channel/rolePaneLifecycle.ts` | Unified pane lifecycle abstraction |
| `src/v11/infrastructure/channel/tmux/rolePaneLifecycleDefaults.ts` | Default RolePaneLifecycle impl |
| `src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.ts` | Low-level tmux delivery mechanics |
| `src/v11/infrastructure/channel/tmux/tmuxDeliveryTargeting.ts` | Delivery targeting & routing |
| `src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts` | Message construction |

### Topology & Registry
| Path | Purpose |
|------|---------|
| `src/v11/shared/topology/topologySlotPaneProjection.ts` | Pane index → role mapping |
| `src/v11/infrastructure/channel/tmux/metaReviewerPaneBinding.ts` | Meta-reviewer pane binding management |
| `src/v11/infrastructure/executor/sessionRuntime/runtimeSessionsRegistry.ts` | Runtime session metadata persistence |

### Contracts & Types
| Path | Purpose |
|------|---------|
| `src/v11/shared/delivery/tmuxDeliveryContract.ts` | Delivery types & acks |
| `src/v11/shared/delivery/deliveryTargetMetadataContract.ts` | Delivery target role metadata |
| `src/v11/ports/tmuxDelivery.ts` | Delivery ports |
| `src/v11/ports/reviewerContext.ts` | Reviewer context port |

---

**Generated**: 2026-06-29  
**Status**: Analysis complete; ready for Phase 3 planning  
**Next Review**: After Phase 3 design decisions finalized
