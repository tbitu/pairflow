import type {
  MetaReviewGateNotifyRuntimeCapabilities,
  MetaReviewGateNotifyTmuxCapabilities,
  MetaReviewGatePaneBindingRuntimeCapabilities,
  MetaReviewGatePaneBindingTmuxCapabilities
} from "../../shared/metaReviewGate/metaReviewGateRuntimeCapabilities.js";

function hasDefinedValues(record: Record<string, unknown>): boolean {
  return Object.values(record).some((value) => value !== undefined);
}

export function resolveMetaReviewGateNotifyTmuxCapabilities(
  runtime: MetaReviewGateNotifyRuntimeCapabilities | undefined
): MetaReviewGateNotifyTmuxCapabilities | undefined {
  const runner = runtime?.tmux?.runner;
  const resolveAgentPaneAdapter = runtime?.tmux?.resolveAgentPaneAdapter;
  const sendSubmissionRequestMessage = runtime?.tmux?.sendSubmissionRequestMessage;
  const confirmSubmission = runtime?.tmux?.confirmSubmission;
  const resolved = {
    ...(runner !== undefined ? { runner } : {}),
    ...(resolveAgentPaneAdapter !== undefined ? { resolveAgentPaneAdapter } : {}),
    ...(sendSubmissionRequestMessage !== undefined
      ? { sendSubmissionRequestMessage }
      : {}),
    ...(confirmSubmission !== undefined ? { confirmSubmission } : {})
  };

  return hasDefinedValues(resolved) ? resolved : undefined;
}

export function resolveMetaReviewGatePaneBindingTmuxCapabilities(
  runtime: MetaReviewGatePaneBindingRuntimeCapabilities | undefined
): MetaReviewGatePaneBindingTmuxCapabilities | undefined {
  const runner = runtime?.tmux?.runner;
  const resolveAgentPaneAdapter = runtime?.tmux?.resolveAgentPaneAdapter;
  const respawnPaneCommand = runtime?.tmux?.respawnPaneCommand;
  const deactivateOtherRolePanes = runtime?.tmux?.deactivateOtherRolePanes;
  const waitForPaneReady = runtime?.tmux?.waitForPaneReady;
  const sendSubmissionRequestMessage = runtime?.tmux?.sendSubmissionRequestMessage;
  const resolved = {
    ...(runner !== undefined ? { runner } : {}),
    ...(resolveAgentPaneAdapter !== undefined ? { resolveAgentPaneAdapter } : {}),
    ...(respawnPaneCommand !== undefined ? { respawnPaneCommand } : {}),
    ...(deactivateOtherRolePanes !== undefined ? { deactivateOtherRolePanes } : {}),
    ...(waitForPaneReady !== undefined ? { waitForPaneReady } : {}),
    ...(sendSubmissionRequestMessage !== undefined ? { sendSubmissionRequestMessage } : {})
  };

  return hasDefinedValues(resolved) ? resolved : undefined;
}
