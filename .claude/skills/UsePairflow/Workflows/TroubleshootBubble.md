---
description: Diagnose and resolve common Pairflow workflow issues quickly
argument-hint: --id <name> [--repo <path>] [--task <text>] [--task-file <path>]
allowed-tools: Bash, Read, AskUserQuestion
---

# Troubleshoot Bubble

## Purpose

Rapidly diagnose pairflow state/command mismatches and apply a safe next step with verification.

## Variables

BUBBLE_ID: extracted from `--id` argument (required)
REPO_PATH: extracted from `--repo`, or `git rev-parse --show-toplevel`
TASK_TEXT: extracted from `--task` argument (optional; for ideation kickoff)
TASK_FILE: extracted from `--task-file` argument (optional; for ideation kickoff)

## Instructions

- Always capture baseline status/inbox before proposing a fix.
- Match command to state; do not guess lifecycle actions.
- Prefer absolute repo path when lookup ambiguity appears.
- Re-verify after each fix attempt.
- If diagnosis is inconclusive, stop with a concrete escalation path.
- For remote started-pointer runtime loss, stay fail-closed: do not imply that `bubble start` or `bubble restart` is already the supported recovery contract on top of preserved remote state.
- For repeated `pairflow agent emit` failures, classify by error signature and apply the mapped correction once (do not keep mutating flags blindly); use `references/agent-emit-recipes.md` for the per-case command and `pairflow bubble emit-log` to confirm the dominant signature. `pairflow agent emit --help` is self-contained (authority rule, role templates, failure->fix table) and every rejected emit prints its mapped fix inline, so an agent should never need to read the Pairflow source tree to recover.

## Agent Emit Failure Playbook

Use this when pane output shows repeated emit failures.

1. Refresh authority first:
```bash
pairflow bubble status --id <BUBBLE_ID> --repo <REPO_PATH> --json
```
Then copy fresh `executionContext.handoffId` and `executionContext.executionId`.
If the JSON shows no active `executionContext`, or `active_role` is not the
failing agent's role, there is no emit owed - stop (see step 2).

2. Do I owe an emit? (before correcting any flags)
- No active `executionContext` (state `WAITING_HUMAN`, `READY_FOR_HUMAN_APPROVAL`, exhausted attempt) -> nothing to emit; wait for the next handoff.
- `executionContext.active_role` (or `active_role`) is not the agent's role -> do not emit; the loop waits on the other agent.
- A stale or re-delivered resume snapshot in the pane prompt (`active_role=<you>`, old `attempt:<n>`) is not authority; the status JSON is.

3. Role-to-kind lock:
- implementer: `pass|human_question`
- reviewer: `pass|convergence|human_question`
- meta-reviewer: `meta_review_result` only

4. Error signature -> correction (`pairflow agent emit --help` prints the full table;
the failing emit itself prints its own mapped fix inline):
- `Missing required option: --<flag>`:
  - Refresh authority first, then rebuild the whole command from the role template.
  - Required every time: `--repo --bubble-id --handoff-id --execution-id`; note `--execution-id` must come from `executionContext.executionId` and never from `--handoff-id`.
- `ACTOR_EMIT_OPTIONS_INVALID`:
  - Rebuild command from canonical template (`pairflow agent emit --help`).
  - Ensure `--repo`, `--bubble-id`, `--handoff-id`, `--execution-id` are all present and non-empty.
- `ACTOR_EMIT_CONTEXT_INVALID`:
  - Kind/authority mismatch. Switch to the allowed kind for current active role/authority.
- `Active actor authority is unavailable for state ...`:
  - No active `executionContext`; no emit is owed. Stop and wait for the next handoff.
- `Canonical actor emit handoff/execution/role/round mismatch`:
  - Stale or constructed authority. Re-read `bubble status --json` and copy both tokens verbatim; never reuse a previous round's token.
- `Implementer PASS does not accept findings flags`:
  - Drop `--finding`; findings are reviewer-only. Move the note into `--summary`.
- `REVIEWER_INTENT_OVERRIDE_INVALID`:
  - Findings => `--intent fix_request`; clean `--no-findings` => `--intent review`; `--intent task` is implementer-only.
- `FINDINGS_PAYLOAD_INVALID` (post-gate round):
  - Clean/advisory reviewer outcome must use `--kind convergence`, not `--kind pass`.
- `CONVERGED_SUMMARY_FINDINGS_CONTRADICTION`:
  - Add `--finding` entries or state explicitly that the outcome is clean.
- `Invalid --report-json value`:
  - Rebuild `--report-json` as a valid JSON object string (double-quoted keys/strings).
  - Single-quote the full shell argument; a file path is not accepted.
- `... is missing the required top-level claim keys findings_claim_state and findings_claim_source`:
  - Add both keys to the top level of the `--report-json` object (never inside a `findings` entry).
  - The error message prints the corrected payload for the active recommendation; copy it.
- `CLAIM_SOURCE_INVALID`:
  - If `findings_claim_state` is present, set `findings_claim_source=meta_review_artifact`.
- `report_json.findings_count is required and must be a non-negative integer`:
  - Set integer `findings_count>=0`.
  - Keep tuple consistent: `open_findings => findings_count>0`, `clean => findings_count=0`.
- `META_REVIEW_APPROVE_ADVISORY_SPLIT_REQUIRED`:
  - Add `findings_claimed_open_total`, `findings_blocking_open_total=0`, `findings_advisory_open_total`.
- `META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT` with snapshot totals:
  - Copy snapshot totals into `findings_count`, `findings_claimed_open_total`, `findings_advisory_open_total`.
  - Keep `findings_blocking_open_total=0` for advisory-only approve.
- `META_REVIEW_FINDINGS_PARITY_GUARD`:
  - Do not embed a digest inside the findings file; hash the finalized file and pass it as `findings_digest_sha256`.
- `spawn git ENOENT`:
  - `git` is not on the agent shell `PATH`; fix `PATH` and re-run the same command.

5. Retry policy:
- Retry exactly once after applying mapped correction.
- If it fails again, stop and report the exact error plus the corrected command variant.

6. Recorded attempt log:
```bash
pairflow bubble emit-log --id <BUBBLE_ID> [--repo <REPO_PATH>]
pairflow bubble emit-log --log <path-to-emit-history.ndjson>
```
Groups rejections by signature with counts and a time window; use `--log` when the bubble no longer resolves.

7. Reference:
- Self-contained CLI help: `pairflow agent emit --help` (also `pairflow help`, `pairflow agent --help`).
- Per-case commands: `references/agent-emit-recipes.md`.
- Canonical long form: `docs/agent-emit-troubleshooting.md`.

## Error Messages

- Missing bubble id: `"Usage: TroubleshootBubble --id <name> [--repo <path>] [--task <text>] [--task-file <path>]"`
- Bubble not found: `"Error: Bubble {id} was not found in repository {repo}."`
- Missing task input for ideation kickoff: `"Error: ideation bubble in RUNNING round 0 requires --task <text> or --task-file <path> for bubble kickoff."`
- No clear diagnosis: `"Error: No matching troubleshooting pattern found. Capture diagnostics and escalate."`

## Workflow

1. Resolve inputs.
- If `BUBBLE_ID` is empty -> STOP and report: `"Usage: TroubleshootBubble --id <name> [--repo <path>] [--task <text>] [--task-file <path>]"`
- Resolve `REPO_PATH` from argument or `git rev-parse --show-toplevel`.

2. Capture baseline diagnostics.
```bash
pairflow bubble status --id <BUBBLE_ID> --repo <REPO_PATH> --json
pairflow bubble inbox --id <BUBBLE_ID> --repo <REPO_PATH>
```
- If `status` reports bubble not found -> STOP and report: `"Error: Bubble {id} was not found in repository {repo}."`
- Optionally capture transcript tail:
  ```bash
  tail -n 30 <REPO_PATH>/.pairflow/bubbles/<BUBBLE_ID>/transcript.ndjson
  ```

3. Classify issue and apply state-safe fix.
- If command failed due to wrong state -> map fix by state:
  - `WAITING_HUMAN` -> `pairflow bubble reply --id <BUBBLE_ID> --repo <REPO_PATH> --message "<next instruction>"`
  - `RUNNING`:
    - If ideation markers indicate pending kickoff (`round=0` and `bubble.toml` has `[ideation] task_pending=true`):
      - If neither `TASK_TEXT` nor `TASK_FILE` is provided -> STOP and report: `"Error: ideation bubble in RUNNING round 0 requires --task <text> or --task-file <path> for bubble kickoff."`
      - Else run `pairflow bubble kickoff --id <BUBBLE_ID> --repo <REPO_PATH> --task "<TASK_TEXT>"` or `pairflow bubble kickoff --id <BUBBLE_ID> --repo <REPO_PATH> --task-file <TASK_FILE>`.
    - Otherwise continue normal loop (using `pairflow agent emit`) instead of approval commands.
  - `META_REVIEW_RUNNING` -> inspect the canonical status snapshot; if routing appears stuck or runtime is unhealthy, run `pairflow bubble restart --id <BUBBLE_ID> --repo <REPO_PATH>` and re-check state.
  - `READY_FOR_HUMAN_APPROVAL` (legacy `READY_FOR_APPROVAL`) -> `approve` or `request-rework`.
    - For remote bubbles, this means the retained laptop-side routed path by default, not manual lifecycle mutation inside the remote clone.
    - If approve fails with `APPROVAL_OVERRIDE_REQUIRED` or `APPROVAL_PARITY_OVERRIDE_REQUIRED`, rerun only with explicit human justification via `bubble approve --override-non-approve --override-reason "<reason>"`.
- If command output contains `IDEATION_PASS_BLOCKED` or `IDEATION_CONVERGED_BLOCKED`, treat it as pending kickoff and apply the same `bubble kickoff` path.
- If watchdog timeout led to `WAITING_HUMAN` -> send precise `bubble reply`, then re-check.
- If runtime appears unhealthy (agent pane unresponsive, stale tmux/session ownership, token/login refresh required) -> run `pairflow bubble restart --id <BUBBLE_ID> --repo <REPO_PATH>`, then re-check status/inbox.
- Remote exception:
  - If status JSON shows a started remote bubble with runtime unavailable/missing (for example `remoteExecution.pointerKind="started"` and remote runtime availability/reason indicates missing/unavailable), STOP in fail-closed mode.
  - Report that persisted remote state may still exist, but this phase does not treat `bubble start` or `bubble restart` as the generic supported recovery path on top of that started pointer.
  - Do not “work around” routed-command failures by SSH-ing into the remote clone and running `approve`, `commit`, `merge`, or `delete` manually; keep the operator model on the local routed path unless a command-specific parity exception is explicitly documented.
  - Use `pairflow bubble status --id <BUBBLE_ID> --repo <REPO_PATH> --json` or `pairflow bubble list --repo <REPO_PATH> --refresh` to confirm the remote diagnosis before escalating.
- If `bubble start` reported success but state remains `CREATED` -> wait briefly and poll status again from repo root cwd.
- If repo lookup confusion exists -> retry with explicit absolute `--repo` and verify `repoPath`/`worktreePath` in status json.
- If restart/recheck shows the bubble is no longer in `META_REVIEW_RUNNING`, treat the earlier diagnosis as stale, refresh status/inbox, then continue with state-correct routing.
- If state is `CANCELLED` but code is needed -> route to `RecoverBubble`.

4. Verify resolution.
```bash
pairflow bubble status --id <BUBBLE_ID> --repo <REPO_PATH> --json
pairflow bubble inbox --id <BUBBLE_ID> --repo <REPO_PATH>
```
- If state/action still mismatched after one retry -> STOP and report: `"Error: No matching troubleshooting pattern found. Capture diagnostics and escalate."`

## Report

```
Troubleshoot summary:
- Bubble: <BUBBLE_ID>
- Symptom: <SYMPTOM>
- Root-cause category: <CATEGORY>
- Commands executed: <COMMANDS>
- Current state: <STATE>
- Recommended next action: <NEXT_STEP>
```

## STOP

Do not run destructive git history commands during troubleshooting.
