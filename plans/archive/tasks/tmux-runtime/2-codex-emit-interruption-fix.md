---
artifact_type: Task
artifact_id: 2-codex-emit-interruption-fix
status: archived
phase: E
target_files:
  - src/cli/index.ts
  - src/v11/application/actorProtocol/internal/adapters/actorProtocolEmitters.ts
  - src/v11/application/actorProtocol/emitActorProtocol.ts
  - src/v11/infrastructure/channel/tmux/postEmitInterruption.ts
prd_ref: null
plan_ref: null
system_context_ref: null
task_family_id: codex-emit-interruption-fix
sequence_key: "2"
task_id: 2-codex-emit-interruption-fix
doc_bubble_id: 2-codex-emit-interruption-fix-doc
impl_bubble_id: 2-codex-emit-interruption-fix-impl
supersedes: 1-codex-emit-interruption
superseded_by: null
---

# 2-codex-emit-interruption-fix

## L0: Policy and Bounded Scope

### Primary Task Shape
`fail_closed_hardening`

### Business Invariant
The LLM (codex process) can only handle one worker at a time. The previous tmux pane must be fully idle before the next one starts.

### Control Model
The `pairflow agent emit` command must interrupt the codex process running in the *originating* pane (the pane from which the command was invoked). The current implementation hardcodes the interruption to the implementer pane. The logic must be updated to dynamically target the pane associated with the originating agent's role (e.g., implementer, reviewer, meta_reviewer). Since an agent never emits directly to itself in a way that requires preserving its codex process, no contingency for same-pane emission is required.

### Scope Reality Proof
- **Target Entrypoints:** `src/v11/infrastructure/channel/tmux/postEmitInterruption.ts`, `src/cli/index.ts`, `src/v11/application/actorProtocol/emitActorProtocol.ts`, `src/v11/application/actorProtocol/internal/adapters/actorProtocolEmitters.ts`.
- **Bounded Slice:** Modifies the post-emit interruption logic to use the `expected_role` from the `ActorEmitContextSnapshot` to resolve the correct pane index, and updates the protocol emitters to expose this role in the emit result metadata.

### Complexity Risk Gate
- **risk_score:** 2
- **split_decision:** N/A. Small localized fix.

## L1: Implementation Contract

### Execution & Interruption Matrix
| ID | Contract Element | Acceptance Criteria / Rule |
|----|------------------|----------------------------|
| AC1 | Expose Originating Role | Update `ActorEmitResult`'s `_meta` field in `src/v11/application/actorProtocol/internal/adapters/actorProtocolEmitters.ts` to include `originatingRole: AgentRole` (populated from `resolvedInput.authoritativeContext.expected_role` in `emitActorProtocol.ts`). |
| AC2 | Dynamic Target Pane | Update `postEmitInterruptCodexPane` in `src/v11/infrastructure/channel/tmux/postEmitInterruption.ts` to accept `originatingRole: AgentRole` in its input. Use `getSharedTopologySlotPaneIndexForRole(input.originatingRole)` from `topologySlotPaneProjection.ts` to resolve the correct pane index instead of hardcoding `implementer`. |
| AC3 | CLI Integration | Update `src/cli/index.ts` to pass `bubbleContext.originatingRole` to `postEmitInterruptCodexPane`. |

### Baseline Preservation
| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP1 | Post-Emit Timing | The interruption must still occur strictly *after* the emit has successfully registered. |

## L2: Hardening Backlog
- Add tests to verify that `postEmitInterruptCodexPane` targets the correct pane for each possible `AgentRole`.
