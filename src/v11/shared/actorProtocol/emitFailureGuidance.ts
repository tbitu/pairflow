/**
 * Self-teaching guidance for `pairflow agent emit` failures.
 *
 * Derived from the recorded emit-attempt logs across the local repos that use
 * Pairflow (`.pairflow/bubbles/<id>/emit-history.ndjson`). The largest cost is
 * not the failed emit itself but the agent hunting for the right command
 * afterwards: on record an agent read the Pairflow source tree to reconstruct
 * the contract because no `--help` entry point pointed at the recipe. This
 * module is the one place that maps a failure signature to the corrective
 * action, so the CLI error output, `pairflow agent emit --help`, the role
 * prompts and the skill recipe stay in agreement.
 *
 * The table is ordered most-specific first: the first matching row wins.
 */

export interface EmitFailureFixRow {
  /** Reason code or distinctive message fragment that identifies the failure. */
  signature: string;
  /** One-line corrective action for the emitting agent. */
  fix: string;
}

export const emitFailureFixTable: readonly EmitFailureFixRow[] = [
  {
    signature: "ACTOR_EMIT_INPUT_EXECUTION_ID_MISSING",
    fix: "add `--execution-id`: copy `executionContext.executionId` verbatim from `pairflow bubble status --id <id> --repo <path> --json`; never derive it from `--handoff-id`."
  },
  {
    signature: "ACTOR_EMIT_FORBIDDEN_EXECUTION_ID_DERIVATION",
    fix: "copy `--execution-id` from `executionContext.executionId` in `pairflow bubble status --json`; it must be a real token, never the handoff id or a reconstructed value."
  },
  {
    signature: "Active actor authority is unavailable for state",
    fix: "the bubble has no active `executionContext` right now, so you do not owe an emit. Stop and wait for the next handoff instead of emitting against a stale or absent snapshot."
  },
  {
    signature: "Canonical actor emit handoff mismatch",
    fix: "re-read `pairflow bubble status --id <id> --repo <path> --json` and copy `executionContext.handoffId` verbatim; a token from an earlier attempt or round is rejected on purpose."
  },
  {
    signature: "Canonical actor emit execution mismatch",
    fix: "re-read `pairflow bubble status --id <id> --repo <path> --json` and copy `executionContext.executionId` verbatim; a transcript id (`msg_*`) or round label (`r6`) is rejected."
  },
  {
    signature: "Canonical actor emit role mismatch",
    fix: "you are not the active role for this handoff. Check `active_role` in `pairflow bubble status --json`; if it is not your role, do not emit - the loop is waiting on the other agent."
  },
  {
    signature: "Canonical actor emit round mismatch",
    fix: "re-read `pairflow bubble status --json` and emit for the active round only."
  },
  {
    signature: "ACTOR_EMIT_CONTEXT_INVALID",
    fix: "wrong authority context or kind for the active role. Re-read `pairflow bubble status --json`, then emit with the role's own kind (implementer => pass|human_question; reviewer => pass|convergence|human_question; meta-reviewer => meta_review_result only)."
  },
  {
    signature: "Implementer PASS does not accept findings flags",
    fix: "drop every `--finding`; findings are reviewer-only. Move reviewer notes into the `--summary` text."
  },
  {
    signature: "REVIEWER_INTENT_OVERRIDE_INVALID",
    fix: "reviewer intent follows the findings declaration: findings => `--intent fix_request`; clean `--no-findings` => `--intent review` (or omit `--intent`); `--intent task` is implementer-only."
  },
  {
    signature: "requires explicit structured findings in post-gate rounds",
    fix: "a post-gate reviewer clean/advisory outcome (`round >= severity_gate_round`) must use `--kind convergence`, not `--kind pass`."
  },
  {
    signature: "Reviewer PASS requires explicit findings declaration",
    fix: "a clean reviewer pass needs the bare `--no-findings` flag; a reviewer pass with findings needs `--finding \"<P0|P1|P2|P3:Title[|ref]\"` (repeatable). Never pass both."
  },
  {
    signature: "CONVERGED_SUMMARY_FINDINGS_CONTRADICTION",
    fix: "a convergence `--summary` that asserts open findings needs structured flags: add `--finding` entries, or state explicitly that the outcome is clean."
  },
  {
    signature: "CLAIM_SOURCE_INVALID",
    fix: "set `findings_claim_source` to `meta_review_artifact` in `--report-json` whenever `findings_claim_state` is present."
  },
  {
    signature: "META_REVIEW_APPROVE_ADVISORY_SPLIT_REQUIRED",
    fix: "`approve` requires the split triplet: `findings_claimed_open_total`, `findings_blocking_open_total` (`0`) and `findings_advisory_open_total`."
  },
  {
    signature: "META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT",
    fix: "keep `recommendation=approve` for a below-threshold snapshot: re-emit advisory-only metadata with `findings_claim_state=open_findings`, blocking total `0`, and the snapshot totals copied into claimed/advisory."
  },
  {
    signature: "META_REVIEW_FINDINGS_PARITY_GUARD",
    fix: "digest mismatch: do not embed a digest inside the findings file; hash the finalized file on disk (`sha256sum artifacts/findings.json`) and pass that value as `findings_digest_sha256`."
  },
  {
    signature: "findings_claim_state",
    fix: "add `findings_claim_state` and `findings_claim_source` as top-level keys of the `--report-json` object (never nested inside a `findings` entry)."
  },
  {
    signature: "findings_count",
    fix: "add a top-level integer `findings_count` consistent with the claim: `open_findings` => >0, `clean` => 0."
  },
  {
    signature: "Invalid --report-json value",
    fix: "pass inline JSON text single-quoted at the shell level (`--report-json '{\"findings_claim_state\":\"clean\",...}'`); a file path such as `/tmp/report.json` is not accepted."
  },
  {
    signature: "Missing required option",
    fix: "add the named flag. Required every time: `--repo --bubble-id --handoff-id --execution-id`; `pass`/`convergence` also need `--summary` (plus `--no-findings` or `--finding`), `human_question` needs `--question`, and `meta_review_result` needs `--round --recommendation --report-json`."
  },
  {
    signature: "Invalid --intent value",
    fix: "use `--intent task` (implementer), `review` (clean reviewer pass) or `fix_request` (reviewer findings)."
  },
  {
    signature: "Invalid --kind value",
    fix: "follow the role-to-kind lock: implementer => `pass|human_question`; reviewer => `pass|convergence|human_question`; meta-reviewer => `meta_review_result` only."
  },
  {
    signature: "Invalid --expected-role value",
    fix: "use one of `implementer`, `reviewer`, `meta_reviewer`."
  },
  {
    signature: "ACTOR_EMIT_OPTIONS_INVALID",
    fix: "a flag is missing or misspelled. Rebuild the command from `pairflow agent emit --help` for your role instead of mutating flags one at a time."
  },
  {
    signature: "ENOENT",
    fix: "the emit process could not spawn a required binary (commonly `git`). Ensure `git` is on `PATH` for the agent shell, then re-run the same command."
  }
];

/**
 * The recipe locations an agent can resolve. Shared by the CLI help, the role
 * prompts and the skill so the pointer cannot drift to a path that does not
 * exist (an earlier pointer named `~/.agents/skills/UsePairflow`, which the
 * skills installer never writes - only `PF-*` role definitions land there).
 */
export const emitRecipeLocationLine =
  "load the `UsePairflow` skill and read `references/agent-emit-recipes.md`, or read that file from an installed skill root (`~/.reasonix/skills/UsePairflow/references/agent-emit-recipes.md`, `~/.config/opencode/skills/UsePairflow/references/agent-emit-recipes.md`, `~/.opencode/skills/UsePairflow/references/agent-emit-recipes.md`, `~/.claude/skills/UsePairflow/references/agent-emit-recipes.md`)";

export function buildEmitFailureFix(message: string): string | undefined {
  for (const row of emitFailureFixTable) {
    if (message.includes(row.signature)) {
      return row.fix;
    }
  }
  return undefined;
}

/**
 * Hint appended to a rejected emit's thrown message. Kept short (one fix line
 * plus the help pointer) because it is printed alongside every failure.
 */
export function buildEmitFailureHint(message: string): string {
  const fix = buildEmitFailureFix(message);
  const lines = fix === undefined
    ? [
      "No mapped fix for this signature. Rebuild the command from `pairflow agent emit --help`; if it fails again with the same signature, stop guessing and read the recipe:"
    ]
    : [`Fix: ${fix}`];
  lines.push(
    `Recipes: run \`pairflow agent emit --help\`, or ${emitRecipeLocationLine}.`
  );
  return `\n${lines.join("\n")}`;
}
