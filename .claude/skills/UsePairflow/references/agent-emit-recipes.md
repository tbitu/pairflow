# Agent Emit Recipes (Reference)

Copy-paste emit commands per case, for loop agents and for operators
troubleshooting a stuck pane. Canonical long form:
`docs/agent-emit-troubleshooting.md`.

## Step 0 — authority (every emit, no exceptions)

```bash
pairflow bubble status --id <id> --repo <path> --json
```

Copy `executionContext.handoffId` → `--handoff-id` and
`executionContext.executionId` → `--execution-id` verbatim, immediately before
emitting.

- Never construct these values. `msg_...`, `r6`, or any reconstructed token is
  rejected as a handoff/execution mismatch.
- No active `executionContext` in the JSON (e.g. `WAITING_HUMAN`) ⇒ there is no
  valid emit. Stop and wait.

## Role to kind lock

| Role | Allowed `--kind` |
|---|---|
| implementer | `pass`, `human_question` |
| reviewer | `pass`, `human_question`, `convergence` |
| meta-reviewer | `meta_review_result` only |

## Implementer

```bash
pairflow agent emit --kind pass --repo <path> --bubble-id <id> \
  --handoff-id <handoff-id> --execution-id <execution-id> \
  --summary "<what changed + validation>" \
  --ref .pairflow/evidence/lint.log --ref .pairflow/evidence/test.log
```

Findings are reviewer-only — an implementer `pass` must not carry `--finding`.
Blocked instead:

```bash
pairflow agent emit --kind human_question --repo <path> --bubble-id <id> \
  --handoff-id <handoff-id> --execution-id <execution-id> --question "<blocker>"
```

## Reviewer

Round gate: `round >= severity_gate_round` is post-gate.

| Outcome | Emit |
|---|---|
| finding at/above threshold (any round) | `--kind pass --finding "<P0\|P1\|P2\|P3:Title\|ref>"` |
| findings, pre-gate | `--kind pass --finding ...` |
| clean, pre-gate | `--kind pass --no-findings` (bare flag) |
| clean, post-gate | `--kind convergence` (no finding flags) |
| advisory-only, post-gate | `--kind convergence --finding "P2\|P3:Title"` |
| clean/advisory, post-gate | `--no-findings` is forbidden |

```bash
pairflow agent emit --kind pass --repo <path> --bubble-id <id> \
  --handoff-id <handoff-id> --execution-id <execution-id> \
  --intent fix_request --summary "<verdict + coverage>" \
  --finding "P1:Title|src/file.ts" --finding "P3:Title"
```

Intent: findings ⇒ `--intent fix_request`; clean `--no-findings` ⇒ `--intent
review` (omitting `--intent` is inferred); `--intent task` is implementer-only.
`--finding` and `--no-findings` are mutually exclusive.

## Meta-reviewer

```bash
pairflow agent emit --kind meta_review_result --repo <path> --bubble-id <id> \
  --handoff-id <handoff-id> --execution-id <execution-id> \
  --round <n> --recommendation approve|rework|inconclusive \
  --summary "<verdict>" --report-json '<inline JSON>'
```

### Required `--report-json` keys (top-level, checked before any derivation)

`findings_claim_state` (`clean|open_findings|unknown`),
`findings_claim_source` (`meta_review_artifact`),
`findings_count` (integer `>= 0`, consistent with the claim).

Never nest `claim_state`/`claim_source` inside a `findings` entry — that is the
single most common recorded failure. `approve` additionally requires
`findings_claimed_open_total`, `findings_blocking_open_total` (`0`) and
`findings_advisory_open_total`. `--report-json` takes inline JSON, never a file
path.

Minimal payloads:

```json
{"findings_claim_state":"clean","findings_claim_source":"meta_review_artifact","findings_count":0,"findings_claimed_open_total":0,"findings_blocking_open_total":0,"findings_advisory_open_total":0}
{"findings_claim_state":"open_findings","findings_claim_source":"meta_review_artifact","findings_count":2,"findings_claimed_open_total":2,"findings_blocking_open_total":0,"findings_advisory_open_total":2}
{"findings_claim_state":"unknown","findings_claim_source":"meta_review_artifact","findings_count":0}
```

## Failure to fix

| Error signature | Fix |
|---|---|
| `... is missing the required top-level claim keys findings_claim_state and findings_claim_source` | add both keys to the top level of `--report-json` (the message prints the corrected payload) |
| `report_json.findings_count is required` / `must be a non-negative integer` | add a top-level integer `findings_count` |
| `Invalid --report-json value` (often naming `/tmp/...`) | pass inline JSON text, not a file path; single-quote it |
| `CLAIM_SOURCE_INVALID` | set `findings_claim_source=meta_review_artifact` whenever `findings_claim_state` is present |
| `META_REVIEW_APPROVE_ADVISORY_SPLIT_REQUIRED` | add the split triplet with `findings_blocking_open_total=0` |
| `META_REVIEW_FINDINGS_PARITY_GUARD` | do not embed a digest in the findings file; hash the finalized file and pass it as `findings_digest_sha256` |
| `Canonical actor emit handoff/execution mismatch` | re-read `bubble status --json`; copy both tokens verbatim |
| `Active actor authority is unavailable for state ...` | wait for the next handoff; do not emit |
| `Implementer PASS does not accept findings flags` | drop `--finding`; findings are reviewer-only |
| `REVIEWER_INTENT_OVERRIDE_INVALID` | findings ⇒ `fix_request`, clean ⇒ `review`, `task` is implementer-only |
| `FINDINGS_PAYLOAD_INVALID` in a post-gate round | clean/advisory outcomes use `--kind convergence` |
| `CONVERGED_SUMMARY_FINDINGS_CONTRADICTION` | add `--finding` flags or state the outcome is clean |
| `ACTOR_EMIT_OPTIONS_INVALID` / `ACTOR_EMIT_CONTEXT_INVALID` | rebuild from the recipe, refresh authority, retry **once** |

## Retry policy

Retry a corrected command **once**. If the same signature returns, stop guessing
and rebuild from this card. Do not re-emit against stale authority. One recorded
meta-review submit was retried 211 times on a single signature.

## Recorded attempts

Every emit attempt is logged to `.pairflow/bubbles/<id>/emit-history.ndjson`
(runtime log when the bubble cannot be resolved). Read it with:

```bash
pairflow bubble emit-log --id <id> [--repo <path>] [--json]
pairflow bubble emit-log [--repo <path>] [--json]
pairflow bubble emit-log --log <path-to-emit-history.ndjson> [--json]
```
