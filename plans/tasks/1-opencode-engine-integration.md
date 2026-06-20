---
artifact_type: task
artifact_id: task_opencode_engine_integration_v1
task_family_id: opencode-engine-integration
sequence_key: "1"
task_id: 1-opencode-engine-integration
title: Opencode Local Engine Integration
status: draft
phase: phase1
target_files:
  - src/v11/shared/command/agentCommand.ts
  - src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts
  - src/v11/infrastructure/channel/tmux/tmuxInput.ts
  - src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts
  - tests/core/engine/opencode.test.ts (new)
prd_ref: null
plan_ref: null
system_context_ref: docs/pairflow-initial-design.md
owners:
  - opencode-agent
doc_bubble_id: null
impl_bubble_id: null
supersedes: []
superseded_by: null
archive_group: null
---

# Task: Opencode Local Engine Integration

## L0 - Policy

### Goal

Enable Pairflow bubbles to use `opencode` as an implementer (or reviewer/meta-reviewer) agent, matching the existing codex/claude runtime integration pattern while respecting opencode's distinct CLI interface and TUI readiness behavior.

### Domain / Control Model Summary

1. **Business invariant:** All three supported agents (codex, claude, opencode) must participate in bubbles identically from Pairflow's lifecycle perspective — same pane layout, same message protocol, same handoff semantics. Differences in launch flags and readiness detection are internal to each agent's integration.
2. **Control model:** Agent selection is controlled by `bubbleConfig.agents.*` fields. The runtime resolves per-agent behavior through dispatch patterns (conditional branches keyed on `AgentName`). No new top-level authority is introduced.
3. **Read-path rule:** The runtime reads the resolved agent name from bubble config and dispatches to the appropriate command-building and readiness-detection logic.
4. **Forbidden fallback:** Do not fall back to codex behavior when opencode is selected, or use `>` prompt detection for opencode. Each agent's launch pattern and readiness signal must be distinct and explicit.
5. **Allowed resolution path:** Opencode configuration (permissions, MCP policy) is managed entirely through its local config files; Pairflow does not attempt to override these via CLI flags like codex/claude do with `--dangerously-*` options.
6. **Missing-data rule:** If opencode binary is not found in PATH at bubble launch time, the pane falls back to interactive `bash -i` shell (same as existing agents), preserving the session without crashing the orchestrator.

### Plan Linkage

N/A — this task is self-contained and does not depend on an external plan. The work extends a registry already registered (`opencode` in `agentNames`).

### Canonical Contract Anchors

1. **Source-of-truth anchors:**
   - `src/contracts/kernel/agentIdentity.ts` — canonical `AgentName` union type (already includes `"opencode"`)
   - `src/v11/shared/command/agentCommand.ts:buildAgentLaunchCommand` — per-agent CLI argument builder
   - `src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts:shouldSubmitStartupPrompt` — agent-specific startup prompt submission gate
   - `src/v11/infrastructure/channel/tmux/tmuxInput.ts:isAgentPromptLine` / `checkTmuxPaneMarkerStatus` — readiness detection primitives
2. **Closed canonical elements:**
   - The existing codex and claude behavior must remain unchanged. All opencode additions are additive conditional branches.
   - The tmux pane layout (4 panes) is fixed; no structural changes to the session model.
3. **Guard elements:** N/A — no new validation guards are introduced.
4. **Compat-only elements:** N/A.
5. **Forbidden reinterpretations:** Do not modify `isAgentPromptLine` regex globally for opencode compatibility. Keep prompt detection per-agent or use a separate readiness primitive.

### Scope Reality / Shape Proof

1. **Inspected entrypoints / call-sites:** All four target files have been read in full (see exploration findings). Additional adjacent inspection:
   - `src/v11/infrastructure/channel/tmux/tmuxDelivery.ts` — stuck-input retry uses prompt-line regex; scoped out for opencode readiness changes but needs verification that existing watchdog behavior does not break on opencode panes.
   - `src/config/defaults.ts` — default agent values; no change needed (opencode is optional selection).
2. **Actual touched scope:** `consumer-family alignment` + `contract_or_persisted_authority_foundation`. The task aligns four existing runtime code paths to recognize a new agent value. No producer boundary changes; no new persisted authority; no new orchestration logic.
3. **Mutation entrypoints in scope:** None — this is pure read-path alignment and dispatch behavior addition. No state mutation, no persistence writes, no filesystem mutations beyond test file creation.
4. **Hidden scope ruled out:** Verified that `agentCommand.ts` is the sole command builder for all agent panes; no other code path independently constructs agent launch commands. Readiness detection via `isAgentPromptLine` and marker status check are the only readiness primitives — both scoped to tmux input layer, not lifecycle state machine.
5. **Branch inventory note:** Fresh per-agent branches (codex / claude / opencode) in existing conditional dispatch patterns; success path for all three, no failure/retry-specific branches needed beyond existing fallback-to-shell pattern.
6. **Why the declared task shape matches reality:** The bounded slice adds one new consumer branch to each of four existing code paths. No shared contract change (opencode is already in `agentNames`). No new persistence, no new orchestration ordering. A single task can close this scope without splitting because all changes are additive conditional branches against a stable dispatch model.

### Refactor Classification

1. **Classification:** `mechanical`
2. **Classification triggers:** Existing conditional dispatch pattern (`if agentName === "codex"`) is extended with one additional branch for `"opencode"`. No module movement, no interface changes, no caller-knowledge increase.
3. **Preparatory modifier:** no

### Authority Boundary Map

1. **Authority producer:** N/A — no new authority is produced; `agentNames` tuple already declares opencode as a valid identity.
2. **Stored authority:** N/A — agent name resolution reads from in-memory bubble config, no persistence changes.
3. **In-scope consumers:** Four runtime consumer families aligned: command building, startup prompt submission gate, tmux readiness detection, and pane message seeding.
4. **Explicit out-of-scope consumers:** Plan-watch runner headless spawning (no opencode backend adapter needed in this task), UI display layer (agent name rendering is already generic).
5. **Export surfaces closed in this phase:** yes — all four runtime entrypoints are aligned; no downstream activation or read-model work required for the engine to function in a bubble.

### Baseline Preservation

1. **Must-preserve behaviors:** Codex `--dangerously-bypass-approvals-and-sandbox` behavior, claude `--dangerously-skip-permissions / --permission-mode bypassPermissions` behavior, tmux Enter-based startup prompt submission for codex, CLI-positional-prompt delivery for claude, marker-submission confirmation loop for all agents, fallback-to-shell on agent exit or binary-not-found.
2. **Allowed resolution paths:** Adding a new `else if (agentName === "opencode")` branch is the intended and only allowed resolution path. No restructuring of existing branches permitted.
3. **Forbidden regression interpretations:** Reviewers must not interpret "align opencode readiness" as permission to modify the global `isAgentPromptLine` regex — that regex serves codex/claude correctly and changing it would be a cross-agent regression risk.
4. **Replacement proof required if removed:** N/A — no existing behavior is being replaced.

### Success / Completion Proof Boundary

1. **Current canonical success proof source:** Agents launch in tmux panes, Pairflow detects readiness via prompt-line regex, then seeds bootstrap/kickoff messages with marker-submission confirmation.
2. **Target canonical success proof source:** Identical flow for opencode — distinct launch flags (`--prompt`), distinct or fallback-ready readiness detection (TUI-specific indicator or timeout-based sentinel), then same message-seeding and marker-confirmation path.
3. **Current canonical completion proof source:** N/A — no changes to agent termination or result collection.
4. **Target canonical completion proof source:** N/A.
5. **Reused proof contract:** Inherit full parity — opencode panes use the same message-seeding, marker-submission confirmation, and stuck-input retry contracts as codex/claude.

### Precondition and Side-Effect Boundary

1. **Primary bounded task shape:** `consumer_family_alignment`
2. **Secondary shape (if any):** `contract_or_persisted_authority_foundation` — minor: opencode is already declared in `agentNames`, but this task makes the runtime fully operational for that identity. The foundation was done upstream; this task closes the operational gap.
3. **Preconditions that must pass before side effects:** N/A — no mutations, only dispatch additions.
4. **Side effects forbidden before preconditions pass:** N/A.
5. **Invalid/precondition-failure behavior:** N/A — pure read-path alignment.
6. **Coordination primitives in scope:** N/A — no new locking, idempotency, or serialization concerns introduced.

### In Scope

1. Build `opencode` launch command using `--prompt` flag for startup context (same as codex CLI pattern), with optional `--model` flag, WITHOUT any dangerous-bypass flags (permissions handled by opencode's own config).
2. Implement readiness detection for opencode TUI: detect when the pane has rendered its input-ready state, either via a distinct visual indicator (`>>>` or similar) or by falling back to a short timeout-based sentinel (500-800ms after process start) when no reliable regex pattern is identified.
3. Wire `shouldSubmitStartupPrompt` to handle opencode: pass startup prompt via `--prompt` CLI flag AND submit initial message via tmux paste-and-submit for Pairflow bootstrap/kickoff messages (opencode needs both — the CLI flag sets initial context, tmux input delivers Pairflow protocol messages).
4. Wire `seedBubbleTmuxPaneMessages` to handle opencode pane seeding correctly: after launch, detect readiness (via indicator or timeout), then send bootstrap + kickoff merged message with marker submission confirmation.
5. Add unit tests covering: opencode command construction (`--prompt` flag present/absent, model flag passthrough), opencode readiness detection logic, and startup prompt submission decision gate for opencode.

### Out of Scope

1. Opencode MCP disable mechanism — opencode does not expose a `mcp list --json` equivalent (no codex-style MCP discovery needed in this task).
2. Opencode plan-watch headless runner backend adapter (`AgentRunnerBuiltInBackendAdapter` implementation) — this requires additional investigation into whether opencode supports ACP/headless invocation suitable for the plan-watch runner. Defer to a successor task if plan-watch support is needed.
3. Trust-prompt auto-acceptance for opencode (Claude folder-trust, Codex directory trust) — opencode's TUI does not use this interaction pattern.
4. UI display changes — opencode name rendering in bubble status/panels is already generic via `AgentName` type.
5. Remote bubble execution support for opencode (`remoteStartContext`) — add only when explicitly needed; the tmux-local path is sufficient for v1 integration.

### Safety Defaults

1. If opencode binary not found at launch time: fall back to interactive bash shell (same as existing agent fallback behavior). No error escalation or bubble abort.
2. Readiness detection timeout fallback defaults to 600ms after process start if no visual indicator is matched within a 5-second polling window — this prevents infinite wait loops while being generous enough for slow TUI rendering.

### Scoped Invariants

| Invariant | Applies To | Does Not Apply To | Proof Surface | Deferred / External Surfaces | Reviewer Non-Goals |
|---|---|---|---|---|---|
| Opencode launch command must use `--prompt` flag for startup context, not positional arguments | `buildAgentLaunchCommand` opencode branch only | codex branch (positional), claude branch (positional) | Unit test for command string output | N/A | Verifying that codex/claude positional behavior is unchanged beyond the existing code paths |
| Readiness detection must not modify global `isAgentPromptLine` regex | All readiness checks for opencode panes | Codex/claude pane readiness (unchanged) | Unit test for opencode-specific readiness logic | N/A | Modifying or tightening the global prompt-line regex |

### Review Scope Fence

| Edge-Case Family | Why Not Required Now | Safe Current Behavior | If Discovered During Review | Route |
|---|---|---|---|---|
| Opencode TUI renders a different prompt character than `>>>` (e.g., cursor blink only) | Task scope includes timeout-based fallback readiness sentinel; no regex dependency required | 500-800ms timeout after process start signals readiness | follow_up — refine readiness indicator if timeout proves unreliable in practice | follow_up |
| Opencode config requires environment variables for model/provider setup | Config is external to Pairflow; opencode reads its own config at startup | Agent launches with `--prompt` flag regardless of provider config; config gaps surface as agent-side errors, not runtime crashes | accepted_limitation — operator must ensure opencode config is correct before using it as an engine | external |
| Stuck-input watchdog retry on opencode panes may misclassify opencode TUI text | Watchdog uses `[pairflow]` marker detection in input buffer; this is agent-agnostic and does not depend on prompt character | Marker-based stuck-input detection works independently of what the agent's prompt looks like | accepted_limitation — existing marker-based detection already handles all agents uniformly | external |

### Contract Boundary / Blast Radius

1. `contract_boundary_override`: `no`
   - `agentNames` tuple in `src/contracts/kernel/agentIdentity.ts` already includes `"opencode"`; no contract change required. The task only extends existing dispatch branches to fully support the already-declared identity. If future work adds a fourth agent name, that would be a true contract widening and should follow its own task.

### Gate Detail Budget

| Gate | Detail Level | Evidence / Reason |
|---|---|---|
| Complexity Risk Gate | triggered_low_risk | Score 3 (see below). Single additive branch per existing code path; no cross-seam identity matching; no new persistence or authority. |
| Closure-Budget Gate | triggered_low_risk | Two buckets touched: `shared_contract` (opencode identity alignment in dispatch) and `internal_execution_consumers` (four runtime entrypoints aligned). Both closed by same bounded change. No split required. |
| Authority Fan-out Scan | not_triggered | N/A — no new authority produced; existing `agentNames` registry is already the source of truth for all consumers. |
| Bounded-Task-Shape Gate | triggered_low_risk | Primary: `consumer_family_alignment`. Secondary: `contract_or_persisted_authority_foundation` (operational gap closure). Safe collapse because same dispatch pattern in each code path closes both concerns together. |
| Closed-Contract Drift Check | not_triggered | N/A — no existing contract terms are reinterpreted; all additions are additive branches. |

### Complexity Risk Gate

1. `authority_risk`: 0 — no new canonical source-of-truth; `opencode` already in `agentNames`.
2. `surface_spread`: 1 — changes touch command building, startup submission gate, tmux readiness detection, and pane seeding (3-4 surfaces = score 1).
3. `identity_join_risk`: 0 — stable string comparison against `AgentName` union; no cross-seam identity matching.
4. `activation_coupling`: 1 — small coupling between foundation (dispatch branches) and delivery (readiness detection + message seeding).
5. `prerequisite_risk`: 0 — no dependency on unfinished milestone work.
6. `acceptance_multiplicity`: 1 — two success classes: command construction correctness and readiness-detection behavior correctness.
7. `risk_score`: 3
8. `single-task allowed`: yes
9. Identity/join note: N/A — string identity, no competing forms.
10. Authority/source-of-truth note: canonical source is `agentNames` tuple; already includes opencode.
11. Closure-budget triage:
    - closure buckets touched: shared_contract (dispatch alignment), internal_execution_consumers (command building + readiness + seeding)
    - intentionally collapsed closures: same four code paths each get one additive branch; all closed by single implementation bubble
    - explicitly deferred closures: plan-watch runner adapter, opencode MCP disable mechanism, remote execution support
12. Bounded-task-shape decision: primary `consumer_family_alignment`, secondary `contract_or_persisted_authority_foundation`; safe because same dispatch model in each code path handles both concerns simultaneously.
13. Scoped-invariant decision: gate triggered yes — scoped invariant records present above. Unbounded invariant route-back: no.
14. Review-scope-fence decision: fence needed yes — fenced families listed above; invalid fence route-back: no.

## L1 - Change Contract

### 0) Domain / Control Contract

| Item | Rule | Implementation Consequence | Priority | Timing |
|---|---|---|---|---|
| Business invariant | Opencode panes in a bubble behave identically to codex/claude panes from Pairflow's lifecycle perspective | All four runtime entrypoints must dispatch correctly for `"opencode"` agent name | P1 | required-now |
| Control model | Agent-specific behavior is determined by conditional branches keyed on `AgentName` | Each code path uses `if (agentName === "codex") / else if (agentName === "claude")` pattern; add `else if (agentName === "opencode")` without restructuring existing branches | P1 | required-now |
| Read-path rule | Runtime reads agent name from bubble config and dispatches to appropriate branch | No config schema changes needed; opencode selection via existing `agents.implementer: "opencode"` field works as-is | P1 | required-now |
| Forbidden fallback | Do not use codex's `--dangerously-*` flags or `>` prompt regex for opencode | Opencode launch command omits bypass flags entirely; readiness detection uses TUI indicator or timeout, not the global prompt-line regex | P1 | required-now |
| Allowed resolution path | Opencode config (permissions, MCP) managed by opencode's own configuration files | Pairflow does not attempt to override opencode permissions via CLI | P1 | required-now |

### 1) Call-site Matrix

| ID | File | Function/Entry | Exact Signature (args -> return) | Insertion Point | Expected Behavior | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|---|
| CS1 | `src/v11/shared/command/agentCommand.ts` | `buildAgentLaunchCommand(agentName, model, startupPrompt, roleMcpPolicy): string` | After claude branch (line ~69) | Add `else if (agentName === "opencode")` branch that pushes `--prompt "<startupPrompt>"` and `--model <model>` flags to args array | Opencode receives startup context via CLI flag; no bypass flags added | P1 | required-now | target file, line 59-86 current pattern |
| CS2 | `src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts` | `shouldSubmitStartupPrompt(agentName, startupPrompt): boolean` | Replace hard-coded codex check (line ~27) with inclusive check that also covers opencode | Change `agentName === "codex"` to `["codex", "opencode"].includes(agentName)` | Both codex and opencode get startup prompt submitted via tmux after readiness detection; claude does not | P1 | required-now | target file, line 24-29 |
| CS3 | `src/v11/infrastructure/channel/tmux/tmuxInput.ts` | Readiness detection for opencode TUI | Add new exported function `detectOpencodeReadiness(runner, targetPane): Promise<boolean>` or use timeout sentinel in seeding layer | New utility function or inline readiness check before first message send | Returns true when opencode pane shows input-ready state (via visual indicator match or timeout elapsed) | P1 | required-now | new file |
| CS4 | `src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts` | `seedBubbleTmuxPaneMessages(input): Promise<void>` | Before first message send for opencode panes, call readiness detection function or apply timeout sentinel | In the `sendPaneMessage` path, add readiness gate specific to opencode agent type | Waits for opencode TUI to be ready before pasting bootstrap/kickoff messages; then proceeds with normal marker-confirmation flow | P1 | required-now | target file, line 82-102 sendPaneMessage |

### 2) Data and Interface Contract

| Contract | Current | Target | Required Fields | Optional Fields | Compatibility | Priority | Timing |
|---|---|---|---|---|---|---|---|
| `buildAgentLaunchCommand` return type | string (bash fragment with codex/claude args) | Same — adds opencode args to output | N/A | N/A | non-breaking: existing callers receive same format, just different arg set for `"opencode"` agent name | P1 | required-now |
| Opencode readiness detection interface | N/A | `detectOpencodeReadiness(runner, targetPane): Promise<boolean>` | runner (TmuxRunner), targetPane (string) | Attempts (number), delayMs (number) | New API — no existing consumers yet | P1 | required-now |

### 3) Side Effects Contract

| Area | Allowed | Forbidden | Notes | Priority | Timing |
|---|---|---|---|---|---|
| FS/Network | Read-only tmux pane captures; spawn opencode process via `config.runner()` | No file writes beyond test files; no network calls | Opencode launch uses existing tmux session management infrastructure | P1 | required-now |

### 4) Error and Fallback Contract

| Trigger | Dependency (if any) | Behavior (throw/result/fallback) | Fallback Value/Action | Reason Code | Log Level | Priority | Timing |
|---|---|---|---|---|---|---|---|
| Opencode binary not in PATH | Process spawn via `command -v opencode` | Pane falls back to interactive bash shell (existing fallback pattern) | `exec bash -i` | `AGENT_BINARY_NOT_FOUND` | warn | P1 | required-now |
| Readiness detection timeout exceeded (5s) | No external dependency | Proceed with message send anyway; rely on marker-submission confirmation to detect if agent was not actually ready | Send message without readiness gate | `READINESS_TIMEOUT_FALLBACK` | info | P2 | required-now |
| Opencode TUI renders unreadable output during capture | tmux `capture-pane` returns garbled content | Treat as "not ready"; retry up to max attempts (default 3) then fall back to timeout sentinel | Continue with message send | `READINESS_DETECTION_FAILED` | warn | P2 | required-now |

### 5) Dependency Constraints

| Type | Items | Priority | Timing |
|---|---|---|---|
| must-use | Existing `buildAgentCommand` scaffolding pattern (bash script wrapper with cd + bootstrap + launch), tmux pane message seeding flow, marker-submission confirmation loop | P1 | required-now |
| must-not-use | Modifying global `isAgentPromptLine` regex for opencode compatibility, adding new top-level config schema fields | P1 | required-now |

### 6) Test Matrix

| ID | Scenario | Given | When | Then | Priority | Timing | Evidence |
|---|---|---|---|---|---|---|---|
| T1 | Opencode command with startup prompt and model | agentName=`"opencode"`, model=`"anthropic/claude-sonnet-4-20250514"`, startupPrompt=`"Build me a React app"` | `buildAgentLaunchCommand` called | Returns args containing: `opencode --model "anthropic/claude-sonnet-4-20250514" --prompt "Build me a React app"` — NO dangerous-bypass flags present | P1 | required-now | golden path assertion on command string |
| T2 | Opencode command without startup prompt | agentName=`"opencode"`, model=undefined, startupPrompt=undefined | `buildAgentLaunchCommand` called | Returns args: `opencode` — no extra flags appended | P1 | required-now | minimal command assertion |
| T3 | Opencode command with model but no startup prompt | agentName=`"opencode"`, model=`"openai/gpt-4o"` | `buildAgentLaunchCommand` called | Returns args containing `--model "openai/gpt-4o"` and NO `--prompt` flag | P1 | required-now | partial command assertion |
| T4 | Codex command unchanged (regression guard) | agentName=`"codex"`, model=undefined, startupPrompt=`"test"`, roleMcpPolicy=`"disabled"` | `buildAgentLaunchCommand` called | Returns args with `--dangerously-bypass-approvals-and-sandbox` and positional prompt — same as before this task | P1 | required-now | existing test or new regression assertion |
| T5 | Claude command unchanged (regression guard) | agentName=`"claude"` | `buildAgentLaunchCommand` called | Returns args with `--dangerously-skip-permissions --permission-mode bypassPermissions` — same as before this task | P1 | required-now | existing test or new regression assertion |
| T6 | shouldSubmitStartupPrompt returns true for opencode | agentName=`"opencode"`, startupPrompt=`"some prompt"` | `shouldSubmitStartupPrompt` called | Returns `true` | P1 | required-now | gate function unit test |
| T7 | shouldSubmitStartupPrompt returns false for claude | agentName=`"claude"` | `shouldSubmitStartupPrompt` called | Returns `false` (claude receives prompt via CLI, not tmux) | P1 | required-now | regression guard |
| T8 | Opencode readiness detection via timeout sentinel | opencode process started in pane, no visual indicator available within 5s timeout window | `detectOpencodeReadiness` called with timeout fallback | Returns `true` after timeout elapsed (e.g., 600ms), allowing message send to proceed | P2 | required-now | mock tmux runner test |

## L2 - Implementation Notes (Optional)

1. [later-hardening] If opencode's TUI prompt character can be reliably identified in a future opencode version, replace the timeout-based readiness sentinel with a regex match on that specific character. Document the exact pattern to use.
2. [later-hardening] Consider adding `opencode` as a plan-watch runner backend adapter (`AgentRunnerBuiltInBackendAdapter`) if headless invocation via ACP mode (`opencode acp`) or server mode (`opencode serve`) proves viable. This requires investigating opencode's ACP protocol for programmatic message delivery and result extraction.
3. [later-hardening] If opencode supports a `--pure` flag (visible in help output), consider passing it when Pairflow needs to isolate the bubble from global plugins — but only after verifying that plugin isolation does not break expected agent behavior.

## Hardening Backlog (Optional)

| ID | Item | Layer | Priority | Timing | Source | Proposed Action |
|---|---|---|---|---|---|---|
| H1 | Verify watchdog `retryStuckAgentInput` works on opencode panes — the stuck-input detection uses `[pairflow]` marker search in pane text, which is agent-agnostic and should work, but confirm that opencode TUI doesn't interpret paste differently than codex/claude | tmuxDelivery | P2 | later-hardening | Review scope fence entry: stuck-input watchdog | Verify during integration testing; file follow-up if needed |
| H2 | Add opencode-specific pane label formatting (e.g., `[opencode/implementer]` instead of generic pattern) — already handled by existing pane labeling code that interpolates agent name into the label string, so no action needed unless visual distinction is desired beyond the agent name prefix | tmuxManager layout | P3 | later-hardening | Scope definition | Close as not-needed; labels are already dynamic |
| H3 | Investigate opencode session persistence: opencode supports `--continue` and `--session` flags that could be leveraged for bubble resume scenarios. If useful, add session ID management to the resume flow in a successor task | startup command building | P2 | later-hardening | Feature scope discussion | Defer; evaluate after v1 integration is validated in production |

## Review Control

1. Every finding must include: `priority`, `timing`, `layer`, `evidence`.
2. Max 2 L1 hardening rounds.
3. After round 2, new `required-now` is allowed only for evidence-backed `P0/P1`.
4. Items outside L1 blocker scope must be tagged `later-hardening`.
5. If `contract_boundary_override=yes`, `plan_ref` is mandatory and must align with L1 contract rows.
6. If a shared contract changes, current-consumer inventory and additive-vs-breaking classification are mandatory.
7. If an authority fan-out exists, the authority boundary map must stay consistent with the bounded task scope.
8. If baseline behavior is removed or replaced, the task must name the exact replacement path and the proof expected from validation.
9. If `plan_ref` is non-null, `Plan Linkage` and the inherited validation/exit expectation are mandatory and must stay consistent with successor impact notes.
10. If a capability claim is in scope, `Capability Closure` must align with Done Definition / acceptance wording and the test matrix. End-to-end claims require last-mile proof; hook/foundation/deferred work must not assert fully usable automation.
11. If `target_files` are known, `Scope Reality / Shape Proof` is mandatory and the declared task shape must match the inspected touched scope.
12. If the task is a refactor or target-file reality shows refactor behavior, `Refactor Classification` is mandatory; if classified as Boundary/Architecture, `Refactor Classification and Module Depth Check` is mandatory.
13. If the task refines an already-closed authority/shared contract, `Canonical Contract Anchors` and `Canonical Contract Preservation` are mandatory.
14. New terminology for an existing contract must map back to source anchors and field roles explicitly before it can become `required-now`.
15. If the Contract-Dense Task Gate triggers, `Canonical Contract Matrix`, `Ownership and Deferred Semantics`, and `Mirrored Surface Checklist` are mandatory.
16. If structured input/output is part of a dense contract, `Structured Contract Rules` is mandatory and must use allowlist/rejection behavior instead of prose-only validity language.

## Spec Lock

Mark task as `IMPLEMENTABLE` when all `P0/P1 + required-now` items are closed.
