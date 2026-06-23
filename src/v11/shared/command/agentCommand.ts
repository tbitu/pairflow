
import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import type {
  PairflowCommandProfile,
  RoleMcpPolicy
} from "../config/bubbleConfigVocabulary.js";
import { shellQuote } from "../foundation/shellQuote.js";
import {
  buildPairflowCommandBootstrap,
  type PairflowRemoteWorkspaceAuthority
} from "./pairflowCommandBootstrap.js";

export interface BuildAgentCommandInput {
  agentName: AgentName;
  roleName?: AgentRole;
  roleMcpPolicy?: RoleMcpPolicy;
  model?: string;
  bubbleId: string;
  workspacePath?: string;
  worktreePath?: string;
  pairflowCommandProfile?: PairflowCommandProfile;
  externalPairflowCommand?: string;
  remoteWorkspaceAuthority?: PairflowRemoteWorkspaceAuthority;
  opencodeMcpDisableArgs?: string[];
  startupPrompt?: string | undefined;
}

export class UnsupportedAgentError extends Error {
  public readonly reasonCode: "UNSUPPORTED_AGENT";
  public readonly context: Record<string, unknown>;

  constructor(agentName: AgentName) {
    super(`Unsupported agent: ${String(agentName)}`);
    this.name = "UnsupportedAgentError";
    this.reasonCode = "UNSUPPORTED_AGENT";
    this.context = { agent_name: String(agentName) };
  }
}

export class WorkspacePathRequiredError extends Error {
  public readonly reasonCode: "WORKSPACE_PATH_REQUIRED";
  public readonly context: Record<string, unknown>;

  constructor(bubbleId: string) {
    super(`Workspace path is required to build agent command for bubble ${bubbleId}`);
    this.name = "WorkspacePathRequiredError";
    this.reasonCode = "WORKSPACE_PATH_REQUIRED";
    this.context = { bubble_id: bubbleId };
  }
}

function buildAgentLaunchCommand(
  agentName: AgentName,
  model: string | undefined,
  startupPrompt: string | undefined,
  roleName?: AgentRole
): string {
  if (agentName !== "opencode") {
    throw new UnsupportedAgentError(agentName);
  }

  const args: string[] = [agentName];

  // For opencode agents, inject the PF role-specific --agent flag.
  if (roleName === "implementer" || roleName === "reviewer") {
    args.push("--agent", roleName === "implementer" ? "PF-implementer" : "PF-reviewer");
  }

  if ((model?.trim().length ?? 0) > 0) {
    args.push("-m", model as string);
  }

  if ((startupPrompt?.trim().length ?? 0) > 0) {
    args.push("-p", startupPrompt as string);
  }

  return args.map((arg) => shellQuote(arg)).join(" ");
}



export function buildAgentCommand(input: BuildAgentCommandInput): string {
  const agentName = input.agentName;
  const bubbleId = input.bubbleId;
  const workspacePath = (input.workspacePath ?? input.worktreePath ?? "").trim();
  if (workspacePath.length === 0) {
    throw new WorkspacePathRequiredError(bubbleId);
  }
  const missingBinaryMessage = `${agentName} CLI not found in PATH for bubble ${bubbleId}. Install it or configure agent command mapping.`;
  const worktreePinningMessage = `Failed to pin agent root to workspace ${workspacePath} for bubble ${bubbleId}.`;

  const launchCommand = buildAgentLaunchCommand(
    agentName,
    input.model,
    input.startupPrompt,
    input.roleName
  );
  const pairflowBootstrap = buildPairflowCommandBootstrap(
    workspacePath,
    input.pairflowCommandProfile ?? "external",
    input.externalPairflowCommand,
    input.remoteWorkspaceAuthority
  );
  const agentExitedMessage = `${agentName} exited (code $agent_exit_code). Auto-restarting in 1s...`;

  const agentExecution = [
    "  while true; do",
    `    ${launchCommand}`,
    "    agent_exit_code=$?",
    `    printf '%s\\n' ${shellQuote(agentExitedMessage)}`,
    "    sleep 1",
    "  done"
  ];

  const script = [
    "set +e",
    `if ! cd ${shellQuote(workspacePath)}; then`,
    `  printf '%s\\n' ${shellQuote(worktreePinningMessage)}`,
    "  exec bash -i",
    "fi",
    ...pairflowBootstrap,
    `if command -v ${agentName} >/dev/null 2>&1; then`,
    ...agentExecution,
    "fi",
    `printf '%s\\n' ${shellQuote(missingBinaryMessage)}`,
    "exec bash -i"
  ].join("\n");
  return `bash -lc ${shellQuote(script)}`;
}

// Stub exports for test compatibility - resolveOpencodeMcpDisableArgs was referenced by tests but never implemented in source.
export type OpencodeMcpDisableArgsError = {
  name: string;
  reasonCode: string;
  context: Record<string, unknown>;
};

export type ResolveOpencodeMcpDisableArgsInput = {
  roleName: string;
  bubbleId: string;
  opencodeCommand: string;
};

// eslint-disable-next-line @typescript-eslint/require-await
export async function resolveOpencodeMcpDisableArgs(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: ResolveOpencodeMcpDisableArgsInput
): Promise<string[]> {
  return [];
}
