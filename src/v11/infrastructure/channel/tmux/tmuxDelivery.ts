import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { getBubblePaths } from "../../../shared/bubble/bubblePaths.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../config/defaults.js";
import { buildAgentCommand } from "../../../shared/command/agentCommand.js";
import type { AgentRole } from "../../../../contracts/kernel/agentIdentity.js";
import {
  isAgentNameRegistered
} from "../../../shared/agent/agentRuntimeProfiles.js";
import { getSharedTopologySlotPaneIndexForRole } from "../../../shared/topology/topologySlotPaneProjection.js";
import { deactivateOtherRolePanes } from "../../../shared/channel/rolePaneLifecycle.js";
import { runTmux, type TmuxRunner } from "./tmuxManager.js";
import { respawnTmuxPaneCommand } from "./tmuxManager.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import { checkTmuxPaneMarkerStatus } from "./tmuxPaneMarkerConfirmation.js";
import { submitTmuxPaneInput } from "./tmuxPaneWrite.js";
import {
  attemptTmuxDelivery,
  createRejectedDeliveryAck,
  readDeliverySessionContext,
  type TmuxDeliveryTimingOptions
} from "./tmuxDeliveryRuntime.js";
import { ensureRoleInstructionArtifacts } from "../../../shared/bubble/roleInstructionArtifacts.js";
import {
  buildTmuxDeliveryMessage,
} from "./tmuxDeliveryMessageBuilder.js";
import {
  buildTranscriptFallbackRef,
  resolveDeliveryMessageRef
} from "./tmuxDeliveryRefs.js";
import {
  resolveEnvelopeRecipientRole,
  resolveEnvelopeTargetPane
} from "./tmuxDeliveryTargeting.js";
import {
  resolveConfiguredAgentForRole,
  resolveConfiguredModelForRole
} from "../../../domain/agentIdentity/agentIdentity.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import {
  resolveWatchdogTargetPaneIndex
} from "../../../shared/watchdog/watchdogPaneTargeting.js";
import type {
  DeliveryAck,
  EmitDeliveryNotificationInput,
  RetryStuckAgentInputOptions,
  RetryStuckAgentInputResult,
} from "../../../shared/delivery/tmuxDeliveryContract.js";

interface EmitDeliveryNotificationRuntimeDependencies {
  runner?: TmuxRunner;
  readSessionsRegistry?: typeof readRuntimeSessionsRegistry;
  deliveryTiming?: TmuxDeliveryTimingOptions;
}

export type EmitDeliveryNotificationRuntimeInput =
  EmitDeliveryNotificationInput & EmitDeliveryNotificationRuntimeDependencies;

interface RetryStuckAgentInputRuntimeDependencies {
  runner?: TmuxRunner;
  readSessionsRegistry?: typeof readRuntimeSessionsRegistry;
}

type RetryStuckAgentInputRuntimeOptions = RetryStuckAgentInputOptions &
  RetryStuckAgentInputRuntimeDependencies;

export type {
  AcceptedDeliveryAck,
  DeliveryAck,
  DeliveryAckReasonCode,
  DeliveryAckStatus,
  DeliveryFailureReason,
  DeliveryTargetReasonCode,
  EmitDeliveryNotificationInput,
  RejectedDeliveryAck,
  ResolveDeliveryMessageRefInput
} from "../../../shared/delivery/tmuxDeliveryContract.js";
export { buildTranscriptFallbackRef, resolveDeliveryMessageRef } from "./tmuxDeliveryRefs.js";

function resolveDeliveryTiming(
  deliveryTiming: TmuxDeliveryTimingOptions | undefined
): TmuxDeliveryTimingOptions | undefined {
  if (deliveryTiming !== undefined) {
    return deliveryTiming;
  }
  if (process.env.PAIRFLOW_SMOKE_FAST_TMUX_DELIVERY !== "1") {
    return undefined;
  }
  return {
    submitDelayMs: 0,
    markerSettleDelayMs: 0,
    markerRetryDelayMs: 0
  };
}

function buildRegistryReadFailedMessage(
  input: EmitDeliveryNotificationRuntimeInput
): string {
  return buildTmuxDeliveryMessage({
    envelope: input.envelope,
    messageRef:
      input.messageRef ??
      input.envelope.refs[0] ??
      buildTranscriptFallbackRef(
        input.bubbleId,
        input.sessionsPath,
        input.envelope.id
      ),
    bubbleConfig: input.bubbleConfig,
    ...(input.reviewerTestDirective !== undefined
      ? { reviewerTestDirective: input.reviewerTestDirective }
      : {}),
    ...(input.reviewerBrief !== undefined
      ? { reviewerBrief: input.reviewerBrief }
      : {}),
    ...(input.reviewerFocus !== undefined
      ? { reviewerFocus: input.reviewerFocus }
      : {}),
    recipientRole: resolveEnvelopeRecipientRole(
      input.envelope,
      input.bubbleConfig,
      input.recipientRole
    )
  });
}

function createDeliveryMessage(input: {
  runtimeInput: EmitDeliveryNotificationRuntimeInput;
  workspacePath: string | undefined;
}): {
  message: string;
  targetResolution: ReturnType<typeof resolveEnvelopeTargetPane>;
} {
  const { runtimeInput, workspacePath } = input;
  const messageRef =
    runtimeInput.messageRef ??
    resolveDeliveryMessageRef({
      bubbleId: runtimeInput.bubbleId,
      sessionsPath: runtimeInput.sessionsPath,
      envelope: runtimeInput.envelope
    });
  const targetResolution = resolveEnvelopeTargetPane(
    runtimeInput.envelope,
    runtimeInput.bubbleConfig,
    runtimeInput.recipientRole
  );
  let roleArtifactPath: string | undefined;
  if (workspacePath !== undefined) {
    const bubblePaths = getBubblePaths(
      runtimeInput.bubbleConfig.repo_path,
      runtimeInput.bubbleId
    );
    if (targetResolution.recipientRole === "implementer") {
      roleArtifactPath = bubblePaths.roleImplementerArtifactPath;
    } else if (targetResolution.recipientRole === "reviewer") {
      roleArtifactPath = bubblePaths.roleReviewerArtifactPath;
    } else if (targetResolution.recipientRole === "meta-reviewer") {
      roleArtifactPath = bubblePaths.roleMetaReviewerArtifactPath;
    }
  }
  return {
    message: buildTmuxDeliveryMessage({
      envelope: runtimeInput.envelope,
      messageRef,
      bubbleConfig: runtimeInput.bubbleConfig,
      ...(workspacePath !== undefined ? { workspacePath } : {}),
      ...(roleArtifactPath !== undefined ? { roleArtifactPath } : {}),
      ...(runtimeInput.reviewerTestDirective !== undefined
        ? { reviewerTestDirective: runtimeInput.reviewerTestDirective }
        : {}),
      ...(runtimeInput.reviewerBrief !== undefined
        ? { reviewerBrief: runtimeInput.reviewerBrief }
        : {}),
      ...(runtimeInput.reviewerFocus !== undefined
        ? { reviewerFocus: runtimeInput.reviewerFocus }
        : {}),
      recipientRole: targetResolution.recipientRole
    }),
    targetResolution
  };
}

function resolveExpectedPaneAgentForRecipient(input: {
  recipientRole: ReturnType<typeof resolveEnvelopeRecipientRole>;
  bubbleConfig: EmitDeliveryNotificationRuntimeInput["bubbleConfig"];
}): AgentName | undefined {
  const role = resolveRecipientRoleToAgentRole(input.recipientRole);
  return role !== undefined
    ? resolveConfiguredAgentForRole({
        agents: input.bubbleConfig.agents,
        role
      })
    : undefined;
}

function resolveRecipientRoleToAgentRole(
  recipientRole: ReturnType<typeof resolveEnvelopeRecipientRole>
): AgentRole | undefined {
  switch (recipientRole) {
    case "implementer":
      return "implementer";
    case "reviewer":
      return "reviewer";
    case "meta-reviewer":
      return "meta_reviewer";
    default:
      return undefined;
  }
}

function resolveRoleModel(input: {
  role: AgentRole;
  bubbleConfig: EmitDeliveryNotificationRuntimeInput["bubbleConfig"];
}): string | undefined {
  return resolveConfiguredModelForRole({
    agents: input.bubbleConfig.agents,
    role: input.role
  });
}

function resolveConvergencePolicy(
  input: EmitDeliveryNotificationRuntimeInput,
  recipientRole: ReturnType<typeof resolveEnvelopeRecipientRole>
): "respawn" | "assume_running" {
  if (input.convergencePolicy !== undefined) {
    return input.convergencePolicy;
  }
  if (
    recipientRole === "reviewer"
    && input.bubbleConfig.reviewer_context_mode === "persistent"
    && input.envelope.type === "PASS"
  ) {
    return "assume_running";
  }
  if (input.envelope.type === "HUMAN_REPLY") {
    return "assume_running";
  }
  return "respawn";
}

export async function emitDeliveryNotificationAck(
  input: EmitDeliveryNotificationRuntimeInput
): Promise<DeliveryAck> {
  const readSessions = input.readSessionsRegistry ?? readRuntimeSessionsRegistry;

  let sessionName: string | undefined;
  let workspacePath: string | undefined;
  try {
    const sessionContext = await readDeliverySessionContext({
      bubbleId: input.bubbleId,
      sessionsPath: input.sessionsPath,
      readSessions
    });
    sessionName = sessionContext.sessionName;
    workspacePath = sessionContext.workspacePath;
  } catch {
    return createRejectedDeliveryAck({
      reason: "registry_read_failed",
      message: buildRegistryReadFailedMessage(input),
      deliveryTargetReasonCode: "DELIVERY_TARGET_REGISTRY_READ_FAILED"
    });
  }

  if (workspacePath !== undefined) {
    const bubblePaths = getBubblePaths(
      input.bubbleConfig.repo_path,
      input.bubbleId
    );
    await ensureRoleInstructionArtifacts(bubblePaths.artifactsDir, {
      bubbleConfig: input.bubbleConfig,
      repoPath: input.bubbleConfig.repo_path,
      bubbleId: input.bubbleId
    });
  }

  const { message: workspaceMessage, targetResolution } = createDeliveryMessage({
    runtimeInput: input,
    workspacePath
  });

  if (sessionName === undefined || workspacePath === undefined) {
    return createRejectedDeliveryAck({
      reason: "no_runtime_session",
      message: workspaceMessage,
      ...(targetResolution.deliveryTargetReasonCode !== undefined
        ? { deliveryTargetReasonCode: targetResolution.deliveryTargetReasonCode }
        : {})
    });
  }

  const targetPaneIndex = targetResolution.targetPaneIndex;
  if (targetPaneIndex === undefined) {
    return createRejectedDeliveryAck({
      reason: "unsupported_recipient",
      message: workspaceMessage,
      sessionName,
      ...(targetResolution.deliveryTargetReasonCode !== undefined
        ? { deliveryTargetReasonCode: targetResolution.deliveryTargetReasonCode }
        : {})
    });
  }

  const targetPane = `${sessionName}:0.${targetPaneIndex}`;
  const runner = input.runner ?? runTmux;
  const deliveryTiming = resolveDeliveryTiming(input.deliveryTiming);
  const expectedPaneAgent = resolveExpectedPaneAgentForRecipient({
    recipientRole: targetResolution.recipientRole,
    bubbleConfig: input.bubbleConfig
  });
  const expectedAgentRole = resolveRecipientRoleToAgentRole(
    targetResolution.recipientRole
  );
  const respawnExpectedPaneAgent = buildRespawnPaneAgentAction({
    expectedPaneAgent,
    expectedAgentRole,
    bubbleConfig: input.bubbleConfig,
    bubbleId: input.bubbleId,
    workspacePath,
    sessionName,
    targetPaneIndex,
    runner
  });
  // Deactivate other role panes for single-session agents (reasonix).
  await deactivateNonConcurrentAgentPanes({
    sessionName, expectedAgentRole, workspacePath, runner, expectedPaneAgent,
    bubbleConfig: input.bubbleConfig
  });

  const convergencePolicy = resolveConvergencePolicy(
    input,
    targetResolution.recipientRole
  );

  const deliveryAck = await attemptTmuxDelivery({
    runner,
    targetPane,
    envelopeId: input.envelope.id,
    message: workspaceMessage,
    sessionName,
    targetPaneIndex,
    initialDelayMs: input.initialDelayMs,
    deliveryAttempts: input.deliveryAttempts,
    expectedPaneAgent,
    convergencePolicy,
    respawnExpectedPaneAgent,
    timing: deliveryTiming,
    deliveryTargetReasonCode: targetResolution.deliveryTargetReasonCode
  });
  return deliveryAck;
}

function buildRespawnPaneAgentAction(input: {
  expectedPaneAgent: AgentName | undefined;
  expectedAgentRole: AgentRole | undefined;
  bubbleConfig: EmitDeliveryNotificationRuntimeInput["bubbleConfig"];
  bubbleId: string;
  workspacePath: string;
  sessionName: string;
  targetPaneIndex: number;
  runner: TmuxRunner;
}): (() => Promise<void>) | undefined {
  if (
    input.expectedPaneAgent === undefined ||
    input.expectedAgentRole === undefined ||
    !isAgentNameRegistered(input.expectedPaneAgent)
  ) {
    return undefined;
  }

  const roleName = input.expectedAgentRole;
  const agentName = input.expectedPaneAgent;
  return async (): Promise<void> => {
    const roleModel = resolveRoleModel({ role: roleName, bubbleConfig: input.bubbleConfig });
    const roleMcpPolicy = input.bubbleConfig.role_mcp?.[roleName] ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE[roleName];
    const respawnCommand = buildAgentCommand({
      agentName,
      roleName,
      roleMcpPolicy,
      ...(roleModel !== undefined ? { model: roleModel } : {}),
      bubbleId: input.bubbleId,
      workspacePath: input.workspacePath,
      pairflowCommandProfile: input.bubbleConfig.pairflow_command_profile,
      ...(input.bubbleConfig.executor?.type === "ssh"
        ? { remoteWorkspaceAuthority: { workspaceRoot: input.workspacePath } }
        : {})
    });
    await respawnTmuxPaneCommand({
      sessionName: input.sessionName,
      paneIndex: input.targetPaneIndex,
      cwd: input.workspacePath,
      command: respawnCommand,
      runner: input.runner
    });
  };
}

async function deactivateNonConcurrentAgentPanes(input: {
  sessionName: string;
  expectedAgentRole: AgentRole | undefined;
  workspacePath: string;
  runner: TmuxRunner;
  expectedPaneAgent: AgentName | undefined;
  bubbleConfig: EmitDeliveryNotificationRuntimeInput["bubbleConfig"];
}): Promise<void> {
  if (input.expectedPaneAgent === undefined || input.expectedAgentRole === undefined) {
    return;
  }
  await deactivateOtherRolePanes({
    activateInput: {
      sessionName: input.sessionName,
      role: input.expectedAgentRole,
      cwd: input.workspacePath,
      runner: input.runner,
      paneAgent: resolveAgentPaneAdapter(input.expectedPaneAgent)
    },
    topologyPaneIndexForRole: getSharedTopologySlotPaneIndexForRole,
    respawnPane: (respawnInput) => respawnTmuxPaneCommand(respawnInput),
    configureRoleAgent: (role) => resolveAgentPaneAdapter(
      resolveConfiguredAgentForRole({ agents: input.bubbleConfig.agents, role })
    )
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

  // Marker only appears after the prompt → stuck in input buffer.
  await submitTmuxPaneInput(runner, targetPane);
  return { retried: true };
}
