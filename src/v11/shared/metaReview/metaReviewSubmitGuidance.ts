const metaReviewSubmitReportJsonParityFields =
  '{"findings_claim_state":"clean|open_findings|unknown","findings_claim_source":"meta_review_artifact","findings_count":<int>,"findings_claimed_open_total":<int>,"findings_blocking_open_total":<int>,"findings_advisory_open_total":<int>,"findings_artifact_ref":"artifacts/<findings>.json","meta_review_run_id":"<run-id>","findings_digest_sha256":"<sha256>","findings_artifact_status":"available"}';

const metaReviewSubmitApproveParityNote = [
  "Clean approve requires zero open findings.",
  "For recommendation=approve, split fields are mandatory, findings_claimed_open_total = findings_blocking_open_total + findings_advisory_open_total, and findings_blocking_open_total must be 0.",
  "Advisory-only approve is still recommendation=approve only when the same-run highest open severity is below review_policy.meta_review_auto_rework_min_severity: use findings_claim_state=open_findings, keep findings_blocking_open_total=0, set a positive findings_advisory_open_total, and do not switch to inconclusive when the latest same-round reviewer snapshot is advisory-only.",
  "When any same-run open finding meets or exceeds review_policy.meta_review_auto_rework_min_severity, do not emit recommendation=approve; emit recommendation=rework with a rework target message."
].join(" ");

const metaReviewSubmitAdvisoryOnlyCorrectionNote =
  "Valid correction for advisory-only reviewer-snapshot conflicts: keep recommendation=approve, do not switch to inconclusive, and re-emit advisory-only approve metadata (findings_claim_state=open_findings; findings_count>0; findings_claimed_open_total=findings_count; findings_blocking_open_total=0; findings_advisory_open_total=findings_count). If the conflict message includes snapshot totals (for example claimed=0 snapshot_open_total=2), copy the snapshot totals into findings_count/findings_claimed_open_total/findings_advisory_open_total and keep blocking total at 0.";

const metaReviewSubmitFailureRecoveryChecklist =
  "Meta-review submit failure recovery: Invalid --report-json -> rebuild as valid JSON object with double-quoted keys/strings; CLAIM_SOURCE_INVALID -> set findings_claim_source=meta_review_artifact whenever findings_claim_state is present; findings_count required/invalid -> set findings_count to a non-negative integer and keep claim/count tuple consistent (open_findings => findings_count>0, clean => findings_count=0); META_REVIEW_GATE_REVIEWER_CONVERGENCE_CONFLICT with snapshot totals -> copy snapshot_open_total/snapshot_advisory into findings_count/findings_claimed_open_total/findings_advisory_open_total and keep findings_blocking_open_total=0 for advisory-only approve.";

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

export function buildMetaReviewSubmitApproveParityNote(): string {
  return metaReviewSubmitApproveParityNote;
}

export function buildMetaReviewSubmitAdvisoryOnlyCorrectionNote(): string {
  return metaReviewSubmitAdvisoryOnlyCorrectionNote;
}

export function buildMetaReviewSubmitFailureRecoveryChecklist(): string {
  return metaReviewSubmitFailureRecoveryChecklist;
}
