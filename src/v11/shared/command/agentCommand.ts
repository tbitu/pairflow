import { resolve } from "node:path";
import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import type {
  PairflowCommandProfile,
  RoleMcpPolicy
} from "../config/bubbleConfigVocabulary.js";
import { getAgentRuntimeProfile } from "../agent/agentRuntimeProfiles.js";
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
  // Phase 4: Metadata fields for agent situational awareness.
  // Agents reconstruct context internally instead of receiving pre-built prompts.
  round?: number;
  repoPath?: string;
  taskArtifactPath?: string;
  startupPrompt?: string | undefined;
}

/**
 * Build the agent argv (without the executable) for a bubble pane launch.
 * opencode takes role identity/model/startup prompt as CLI flags; reasonix
 * takes a code-mode TUI pinned to the workspace (startup prompt arrives via
 * tmux paste — see profile.startupPromptDelivery).
 */
function buildAgentLaunchArgs(input: {
  agentName: AgentName;
  roleName: AgentRole | undefined;
  model: string | undefined;
  startupPrompt: string | undefined;
  workspacePath: string;
  repoPath?: string | undefined;
}): string[] {
  const profile = getAgentRuntimeProfile(input.agentName);
  const args: string[] = [];
  const hasStartupPrompt = (input.startupPrompt?.trim().length ?? 0) > 0;

  if (profile.startupPromptDelivery === "cli_arg") {
    if ((input.model?.trim().length ?? 0) > 0) {
      args.push("--model", trimAndStripTrailingSlashes(input.model as string));
    }

    if (hasStartupPrompt) {
      args.push("--prompt", input.startupPrompt as string);
    }
  } else {
    // reasonix: code-mode TUI pinned to the workspace. Role identity is
    // delivered via file-based role instructions in the workspace artifacts.
    args.push("code", "--dir", input.workspacePath);

    const trimmedRepoPath = input.repoPath?.trim();
    if (
      trimmedRepoPath !== undefined &&
      trimmedRepoPath.length > 0 &&
      resolve(trimmedRepoPath) !== resolve(input.workspacePath)
    ) {
      args.push("--add-dir", trimmedRepoPath);
    }

    if ((input.model?.trim().length ?? 0) > 0) {
      args.push("--model", trimAndStripTrailingSlashes(input.model as string));
    }

    // Autonomous loop agents run without human prompting in YOLO mode. This mirrors the
    // opencode profile's `permission: "allow"` config injection.
    args.push("--permission-mode", "danger-full-access");
  }

  return args;
}

function buildOpencodePreparation(): string[] {
  return [
    `export OPENCODE_CONFIG_CONTENT=${shellQuote(
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        permission: "allow",
        provider: {
          lmstudio: {
            options: {
              baseURL: "http://127.0.0.1:1235/v1",
              headerTimeout: 600_000,
              chunkTimeout: 1_800_000,
              timeout: 3_600_000
            }
          }
        }
      })
    )}`
  ];
}

function buildMissingBinaryMessage(agentName: AgentName, bubbleId: string): string {
  if (agentName === "reasonix") {
    return `reasonix CLI not found in PATH for bubble ${bubbleId}. Install reasonix (npm i -g reasonix).`;
  }
  return `opencode CLI not found in PATH for bubble ${bubbleId}. Install opencode.`;
}

/**
 * reasonix is file-configured (reasonix.toml in the workspace root, else the
 * user-level ~/.reasonix/config.toml). The user-level config commonly sets
 * `[sandbox] bash = "enforce"`, which requires bubblewrap ('bwrap') on Linux.
 * In containerized or unconfined environments without bwrap, `bash = "enforce"`
 * refuses shell execution. Mirroring OPENCODE_CONFIG_CONTENT, a per-bubble
 * `reasonix.toml` is written into the workspace before launch with `bash = "off"`
 * so bubble agents run unconfined without requiring host bubblewrap, and can write
 * under the worktree (including `.pairflow/`). External writable paths (such as
 * the host repo containing live `.pairflow/` state and `.git/`) cannot be permitted
 * in a project-level `reasonix.toml` (which ignores external paths in `allow_write`);
 * In addition, Reasonix requires a one-time YOLO acknowledgment when launched with
 * `--permission-mode danger-full-access` (or `--yolo`), stored in
 * `<Reasonix home>/yolo-acknowledged.json`. Autonomous loop agents run unattended in
 * tmux panes, so this file is pre-populated if absent to prevent blocking on the
 * interactive "Enable YOLO? [y/N]" prompt.
 */
function buildReasonixPreparation(input: {
  workspacePath: string;
}): string[] {
  const workspacePath = input.workspacePath;
  const configToml = [
    "[sandbox]",
    // Anchor the sandbox to the bubble worktree and permit writes under it,
    // including .pairflow.
    `workspace_root = ${JSON.stringify(workspacePath)}`,
    `allow_write = [${JSON.stringify(`${workspacePath}/.pairflow`)}, ${JSON.stringify(workspacePath)}]`,
    'bash = "off"',
    "network = true"
  ].join("\n");
  return [
    'rx_home="${REASONIX_HOME:-$HOME/.reasonix}"',
    'if [ ! -f "$rx_home/yolo-acknowledged.json" ]; then mkdir -p "$rx_home" && printf \'{"acknowledged_at":"%s"}\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo 2026-01-01T00:00:00Z)" > "$rx_home/yolo-acknowledged.json"; fi',
    // Only write when absent so we never clobber a user-provided worktree config.
    `if [ ! -f reasonix.toml ]; then printf '%s\\n' ${shellQuote(configToml)} > reasonix.toml; fi`
  ];
}

/**
 * Build the shell script that launches an agent in a bubble pane.
 *
 * Launches the agent executable (`opencode` or `reasonix`) directly with its
 * profile arguments, reporting the binary as missing if not found in PATH.
 */
export function buildAgentCommand(input: BuildAgentCommandInput): string {
  const agentName = input.agentName;
  const bubbleId = input.bubbleId;
  const workspacePath = (input.workspacePath ?? input.worktreePath ?? "").trim();
  if (workspacePath.length === 0) {
    throw new Error(
      `AGENT_COMMAND_WORKSPACE_REQUIRED: Workspace path is required to build agent command for bubble ${bubbleId}.`
    );
  }
  const missingBinaryMessage = buildMissingBinaryMessage(agentName, bubbleId);
  const worktreePinningMessage = `Failed to pin agent root to workspace ${workspacePath} for bubble ${bubbleId}.`;

  const launchArgs = buildAgentLaunchArgs({
    agentName,
    roleName: input.roleName,
    model: input.model,
    startupPrompt: input.startupPrompt,
    workspacePath,
    repoPath: input.repoPath
  });
  const pairflowBootstrap = buildPairflowCommandBootstrap(
    workspacePath,
    input.pairflowCommandProfile ?? "external",
    input.externalPairflowCommand,
    input.remoteWorkspaceAuthority
  );

  const agentLaunchBlock = buildAgentLaunchBlock({
    agentName,
    bubbleId,
    launchArgs,
    profilePreparation:
      agentName === "opencode"
        ? buildOpencodePreparation()
        : agentName === "reasonix"
          ? buildReasonixPreparation({
              workspacePath
            })
          : [],
    missingBinaryMessage
  });

  const script = [
    "set +e",
    `if ! cd ${shellQuote(workspacePath)}; then`,
    `  printf '%s\\n' ${shellQuote(worktreePinningMessage)}`,
    "  exec bash -i",
    "fi",
    ...pairflowBootstrap,
    ...agentLaunchBlock
  ].join("\n");
  return `bash -lc ${shellQuote(script)}`;
}

function buildAgentLaunchBlock(input: {
  agentName: AgentName;
  bubbleId: string;
  launchArgs: string[];
  profilePreparation: string[];
  missingBinaryMessage: string;
}): string[] {
  const { agentName, bubbleId, launchArgs, profilePreparation, missingBinaryMessage } = input;
  const droppedShellLine = `printf '${agentName} exited (code %s). Dropping to interactive shell.\\n' "$agent_exit_code"`;

  return [
    `if command -v ${agentName} >/dev/null 2>&1; then`,
    ...profilePreparation,
    `  ${renderLaunchCommand(agentName, launchArgs)}`,
    "  agent_exit_code=$?",
    `  ${droppedShellLine}`,
    "  exec bash -i",
    "fi",
    `printf '%s\\n' ${shellQuote(missingBinaryMessage)}`,
    `printf 'bubble=${bubbleId}\\n'`,
    "exec bash -i"
  ];
}

function renderLaunchCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(shellQuote).join(" ");
}
