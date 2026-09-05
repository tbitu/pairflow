import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import type { AgentPaneAdapter } from "../../../shared/agent/agentPaneAdapter.js";
import {
  checkTmuxPaneMarkerStatus,
  confirmTmuxPaneMarkerSubmission
} from "./tmuxPaneMarkerConfirmation.js";
import {
  sendAndSubmitTmuxPaneMessage,
  submitTmuxPaneInput
} from "./tmuxPaneWrite.js";
import { waitForAgentPaneReady } from "./tmuxPaneReadiness.js";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
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
  launchImplementerAgent?: boolean | undefined;
  launchReviewerAgent?: boolean | undefined;
  launchMetaReviewerAgent?: boolean | undefined;
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
  agentName: AgentName | undefined;
}): Promise<void> {
  if (!input.shouldSubmit) {
    return;
  }

  const ready = await waitForAgentPaneReady(input.agentName, {
    runner: input.runner,
    targetPane: input.targetPane
  });
  if (!ready) {
    console.error(
      `[tmux seed] startup prompt skipped because pane is not ready for target_pane=${input.targetPane}.`
    );
    return;
  }

  const promptText = input.startupPrompt?.trim();
  if (promptText !== undefined && promptText.length > 0) {
    // tmux_paste agents (reasonix) receive their startup prompt through the
    // pane instead of CLI args; give the TUI time to initialize first.
    console.error(
      `[tmux seed][${input.agentName ?? "unknown"}] startup prompt present (chars=${promptText.length}) for pane=${input.targetPane}.`
    );
    const paneAgent = resolveAgentPaneAdapter(input.agentName);
    const startupPasteSettleMs = paneAgent.startupPasteSettleMs;
    await sendAndSubmitTmuxPaneMessage(
      input.runner,
      input.targetPane,
      promptText,
      {
        ...paneAgent.resolvePasteOptions(),
        // reasonix renders its composer prompt well before its input loop
        // attaches; a paste in that window is silently dropped. The seed waits
        // out the settle before its first paste (round deliveries gate on
        // their own signals and never pay this).
        ...(startupPasteSettleMs > 0 ? { settleMs: startupPasteSettleMs } : {})
      }
    ).catch((error: unknown) => {
      // Catching here (best-effort paste) is intentional: a paste hiccup must
      // not abort the whole bubble start. If the startup prompt fails to land,
      // the watchdog nudge will still steer the agent.
      console.error(
        `[tmux seed] startup prompt paste failed for target_pane=${input.targetPane}: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    return;
  }

  // Legacy opencode reviewer path: the startup prompt was delivered via CLI
  // args; a bare Enter submits the resulting prompt/trust state.
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, 1500);
  });
  await submitTmuxPaneInput(input.runner, input.targetPane);
}

/**
 * Paste the kickoff message and confirm the pairflow marker was submitted,
 * re-sending once for agents documented to swallow early keystrokes (reasonix).
 */
async function pasteKickoffMessage(input: {
  runner: TmuxRunner;
  targetPane: string;
  paneAgent: AgentPaneAdapter;
  message: string;
  marker: string | undefined;
  startupPasteSettleMs: number;
}): Promise<boolean> {
  const isStructuredPairflowEnvelope = input.marker !== undefined;
  const maxPasteAttempts =
    input.marker !== undefined && input.startupPasteSettleMs > 0 ? 2 : 1;
  let confirmed = false;
  for (
    let pasteAttempt = 0;
    pasteAttempt < maxPasteAttempts && !confirmed;
    pasteAttempt += 1
  ) {
    if (pasteAttempt > 0) {
      console.error(
        `[tmux seed] kickoff marker not confirmed; re-sending paste to target_pane=${input.targetPane} (attempt ${pasteAttempt + 1} of ${maxPasteAttempts}).`
      );
      await sleep(2000);
    }
    try {
      await sendAndSubmitTmuxPaneMessage(input.runner, input.targetPane, input.message, {
        requireSuccess: !isStructuredPairflowEnvelope,
        ...input.paneAgent.resolvePasteOptions(),
        ...(input.startupPasteSettleMs > 0 && pasteAttempt === 0
          ? { settleMs: input.startupPasteSettleMs }
          : {})
      });
    } catch (error) {
      console.error(
        `[tmux seed] kickoff paste failed for target_pane=${input.targetPane}: ${error instanceof Error ? error.message : String(error)}`
      );
      break;
    }
    if (input.marker === undefined) {
      confirmed = true;
      continue;
    }
    confirmed = await confirmTmuxPaneMarkerSubmission({
      runner: input.runner,
      targetPane: input.targetPane,
      marker: input.marker,
      paneAgent: input.paneAgent
    }).catch(() => false);
    if (!confirmed && pasteAttempt < maxPasteAttempts - 1) {
      const markerStatus = await checkTmuxPaneMarkerStatus(
        input.runner,
        input.targetPane,
        input.marker,
        input.paneAgent
      ).catch(() => "not_found" as const);
      if (markerStatus === "stuck_in_input") {
        // The paste is sitting in the composer and the confirm loop already
        // retries Enter; re-sending the text would duplicate it.
        break;
      }
    }
  }
  return confirmed;
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
  console.error(
    `[tmux seed][${agentName ?? "unknown"}] delivering kickoff to pane=${targetPane} (chars=${(message ?? "").length}).`
  );

  // Only opencode shows folder-trust / bypass-permissions prompts that need
  // accepting during pane bootstrap (see agent runtime profiles). Undefined or
  // unknown agents keep the historical opencode-default behavior.
  const paneAgent = resolveAgentPaneAdapter(agentName);
  if (paneAgent.trustPromptHandling === "opencode") {
    await paneAgent.acceptTrustPrompt(runner, targetPane).catch(() => undefined);
  }
  const concreteMessage = message as string;
  const marker = resolvePairflowPaneMessageMarker(concreteMessage);
  const ready = await waitForAgentPaneReady(agentName, {
    runner,
    targetPane
  });
  if (!ready) {
    console.error(
      `[tmux seed] kickoff skipped because pane is not ready for target_pane=${targetPane}.`
    );
    return;
  }
  const confirmed = await pasteKickoffMessage({
    runner,
    targetPane,
    paneAgent,
    message: concreteMessage,
    marker,
    startupPasteSettleMs: paneAgent.startupPasteSettleMs
  });
  if (marker !== undefined && !confirmed) {
    console.error(
      `[tmux seed] KICKOFF_DELIVERY_FAILED: target_pane=${targetPane} agent=${agentName ?? "unknown"} marker=${marker} — the initial [pairflow] guidance was not confirmed in the pane within the seed paste retry window. The agent may sit uninstructed; check \`pairflow bubble status\` and restart the bubble if the implementer never started.`
    );
  }

  // Note: Watchdog nudges are recovery-only and belong in the watchdog mechanism,
  // not in normal delivery paths. Successful work-guidance delivery does not
  // trigger an unconditional follow-up message; the agent proceeds on the
  // guidance received.
}

export async function seedBubbleTmuxPaneMessages(
  input: SeedBubbleTmuxPaneMessagesInput
): Promise<void> {
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.implementerPaneId,
    shouldSubmit: input.implementerSubmitStartupPrompt,
    startupPrompt: input.implementerStartupPrompt,
    agentName: input.implementerAgentName
  });
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.reviewerPaneId,
    shouldSubmit: input.reviewerSubmitStartupPrompt,
    startupPrompt: input.reviewerStartupPrompt,
    agentName: input.reviewerAgentName
  });
  await submitStartupPrompt({
    runner: input.runner,
    targetPane: input.metaReviewerPaneId,
    shouldSubmit: input.metaReviewerSubmitStartupPrompt,
    startupPrompt: input.metaReviewerStartupPrompt,
    agentName: input.metaReviewerAgentName
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

  if (
    input.launchImplementerAgent !== false
    && !shouldSkipKickoffAfterStartup(input.implementerAgentName, input.implementerSubmitStartupPrompt === true)
  ) {
    await sendPaneMessage(
      input.runner,
      input.implementerPaneId,
      input.implementerAgentName,
      mergeAndDeduplicateMessages(input.implementerBootstrapMessage, input.implementerKickoffMessage)
    );
  }
  if (
    input.launchReviewerAgent !== false
    && !shouldSkipKickoffAfterStartup(input.reviewerAgentName, input.reviewerSubmitStartupPrompt === true)
  ) {
    await sendPaneMessage(
      input.runner,
      input.reviewerPaneId,
      input.reviewerAgentName,
      mergeAndDeduplicateMessages(input.reviewerBootstrapMessage, input.reviewerKickoffMessage)
    );
  }
  if (
    input.launchMetaReviewerAgent !== false
    && !shouldSkipKickoffAfterStartup(input.metaReviewerAgentName, input.metaReviewerSubmitStartupPrompt === true)
  ) {
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
  // Unknown/undefined agents resolve to the opencode adapter ("cli_arg") and
  // therefore keep the historical opencode-default skip.
  return resolveAgentPaneAdapter(agentName).startupPromptDelivery !== "tmux_paste";
}
