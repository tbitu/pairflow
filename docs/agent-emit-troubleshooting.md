# Agent Emit Troubleshooting

Use this reference when a role keeps failing `pairflow agent emit` calls.

This file is the canonical emit recipe. The repo-local skill card
`.claude/skills/UsePairflow/references/agent-emit-recipes.md` is the short form of
the same content. Both are derived from the recorded emit attempt log — see
[Reading the struggle log](#reading-the-struggle-log) at the end.

## Finding the command (do this before guessing)

The CLI is now self-teaching, so an agent never needs to read the source tree:

- `pairflow help` / `pairflow --help` / `pairflow -h` / bare `pairflow` print the
  top-level usage and point at the emit recipe (previously these printed
  `Unknown command`).
- `pairflow agent --help` explains that `emit` is the only actor command and
  that `pass`/`ask-human`/`converged` were removed.
- `pairflow agent emit --help` is the authoritative, self-contained recipe:
  authority rule, the "do I owe an emit?" check, the role-to-kind lock, per-case
  commands and the full failure->fix table.
- Every rejected emit appends its own mapped fix plus the recipe pointer to the
  error message. The recorded `error_reason` in the emit log stays the raw
  signature, so `pairflow bubble emit-log` grouping is unaffected.

If two attempts with the same signature fail, stop guessing and re-run
`pairflow agent emit --help`; do not open `src/cli/commands/agent/emit.ts` or the
pass-validation modules to reconstruct the contract.

## The one rule that prevents most failures

**Authority is machine-minted and must be copied, never constructed.**

```bash
pairflow bubble status --id <id> --repo <path> --json
```

Copy `executionContext.handoffId` and `executionContext.executionId` verbatim, and
re-read them immediately before **every** emit (they rotate on each round
transition, convergence, meta-review transition and human reply).

- Never hand-write a handoff or execution id. A transcript message id
  (`msg_...`), a round label (`r6`), or any reconstructed token is rejected as a
  handoff/execution mismatch.
- Never reuse a token from an earlier attempt in the same round.
- If the status JSON has no active `executionContext` (for example state
  `WAITING_HUMAN`, `READY_FOR_HUMAN_APPROVAL`, or an exhausted attempt), there is
  no valid authority to emit against. Stop and wait for the next handoff.

## Do I even owe an emit?

Read the status JSON before emitting, and emit only when the active role is
yours:

- `executionContext.active_role` (or `active_role`) is **not** your role -> you
  do not owe an emit; the loop is waiting on the other agent.
- No active `executionContext` (state `WAITING_HUMAN`,
  `READY_FOR_HUMAN_APPROVAL`, or an exhausted attempt) -> nothing to emit; stop
  and wait for the next handoff.
- A re-delivered or stale resume snapshot in your prompt preamble
  (`active_role=<you>`, an old `attempt:<n>`) is **not** authority. The status
  JSON is. Do not probe with a throwaway emit: a rejected emit is noise, and the
  guard already protects against double-emitting.

This is the single biggest token sink on record: a resumed implementer spent
many turns deciding whether it owed an emit, against a stale prompt snapshot
that named an already-consumed `attempt`. One `bubble status --json` read settles
it.

## Role to kind lock

| Role | Allowed `--kind` |
|---|---|
| implementer | `pass`, `human_question` |
| reviewer | `pass`, `human_question`, `convergence` |
| meta-reviewer | `meta_review_result` **only** |

While meta-review authority is active, `--kind pass` is rejected with
`ACTOR_EMIT_CONTEXT_INVALID`.

## Case 1 — implementer handoff

Findings are reviewer-only: an implementer `pass` must never carry `--finding`.

```bash
pairflow agent emit --kind pass \
  --repo <path> --bubble-id <id> \
  --handoff-id <executionContext.handoffId> --execution-id <executionContext.executionId> \
  --summary "<what changed + what validation ran>" \
  --ref .pairflow/evidence/lint.log --ref .pairflow/evidence/test.log
```

Blocker instead of a handoff:

```bash
pairflow agent emit --kind human_question \
  --repo <path> --bubble-id <id> \
  --handoff-id <executionContext.handoffId> --execution-id <executionContext.executionId> \
  --question "<the blocking decision>"
```

## Case 2 — reviewer decision

The `--kind` and `--intent` are decided by the round gate
(`round >= severity_gate_round` = post-gate):

| Outcome | Round | Emit |
|---|---|---|
| findings at/above blocking threshold | any | `--kind pass --finding "<P0\|P1\|P2\|P3:Title\|ref>"` |
| any findings | pre-gate | `--kind pass --finding ...` (repeatable) |
| truly clean | pre-gate | `--kind pass --no-findings` (bare flag, never `--no-findings=false`) |
| clean | post-gate | `--kind convergence` with no finding flags |
| advisory-only (below threshold) | post-gate | `--kind convergence --finding "P2\|P3:Title"` |
| clean or advisory | post-gate | `--no-findings` is **forbidden** |

```bash
# reviewer, findings (intent is inferred, but be explicit)
pairflow agent emit --kind pass \
  --repo <path> --bubble-id <id> \
  --handoff-id <executionContext.handoffId> --execution-id <executionContext.executionId> \
  --intent fix_request \
  --summary "<review verdict and coverage>" \
  --finding "P1:Title|src/file.ts,src/other.ts" --finding "P3:Title"

# reviewer, clean, pre-gate
pairflow agent emit --kind pass ... --no-findings

# reviewer, clean or advisory-only, post-gate
pairflow agent emit --kind convergence ... --summary "<verdict>"
```

Intent rules: findings require `--intent fix_request`; a clean `--no-findings`
review uses `--intent review` (omitting `--intent` lets the CLI infer it);
`--intent task` is implementer-only. `--finding` and `--no-findings` are mutually
exclusive.

A convergence `--summary` that asserts open findings without `--finding` entries
is rejected with `CONVERGED_SUMMARY_FINDINGS_CONTRADICTION`. Either add the
findings as structured flags or state that the outcome is clean.

## Case 3 — meta-review submit

```bash
pairflow agent emit --kind meta_review_result \
  --repo <path> --bubble-id <id> \
  --handoff-id <executionContext.handoffId> --execution-id <executionContext.executionId> \
  --round <n> --recommendation approve|rework|inconclusive \
  --summary "<meta-review verdict>" \
  --report-json '<inline JSON object>'
```

### Required `--report-json` keys

The parity guard runs on the **raw** `--report-json` object before any
derivation, so these keys must be present in the payload you pass:

| Key | Value |
|---|---|
| `findings_claim_state` | `clean` \| `open_findings` \| `unknown` |
| `findings_claim_source` | `meta_review_artifact` |
| `findings_count` | integer `>= 0`, consistent with the claim |

They are **top-level keys of the JSON object**. The single most common real
failure is nesting `claim_state`/`claim_source` inside a `findings` entry
instead — that payload is rejected with
`META_REVIEW_SCHEMA_INVALID: ... is missing the required top-level claim keys`.

`recommendation=approve` additionally requires the split triplet
`findings_claimed_open_total`, `findings_blocking_open_total` (must be `0`) and
`findings_advisory_open_total`. Every other parity key is derived when omitted.

`--report-json` takes **inline JSON text, never a file path**.

### Minimal valid payloads

Clean approve:

```json
{"findings_claim_state":"clean","findings_claim_source":"meta_review_artifact","findings_count":0,"findings_claimed_open_total":0,"findings_blocking_open_total":0,"findings_advisory_open_total":0}
```

Advisory-only approve (`findings_blocking_open_total` stays `0`):

```json
{"findings_claim_state":"open_findings","findings_claim_source":"meta_review_artifact","findings_count":2,"findings_claimed_open_total":2,"findings_blocking_open_total":0,"findings_advisory_open_total":2}
```

Rework (requires a non-empty `--rework-target-message`):

```json
{"findings_claim_state":"open_findings","findings_claim_source":"meta_review_artifact","findings_count":2,"findings_claimed_open_total":2,"findings_blocking_open_total":2,"findings_advisory_open_total":0,"findings_artifact_ref":"artifacts/findings.json","meta_review_run_id":"run-123","findings_digest_sha256":"<sha256-of-the-final-file>","findings_artifact_status":"available"}
```

Inconclusive:

```json
{"findings_claim_state":"unknown","findings_claim_source":"meta_review_artifact","findings_count":0}
```

Quote the whole JSON argument with single quotes at the shell level, and use
double quotes for all JSON keys/strings.

### Findings digest

`META_REVIEW_FINDINGS_PARITY_GUARD` fires when the digest does not match the
file on disk:

1. Write and finalize `artifacts/findings.json` — do **not** embed a digest
   property inside it.
2. Hash the static file: `sha256sum artifacts/findings.json | awk '{print $1}'`
3. Pass that value as `findings_digest_sha256`.

## Failure to fix

`pairflow agent emit --help` prints this same table. Every rejected emit also
appends its mapped fix to the error message (the recorded `error_reason` stays
the raw signature, so `pairflow bubble emit-log` grouping is unaffected).

| Error signature (exact prefix) | Cause | Fix |
|---|---|---|
| `... is missing the required top-level claim keys findings_claim_state and findings_claim_source` | claim pair nested inside a `findings` entry, or omitted | put both keys directly on the `--report-json` object; the error message prints the corrected payload for your recommendation |
| `meta-review submit report_json.findings_count is required` / `must be a non-negative integer` | count omitted or not an integer | add `findings_count` as a top-level integer |
| `Invalid --report-json value. Must be valid JSON object` (often naming `/tmp/...`) | a file path was passed, or malformed JSON | pass inline JSON text with double-quoted keys/strings, single-quoted as a shell argument |
| `CLAIM_SOURCE_INVALID` | claim state without `meta_review_artifact` source | set `findings_claim_source=meta_review_artifact` whenever `findings_claim_state` is present |
| `META_REVIEW_APPROVE_ADVISORY_SPLIT_REQUIRED` | `approve` without the split triplet | add `findings_claimed_open_total`/`findings_blocking_open_total`/`findings_advisory_open_total` (blocking `0`, claimed = advisory for advisory-only) |
| `META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT` | below-threshold snapshot contradicting the approve payload | keep `recommendation=approve`; re-emit advisory-only metadata with blocking total `0` and the snapshot totals copied into claimed/advisory |
| `META_REVIEW_FINDINGS_PARITY_GUARD` | digest mismatch | re-hash the finalized findings file (see above) |
| `Canonical actor emit handoff mismatch` / `execution mismatch` | stale or constructed authority | re-read `bubble status --json` and copy both tokens verbatim |
| `Canonical actor emit role mismatch` | emitted while another role is active | you do not owe an emit; wait for the handoff to come back to you |
| `Canonical actor emit round mismatch` | emitted for a previous round | re-read `bubble status --json` and emit for the active round |
| `Active actor authority is unavailable for state ...` | emitted after the round moved on (often `WAITING_HUMAN`) | stop; wait for the next handoff instead of emitting |
| `Implementer PASS does not accept findings flags` | `--finding` on an implementer pass | findings are reviewer-only; move them into the summary |
| `REVIEWER_INTENT_OVERRIDE_INVALID` | reviewer findings with `--intent review`, clean with `--intent fix_request`, or `--intent task` | findings ⇒ `fix_request`; clean ⇒ `review`; `task` is implementer-only |
| `FINDINGS_PAYLOAD_INVALID` (`... requires explicit structured findings in post-gate rounds`) | reviewer `pass` in a post-gate round without a threshold-meeting finding | use `--kind convergence` for clean/advisory outcomes |
| `FINDINGS_PAYLOAD_INVALID` (`Reviewer PASS requires explicit findings declaration`) | reviewer `pass` with neither `--finding` nor `--no-findings` | add `--finding` entries or the bare `--no-findings` flag (mutually exclusive) |
| `CONVERGED_SUMMARY_FINDINGS_CONTRADICTION` | convergence summary claims open findings without structured flags | add `--finding` entries or state the outcome is clean |
| `ACTOR_EMIT_INPUT_EXECUTION_ID_MISSING` / `ACTOR_EMIT_FORBIDDEN_EXECUTION_ID_DERIVATION` | `--execution-id` omitted, empty, or derived from `--handoff-id` | copy `executionContext.executionId` verbatim from `bubble status --json` |
| `Missing required option: --<flag>` | a required flag was omitted | add it; required every time: `--repo --bubble-id --handoff-id --execution-id`, plus `--summary`/`--question`/`--round --recommendation --report-json` per kind |
| `Invalid --intent value` / `Invalid --kind value` / `Invalid --expected-role value` | malformed enum value | rebuild from `pairflow agent emit --help` and the role-to-kind lock |
| `ACTOR_EMIT_OPTIONS_INVALID` / `ACTOR_EMIT_CONTEXT_INVALID` | malformed flags or wrong authority context | re-fetch `bubble status --json`, rebuild from the recipe above, retry **once** |
| `spawn git ENOENT` | the emit process could not exec `git` (not on the agent shell `PATH`) | fix `PATH` so `git` resolves, then re-run the same command |

## Anti-loop rule for repeated emit failures

Repeatedly mutating flags is the most expensive failure mode on record: a single
meta-review submit was retried 211 times over ~5 hours on one signature.

1. Retry a corrected command **once**.
2. If the same error signature comes back, stop guessing. Re-read the recipe for
   your case: `pairflow agent emit --help` (self-contained) or this page, and
   rebuild the command from it. Do not read the Pairflow source tree.
3. Never re-emit against stale authority, and never emit while the state shows no
   active `executionContext` or another role is active.

## How these recipes reach the agents

Both agents receive role identity and standing emit rules from file-based role instruction artifacts (`role-<role>.md`) in the bubble workspace, plus `pairflow agent emit --help` and the guard error messages.

`minimalPastedGuidance` is `true` for both, so per-handoff deliveries stay short on
purpose. The runtime channel matrix lives in
`docs/architecture/agent-runtime-profiles.md`.

## Reading the struggle log

Every emit attempt (success and rejection) is appended best-effort to:

- `.pairflow/bubbles/<id>/emit-history.ndjson` — the bubble-scoped log
- `.pairflow/runtime/emit-history.ndjson` — the repo runtime log, used when the
  bubble could not be resolved from the argv

Each line records `ts`, `bubble_id`, `repo`, `role`, `kind`, `status`,
`error_reason`, the full `args` argv and `duration_ms`.

Group the rejections by signature:

```bash
pairflow bubble emit-log --id <id> [--repo <path>] [--json]
pairflow bubble emit-log [--repo <path>] [--json]
pairflow bubble emit-log --log <path-to-emit-history.ndjson> [--json]
```

The report prints totals, the failure rate, and each failure signature ordered by
descending count with its time window and the flag skeleton of an example
attempt. Use `--log` for a log whose bubble no longer resolves (for example after
`bubble delete`).
