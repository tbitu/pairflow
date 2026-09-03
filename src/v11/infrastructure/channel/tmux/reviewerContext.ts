/* eslint-disable @typescript-eslint/no-unused-vars */
import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { createDefaultRolePaneLifecycle } from "./rolePaneLifecycleDefaults.js";
import { runTmux } from "./tmuxRunner.js";
import {
  sendAndSubmitTmuxPaneMessage, submitTmuxPaneInput
} from "./tmuxInput.js";
import { resolve } from "node:path";
import { buildAgentCommand } from "../../../shared/command/agentCommand.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered,
  resolveTmuxPasteOptions
} from "../../../shared/agent/agentRuntimeProfiles.js";
import { composeRolePrompt } from "../../../shared/role/prompts/roleStartupPromptComposer.js";
import { reviewerPolicySnapshotFileName } from "../../../shared/reviewer/reviewerPolicySnapshot.js";
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
      ...resolveTmuxPasteOptions(input.reviewerAgentName),
      ...(input.startupSubmitDelayMs === 0 ? { settleMs: 0, interChunkDelayMs: 0 } : {})
    }
  );
}

async function resolveReviewerSessionWorkspace(
  input: RefreshReviewerContextInternalInput
): Promise<
  | { ok: true; sessionName: string; workspacePath: string }
  | { ok: false; reason: NonNullable<RefreshReviewerContextResult["reason"]> }
> {
  const readSessions = input.readSessionsRegistry ?? readRuntimeSessionsRegistry;
  try {
    const sessions = await readSessions(input.sessionsPath, {
      allowMissing: true
    });
    const record = sessions[input.bubbleId];
    const sessionName = record?.tmuxSessionName;
    const workspaceAuthority = resolveRuntimeSessionWorkspaceAuthority({
      runtimeSessionRecord: record
    });
    if (sessionName !== undefined && workspaceAuthority.status === "resolved") {
      return {
        ok: true,
        sessionName,
        workspacePath: workspaceAuthority.authority.workspacePath
      };
    }
    return { ok: false, reason: "no_runtime_session" };
  } catch {
    return { ok: false, reason: "registry_read_failed" };
  }
}

function resolveReviewerStartupPromptToSubmit(input: {
  bubbleId: string;
  bubbleConfig: RefreshReviewerContextInternalInput["bubbleConfig"];
  workspacePath: string;
  reviewerStartupPrompt?: string | undefined;
}): string | undefined {
  if (input.reviewerStartupPrompt !== undefined) {
    return input.reviewerStartupPrompt;
  }
  const reviewerAgent = input.bubbleConfig.agents.reviewer;
  const reviewerProfile = isAgentNameRegistered(reviewerAgent)
    ? getAgentRuntimeProfile(reviewerAgent)
    : undefined;
  if (reviewerProfile?.startupPromptDelivery !== "tmux_paste") {
    return undefined;
  }
  return composeRolePrompt({
    agentName: reviewerAgent,
    role: "reviewer",
    phase: "startup",
    context: {
      bubbleId: input.bubbleId,
      repoPath: input.bubbleConfig.repo_path,
      workspacePath: input.workspacePath,
      taskArtifactPath: resolve(
        input.bubbleConfig.repo_path,
        `.pairflow/bubbles/${input.bubbleId}/artifacts/task.md`
      ),
      pairflowCommandProfile:
        input.bubbleConfig.pairflow_command_profile ?? "external",
      policySnapshotPathAbs: resolve(
        input.bubbleConfig.repo_path,
        `.pairflow/bubbles/${input.bubbleId}/artifacts/${reviewerPolicySnapshotFileName}`
      ),
      reviewArtifactType: input.bubbleConfig.review_artifact_type,
      reviewerBlockingMinSeverity:
        input.bubbleConfig.review_policy?.reviewer_blocking_min_severity
    }
  });
}

export async function refreshReviewerContext(
  input: RefreshReviewerContextInternalInput
): Promise<RefreshReviewerContextResult> {
  const sessionWorkspace = await resolveReviewerSessionWorkspace(input);
  if (!sessionWorkspace.ok) {
    return {
      refreshed: false,
      reason: sessionWorkspace.reason
    };
  }
  const { sessionName, workspacePath } = sessionWorkspace;

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

  const startupPromptToSubmit = resolveReviewerStartupPromptToSubmit({
    bubbleId: input.bubbleId,
    bubbleConfig: input.bubbleConfig,
    workspacePath,
    reviewerStartupPrompt: input.reviewerStartupPrompt
  });

  if (startupPromptToSubmit !== undefined) {
    await submitReviewerStartupPrompt({
      startupPrompt: startupPromptToSubmit,
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
