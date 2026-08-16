import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered
} from "../../../shared/agent/agentRuntimeProfiles.js";
import {
  confirmTmuxPaneMarkerSubmission,
  maybeAcceptOpencodeTrustPrompt,
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput,
  waitForTuiReady
} from "./tmuxInput.js";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

/**
 * Merge bootstrap and kickoff messages into a single message, deduplicating lines.
 *
 * Whitespace normalization: each line is trimmed before comparison and inclusion
 * in the output. This means leading/trailing whitespace on individual lines is
 * intentionally discarded so that duplicate content differing only by surrounding
 * whitespace is treated as a true duplicate. The resulting merged message uses
 * single \n line separators with no extra blank lines between entries.
 */
export function mergeAndDeduplicateMessages(bootstrap: string | undefined, kickoff: string | undefined): string | undefined {
  const bootstrapText = (bootstrap ?? "").trim();
  const kickoffText = (kickoff ?? "").trim();
  if ((bootstrapText.length + kickoffText.length) === 0) {
    return undefined;
  }

  // Merge both sources and deduplicate exact lines while preserving order.
  // Lines are trimmed to normalize whitespace and avoid near-duplicates.
  const allLines: string[] = [];
  const seen = new Set<string>();
  for (const raw of [bootstrapText, kickoffText]) {
    if (raw.length === 0) continue;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        allLines.push(trimmed);
      }
    }
  }

  return allLines.join("\n");
}



export interface SeedBubbleTmuxPaneMessagesInput {
  runner: TmuxRunner;
  implementerPaneId: string;
  reviewerPaneId: string;
  metaReviewerPaneId: string;
  implementerSubmitStartupPrompt?: boolean | undefined;
  reviewerSubmitStartupPrompt?: boolean | undefined;
  metaReviewerSubmitStartupPrompt?: boolean | undefined;
  implementerStartupPrompt?: string | undefined;
  reviewerStartupPrompt?: string | undefined;
  metaReviewerStartupPrompt?: string | undefined;
  implementerBootstrapMessage?: string | undefined;
  reviewerBootstrapMessage?: string | undefined;
  metaReviewerBootstrapMessage?: string | undefined;
  implementerKickoffMessage?: string | undefined;
  reviewerKickoffMessage?: string | undefined;
  implementerAgentName: AgentName | undefined;
  reviewerAgentName: AgentName | undefined;
  metaReviewerAgentName: AgentName | undefined;
  metaReviewerKickoffMessage?: string | undefined;
}

function resolvePairflowPaneMessageMarker(message: string): string | undefined {
  const match = /\[pairflow\]\s+bubble=\S+/u.exec(message);
  return match?.[0];
}

async function submitStartupPrompt(input: {
  runner: TmuxRunner;
  targetPane: string;
  shouldSubmit: boolean | undefined;
  startupPrompt: string | undefined;
}): Promise<void> {
  if (!input.shouldSubmit) {
    return;
  }

  const promptText = input.startupPrompt?.trim();
  if (promptText !== undefined && promptText.length > 0) {
    // tmux_paste agents (reasonix) receive their startup prompt through the
    // pane instead of CLI args; give the TUI time to initialize first.
    await waitForTuiReady(input.runner, input.targetPane);
    await sendAndSubmitTmuxPaneMessage(
      input.runner,
      input.targetPane,
      promptText,
      { maxChunkLength: 1024 }
    );
    return;
  }

  // Legacy opencode reviewer path: the startup prompt was delivered via CLI
  // args; a bare Enter submits the resulting prompt/trust state.
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, 1500);
  });
  await submitTmuxPaneInput(input.runner, input.targetPane);
}

async function sendPaneMessage(
  runner: TmuxRunner,
  targetPane: string,
  agentName: AgentName | undefined,
  message: string | undefined
): Promise<void> {
  if ((message?.trim().length ?? 0) === 0) {
    return;
  }

  // Only opencode shows folder-trust / bypass-permissions prompts that need
  // accepting during pane bootstrap (see agent runtime profiles). Undefined or
  // unknown agents keep the historical opencode-default behavior.
  const trustPromptHandling =
    agentName !== undefined && isAgentNameRegistered(agentName)
      ? getAgentRuntimeProfile(agentName).trustPromptHandling
      : "opencode";
  if (trustPromptHandling === "opencode") {
    await maybeAcceptOpencodeTrustPrompt(runner, targetPane).catch(() => undefined);
  }
  const concreteMessage = message as string;
  const marker = resolvePairflowPaneMessageMarker(concreteMessage);
  const isStructuredPairflowEnvelope = marker !== undefined;
  // Give the TUI time to initialize during very early pane bootstrap
  // before submitting the whole prompt as one tmux input.
  // Fail closed on write/submit failures so launch does not report success
  // with a silently missing startup handoff.
  await waitForTuiReady(runner, targetPane);
  await sendAndSubmitTmuxPaneMessage(runner, targetPane, concreteMessage, {
    requireSuccess: !isStructuredPairflowEnvelope,
    maxChunkLength: 1024
  });
  if (marker !== undefined) {
    await confirmTmuxPaneMarkerSubmission({
      runner,
      targetPane,
      marker
    });
  }
}

export async function seedBubbleTmuxPaneMessages(
  input: SeedBubbleTmuxPaneMessagesInput
): Promise<void> {
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.implementerPaneId,
    shouldSubmit: input.implementerSubmitStartupPrompt,
    startupPrompt: input.implementerStartupPrompt
  });
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.reviewerPaneId,
    shouldSubmit: input.reviewerSubmitStartupPrompt,
    startupPrompt: input.reviewerStartupPrompt
  });
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.metaReviewerPaneId,
    shouldSubmit: input.metaReviewerSubmitStartupPrompt,
    startupPrompt: input.metaReviewerStartupPrompt
  });
  // When a startup prompt was submitted for an agent, the agent already
  // received its full context via the CLI argument that launched it
  // (opencode) or via the startup prompt paste (reasonix). Sending a separate
  // bootstrap+kickoff message through tmux paste would deliver semi-duplicate
  // content as a second input for opencode ("double input" steering confusion).
  //
  // reasonix uses a two-paste model: the role-identity startup prompt is the
  // FIRST paste, and pairflow's per-task guidance is the SECOND paste
  // (kickoff). These are intentionally distinct — role instructions are
  // constant, per-task guidance varies. So for tmux_paste agents the kickoff
  // is always delivered even when a startup prompt was submitted.

  if (!shouldSkipKickoffAfterStartup(input.implementerAgentName, input.implementerSubmitStartupPrompt === true)) {
    await sendPaneMessage(
      input.runner,
      input.implementerPaneId,
      input.implementerAgentName,
      mergeAndDeduplicateMessages(input.implementerBootstrapMessage, input.implementerKickoffMessage)
    );
  }
  if (!shouldSkipKickoffAfterStartup(input.reviewerAgentName, input.reviewerSubmitStartupPrompt === true)) {
    await sendPaneMessage(
      input.runner,
      input.reviewerPaneId,
      input.reviewerAgentName,
      mergeAndDeduplicateMessages(input.reviewerBootstrapMessage, input.reviewerKickoffMessage)
    );
  }
  if (!shouldSkipKickoffAfterStartup(input.metaReviewerAgentName, input.metaReviewerSubmitStartupPrompt === true)) {
    await sendPaneMessage(
      input.runner,
      input.metaReviewerPaneId,
      input.metaReviewerAgentName,
      mergeAndDeduplicateMessages(input.metaReviewerBootstrapMessage, input.metaReviewerKickoffMessage)
    );
  }
}

/**
 * Decide whether the per-task kickoff paste should be skipped after a role
 * startup prompt was already submitted for an agent.
 *
 * Returns false (deliver the kickoff) whenever no startup prompt was submitted,
 * and for tmux_paste agents (reasonix) even when a startup prompt was
 * submitted — reasonix uses a two-paste model (role startup, then per-task
 * kickoff). Only non-tmux_paste agents (opencode) and unknown agents retain the
 * historical "double input" skip after a startup prompt.
 */
export function shouldSkipKickoffAfterStartup(
  agentName: AgentName | undefined,
  submitted: boolean
): boolean {
  if (!submitted) {
    return false;
  }
  if (agentName !== undefined && isAgentNameRegistered(agentName)) {
    return getAgentRuntimeProfile(agentName).startupPromptDelivery !== "tmux_paste";
  }
  // Unknown/undefined agents keep the historical opencode-default skip.
  return true;
}
