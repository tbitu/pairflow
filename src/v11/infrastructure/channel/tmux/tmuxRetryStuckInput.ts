import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { runTmux, type TmuxRunner } from "./tmuxManager.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import { checkTmuxPaneMarkerStatus } from "./tmuxPaneMarkerConfirmation.js";
import { submitTmuxPaneInput } from "./tmuxPaneWrite.js";
import { resolveConfiguredAgentForRole } from "../../../domain/agentIdentity/agentIdentity.js";
import { resolveWatchdogTargetPaneIndex } from "../../../shared/watchdog/watchdogPaneTargeting.js";
import type {
  RetryStuckAgentInputOptions,
  RetryStuckAgentInputResult
} from "../../../shared/delivery/tmuxDeliveryContract.js";

export interface RetryStuckAgentInputRuntimeDependencies {
  runner?: TmuxRunner;
  readSessionsRegistry?: typeof readRuntimeSessionsRegistry;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
}

export type RetryStuckAgentInputRuntimeOptions = RetryStuckAgentInputOptions &
  RetryStuckAgentInputRuntimeDependencies;

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

// ---------------------------------------------------------------------------
// Stuck-input retry — called periodically by the watchdog loop
// ---------------------------------------------------------------------------
/**
 * Check whether the active role's tmux pane has a pairflow message stuck
 * in its input buffer (text visible after the prompt but not submitted).
 * If so, press Enter to unstick it.
 *
 * Designed to be called from the watchdog loop (every ~2 s) as a
 * best-effort safety net for delivery failures.
 */
export async function retryStuckAgentInput(
  options: RetryStuckAgentInputRuntimeOptions
): Promise<RetryStuckAgentInputResult> {
  const runner = options.runner ?? runTmux;
  const readSessions = options.readSessionsRegistry ?? readRuntimeSessionsRegistry;

  let sessionName: string | undefined;
  try {
    const sessions = await readSessions(options.sessionsPath, {
      allowMissing: true
    });
    sessionName = sessions[options.bubbleId]?.tmuxSessionName;
  } catch {
    return { retried: false, reason: "no_session" };
  }

  if (sessionName === undefined) {
    return { retried: false, reason: "no_session" };
  }

  const paneIndex = resolveWatchdogTargetPaneIndex(options.activeRole);

  const targetPane = `${sessionName}:0.${paneIndex}`;
  const capture = await runner(["capture-pane", "-pt", targetPane], {
    allowFailure: true
  });
  if (capture.exitCode !== 0) {
    return { retried: false, reason: "pane_read_failed" };
  }

  const output = capture.stdout;
  if (!output.includes("[pairflow]")) {
    return { retried: false, reason: "not_stuck" };
  }

  const expectedPaneAgent = options.bubbleConfig !== undefined
    ? resolveConfiguredAgentForRole({
        agents: options.bubbleConfig.agents,
        role: options.activeRole
      })
    : undefined;
  const paneAgent = resolveAgentPaneAdapter(expectedPaneAgent);

  // If the agent is currently busy (e.g. thinking/running/tool execution),
  // the input is not stuck waiting for Enter.
  if (paneAgent.isBusy?.(output)) {
    return { retried: false, reason: "not_stuck" };
  }

  // If the prompt is not visible, the agent is either initializing or not ready.
  if (paneAgent.hasVisiblePrompt !== undefined && !paneAgent.hasVisiblePrompt(output)) {
    return { retried: false, reason: "not_stuck" };
  }

  // Check if the [pairflow] marker is stuck in the input buffer
  // (after the last prompt line) rather than in the output area.
  const markerStatus = await checkTmuxPaneMarkerStatus(
    runner,
    targetPane,
    "[pairflow]",
    paneAgent
  );
  if (markerStatus !== "stuck_in_input") {
    // Marker is either already submitted or not present in the live input area.
    return { retried: false, reason: "not_stuck" };
  }

  // Stability check: sample again to ensure the input is not actively being typed into.
  const sleepFn = options.sleepForDelayMs ?? sleep;
  if (!process.env.VITEST || options.sleepForDelayMs !== undefined) {
    await sleepFn(300);
  }
  const secondCapture = await runner(["capture-pane", "-pt", targetPane], {
    allowFailure: true
  });
  if (secondCapture.exitCode !== 0 || secondCapture.stdout !== output) {
    return { retried: false, reason: "not_stuck" };
  }

  // Marker only appears after the prompt and content is stable → stuck in input buffer.
  await submitTmuxPaneInput(runner, targetPane);
  return { retried: true };
}
