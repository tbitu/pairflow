import {
  confirmTmuxPaneMarkerSubmission,
  maybeAcceptClaudeTrustPrompt,
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput
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
  implementerBootstrapMessage?: string | undefined;
  reviewerBootstrapMessage?: string | undefined;
  metaReviewerBootstrapMessage?: string | undefined;
  implementerKickoffMessage?: string | undefined;
  reviewerKickoffMessage?: string | undefined;
  metaReviewerKickoffMessage?: string | undefined;
}

function resolvePairflowPaneMessageMarker(message: string): string | undefined {
  const match = /\[pairflow\]\s+bubble=\S+/u.exec(message);
  return match?.[0];
}

async function submitStartupPrompt(
  runner: TmuxRunner,
  targetPane: string,
  shouldSubmit: boolean | undefined
): Promise<void> {
  if (!shouldSubmit) {
    return;
  }

  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, 1500);
  });
  await submitTmuxPaneInput(runner, targetPane);
}

async function sendPaneMessage(
  runner: TmuxRunner,
  targetPane: string,
  message: string | undefined
): Promise<void> {
  if ((message?.trim().length ?? 0) === 0) {
    return;
  }

  await maybeAcceptClaudeTrustPrompt(runner, targetPane).catch(() => undefined);
  const concreteMessage = message as string;
  await sendAndSubmitTmuxPaneMessage(runner, targetPane, concreteMessage);
  const marker = resolvePairflowPaneMessageMarker(concreteMessage);
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
  await submitStartupPrompt(
    input.runner,
    input.implementerPaneId,
    input.implementerSubmitStartupPrompt
  );
  await submitStartupPrompt(
    input.runner,
    input.reviewerPaneId,
    input.reviewerSubmitStartupPrompt
  );
  await submitStartupPrompt(
    input.runner,
    input.metaReviewerPaneId,
    input.metaReviewerSubmitStartupPrompt
  );
  // When a startup prompt was submitted for an agent (e.g. Codex), the agent
  // already received its full context via the CLI argument that launched it.
  // Sending a separate bootstrap+kickoff message through tmux paste would
  // deliver semi-duplicate content as a second input, causing "double input"
  // steering confusion. Skip the pasted message for agents whose startup
  // prompt was already submitted.
  if (input.implementerSubmitStartupPrompt !== true) {
    await sendPaneMessage(
      input.runner,
      input.implementerPaneId,
      mergeAndDeduplicateMessages(input.implementerBootstrapMessage, input.implementerKickoffMessage)
    );
  }
  if (input.reviewerSubmitStartupPrompt !== true) {
    await sendPaneMessage(
      input.runner,
      input.reviewerPaneId,
      mergeAndDeduplicateMessages(input.reviewerBootstrapMessage, input.reviewerKickoffMessage)
    );
  }
  if (input.metaReviewerSubmitStartupPrompt !== true) {
    await sendPaneMessage(
      input.runner,
      input.metaReviewerPaneId,
      mergeAndDeduplicateMessages(input.metaReviewerBootstrapMessage, input.metaReviewerKickoffMessage)
    );
  }
}
