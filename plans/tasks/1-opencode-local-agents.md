---
artifact_type: Task
artifact_id: task_opencode_local_agents_v1
task_family_id: opencode-local-agents
sequence_key: "1"
task_id: 1-opencode-local-agents
status: draft
phase: E
target_files:
  - src/v11/shared/command/agentCommand.ts
  - src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts
  - src/v11/application/start/internal/prompts/startCommandImplementerPrompts.ts
  - src/v11/application/start/internal/prompts/startCommandResumeKickoffMessageBuilders.ts
prd_ref: null
plan_ref: null
system_context_ref: null
doc_bubble_id: 1-opencode-local-agents-doc
impl_bubble_id: 1-opencode-local-agents-impl
supersedes: []
superseded_by: null
---

# 1-opencode-local-agents

## L0: Policy and Bounded Scope

### Primary Task Shape
`activation_or_read_model`

### Business Invariant
Pairflow must launch the `opencode` agent in tmux panes using the locally configured agents `PF-implementer` and `PF-reviewer` for their respective roles. All generic instructions injected from the codebase that overlap with these agents' system prompts must be omitted to prevent input clutter and steering confusion.

### Control Model
- If `agentName === "opencode"`, launch the process using `--agent PF-implementer` for `roleName === "implementer"` and `--agent PF-reviewer` for `roleName === "reviewer"`.
- If `agentName === "opencode"`, startup prompts passed via `--prompt`/`-p` and kickoff/resume messages pasted via tmux must not contain redundant instructions (such as `buildPairflowCommandGuidance`, `buildAgentEvidenceHandoffGuidance`, `buildCanonicalActorEmitLookupGuidance`, and role instructions/directives).

### Scope Reality Proof
- **Target Entrypoints:**
  - `src/v11/shared/command/agentCommand.ts` - `buildAgentLaunchCommand` and `buildAgentCommand` build the execution script.
  - `src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts` - launches fresh/resume tmux sessions and prepares the launch commands/prompts.
  - `src/v11/application/start/internal/prompts/startCommandImplementerPrompts.ts` - builds startup prompts and kickoff messages.
  - `src/v11/application/start/internal/prompts/startCommandResumeKickoffMessageBuilders.ts` - builds resume kickoff messages.
- **Bounded Slice:**
  - Update `buildAgentLaunchCommand` to receive `roleName?: AgentRole` and append `--agent PF-implementer` or `--agent PF-reviewer` flags for `opencode`.
  - Pass `roleName` to `buildAgentLaunchCommand` within `buildAgentCommand`.
  - Strip startup prompts and kickoff/resume messages of overlapping generic guidance when `agentName === "opencode"`.

### Complexity Risk Gate
- **risk_score:** 4
- **split_decision:** None needed. The changes touch only command generation, prompt filters, and tmux start flow; all are within a single implementation boundary.

## L1: Implementation Contract

### Execution & Mapping Matrix
| ID | Contract Element | Acceptance Criteria / Rule |
|----|------------------|----------------------------|
| AC1 | Launch Command Agent Mapping | When `agentName === "opencode"`, add `--agent PF-implementer` to the CLI arguments if the role is `implementer`, and `--agent PF-reviewer` if the role is `reviewer`. |
| AC2 | Startup Prompt Removal | When `agentName === "opencode"`, startup prompts (`implementerStartupPrompt` and `reviewerStartupPrompt` during start/resume) must be empty/undefined. |
| AC3 | Kickoff Message Cleaning | When `agentName === "opencode"`, `implementerKickoffMessage` (fresh and resume) must only contain the bubble ID header and the task artifact path instruction, omitting command guidance, handoff guidelines, and emit commands. |
| AC4 | Reviewer Kickoff Cleaning | When `agentName === "opencode"`, `reviewerKickoffMessage` (fresh and resume) must only contain the bubble ID header, the active round description, and any test directive, omitting command guidance, handoff guidelines, findings pass instructions, and command gate projections. |

### Baseline Preservation
| ID | Must Preserve | Allowed Resolution |
|----|---------------|--------------------|
| BP1 | Non-opencode Launch Paths | Any non-opencode agent launch configurations or standard fallback shell executions must remain unmodified. |
| BP2 | Process Recovery and Watchdog | Working directory cd checks, error message outputs, process restart loops, and visual readiness checks inside tmuxManager/tmuxInput must be preserved without regression. |

## L2: Hardening Backlog
- Consider making the agent naming mapping fully configurable via `pairflow.toml` under a new `agents.opencode` block.
- Add validation in `startCommandTmuxLaunch.ts` verifying that `PF-implementer` and `PF-reviewer` actually exist in `opencode agent list` before launching, else fallback gracefully.
