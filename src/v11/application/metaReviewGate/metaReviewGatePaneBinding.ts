import type {
  RuntimeSessionRecord
} from "../../ports/runtimeSessions.js";
import {
  getTopologySlotPaneIndexForRole
} from "../../shared/role/registry/topologySlotCatalog.js";
import type {
  ResolveMetaReviewerPaneWarning
} from "../../shared/metaReviewGate/index.js";
import type {
  MetaReviewGatePaneBindingTmuxCapabilities
} from "../../shared/metaReviewGate/metaReviewGateRuntimeCapabilities.js";
import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type {
  PairflowCommandProfile,
  RoleMcpPolicy
} from "../../shared/config/bubbleConfigVocabulary.js";
import {
  resolveMetaReviewGatePaneBindingTmuxCapabilities
} from "./metaReviewGateRuntimeCapabilityResolution.js";
import {
  buildMetaReviewGateRunPrompt
} from "./internal/prompts/metaReviewGatePrompt.js";
import {
  resolveRuntimeSessionWorkspaceAuthority
} from "../../shared/runtimeSessionWorkspaceAuthority.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../config/defaults.js";
import {
  getAgentRuntimeProfile,
  resolveTmuxPasteOptions
} from "../../shared/agent/agentRuntimeProfiles.js";
import {
  deactivateOtherRolePanes
} from "../../shared/channel/rolePaneLifecycle.js";
import {
  getSharedTopologySlotPaneIndexForRole
} from "../../shared/topology/topologySlotPaneProjection.js";
import { WATCHDOG_NUDGE_PROMPT } from "../../shared/watchdog/watchdogPrompt.js";

function resolveMetaReviewerWorkspaceAuthority(input: {
  bubbleId: string;
  runtimeSessionRecord: RuntimeSessionRecord;
}):
  | {
    status: "resolved";
    workspacePath: string;
  }
  | {
    status: "failed";
    message: string;
  } {
  const resolution = resolveRuntimeSessionWorkspaceAuthority({
    runtimeSessionRecord: input.runtimeSessionRecord
  });
  if (resolution.status === "resolved") {
    return {
      status: "resolved",
      workspacePath: resolution.authority.workspacePath
    };
  }

  return {
    status: "failed",
    message:
      `Bubble ${input.bubbleId} cannot bind meta-review pane because runtime workspace authority is empty.`
  };
}

function buildMetaReviewerPaneFailure(input: {
  reasonCode:
    | "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE"
    | "META_REVIEWER_PANE_UNAVAILABLE"
    | "META_REVIEWER_PANE_RESPAWN_FAILED";
  message: string;
  shouldDeactivate: boolean;
}) {
  return {
    delivery: {
      status: "failed" as const,
      reasonCode: input.reasonCode,
      message: input.message
    },
    shouldDeactivate: input.shouldDeactivate
  };
}

function isDurableHandoffOnlyBindingResult(
  value: Awaited<ReturnType<typeof activateMetaReviewerPane>>
): value is { updated: true; reason: "durable_handoff_only"; record?: undefined } {
  return value.updated
    && value.reason === "durable_handoff_only"
    && value.record === undefined;
}

async function activateMetaReviewerPane(input: Parameters<
  ResolveMetaReviewerPaneWarning
>[0]) {
  return input.setMetaReviewerPane({
    sessionsPath: input.sessionsPath,
    bubbleId: input.bubbleId,
    active: true,
    now: input.now
  }).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      updated: false,
      reason: "no_runtime_session" as const,
      errorMessage: reason
    };
  });
}

type MetaReviewGateCommandBuilder = NonNullable<
  NonNullable<
    NonNullable<Parameters<ResolveMetaReviewerPaneWarning>[0]["runtime"]>["paneBinding"]
  >["buildAgentCommand"]
>;

type MetaReviewGatePaneBindingRuntime = NonNullable<
  NonNullable<Parameters<ResolveMetaReviewerPaneWarning>[0]["runtime"]>["paneBinding"]
>;

type MetaReviewGatePaneBindingTmux = NonNullable<
  ReturnType<typeof resolveMetaReviewGatePaneBindingTmuxCapabilities>
>;

function buildMetaReviewerCommand(input: {
  buildAgentCommand: MetaReviewGateCommandBuilder;
  metaReviewerAgent: AgentName;
  bubbleId: string;
  round: number;
  workspacePath: string;
  repoPath: string;
  taskArtifactPath: string;
  pairflowCommandProfile: PairflowCommandProfile;
  metaReviewerMcpPolicy: RoleMcpPolicy;
  metaReviewerModel?: string;
}): string {
  const roleMcpPolicy =
    input.metaReviewerMcpPolicy
    ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.meta_reviewer;

  const startupPrompt = buildMetaReviewGateRunPrompt({
    bubbleId: input.bubbleId,
    round: input.round,
    repoPath: input.repoPath,
    taskArtifactPath: input.taskArtifactPath
  });

  return input.buildAgentCommand({
    agentName: input.metaReviewerAgent,
    roleName: "meta_reviewer",
    roleMcpPolicy,
    ...(input.metaReviewerModel !== undefined ? { model: input.metaReviewerModel } : {}),
    bubbleId: input.bubbleId,
    workspacePath: input.workspacePath,
    pairflowCommandProfile: input.pairflowCommandProfile,
    round: input.round,
    repoPath: input.repoPath,
    taskArtifactPath: input.taskArtifactPath,
    startupPrompt
  });
}

function resolvePaneBindingPrerequisites(input: {
  runtime: Parameters<ResolveMetaReviewerPaneWarning>[0]["runtime"];
}):
  | {
    ok: true;
    paneBindingRuntime: MetaReviewGatePaneBindingRuntime;
    paneBindingTmux: MetaReviewGatePaneBindingTmux;
    buildAgentCommand: MetaReviewGateCommandBuilder;
    respawnPaneCommand: NonNullable<MetaReviewGatePaneBindingTmux["respawnPaneCommand"]>;
  }
  | {
    ok: false;
    failure: ReturnType<typeof buildMetaReviewerPaneFailure>;
  } {
  const paneBindingRuntime = input.runtime?.paneBinding;
  const paneBindingTmux = resolveMetaReviewGatePaneBindingTmuxCapabilities(
    paneBindingRuntime
  );

  if (paneBindingRuntime?.buildAgentCommand === undefined) {
    return {
      ok: false as const,
      failure: buildMetaReviewerPaneFailure({
        reasonCode: "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE",
        message: "meta-review gate pane binding is missing agent command builder.",
        shouldDeactivate: false
      })
    };
  }
  if (paneBindingTmux?.respawnPaneCommand === undefined) {
    return {
      ok: false as const,
      failure: buildMetaReviewerPaneFailure({
        reasonCode: "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE",
        message: "meta-review gate pane binding is missing respawn capability.",
        shouldDeactivate: false
      })
    };
  }

  return {
    ok: true as const,
    paneBindingRuntime,
    paneBindingTmux,
    buildAgentCommand: paneBindingRuntime.buildAgentCommand,
    respawnPaneCommand: paneBindingTmux.respawnPaneCommand
  };
}

type ResolveMetaReviewerPaneWarningInput = Parameters<ResolveMetaReviewerPaneWarning>[0];
type ResolveMetaReviewerPaneWarningResult = Awaited<ReturnType<ResolveMetaReviewerPaneWarning>>;

async function deliverMetaReviewerPromptViaTmuxPaste(input: {
  paneBindingTmux: MetaReviewGatePaneBindingTmuxCapabilities;
  metaReviewerAgent: AgentName;
  sessionName: string;
  paneIndex: number;
  bubbleId: string;
  round: number;
  repoPath: string;
  taskArtifactPath: string;
  shouldDeactivate: boolean;
}): Promise<ResolveMetaReviewerPaneWarningResult> {
  const runner = input.paneBindingTmux.runner;
  const waitForPaneReady = input.paneBindingTmux.waitForPaneReady;
  const sendSubmissionRequestMessage = input.paneBindingTmux.sendSubmissionRequestMessage;

  if (runner === undefined || waitForPaneReady === undefined || sendSubmissionRequestMessage === undefined) {
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE",
      message:
        "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE: tmux prompt delivery capabilities are unavailable.",
      shouldDeactivate: input.shouldDeactivate
    });
  }

  const targetPane = `${input.sessionName}:0.${input.paneIndex}`;
  const isReady = await waitForPaneReady(input.metaReviewerAgent, {
    runner,
    targetPane,
    attempts: 100,
    retryDelayMs: 300
  });

  if (!isReady) {
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_RESPAWN_FAILED",
      message:
        "META_REVIEWER_PANE_RESPAWN_FAILED: meta-reviewer pane failed readiness check after respawn.",
      shouldDeactivate: input.shouldDeactivate
    });
  }

  const startupPrompt = buildMetaReviewGateRunPrompt({
    bubbleId: input.bubbleId,
    round: input.round,
    repoPath: input.repoPath,
    taskArtifactPath: input.taskArtifactPath
  });

  await sendSubmissionRequestMessage(runner, targetPane, startupPrompt, {
    maxChunkLength: 1024,
    ...resolveTmuxPasteOptions(input.metaReviewerAgent)
  });
  await sendSubmissionRequestMessage(runner, targetPane, WATCHDOG_NUDGE_PROMPT, {
    maxChunkLength: 1024,
    ...resolveTmuxPasteOptions(input.metaReviewerAgent)
  }).catch(() => undefined);

  return {
    delivery: {
      status: "confirmed",
      reasonCode: null,
      message: "meta-review submit request delivered via tmux paste."
    },
    shouldDeactivate: input.shouldDeactivate
  };
}

async function executeMetaReviewerRespawnAndDelivery(input: {
  bindStartRecord: RuntimeSessionRecord;
  workspacePath: string;
  paneIndex: number;
  input: ResolveMetaReviewerPaneWarningInput;
  paneBindingTmux: MetaReviewGatePaneBindingTmuxCapabilities;
  buildAgentCommand: MetaReviewGateCommandBuilder;
  respawnPaneCommand: NonNullable<MetaReviewGatePaneBindingTmux["respawnPaneCommand"]>;
  shouldDeactivate: boolean;
}): Promise<ResolveMetaReviewerPaneWarningResult> {
  const profile = getAgentRuntimeProfile(input.input.metaReviewerAgent);
  try {
    if (!profile.supportsConcurrentPanes) {
      const runner = input.paneBindingTmux.runner;
      if (runner === undefined) {
        return buildMetaReviewerPaneFailure({
          reasonCode: "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE",
          message: "meta-review gate pane binding is missing runner capability.",
          shouldDeactivate: input.shouldDeactivate
        });
      }
      const deactivateFn =
        input.paneBindingTmux.deactivateOtherRolePanes ?? deactivateOtherRolePanes;
      await deactivateFn({
        activateInput: {
          sessionName: input.bindStartRecord.tmuxSessionName,
          role: "meta_reviewer",
          cwd: input.workspacePath,
          runner,
          expectedPaneAgent: input.input.metaReviewerAgent
        },
        topologyPaneIndexForRole: getSharedTopologySlotPaneIndexForRole,
        respawnPane: (respawnInput: Parameters<typeof input.respawnPaneCommand>[0]) =>
          input.respawnPaneCommand({
            ...respawnInput,
            runner
          }),
        ...(input.input.configureRoleAgent !== undefined
          ? { configureRoleAgent: input.input.configureRoleAgent }
          : {})
      });
    }

    const metaReviewerCommand = buildMetaReviewerCommand({
      buildAgentCommand: input.buildAgentCommand,
      metaReviewerAgent: input.input.metaReviewerAgent,
      bubbleId: input.input.bubbleId,
      round: input.input.round,
      workspacePath: input.workspacePath,
      repoPath: input.bindStartRecord.repoPath,
      taskArtifactPath: input.input.taskArtifactPath,
      pairflowCommandProfile: input.input.pairflowCommandProfile,
      metaReviewerMcpPolicy:
        input.input.metaReviewerMcpPolicy
        ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.meta_reviewer,
      ...(input.input.metaReviewerModel !== undefined
        ? { metaReviewerModel: input.input.metaReviewerModel }
        : {})
    });

    await input.respawnPaneCommand({
      sessionName: input.bindStartRecord.tmuxSessionName,
      paneIndex: input.paneIndex,
      cwd: input.workspacePath,
      command: metaReviewerCommand,
      ...(input.paneBindingTmux.runner !== undefined
        ? { runner: input.paneBindingTmux.runner }
        : {})
    });

    if (profile.startupPromptDelivery === "tmux_paste") {
      return await deliverMetaReviewerPromptViaTmuxPaste({
        paneBindingTmux: input.paneBindingTmux,
        metaReviewerAgent: input.input.metaReviewerAgent,
        sessionName: input.bindStartRecord.tmuxSessionName,
        paneIndex: input.paneIndex,
        bubbleId: input.input.bubbleId,
        round: input.input.round,
        repoPath: input.bindStartRecord.repoPath,
        taskArtifactPath: input.input.taskArtifactPath,
        shouldDeactivate: input.shouldDeactivate
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_RESPAWN_FAILED",
      message: `META_REVIEWER_PANE_RESPAWN_FAILED: ${reason}`,
      shouldDeactivate: input.shouldDeactivate
    });
  }

  return {
    delivery: {
      status: "confirmed",
      reasonCode: null,
      message: "meta-review submit request delivered as meta-reviewer launch prompt."
    },
    shouldDeactivate: input.shouldDeactivate
  };
}

export const resolveMetaReviewerPaneWarning: ResolveMetaReviewerPaneWarning = async (
  input
) => {
  const prerequisites = resolvePaneBindingPrerequisites({
    runtime: input.runtime
  });
  if (!prerequisites.ok) {
    return prerequisites.failure;
  }
  const {
    paneBindingTmux,
    buildAgentCommand,
    respawnPaneCommand
  } = prerequisites;

  const bindStart = await activateMetaReviewerPane(input);
  if (!bindStart.updated) {
    const bindReason = "errorMessage" in bindStart
      ? bindStart.errorMessage
      : bindStart.reason ?? "unknown";
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_UNAVAILABLE",
      message: `META_REVIEWER_PANE_UNAVAILABLE: ${bindReason}`,
      shouldDeactivate: false
    });
  }
  if (isDurableHandoffOnlyBindingResult(bindStart)) {
    return {
      delivery: {
        status: "confirmed",
        reasonCode: null,
        message: "meta-review submit request uses durable handoff only; no pane binding update required."
      },
      shouldDeactivate: false
    };
  }
  if (!("record" in bindStart) || bindStart.record === undefined) {
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_RUNTIME_UNAVAILABLE",
      message:
        "meta-review gate pane binding updated without runtime session record authority.",
      shouldDeactivate: false
    });
  }

  const shouldDeactivate = true;
  const paneIndex = getTopologySlotPaneIndexForRole("meta_reviewer");
  const workspaceAuthority = resolveMetaReviewerWorkspaceAuthority({
    bubbleId: input.bubbleId,
    runtimeSessionRecord: bindStart.record
  });
  if (workspaceAuthority.status !== "resolved") {
    return buildMetaReviewerPaneFailure({
      reasonCode: "META_REVIEWER_PANE_UNAVAILABLE",
      message: `META_REVIEWER_PANE_UNAVAILABLE: ${workspaceAuthority.message}`,
      shouldDeactivate
    });
  }

  return await executeMetaReviewerRespawnAndDelivery({
    bindStartRecord: bindStart.record,
    workspacePath: workspaceAuthority.workspacePath,
    paneIndex,
    input,
    paneBindingTmux,
    buildAgentCommand,
    respawnPaneCommand,
    shouldDeactivate
  });
};
