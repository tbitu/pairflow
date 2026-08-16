import type { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { resolveRuntimeSessionWorkspaceAuthority } from "../../../shared/runtimeSessionWorkspaceAuthority.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import type {
  DeliveryAck,
  DeliveryAckReasonCode,
  DeliveryFailureReason,
  DeliveryTargetReasonCode
} from "../../../shared/delivery/tmuxDeliveryContract.js";
import {
  confirmTmuxPaneMarkerSubmission,
  maybeAcceptOpencodeTrustPrompt,
  sendAndSubmitTmuxPaneMessage
} from "./tmuxInput.js";
import { waitForAgentPaneReady } from "./tmuxPaneReadiness.js";
import {
  getAgentRuntimeProfile,
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

/**
 * Backwards-compatible alias for callers that only ever manage opencode panes.
 */
export function ensureOpencodePaneReady(input: {
  runner: TmuxRunner;
  targetPane: string;
  respawnExpectedPaneAgent?: (() => Promise<void>) | undefined;
  sleepForDelayMs?: ((delayMs: number) => Promise<void>) | undefined;
  forceRespawn?: boolean | undefined;
}): Promise<boolean> {
  return ensureAgentPaneReady({
    runner: input.runner,
    targetPane: input.targetPane,
    expectedPaneAgent: "opencode",
    respawnExpectedPaneAgent: input.respawnExpectedPaneAgent,
    sleepForDelayMs: input.sleepForDelayMs,
    forceRespawn: input.forceRespawn
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

    const { ok: paneReady, isLiveSession } = await ensureLiveSessionOrRespawn({
      runner: input.runner,
      targetPane: input.targetPane,
      expectedPaneAgent: input.expectedPaneAgent,
      respawnExpectedPaneAgent: input.respawnExpectedPaneAgent,
      sleepForDelayMs: input.timing?.sleepForDelayMs
    });

    const ackOptions = buildAckOptions(input);

    if (!paneReady) {
      return createRejectedDeliveryAck({
        reason: "command_failed",
        message: input.message,
        ...ackOptions
      });
    }

    // Accept trust prompt if any (opencode-only; reasonix has no folder-trust prompt)
    const trustPromptHandling =
      input.expectedPaneAgent !== undefined
      && isAgentNameRegistered(input.expectedPaneAgent)
        ? getAgentRuntimeProfile(input.expectedPaneAgent).trustPromptHandling
        : "opencode";
    if (trustPromptHandling === "opencode") {
      await maybeAcceptOpencodeTrustPrompt(input.runner, input.targetPane).catch(() => undefined);
    }

    // If the session was already live, clear the previous conversation history first.
    if (isLiveSession && input.convergencePolicy === "respawn") {
      await sendAndSubmitTmuxPaneMessage(input.runner, input.targetPane, "/clear", {
        requireSuccess: false,
        maxChunkLength: 1024,
        ...(input.timing?.sleepForDelayMs !== undefined ? { sleepForDelayMs: input.timing.sleepForDelayMs } : {})
      }).catch(() => undefined);

      const sleepForDelayMs = input.timing?.sleepForDelayMs ?? sleep;
      await sleepForDelayMs(500);
    }

    // Deliver the handoff message via send-keys
    await sendAndSubmitTmuxPaneMessage(input.runner, input.targetPane, input.message, {
      requireSuccess: true,
      maxChunkLength: 1024,
      ...(input.timing?.submitDelayMs !== undefined
        ? { submitDelayMs: input.timing.submitDelayMs }
        : {}),
      ...(input.timing?.sleepForDelayMs !== undefined
        ? { sleepForDelayMs: input.timing.sleepForDelayMs }
        : {})
    });

    // Confirm that the command has been processed
    const confirmed = await confirmTmuxPaneMarkerSubmission({
      runner: input.runner,
      targetPane: input.targetPane,
      marker: input.envelopeId,
      ...(input.deliveryAttempts !== undefined ? { attempts: input.deliveryAttempts } : {}),
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

    if (confirmed) {
      return createAcceptedDeliveryAck({
        message: input.message,
        ...ackOptions
      });
    }

    return createRejectedDeliveryAck({
      reason: "delivery_unconfirmed",
      message: input.message,
      ...ackOptions
    });
  } catch {
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
