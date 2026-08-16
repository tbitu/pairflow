import type {
  BubbleWatchdogDependencies,
  PaneActivitySampleResult,
  SampleWatchdogPaneActivityFn
} from "../../watchdogCommandContract.js";
import type { RestartBubbleResult } from "../../../restart/restartCommandContract.js";
import type { AgentRole } from "../../../../../contracts/kernel/agentIdentity.js";
import { BubbleWatchdogError } from "../error/watchdogCommandRuntime.js";
import { type WatchdogRuntimeContext } from "../flow/watchdogCommandFlow.js";
import {
  resolveWatchdogTargetPaneIndex
} from "../../../../shared/watchdog/watchdogPaneTargeting.js";
import type { SendAndSubmitTmuxPaneMessagePort } from "../../../../ports/tmuxDelivery.js";
import { WATCHDOG_PANE_ACTIVITY_SAMPLE_INTERVAL_MS } from "./watchdogPaneActivitySampler.js";
import type {
  ReadWatchdogPaneActivityPort,
  ReadWatchdogPaneActivityResult,
  WatchdogPaneActivityRecord,
  WriteWatchdogPaneActivityPort
} from "../../../../ports/watchdogPaneActivity.js";
import { ensureAgentPaneReady } from "../../../../infrastructure/channel/tmux/tmuxDeliveryRuntime.js";
import { buildAgentCommand } from "../../../../shared/command/agentCommand.js";
import { respawnTmuxPaneCommand } from "../../../../infrastructure/channel/tmux/tmuxManager.js";
import { deactivateOtherRolePanes } from "../../../../shared/channel/rolePaneLifecycle.js";
import { getSharedTopologySlotPaneIndexForRole } from "../../../../shared/topology/topologySlotPaneProjection.js";
import { isAgentNameRegistered } from "../../../../shared/agent/agentRuntimeProfiles.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../../config/defaults.js";
import { resolveRuntimeSessionWorkspaceAuthority } from "../../../../shared/runtimeSessionWorkspaceAuthority.js";

export interface WatchdogPaneActivityState {
  readStatus: "ok" | "missing" | "invalid";
  currentRecord: WatchdogPaneActivityRecord | null;
  sampleResult: PaneActivitySampleResult | null;
  restarted?: boolean;
  restartResult?: RestartBubbleResult;
}

interface NudgeInput {
  activeRole: AgentRole;
  bubbleConfig: WatchdogRuntimeContext["resolved"]["bubbleConfig"];
  bubbleId: string;
  worktreePath: string;
  sessionsPath: string;
  runTmux: BubbleWatchdogDependencies["runTmux"];
  readRuntimeSessionsRegistry: BubbleWatchdogDependencies["readRuntimeSessionsRegistry"];
  sendAndSubmitTmuxPaneMessage: SendAndSubmitTmuxPaneMessagePort;
  targetPane: string;
  nudgeMessage: string;
  sessionName: string;
}

type NudgeEligibility = { eligible: false } | { eligible: true; elapsedSinceLastSeenMs: number; elapsedSinceLastNudgeMs: number };
const WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS = 2 * 60_000;

/**
 * Determines whether a watchdog nudge should be attempted, using early returns.
 */
function shouldAttemptNudge(input: {
  state: WatchdogRuntimeContext["state"];
  currentRecord: WatchdogPaneActivityRecord | null;
  hasEscInterrupt: boolean;
  now: Date;
}): NudgeEligibility {
  if (input.state.state !== "RUNNING") {
    return { eligible: false };
  }
  if (input.hasEscInterrupt) {
    return { eligible: false };
  }
  const activeSinceMs = parseIsoTimestamp(input.state.active_since);
  if (
    activeSinceMs !== null
    && input.now.getTime() - activeSinceMs < WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS
  ) {
    return { eligible: false };
  }
  const lastSeenMs = parseIsoTimestamp(input.currentRecord?.last_seen_esc_interrupt_at) ?? input.now.getTime();
  const elapsedSinceLastSeenMs = input.now.getTime() - lastSeenMs;

  const lastNudgeMs = parseIsoTimestamp(input.currentRecord?.last_nudge_at) ?? 0;
  const elapsedSinceLastNudgeMs = input.now.getTime() - lastNudgeMs;

  return { eligible: true, elapsedSinceLastSeenMs, elapsedSinceLastNudgeMs };
}

/**
 * Attempts to nudge an agent pane when watchdog detects inactivity.
 */
async function trySendWatchdogNudge(input: NudgeInput): Promise<"ok" | "pane_not_ready"> {
  const expectedPaneAgent = input.activeRole === "implementer"
    ? input.bubbleConfig.agents.implementer
    : input.activeRole === "reviewer"
    ? input.bubbleConfig.agents.reviewer
    : input.activeRole === "meta_reviewer"
    ? input.bubbleConfig.agents.meta_reviewer
    : undefined;

  if (expectedPaneAgent === undefined || !isAgentNameRegistered(expectedPaneAgent)) {
    return "ok";
  }

  const expectedAgentRole = input.activeRole;
  const roleModel = input.activeRole === "implementer"
    ? input.bubbleConfig.agents.implementer_model
    : input.activeRole === "reviewer"
    ? input.bubbleConfig.agents.reviewer_model
    : input.activeRole === "meta_reviewer"
    ? input.bubbleConfig.agents.meta_reviewer_model
    : undefined;

  const roleMcpPolicy =
    input.bubbleConfig.role_mcp?.[expectedAgentRole]
    ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE[expectedAgentRole];

  const registry = await input.readRuntimeSessionsRegistry(
    input.sessionsPath,
    { allowMissing: true }
  );
  const sessionRecord = registry[input.bubbleId];
  const workspaceAuthority = resolveRuntimeSessionWorkspaceAuthority({
    runtimeSessionRecord: sessionRecord
  });
  const workspacePath = workspaceAuthority.status === "resolved"
    ? workspaceAuthority.authority.workspacePath
    : input.worktreePath;

  const agentPaneReady = await ensureAgentPaneReady({
    runner: input.runTmux,
    targetPane: input.targetPane,
    expectedPaneAgent,
    respawnExpectedPaneAgent: async (): Promise<void> => {
      // Non-concurrent agents (reasonix) hold a machine-wide single active
      // session lock: deactivate the other role panes so this respawn can
      // acquire the lock.
      await deactivateOtherRolePanes({
        activateInput: {
          sessionName: input.sessionName,
          role: expectedAgentRole,
          cwd: workspacePath,
          runner: input.runTmux,
          expectedPaneAgent
        },
        topologyPaneIndexForRole: getSharedTopologySlotPaneIndexForRole,
        respawnPane: (respawnInput) => respawnTmuxPaneCommand(respawnInput)
      });
      const respawnCommand = buildAgentCommand({
        agentName: expectedPaneAgent,
        roleName: expectedAgentRole,
        roleMcpPolicy,
        ...(roleModel !== undefined ? { model: roleModel } : {}),
        bubbleId: input.bubbleId,
        workspacePath,
        pairflowCommandProfile: input.bubbleConfig.pairflow_command_profile
      });
      const paneIndex = resolveWatchdogTargetPaneIndex(input.activeRole);
      await respawnTmuxPaneCommand({
        sessionName: input.sessionName,
        paneIndex,
        cwd: workspacePath,
        command: respawnCommand,
        runner: input.runTmux
      });
    }
  });

  if (!agentPaneReady) {
    return "pane_not_ready";
  }

  await input.sendAndSubmitTmuxPaneMessage(input.runTmux, input.targetPane, input.nudgeMessage);
  return "ok";
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveExpectedTargetPane(
  sessionName: string | undefined,
  activeRole: AgentRole
): string | null {
  if (sessionName === undefined || sessionName.trim().length === 0) {
    return null;
  }
  return `${sessionName}:0.${String(resolveWatchdogTargetPaneIndex(activeRole))}`;
}

function shouldSamplePaneActivity(
  readResult: ReadWatchdogPaneActivityResult,
  now: Date,
  activeRole: AgentRole
): boolean {
  if (readResult.status !== "ok") {
    return true;
  }
  const expectedTargetPane = resolveExpectedTargetPane(
    readResult.record.session_name,
    activeRole
  );
  if (
    expectedTargetPane !== null
    && readResult.record.target_pane !== expectedTargetPane
  ) {
    return true;
  }
  const sampledAtMs = parseIsoTimestamp(readResult.record.sampled_at);
  if (sampledAtMs === null) {
    return true;
  }
  return now.getTime() - sampledAtMs >= WATCHDOG_PANE_ACTIVITY_SAMPLE_INTERVAL_MS;
}

function buildNextPaneActivityRecord(input: {
  bubbleId: string;
  previous: WatchdogPaneActivityRecord | null;
  previousReadStatus: ReadWatchdogPaneActivityResult["status"];
  sampleResult: Extract<PaneActivitySampleResult, { status: "sampled" }>;
}): WatchdogPaneActivityRecord {
  const previousChangedAtMs = parseIsoTimestamp(input.previous?.last_changed_at);
  const nextLastChangedAt =
    input.previousReadStatus !== "ok"
    || input.previous === null
    || input.sampleResult.changed
    || previousChangedAtMs === null
      ? input.sampleResult.sampled_at
      : input.previous.last_changed_at;

  const previousLastSeenEsc = input.previous?.last_seen_esc_interrupt_at;
  const nextLastSeenEsc = input.sampleResult.has_esc_interrupt !== true
    ? (previousLastSeenEsc ?? input.sampleResult.sampled_at)
    : input.sampleResult.sampled_at;

  return {
    bubble_id: input.bubbleId,
    sampled_at: input.sampleResult.sampled_at,
    pane_hash: input.sampleResult.pane_hash,
    last_changed_at: nextLastChangedAt,
    session_name: input.sampleResult.session_name,
    target_pane: input.sampleResult.target_pane,
    last_sample_status: "sampled",
    last_seen_esc_interrupt_at: nextLastSeenEsc,
    ...(input.previous?.last_nudge_at !== undefined ? { last_nudge_at: input.previous.last_nudge_at } : {}),
    ...(input.previous?.last_nudge_count !== undefined ? { last_nudge_count: input.previous.last_nudge_count } : {}),
    ...(input.previous?.last_nudge_round !== undefined ? { last_nudge_round: input.previous.last_nudge_round } : {}),
    ...(input.previous?.last_nudge_role !== undefined ? { last_nudge_role: input.previous.last_nudge_role } : {}),
    ...(input.previous?.last_nudge_execution_id !== undefined ? { last_nudge_execution_id: input.previous.last_nudge_execution_id } : {})
  };
}

function buildFailedSampleRecord(input: {
  previous: WatchdogPaneActivityRecord;
  sampleResult: Extract<
    PaneActivitySampleResult,
    {
      status: "no_session" | "pane_unreadable";
    }
  >;
}): WatchdogPaneActivityRecord {
  return {
    ...input.previous,
    sampled_at: input.sampleResult.sampled_at,
    ...(input.sampleResult.status === "pane_unreadable"
      ? {
          session_name: input.sampleResult.session_name,
          target_pane: input.sampleResult.target_pane
        }
      : {}),
    last_sample_status: input.sampleResult.status,
    last_sample_error: input.sampleResult.error
  };
}

interface NudgeAndMaybeRestartInput {
  context: WatchdogRuntimeContext;
  currentRecord: WatchdogPaneActivityRecord;
  sampleResult: Extract<PaneActivitySampleResult, { status: "sampled" }>;
  readResultStatus: ReadWatchdogPaneActivityResult["status"];
  runTmux: BubbleWatchdogDependencies["runTmux"];
  readRuntimeSessionsRegistry: BubbleWatchdogDependencies["readRuntimeSessionsRegistry"];
  sendAndSubmitTmuxPaneMessage?: SendAndSubmitTmuxPaneMessagePort | undefined;
  writePaneActivity: WriteWatchdogPaneActivityPort;
}

async function handleNudgeAndMaybeRestart(
  input: NudgeAndMaybeRestartInput
): Promise<WatchdogPaneActivityState | null> {
  const nudgeEligibility = shouldAttemptNudge({
    state: input.context.state,
    currentRecord: input.currentRecord,
    hasEscInterrupt: input.sampleResult.has_esc_interrupt ?? false,
    now: input.context.now
  });
  if (!nudgeEligibility.eligible) {
    return null;
  }
  if (
    nudgeEligibility.elapsedSinceLastSeenMs < WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS ||
    nudgeEligibility.elapsedSinceLastNudgeMs < WATCHDOG_PANE_NUDGE_GRACE_PERIOD_MS
  ) {
    return null;
  }

  const paneIndex = resolveWatchdogTargetPaneIndex(input.context.state.active_role!);
  const targetPane = `${input.sampleResult.session_name}:0.${paneIndex}`;

  if (!input.sendAndSubmitTmuxPaneMessage) {
    return null;
  }

  try {
    const nudgeResult = await trySendWatchdogNudge({
      activeRole: input.context.state.active_role!,
      bubbleConfig: input.context.resolved.bubbleConfig,
      bubbleId: input.context.resolved.bubbleId,
      worktreePath: input.context.resolved.bubblePaths.worktreePath,
      sessionsPath: input.context.resolved.bubblePaths.sessionsPath,
      runTmux: input.runTmux,
      readRuntimeSessionsRegistry: input.readRuntimeSessionsRegistry,
      sendAndSubmitTmuxPaneMessage: input.sendAndSubmitTmuxPaneMessage,
      targetPane,
      nudgeMessage: 'Continue exactly where you left off. Do not summarize or repeat the previous text. Remember your task only ends when you run "pairflow agent emit", never before.',
      sessionName: input.sampleResult.session_name
    });
    if (nudgeResult === "pane_not_ready") {
      return {
        readStatus: input.readResultStatus,
        currentRecord: input.currentRecord,
        sampleResult: input.sampleResult
      };
    }
    if (nudgeResult === "ok") {
      const currentRound = input.context.state.round;
      const currentRole = input.context.state.active_role!;
      const currentExecutionId = input.context.state.execution_context?.execution_id ?? undefined;

      const isSameStep =
        input.currentRecord.last_nudge_round === currentRound &&
        input.currentRecord.last_nudge_role === currentRole &&
        input.currentRecord.last_nudge_execution_id === currentExecutionId;

      const nextNudgeCount = isSameStep ? (input.currentRecord.last_nudge_count ?? 0) + 1 : 1;

      input.currentRecord.last_nudge_at = input.context.nowIso;
      input.currentRecord.last_nudge_count = nextNudgeCount;
      input.currentRecord.last_nudge_round = currentRound;
      input.currentRecord.last_nudge_role = currentRole;
      if (currentExecutionId !== undefined) {
        input.currentRecord.last_nudge_execution_id = currentExecutionId;
      } else {
        delete input.currentRecord.last_nudge_execution_id;
      }

      if (nextNudgeCount === 5) {
        if (input.context.restartBubble) {
          input.currentRecord.last_nudge_count = 0;
          await input.writePaneActivity({
            runtimeDir: input.context.resolved.bubblePaths.runtimeDir,
            bubbleId: input.context.resolved.bubbleId,
            record: input.currentRecord
          });

          const restartResult = await input.context.restartBubble({
            bubbleId: input.context.resolved.bubbleId,
            repoPath: input.context.resolved.repoPath,
            cwd: input.context.cwd,
            now: input.context.now
          });

          return {
            readStatus: input.readResultStatus,
            currentRecord: input.currentRecord,
            sampleResult: input.sampleResult,
            restarted: true,
            restartResult
          };
        }
      }
    }
  } catch {
    /* best effort */
  }

  return null;
}

export async function maybeMonitorWatchdogPaneActivity(input: {
  context: WatchdogRuntimeContext; monitored: boolean; readPaneActivity: ReadWatchdogPaneActivityPort; writePaneActivity: WriteWatchdogPaneActivityPort; samplePaneActivity: SampleWatchdogPaneActivityFn; readRuntimeSessionsRegistry: BubbleWatchdogDependencies["readRuntimeSessionsRegistry"]; runTmux: BubbleWatchdogDependencies["runTmux"]; sendAndSubmitTmuxPaneMessage?: SendAndSubmitTmuxPaneMessagePort;
}): Promise<WatchdogPaneActivityState | null> {
  if (!input.monitored || input.context.state.active_agent === null || input.context.state.active_role === null) {
    return null;
  }

  const readResult = await input.readPaneActivity({ runtimeDir: input.context.resolved.bubblePaths.runtimeDir, bubbleId: input.context.resolved.bubbleId });
  let currentRecord = readResult.status === "ok" ? readResult.record : null;

  if (!shouldSamplePaneActivity(readResult, input.context.now, input.context.state.active_role)) {
    return { readStatus: readResult.status, currentRecord, sampleResult: null };
  }

  if (input.readRuntimeSessionsRegistry === undefined || input.runTmux === undefined) {
    throw new BubbleWatchdogError("Watchdog runtime dependencies missing: readRuntimeSessionsRegistry or runTmux.");
  }

  const sampleResult = await input.samplePaneActivity({
    bubbleId: input.context.resolved.bubbleId,
    bubbleConfig: input.context.resolved.bubbleConfig,
    sessionsPath: input.context.resolved.bubblePaths.sessionsPath,
    activeRole: input.context.state.active_role,
    ...(currentRecord !== null ? { priorPaneHash: currentRecord.pane_hash } : {}),
    now: input.context.now,
    readSessionsRegistry: input.readRuntimeSessionsRegistry,
    runner: input.runTmux
  });

  if (sampleResult.status === "sampled") {
    currentRecord = buildNextPaneActivityRecord({
      bubbleId: input.context.resolved.bubbleId, previous: currentRecord, previousReadStatus: readResult.status, sampleResult
    });

    const nudgeAndRestartResult = await handleNudgeAndMaybeRestart({
      context: input.context,
      currentRecord,
      sampleResult,
      readResultStatus: readResult.status,
      runTmux: input.runTmux,
      readRuntimeSessionsRegistry: input.readRuntimeSessionsRegistry,
      sendAndSubmitTmuxPaneMessage: input.sendAndSubmitTmuxPaneMessage,
      writePaneActivity: input.writePaneActivity
    });

    if (nudgeAndRestartResult !== null) {
      return nudgeAndRestartResult;
    }

    await input.writePaneActivity({ runtimeDir: input.context.resolved.bubblePaths.runtimeDir, bubbleId: input.context.resolved.bubbleId, record: currentRecord });
    return { readStatus: readResult.status, currentRecord, sampleResult };
  }

  if (currentRecord !== null) {
    currentRecord = buildFailedSampleRecord({ previous: currentRecord, sampleResult });
    await input.writePaneActivity({ runtimeDir: input.context.resolved.bubblePaths.runtimeDir, bubbleId: input.context.resolved.bubbleId, record: currentRecord });
  }

  return { readStatus: readResult.status, currentRecord, sampleResult };
}
