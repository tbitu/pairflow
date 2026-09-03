/* eslint-disable @typescript-eslint/no-unused-vars */
import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { createDefaultRolePaneLifecycle } from "./rolePaneLifecycleDefaults.js";
import { runTmux } from "./tmuxRunner.js";
import {
  sendAndSubmitTmuxPaneMessage, submitTmuxPaneInput
} from "./tmuxInput.js";
import { buildAgentCommand } from "../../../shared/command/agentCommand.js";
import { resolveTmuxPasteOptions } from "../../../shared/agent/agentRuntimeProfiles.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";

import { resolveRuntimeSessionWorkspaceAuthority } from "../../../shared/runtimeSessionWorkspaceAuthority.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../config/defaults.js";
import type {
  RefreshReviewerContextInput,
  RefreshReviewerContextResult
} from "../../../ports/reviewerContext.js";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

export type {
  RefreshReviewerContextFailureReason,
  RefreshReviewerContextInput,
  RefreshReviewerContextPort,
  RefreshReviewerContextResult
} from "../../../ports/reviewerContext.js";

interface RefreshReviewerContextInternalInput extends RefreshReviewerContextInput {
  runner?: TmuxRunner;
  readSessionsRegistry?: typeof readRuntimeSessionsRegistry;
  startupSubmitDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function submitReviewerStartupPrompt(input: {
  startupPrompt?: string | undefined;
  runner: TmuxRunner;
  sessionName: string;
  paneIndex: number;
  startupSubmitDelayMs?: number;
  reviewerAgentName: AgentName;
}): Promise<void> {
  if (!input.startupPrompt?.trim()) {
    return;
  }

  const targetPane = `${input.sessionName}:0.${input.paneIndex}`;
  const startupSubmitDelayMs = input.startupSubmitDelayMs ?? 1500;
  if (startupSubmitDelayMs > 0) {
    await sleep(startupSubmitDelayMs);
  }
  await sendAndSubmitTmuxPaneMessage(
    input.runner,
    targetPane,
    input.startupPrompt,
    {
      maxChunkLength: 1024,
      // reasonix drops flooded keystrokes: batch the paste into smaller chunks.
      ...resolveTmuxPasteOptions(input.reviewerAgentName)
    }
  );
}

export async function refreshReviewerContext(
  input: RefreshReviewerContextInternalInput
): Promise<RefreshReviewerContextResult> {
  const readSessions = input.readSessionsRegistry ?? readRuntimeSessionsRegistry;

  let sessionName: string | undefined;
  let workspacePath: string | undefined;
  try {
    const sessions = await readSessions(input.sessionsPath, {
      allowMissing: true
    });
    const record = sessions[input.bubbleId];
    sessionName = record?.tmuxSessionName;
    const workspaceAuthority = resolveRuntimeSessionWorkspaceAuthority({
      runtimeSessionRecord: record
    });
    if (workspaceAuthority.status === "resolved") {
      workspacePath = workspaceAuthority.authority.workspacePath;
    }
  } catch {
    return {
      refreshed: false,
      reason: "registry_read_failed"
    };
  }

  if (sessionName === undefined || workspacePath === undefined) {
    return {
      refreshed: false,
      reason: "no_runtime_session"
    };
  }

  // Use unified RolePaneLifecycle to activate reviewer pane
  const paneLifecycle = createDefaultRolePaneLifecycle({
    configureRoleAgent: (role) => {
      if (role === "implementer") return input.bubbleConfig.agents.implementer;
      if (role === "reviewer") return input.bubbleConfig.agents.reviewer;
      if (role === "meta_reviewer") return input.bubbleConfig.agents.meta_reviewer;
      return undefined;
    }
  });
  const runner = input.runner ?? runTmux;
  
  const roleMcpPolicy =
    input.bubbleConfig.role_mcp?.reviewer
    ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.reviewer;
  const reviewerCommand = buildAgentCommand({
    agentName: input.bubbleConfig.agents.reviewer,
    roleName: "reviewer",
    roleMcpPolicy,
    ...(input.bubbleConfig.agents.reviewer_model !== undefined
      ? { model: input.bubbleConfig.agents.reviewer_model }
      : {}),
    bubbleId: input.bubbleId,
    workspacePath,
    pairflowCommandProfile: input.bubbleConfig.pairflow_command_profile,
    ...(input.bubbleConfig.executor?.type === "ssh"
      ? {
          remoteWorkspaceAuthority: {
            workspaceRoot: workspacePath
          }
        }
      : {})
  });

  const activateResult = await paneLifecycle.activatePaneForRole({
    sessionName,
    role: "reviewer",
    command: reviewerCommand,
    cwd: workspacePath,
    runner,
    expectedPaneAgent: input.bubbleConfig.agents.reviewer
  });

  if (!activateResult.ok) {
    return {
      refreshed: false,
      reason:
        activateResult.reason === "respawn_failed"
          ? "tmux_respawn_failed"
          : "readiness_timeout"
    };
  }

  // Submit startup prompt if provided
  if (input.reviewerStartupPrompt !== undefined) {
    await submitReviewerStartupPrompt({
      startupPrompt: input.reviewerStartupPrompt,
      runner,
      sessionName,
      paneIndex: activateResult.paneIndex,
      reviewerAgentName: input.bubbleConfig.agents.reviewer,
      ...(input.startupSubmitDelayMs !== undefined
        ? { startupSubmitDelayMs: input.startupSubmitDelayMs }
        : {})
    });
  }

  return {
    refreshed: true
  };
}
