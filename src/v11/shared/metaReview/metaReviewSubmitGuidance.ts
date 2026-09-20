import type {
  MetaReviewRecommendation
} from "./metaReviewTypes.js";

const metaReviewSubmitReportJsonParityFields =
  '{"findings_claim_state":"clean|open_findings|unknown","findings_claim_source":"meta_review_artifact","findings_count":<int>,"findings_claimed_open_total":<int>,"findings_blocking_open_total":<int>,"findings_advisory_open_total":<int>,"findings_artifact_ref":"artifacts/<findings>.json","meta_review_run_id":"<run-id>","findings_digest_sha256":"<sha256>","findings_artifact_status":"available"}';

/**
 * The three keys the raw `--report-json` must carry itself.
 *
 * Every other parity key is derived by the command when omitted, but the claim
 * tuple is authoritative input: the parity guard runs on the raw `--report-json`
 * object before canonicalization, so a payload without these keys fails closed.
 * This is the single most frequent real-world emit failure (an agent nesting
 * `claim_state`/`claim_source` inside a `findings` entry instead of passing the
 * two top-level keys), so the wording spells out both the requirement and the
 * wrong shape.
 */
const metaReviewSubmitRequiredReportJsonFieldsLine =
  "Required `--report-json` keys (all three are top-level keys of the JSON object): `findings_claim_state` (clean|open_findings|unknown), `findings_claim_source` (meta_review_artifact), `findings_count` (integer >= 0). Never nest `claim_state`/`claim_source` inside a `findings` entry - the parity guard reads the top-level keys of the raw `--report-json` before any derivation, and an omitted claim pair fails closed as META_REVIEW_SCHEMA_INVALID. For recommendation=approve the split fields `findings_claimed_open_total`, `findings_blocking_open_total` and `findings_advisory_open_total` are additionally required. Every other parity key is derived when omitted. `--report-json` always takes inline JSON text - never a file path.";

const metaReviewSubmitApproveParityNote = [
  "Clean approve requires zero open findings.",
  "For recommendation=approve, split fields are mandatory, findings_claimed_open_total = findings_blocking_open_total + findings_advisory_open_total, and findings_blocking_open_total must be 0.",
  "Advisory-only approve is still recommendation=approve only when the same-run highest open severity is below review_policy.meta_review_auto_rework_min_severity: use findings_claim_state=open_findings, keep findings_blocking_open_total=0, set a positive findings_advisory_open_total, and do not switch to inconclusive when the latest same-round reviewer snapshot is advisory-only.",
  "When any same-run open finding meets or exceeds review_policy.meta_review_auto_rework_min_severity, do not emit recommendation=approve; emit recommendation=rework with a rework target message."
].join(" ");

const metaReviewSubmitAdvisoryOnlyCorrectionNote =
  "Valid correction for advisory-only reviewer-snapshot conflicts: keep recommendation=approve, do not switch to inconclusive, and re-emit advisory-only approve metadata (findings_claim_state=open_findings; findings_count>0; findings_claimed_open_total=findings_count; findings_blocking_open_total=0; findings_advisory_open_total=findings_count). If the conflict message includes snapshot totals (for example claimed=0 snapshot_open_total=2), copy the snapshot totals into findings_count/findings_claimed_open_total/findings_advisory_open_total and keep blocking total at 0.";

const metaReviewSubmitFailureRecoveryChecklist =
  "Meta-review submit failure recovery: Invalid --report-json -> rebuild as valid JSON object with double-quoted keys/strings and pass the JSON text inline (a path such as /tmp/report.json is not accepted); missing findings_claim_state/findings_claim_source -> add both as top-level keys of the object (never inside a `findings` entry) and keep findings_count consistent with the claim; CLAIM_SOURCE_INVALID -> set findings_claim_source=meta_review_artifact whenever findings_claim_state is present; findings_count required/invalid -> set findings_count to a non-negative integer and keep claim/count tuple consistent (open_findings => findings_count>0, clean => findings_count=0); META_REVIEW_APPROVE_ADVISORY_SPLIT_REQUIRED -> add findings_claimed_open_total/findings_blocking_open_total/findings_advisory_open_total with blocking=0 and claimed=advisory for advisory-only approve; META_REVIEW_FINDINGS_PARITY_GUARD digest mismatch -> do not embed a digest inside the findings JSON file, compute sha256 of the static file on disk and pass it in findings_digest_sha256; META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT with snapshot totals -> copy snapshot_open_total/snapshot_advisory into findings_count/findings_claimed_open_total/findings_advisory_open_total and keep findings_blocking_open_total=0 for advisory-only approve.";

const metaReviewSubmitCorrectedReportJsonByRecommendation = {
  approve:
    '{"findings_claim_state":"clean","findings_claim_source":"meta_review_artifact","findings_count":0,"findings_claimed_open_total":0,"findings_blocking_open_total":0,"findings_advisory_open_total":0}',
  rework:
    '{"findings_claim_state":"open_findings","findings_claim_source":"meta_review_artifact","findings_count":<open-count>,"findings_claimed_open_total":<open-count>,"findings_blocking_open_total":<blocking-count>,"findings_advisory_open_total":<advisory-count>}',
  inconclusive:
    '{"findings_claim_state":"unknown","findings_claim_source":"meta_review_artifact","findings_count":0}'
} as const satisfies Record<MetaReviewRecommendation, string>;

/**
 * Minimal `--report-json` value that satisfies the raw-payload parity guards for
 * a given recommendation. Used to make submit failures self-teaching: the error
 * message carries the corrected payload instead of only naming the missing keys.
 */
export function buildMetaReviewSubmitCorrectedReportJson(input: {
  recommendation: MetaReviewRecommendation;
}): string {
  return metaReviewSubmitCorrectedReportJsonByRecommendation[input.recommendation];
}

export function buildMetaReviewSubmitUsageLine(): string {
  return "pairflow agent emit --kind meta_review_result --repo <path> --bubble-id <id> --handoff-id <id> --execution-id <id> --round <n> --recommendation approve|rework|inconclusive --summary <text> [--rework-target-message <text>] --report-json <json> [--ref <artifact-path>]...";
}

export function buildMetaReviewSubmitCommandTemplate(input?: {
  bubbleId?: string;
  round?: number;
}): string {
  const bubbleId = input?.bubbleId ?? "<id>";
  const round = input?.round === undefined ? "<n>" : String(input.round);
  return `pairflow agent emit --kind meta_review_result --repo <repo> --bubble-id ${bubbleId} --handoff-id <handoff-id> --execution-id <execution-id> --round ${round} --recommendation <approve|rework|inconclusive> --summary "<summary>" [--rework-target-message "<message>"] --report-json '${metaReviewSubmitReportJsonParityFields}'`;
}

export function buildMetaReviewSubmitAuthorityGuardLine(): string {
  return "Authority/kind lock: while meta-reviewer authority is active, emit `--kind meta_review_result` only (never `pass`, `convergence`, or `human_question`).";
}

export function buildMetaReviewSubmitRequiredReportJsonFieldsLine(): string {
  return metaReviewSubmitRequiredReportJsonFieldsLine;
}

export function buildMetaReviewSubmitApproveParityNote(): string {
  return metaReviewSubmitApproveParityNote;
}

export function buildMetaReviewSubmitAdvisoryOnlyCorrectionNote(): string {
  return metaReviewSubmitAdvisoryOnlyCorrectionNote;
}

export function buildMetaReviewSubmitFailureRecoveryChecklist(): string {
  return metaReviewSubmitFailureRecoveryChecklist;
}
