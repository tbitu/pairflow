import type { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { resolveRuntimeSessionWorkspaceAuthority } from "../../../shared/runtimeSessionWorkspaceAuthority.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import type {
  DeliveryAck,
  DeliveryAckReasonCode,
  DeliveryFailureReason,
  DeliveryTargetReasonCode
} from "../../../shared/delivery/tmuxDeliveryContract.js";
import { confirmTmuxPaneMarkerSubmission } from "./tmuxPaneMarkerConfirmation.js";
import { sendAndSubmitTmuxPaneMessage } from "./tmuxPaneWrite.js";
import { waitForAgentPaneReady, waitForAgentPaneIdle } from "./tmuxPaneReadiness.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import {
  isAgentNameRegistered
} from "../../../shared/agent/agentRuntimeProfiles.js";
import type { TmuxRunner } from "./tmuxManager.js";

export interface DeliverySessionContext {
  sessionName?: string;
  workspacePath?: string;
}

export async function readDeliverySessionContext(input: {
  bubbleId: string;
  sessionsPath: string;
  readSessions: typeof readRuntimeSessionsRegistry;
}): Promise<DeliverySessionContext> {
  const sessions = await input.readSessions(input.sessionsPath, {
    allowMissing: true
  });
  const record = sessions[input.bubbleId];
  const workspaceAuthority = resolveRuntimeSessionWorkspaceAuthority({
    runtimeSessionRecord: record
  });
  return {
    ...(record?.tmuxSessionName !== undefined
      ? { sessionName: record.tmuxSessionName }
      : {}),
    ...(workspaceAuthority.status === "resolved"
      ? { workspacePath: workspaceAuthority.authority.workspacePath }
      : {})
  };
}

function resolveDeliveryAckReasonCode(
  reason: DeliveryFailureReason
): DeliveryAckReasonCode {
  switch (reason) {
    case "no_runtime_session":
    case "registry_read_failed":
      return "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE";
    case "unsupported_recipient":
      return "DELIVERY_ACK_TARGET_UNSUPPORTED";
    case "delivery_unconfirmed":
    case "pane_busy":
    case "command_failed":
      return "DELIVERY_ACK_REJECTED";
  }
}

export function createRejectedDeliveryAck(input: {
  reason: DeliveryFailureReason;
  message: string;
  deliveryTargetReasonCode?: DeliveryTargetReasonCode;
  sessionName?: string;
  targetPaneIndex?: number;
}): DeliveryAck {
  return {
    status: "rejected",
    ...(input.sessionName !== undefined ? { sessionName: input.sessionName } : {}),
    ...(input.targetPaneIndex !== undefined ? { targetPaneIndex: input.targetPaneIndex } : {}),
    message: input.message,
    reason: input.reason,
    reason_code: resolveDeliveryAckReasonCode(input.reason),
    ...(input.deliveryTargetReasonCode !== undefined
      ? { deliveryTargetReasonCode: input.deliveryTargetReasonCode }
      : {})
  };
}

export function createAcceptedDeliveryAck(input: {
  message: string;
  sessionName: string;
  targetPaneIndex: number;
  deliveryTargetReasonCode?: DeliveryTargetReasonCode;
}): DeliveryAck {
  return {
    status: "accepted",
    sessionName: input.sessionName,
    targetPaneIndex: input.targetPaneIndex,
    message: input.message,
    ...(input.deliveryTargetReasonCode !== undefined
      ? { deliveryTargetReasonCode: input.deliveryTargetReasonCode }
      : {})
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export interface TmuxDeliveryTimingOptions {
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  submitDelayMs?: number;
  markerSettleDelayMs?: number;
  markerRetryDelayMs?: number;
  /** Idle-gate tuning for handoff delivery (see waitForAgentPaneIdle). */
  idleWaitAttempts?: number;
  idleWaitRetryDelayMs?: number;
  /** Skip the busy/idle gate entirely (used by panic-style recovery paths). Defaults to false in production. */
  skipIdleWait?: boolean;
}

export async function ensureAgentPaneReady(input: {
  runner: TmuxRunner;
  targetPane: string;
  expectedPaneAgent?: AgentName | undefined;
  respawnExpectedPaneAgent?: (() => Promise<void>) | undefined;
  sleepForDelayMs?: ((delayMs: number) => Promise<void>) | undefined;
  forceRespawn?: boolean | undefined;
}): Promise<boolean> {
  const quickProbe = await waitForAgentPaneReady(input.expectedPaneAgent, {
    runner: input.runner,
    targetPane: input.targetPane,
    attempts: 3,
    retryDelayMs: 300,
    ...(input.sleepForDelayMs !== undefined
      ? { sleepForDelayMs: input.sleepForDelayMs }
      : {})
  });

  if (quickProbe) {
    if (input.forceRespawn) {
      // Clear the conversation of the already running session
      await sendAndSubmitTmuxPaneMessage(input.runner, input.targetPane, "/clear", {
        requireSuccess: false,
        maxChunkLength: 1024,
        ...(input.sleepForDelayMs !== undefined ? { sleepForDelayMs: input.sleepForDelayMs } : {})
      }).catch(() => undefined);
      // Wait briefly for the clear command to be processed
      const sleepForDelayMs = input.sleepForDelayMs ?? sleep;
      await sleepForDelayMs(500);
    }
    return true;
  }

  if (input.respawnExpectedPaneAgent === undefined) {
    return false;
  }

  await input.respawnExpectedPaneAgent();
  return await waitForAgentPaneReady(input.expectedPaneAgent, {
    runner: input.runner,
    targetPane: input.targetPane,
    attempts: 90, // Give it up to 27 seconds for a fresh container launch
    ...(input.sleepForDelayMs !== undefined
      ? { sleepForDelayMs: input.sleepForDelayMs }
      : {})
  });
}

async function ensureLiveSessionOrRespawn(input: {
  runner: TmuxRunner;
  targetPane: string;
  expectedPaneAgent: AgentName | undefined;
  respawnExpectedPaneAgent?: (() => Promise<void>) | undefined;
  sleepForDelayMs?: ((delayMs: number) => Promise<void>) | undefined;
}): Promise<{ ok: boolean; isLiveSession: boolean }> {
  // Unregistered/legacy agents are treated as always-running (no readiness
  // probe, no respawn), preserving pre-reasonix delivery behavior.
  if (
    input.expectedPaneAgent === undefined
    || !isAgentNameRegistered(input.expectedPaneAgent)
  ) {
    return { ok: true, isLiveSession: false };
  }

  const isLive = await waitForAgentPaneReady(input.expectedPaneAgent, {
    runner: input.runner,
    targetPane: input.targetPane,
    attempts: 3,
    retryDelayMs: 300,
    ...(input.sleepForDelayMs !== undefined ? { sleepForDelayMs: input.sleepForDelayMs } : {})
  });

  if (isLive) {
    return { ok: true, isLiveSession: true };
  }

  if (input.respawnExpectedPaneAgent === undefined) {
    return { ok: false, isLiveSession: false };
  }

  await input.respawnExpectedPaneAgent();
  const ready = await waitForAgentPaneReady(input.expectedPaneAgent, {
    runner: input.runner,
    targetPane: input.targetPane,
    attempts: 90,
    ...(input.sleepForDelayMs !== undefined ? { sleepForDelayMs: input.sleepForDelayMs } : {})
  });

  return { ok: ready, isLiveSession: false };
}

/**
 * Accept any first-run trust prompt, deliver the handoff message via send-keys,
 * and confirm the marker was submitted. No `/clear` before delivery: opencode
 * opens a confirmation gate that swallows the handover, and reasonix queues it
 * as a literal message.
 */
async function deliverHandoffMessage(input: {
  runner: TmuxRunner;
  targetPane: string;
  message: string;
  envelopeId: string;
  expectedPaneAgent: AgentName | undefined;
  deliveryAttempts?: number | undefined;
  timing?: TmuxDeliveryTimingOptions | undefined;
}): Promise<boolean> {
  const paneAgent = resolveAgentPaneAdapter(input.expectedPaneAgent);
  if (paneAgent.trustPromptHandling === "opencode") {
    await paneAgent.acceptTrustPrompt(input.runner, input.targetPane).catch(() => undefined);
  }

  await sendAndSubmitTmuxPaneMessage(input.runner, input.targetPane, input.message, {
    requireSuccess: true,
    ...paneAgent.resolvePasteOptions(),
    ...(input.timing?.submitDelayMs !== undefined
      ? { submitDelayMs: input.timing.submitDelayMs }
      : {}),
    ...(input.timing?.sleepForDelayMs !== undefined
      ? { sleepForDelayMs: input.timing.sleepForDelayMs }
      : {})
  });

  return confirmTmuxPaneMarkerSubmission({
    runner: input.runner,
    targetPane: input.targetPane,
    marker: input.envelopeId,
    paneAgent,
    ...(input.deliveryAttempts !== undefined
      ? { attempts: input.deliveryAttempts }
      : {}),
    ...(input.timing?.markerSettleDelayMs !== undefined
      ? { settleDelayMs: input.timing.markerSettleDelayMs }
      : {}),
    ...(input.timing?.markerRetryDelayMs !== undefined
      ? { retryDelayMs: input.timing.markerRetryDelayMs }
      : {}),
    ...(input.timing?.sleepForDelayMs !== undefined
      ? { sleepForDelayMs: input.timing.sleepForDelayMs }
      : {})
  });
}

export async function attemptTmuxDelivery(input: {
  runner: TmuxRunner;
  targetPane: string;
  envelopeId: string;
  message: string;
  initialDelayMs?: number | undefined;
  deliveryAttempts?: number | undefined;
  sessionName: string;
  targetPaneIndex: number;
  expectedPaneAgent?: AgentName | undefined;
  convergencePolicy?: "respawn" | "assume_running" | undefined;
  respawnExpectedPaneAgent?: (() => Promise<void>) | undefined;
  deliveryTargetReasonCode?: DeliveryTargetReasonCode | undefined;
  timing?: TmuxDeliveryTimingOptions | undefined;
}): Promise<DeliveryAck> {
  try {
    if ((input.initialDelayMs ?? 0) > 0) {
      const sleepForDelayMs = input.timing?.sleepForDelayMs ?? sleep;
      await sleepForDelayMs(input.initialDelayMs as number);
    }

    const { ok: paneReady } = await ensureLiveSessionOrRespawn({
      runner: input.runner,
      targetPane: input.targetPane,
      expectedPaneAgent: input.expectedPaneAgent,
      respawnExpectedPaneAgent: input.respawnExpectedPaneAgent,
      sleepForDelayMs: input.timing?.sleepForDelayMs
    });

    const ackOptions = buildAckOptions(input);

    if (!paneReady) {
      console.error(
        `[tmux delivery] pane not ready for target_pane=${input.targetPane} envelope=${input.envelopeId}; handoff not delivered.`
      );
      return createRejectedDeliveryAck({
        reason: "command_failed",
        message: input.message,
        ...ackOptions
      });
    }

    // Wait for the agent to finish its in-flight turn before typing the handoff.
    // "Ready" (TUI chrome visible) is not the same as "idle": a busy opencode
    // silently drops mid-turn input and a busy reasonix queues it as a literal
    // message, so a round handover typed early never reaches the agent. If the
    // pane stays busy past the budget, fail loudly instead of swallowing the
    // handoff. Reproduced by round-2 handovers delivered at 12:16 while the
    // reviewer was mid-turn (no step-finish until after 12:19).
    const skipIdleWait =
      process.env.VITEST === "skip-idle-wait"
      || input.timing?.skipIdleWait === true;
    if (!skipIdleWait) {
      const paneIdle = await waitForAgentPaneIdle(input.expectedPaneAgent, {
        runner: input.runner,
        targetPane: input.targetPane,
        ...(input.timing?.sleepForDelayMs !== undefined
          ? { sleepForDelayMs: input.timing.sleepForDelayMs }
          : {}),
        ...(input.timing?.idleWaitAttempts !== undefined
          ? { attempts: input.timing.idleWaitAttempts }
          : {}),
        ...(input.timing?.idleWaitRetryDelayMs !== undefined
          ? { retryDelayMs: input.timing.idleWaitRetryDelayMs }
          : {})
      });
      if (!paneIdle) {
        console.error(
          `[tmux delivery] pane still busy for target_pane=${input.targetPane} envelope=${input.envelopeId}; handoff not delivered.`
        );
        return createRejectedDeliveryAck({
          reason: "pane_busy",
          message: input.message,
          ...ackOptions
        });
      }
    }

    // Accept trust prompt (if any), deliver the handoff via send-keys, and
    // confirm the marker was submitted. No `/clear` before delivery.
    const confirmed = await deliverHandoffMessage({
      runner: input.runner,
      targetPane: input.targetPane,
      message: input.message,
      envelopeId: input.envelopeId,
      expectedPaneAgent: input.expectedPaneAgent,
      deliveryAttempts: input.deliveryAttempts,
      timing: input.timing
    });

    if (confirmed) {
      return createAcceptedDeliveryAck({
        message: input.message,
        ...ackOptions
      });
    }

    console.error(
      `[tmux delivery] handoff unconfirmed for target_pane=${input.targetPane} envelope=${input.envelopeId}; marker never observed as submitted.`
    );
    return createRejectedDeliveryAck({
      reason: "delivery_unconfirmed",
      message: input.message,
      ...ackOptions
    });
  } catch (error) {
    console.error(
      `[tmux delivery] handoff failed for target_pane=${input.targetPane} envelope=${input.envelopeId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return createRejectedDeliveryAck({
      reason: "command_failed",
      message: input.message,
      ...buildAckOptions(input)
    });
  }
}

function buildAckOptions(input: {
  sessionName: string;
  targetPaneIndex: number;
  deliveryTargetReasonCode?: DeliveryTargetReasonCode | undefined;
}) {
  if (input.deliveryTargetReasonCode !== undefined) {
    return {
      sessionName: input.sessionName,
      targetPaneIndex: input.targetPaneIndex,
      deliveryTargetReasonCode: input.deliveryTargetReasonCode
    };
  }
  return {
    sessionName: input.sessionName,
    targetPaneIndex: input.targetPaneIndex
  };
}
