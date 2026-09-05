import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import type { AgentPaneAdapter } from "../../../shared/agent/agentPaneAdapter.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import { submitTmuxPaneInput } from "./tmuxPaneWrite.js";

export type TmuxPaneMarkerStatus = "submitted" | "stuck_in_input" | "not_found";

export interface ConfirmTmuxPaneMarkerSubmissionInput {
  runner: TmuxRunner;
  targetPane: string;
  marker: string;
  attempts?: number;
  settleDelayMs?: number;
  retryDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  /** Agent whose prompt/input-box heuristics decide marker placement. */
  paneAgent?: AgentPaneAdapter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

/**
 * Determine whether a pasted marker was submitted (scrolled above the prompt)
 * or is still sitting in the composer (after the prompt).
 */
export async function checkTmuxPaneMarkerStatus(
  runner: TmuxRunner,
  targetPane: string,
  marker: string,
  paneAgent?: AgentPaneAdapter
): Promise<TmuxPaneMarkerStatus> {
  const agent = paneAgent ?? resolveAgentPaneAdapter(undefined);
  const capture = await runner(
    ["capture-pane", "-p", "-S", "-200", "-t", targetPane],
    { allowFailure: true }
  );
  if (capture.exitCode !== 0) {
    return "not_found";
  }

  const output = capture.stdout;
  if (!output.includes(marker)) {
    return "not_found";
  }

  const lines = output.split("\n");
  const lastPromptIdx = agent.findLastPromptIndex(lines);
  if (lastPromptIdx < 0) {
    // A promptless marker can be a wrapped TUI input buffer with the prompt
    // scrolled off-capture. Treat it as unsubmitted so delivery fails closed
    // instead of accepting text that may still be waiting for Enter.
    return "stuck_in_input";
  }

  const promptAndAfter = lines.slice(lastPromptIdx).join("\n");
  if (promptAndAfter.includes(marker)) {
    return "stuck_in_input";
  }

  const beforePrompt = lines.slice(0, lastPromptIdx).join("\n");
  if (beforePrompt.includes(marker)) {
    return "submitted";
  }

  return "not_found";
}

const INTERRUPT_PROMPT_PATTERNS = [
  /esc again to interrupt/iu,
  /esc to interrupt/u,
  /escape to interrupt/u,
  /esc interrupt/ui
];

/** Checks whether captured pane output contains any interrupt prompt text. */
function hasInterruptPrompt(output: string): boolean {
  const lower = output.toLowerCase();
  for (const pattern of INTERRUPT_PROMPT_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Poll until a pasted marker is confirmed submitted. Presses Enter for a marker
 * still sitting in the composer once the pane shows an input surface.
 */
export async function confirmTmuxPaneMarkerSubmission(
  input: ConfirmTmuxPaneMarkerSubmissionInput
): Promise<boolean> {
  // Agent TUIs can take many seconds to echo a submitted message (model load on
  // first prompt), so the window must outlast the echo or delivery gets resent.
  const agent = input.paneAgent ?? resolveAgentPaneAdapter(undefined);
  const attempts = Math.max(1, input.attempts ?? 8);
  const settleDelayMs = input.settleDelayMs ?? 800;
  const retryDelayMs = input.retryDelayMs ?? 1500;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;
  // A busy pane only proves submission once the marker itself was seen; a pane
  // can be mid-turn for reasons unrelated to this delivery.
  let markerSeenInPane = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (settleDelayMs > 0) {
      await sleepForDelayMs(settleDelayMs);
    }
    const status = await checkTmuxPaneMarkerStatus(
      input.runner,
      input.targetPane,
      input.marker,
      agent
    );
    if (status === "submitted") {
      return true;
    }
    if (status === "stuck_in_input") {
      markerSeenInPane = true;
    }
    const capture = await input.runner(
      ["capture-pane", "-p", "-t", input.targetPane],
      { allowFailure: true }
    );
    if (capture.exitCode === 0 && markerSeenInPane) {
      const lowerOutput = capture.stdout.toLowerCase();
      if (hasInterruptPrompt(lowerOutput)) {
        return true;
      }
    }
    if (attempt < attempts - 1) {
      // Only press Enter for a marker still sitting in the composer; a blind
      // Enter elsewhere injects stray input into the agent's turn.
      if (status !== "stuck_in_input") {
        if (retryDelayMs > 0) {
          await sleepForDelayMs(retryDelayMs);
        }

        continue;
      }

      const promptCheck = await input.runner(
        ["capture-pane", "-p", "-S", "-200", "-t", input.targetPane],
        { allowFailure: true }
      );

      if (
        promptCheck.exitCode !== 0
        || !agent.hasVisiblePrompt(promptCheck.stdout)
      ) {
        // Pane is still processing previous input; wait longer instead of
        // blindly resending Enter.
        if (retryDelayMs > 0) {
          await sleepForDelayMs(retryDelayMs);
        }

        continue;
      }

      if (retryDelayMs > 0) {
        await sleepForDelayMs(retryDelayMs);
      }
      await submitTmuxPaneInput(input.runner, input.targetPane);
    }
  }

  return false;
}
