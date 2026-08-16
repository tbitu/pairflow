import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { createDefaultRolePaneLifecycle } from "./rolePaneLifecycleDefaults.js";
import { runTmux } from "./tmuxRunner.js";
import { buildAgentCommand } from "../../../shared/command/agentCommand.js";
import { resolveRuntimeSessionWorkspaceAuthority } from "../../../shared/runtimeSessionWorkspaceAuthority.js";
import { DEFAULT_ROLE_MCP_POLICY_BY_ROLE } from "../../../../config/defaults.js";
import type {
  RefreshImplementerContextInput,
  RefreshImplementerContextResult
} from "../../../ports/implementerContext.js";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";

export type {
  RefreshImplementerContextFailureReason,
  RefreshImplementerContextInput,
  RefreshImplementerContextPort,
  RefreshImplementerContextResult
} from "../../../ports/implementerContext.js";

interface RefreshImplementerContextInternalInput extends RefreshImplementerContextInput {
  runner?: TmuxRunner;
  readSessionsRegistry?: typeof readRuntimeSessionsRegistry;
}

export async function refreshImplementerContext(
  input: RefreshImplementerContextInternalInput
): Promise<RefreshImplementerContextResult> {
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

  // Use unified RolePaneLifecycle to activate implementer pane
  const paneLifecycle = createDefaultRolePaneLifecycle();
  const runner = input.runner ?? runTmux;

  const roleMcpPolicy =
    input.bubbleConfig.role_mcp?.implementer
    ?? DEFAULT_ROLE_MCP_POLICY_BY_ROLE.implementer;
  const implementerCommand = buildAgentCommand({
    agentName: input.bubbleConfig.agents.implementer,
    roleName: "implementer",
    roleMcpPolicy,
    ...(input.bubbleConfig.agents.implementer_model !== undefined
      ? { model: input.bubbleConfig.agents.implementer_model }
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
    role: "implementer",
    command: implementerCommand,
    cwd: workspacePath,
    runner,
    expectedPaneAgent: input.bubbleConfig.agents.implementer
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

  return {
    refreshed: true
  };
}
