# Agent Emit Troubleshooting

Use this reference when a role keeps failing `pairflow agent emit` calls.

## Emit preflight (run before every emit)

1. Refresh authority: `pairflow bubble status --id <id> --repo <path> --json`.
2. Copy fresh values from JSON: `executionContext.handoffId`, `executionContext.executionId`.
3. Use explicit authority flags every time:
   - `--repo <path>`
   - `--bubble-id <id>`
   - `--handoff-id <handoff-id>`
   - `--execution-id <execution-id>`
4. Never leave authority args empty and never reuse stale IDs.

## Role to kind lock

- Implementer: `pass`, `human_question`
- Reviewer: `pass`, `convergence`, `human_question`
- Meta-reviewer: `meta_review_result` only

If meta-review authority is active and you emit `--kind pass`, Pairflow rejects with `ACTOR_EMIT_CONTEXT_INVALID`.

## Common invalid forms and fixes

### Missing authority values

Invalid:

```bash
pairflow agent emit --kind pass ... --handoff-id "" --execution-id ""
```

Fix: fetch fresh status JSON and copy real authority IDs.

### Reviewer clean claim flag misuse

Invalid:

```bash
pairflow agent emit --kind pass ... --no-findings=false
```

Fix:

- `--no-findings` is a bare flag (no value), or
- omit it and provide one or more `--finding` entries.

### Meta-review report JSON quoting

Invalid:

```bash
pairflow agent emit --kind meta_review_result ... --report-json '{...malformed...}'
```

Fix:

- `--report-json` must be valid JSON object text.
- Use double-quoted keys/strings inside JSON.
- Wrap the full JSON argument in single quotes at the shell level.

Example:

```bash
pairflow agent emit --kind meta_review_result \
  --repo <repo> --bubble-id <id> --handoff-id <handoff-id> --execution-id <execution-id> \
  --round <n> --recommendation approve --summary "..." \
  --report-json '{"findings_claim_state":"clean","findings_claim_source":"meta_review_artifact","findings_count":0,"findings_claimed_open_total":0,"findings_blocking_open_total":0,"findings_advisory_open_total":0,"findings_artifact_ref":"artifacts/findings.json","meta_review_run_id":"run-123","findings_digest_sha256":"<sha256>","findings_artifact_status":"available"}'
```

### Meta-review findings digest mismatch (`META_REVIEW_FINDINGS_PARITY_GUARD`)

Invalid:
- Placing a `digest` or `findings_digest_sha256` property inside the `artifacts/findings.json` file and trying to self-hash.
- Editing `artifacts/findings.json` after calculating its SHA-256 hash.

Fix:
1. Write and finalize `artifacts/findings.json` (do **not** embed a digest property inside the file).
2. Calculate the SHA-256 hash of the static file on disk:
   ```bash
   sha256sum artifacts/findings.json | awk '{print $1}'
   ```
3. Pass that computed hash into `findings_digest_sha256` in `--report-json`.


## Recovery rule for repeated emit failures

If emit fails with `ACTOR_EMIT_OPTIONS_INVALID` or `ACTOR_EMIT_CONTEXT_INVALID`:

1. Stop retrying mutated variants.
2. Re-fetch `bubble status --json`.
3. Rebuild from canonical template for your role.
4. Retry once with fresh authority.
