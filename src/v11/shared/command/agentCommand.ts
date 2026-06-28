/* eslint-disable @typescript-eslint/no-unused-vars */

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
import { trimAndStripTrailingSlashes } from "../normalization/stringNormalization.js";

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
  startupPrompt?: string | undefined;
}

function buildAgentLaunchCommand(
  agentName: AgentName,
  roleName: AgentRole | undefined,
  model: string | undefined,
  startupPrompt: string | undefined,
  roleMcpPolicy: RoleMcpPolicy
): string {
  const args: string[] = [agentName];
  const hasStartupPrompt = (startupPrompt?.trim().length ?? 0) > 0;

  if (agentName === "opencode") {
    // AC1: Map opencode to PF-implementer or PF-reviewer agent identity.
    if (roleName === "implementer") {
      args.push("--agent", "PF-implementer");
    } else if (roleName === "reviewer" || roleName === "meta_reviewer") {
      args.push("--agent", "PF-reviewer");
    }
  }

  if ((model?.trim().length ?? 0) > 0) {
    args.push("--model", trimAndStripTrailingSlashes(model as string));
  }

  if (hasStartupPrompt) {
    args.push(startupPrompt as string);
  }

  return args.map(shellQuote).join(" ");
}

function buildOpencodePreparation(agentName: AgentName): string[] {
  if (agentName !== "opencode") {
    return [];
  }
  return [
    `export OPENCODE_CONFIG_CONTENT=${shellQuote(
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        permission: "allow",
        provider: {
          lmstudio: {
            options: {
              baseURL: "http://127.0.0.1:1235/v1",
              headerTimeout: 60_000,
              chunkTimeout: 120_000,
              timeout: 900_000
            }
          }
        }
      })
    )}`
  ];
}

export function buildAgentCommand(input: BuildAgentCommandInput): string {
  const agentName = input.agentName;
  const bubbleId = input.bubbleId;
  const workspacePath = (input.workspacePath ?? input.worktreePath ?? "").trim();
  if (workspacePath.length === 0) {
    throw new Error(`Workspace path is required to build agent command for bubble ${bubbleId}.`);
  }
  const missingBinaryMessage = `${agentName} CLI not found in PATH for bubble ${bubbleId}. Install it or configure agent command mapping.`;
  const worktreePinningMessage = `Failed to pin agent root to workspace ${workspacePath} for bubble ${bubbleId}.`;

  const opencodePreparation = buildOpencodePreparation(agentName);
  const launchCommand = buildAgentLaunchCommand(
    agentName,
    input.roleName,
    input.model,
    input.startupPrompt,
    input.roleMcpPolicy ?? "disabled"
  );
  const pairflowBootstrap = buildPairflowCommandBootstrap(
    workspacePath,
    input.pairflowCommandProfile ?? "external",
    input.externalPairflowCommand,
    input.remoteWorkspaceAuthority
  );
  const agentExitedMessage =
    `${agentName} exited (code $agent_exit_code). Dropping to interactive shell.`;
  const script = [
    "set +e",
    `if ! cd ${shellQuote(workspacePath)}; then`,
    `  printf '%s\\n' ${shellQuote(worktreePinningMessage)}`,
    "  exec bash -i",
    "fi",
    ...pairflowBootstrap,
    `if command -v ${agentName} >/dev/null 2>&1; then`,
    ...opencodePreparation,
    `  ${launchCommand}`,
    "  agent_exit_code=$?",
    `  printf '%s\\n' ${shellQuote(agentExitedMessage)}`,
    "  exec bash -i",
    "fi",
    `printf '%s\\n' ${shellQuote(missingBinaryMessage)}`,
    "exec bash -i"
  ].join("\n");
  return `bash -lc ${shellQuote(script)}`;
}
