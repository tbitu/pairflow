import { spawn } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { OpencodeMcpDisableArgsError } from "../../../src/v11/shared/command/agentCommand.js";
import {
  buildAgentCommand,
  resolveOpencodeMcpDisableArgs
} from "../../../src/v11/shared/command/agentCommand.js";
import { shellQuote } from "../../../src/v11/shared/foundation/shellQuote.js";

async function assertBashParses(command: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bash", ["-n", "-c", command], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        rejectPromise(new Error(`bash could not parse command: ${stderr.trim()}`));
        return;
      }
      resolvePromise();
    });
  });
}

function extractBashLcScript(command: string): string {
  const prefix = "bash -lc ";
  expect(command.startsWith(prefix)).toBe(true);
  const quotedScript = command.slice(prefix.length);
  expect(quotedScript.startsWith("'")).toBe(true);
  expect(quotedScript.endsWith("'")).toBe(true);
  return quotedScript.slice(1, -1).replace(/'\\''/gu, "'");
}

async function resolveArgsWithFakeOpencode(input: {
  opencodeJson?: unknown;
  opencodeStdout?: string;
  opencodeStderr?: string;
  opencodeExitCode?: number;
}): Promise<string[]> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "pairflow-agent-command-"));
  const fakeOpencodePath = path.join(tempDir, "opencode");
  const opencodeStdout =
    input.opencodeStdout ?? JSON.stringify(input.opencodeJson ?? []);
  const opencodeStderr = input.opencodeStderr ?? "";
  const opencodeExitCode = input.opencodeExitCode ?? 0;
  await writeFile(
    fakeOpencodePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [ \"$1 $2\" != \"mcp list\" ]; then",
      "  printf '%s\\n' \"unexpected opencode invocation: $*\" >&2",
      "  exit 64",
      "fi",
      ...(opencodeStderr.length > 0
        ? [`printf '%s\\n' ${shellQuote(opencodeStderr)} >&2`]
        : []),
      `printf '%s\\n' ${shellQuote(opencodeStdout)}`,
      `exit ${opencodeExitCode}`
    ].join("\n")
  );
  await chmod(fakeOpencodePath, 0o755);

  return await resolveOpencodeMcpDisableArgs({
    roleName: "reviewer",
    bubbleId: "b_agent_cmd_fake_opencode",
    opencodeCommand: fakeOpencodePath
  });
}

describe("buildAgentCommand", () => {
  it("builds external profile bootstrap for opencode by default", async () => {
    const worktreePath = "/tmp/pairflow worktree/it's-here";
    const command = buildAgentCommand({
      agentName: "opencode",
      bubbleId: "b_agent_cmd_opencode_01",
      worktreePath,
      opencodeMcpDisableArgs: [
        "-c",
        'mcp_servers={"codescene"={command="node",args=["-e","process.exit(0)"],enabled=false}}'
      ],
      startupPrompt: "Prompt with `ticks` and $HOME literal."
    });
    const script = extractBashLcScript(command);

    expect(script).toContain(`if ! cd ${shellQuote(worktreePath)}; then`);
    expect(script).toContain("PAIRFLOW_EXTERNAL_COMMAND");
    expect(script).toContain("PAIRFLOW_COMMAND_EXTERNAL_UNAVAILABLE");
    expect(script).toContain('PAIRFLOW_WRAPPER_DIR');
    expect(script).toContain('cat > "$PAIRFLOW_WRAPPER_DIR/pairflow"');
    expect(script).toContain('exec "$PAIRFLOW_EXTERNAL_COMMAND" "$@"');
    expect(script).not.toContain('exec node "$PAIRFLOW_LOCAL_ENTRYPOINT" "$@"');
    expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command).not.toContain("opencode mcp list");
    expect(command).not.toContain("setTimeout");
    expect(command).not.toContain("command -v node");
    expect(command).toContain("mcp_servers={");
    expect(command).not.toContain("JSON.stringify");
    expect(command).not.toContain("unsupported control characters");
    expect(command).not.toContain("export PAIRFLOW_ROLE_MCP_ROLE_NAME");
    expect(command).not.toContain("export PAIRFLOW_ROLE_MCP_BUBBLE_ID");
    expect(command).not.toContain("PAIRFLOW_ROLE_MCP_DISABLE_UNAVAILABLE");
    expect(command).toContain("Prompt with `ticks` and $HOME literal.");
    await assertBashParses(command);
  });

  it("omits Opencode MCP discovery and disable overrides when the role opts in", async () => {
    const command = buildAgentCommand({
      agentName: "opencode",
      roleName: "reviewer",
      roleMcpPolicy: "enabled",
      bubbleId: "b_agent_cmd_opencode_enabled_01",
      worktreePath: "/tmp/pairflow-worktree/opencode-enabled"
    });

    expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command).not.toContain("opencode mcp list");
    expect(command).not.toContain("PAIRFLOW_ROLE_MCP_DISABLE_ARGS");
    await assertBashParses(command);
  });

  it("builds Opencode MCP disable overrides for quoted TOML server names", async () => {
    const opencodeMcpDisableArgs = await resolveArgsWithFakeOpencode({
      opencodeJson: [
        { name: "foo.bar", enabled: true },
        { name: "quote\"back\\slash", enabled: true },
        { name: "already_disabled", enabled: false }
      ]
    });
    const command = buildAgentCommand({
      agentName: "opencode",
      roleName: "reviewer",
      roleMcpPolicy: "disabled",
      bubbleId: "b_agent_cmd_quoted_mcp_names_01",
      worktreePath: "/tmp/pairflow-worktree/quoted-mcp",
      opencodeMcpDisableArgs
    });
    const script = extractBashLcScript(command);

    expect(opencodeMcpDisableArgs).toEqual([
      "-c",
      'mcp_servers={"foo.bar"={command="node",args=["-e","process.exit(0)"],enabled=false},"quote\\"back\\\\slash"={command="node",args=["-e","process.exit(0)"],enabled=false}}'
    ]);
    expect(script).toContain("PAIRFLOW_ROLE_MCP_DISABLE_ARGS=(");
    expect(script).toContain("foo.bar");
    expect(script).toContain('quote\\"back\\\\slash');
    expect(script).not.toContain("already_disabled");
    await assertBashParses(command);
  });

  it("fails closed when Opencode MCP discovery exits non-zero", async () => {
    await expect(resolveArgsWithFakeOpencode({
      opencodeStdout: "",
      opencodeStderr: "boom",
      opencodeExitCode: 7
    })).rejects.toThrow(
      "opencode mcp list --json failed for role reviewer in bubble b_agent_cmd_fake_opencode"
    );
    await expect(resolveArgsWithFakeOpencode({
      opencodeStdout: "",
      opencodeStderr: "boom",
      opencodeExitCode: 7
    })).rejects.toThrow("code=7");
    await expect(resolveArgsWithFakeOpencode({
      opencodeStdout: "",
      opencodeStderr: "boom",
      opencodeExitCode: 7
    })).rejects.toThrow("boom");
  });

  it("fails closed when Opencode MCP discovery returns malformed JSON", async () => {
    await expect(resolveArgsWithFakeOpencode({
      opencodeStdout: "{not-json"
    })).rejects.toThrow("opencode mcp list --json returned malformed JSON");
    await expect(resolveArgsWithFakeOpencode({
      opencodeStdout: "{not-json"
    })).rejects.toMatchObject({
      name: "OpencodeMcpDisableArgsError",
      reasonCode: "CODEX_MCP_LIST_JSON_MALFORMED",
      context: { command_name: "opencode mcp list --json" }
    } satisfies Partial<OpencodeMcpDisableArgsError>);
  });

  it("fails closed when Opencode MCP discovery returns invalid schema", async () => {
    await expect(resolveArgsWithFakeOpencode({
      opencodeJson: { name: "not-array" }
    })).rejects.toThrow("opencode mcp list --json must return a top-level array");
    await expect(resolveArgsWithFakeOpencode({
      opencodeJson: [{ name: "missing-enabled" }]
    })).rejects.toThrow("opencode MCP entry 0 has unsupported enabled value");
    await expect(resolveArgsWithFakeOpencode({
      opencodeJson: [{ name: "", enabled: true }]
    })).rejects.toThrow(
      "enabled opencode MCP entry 0 must have a non-empty string name"
    );
  });

  it("fails closed when an enabled Opencode MCP server name contains control characters", async () => {
    await expect(resolveArgsWithFakeOpencode({
      opencodeJson: [{ name: "bad\nname", enabled: true }]
    })).rejects.toThrow(
      "enabled opencode MCP entry 0 name contains unsupported control characters"
    );
  });

  it("passes strict empty MCP config for Opencode disabled roles", async () => {
    const command = buildAgentCommand({
      agentName: "opencode",
      roleName: "reviewer",
      roleMcpPolicy: "disabled",
      bubbleId: "b_agent_cmd_opencode_disabled_01",
      worktreePath: "/tmp/pairflow-worktree/opencode-disabled",
      startupPrompt: "review this handoff"
    });
    const script = extractBashLcScript(command);

    expect(command).toContain("--dangerously-skip-permissions");
    expect(command).toContain("--permission-mode");
    expect(command).toContain("bypassPermissions");
    expect(command).toContain("--strict-mcp-config");
    expect(command).toContain("--mcp-config");
    expect(command).toContain('{"mcpServers":{}}');
    expect(script).toContain(
      "'--mcp-config' '{\"mcpServers\":{}}' '--' 'review this handoff'"
    );
    await assertBashParses(command);
  });

  it("preserves Opencode baseline launch when the role opts in to MCP", async () => {
    const command = buildAgentCommand({
      agentName: "opencode",
      roleName: "meta_reviewer",
      roleMcpPolicy: "enabled",
      bubbleId: "b_agent_cmd_opencode_enabled_01",
      worktreePath: "/tmp/pairflow-worktree/opencode-enabled"
    });

    expect(command).toContain("--dangerously-skip-permissions");
    expect(command).not.toContain("--strict-mcp-config");
    expect(command).not.toContain("--mcp-config");
    await assertBashParses(command);
  });

  it("embeds precomputed Opencode MCP disable args without discovery script", async () => {
    const command = buildAgentCommand({
      agentName: "opencode",
      roleName: "implementer",
      roleMcpPolicy: "disabled",
      bubbleId: "b_agent_cmd_bash3_compat_01",
      worktreePath: "/tmp/pairflow-worktree/bash3",
      opencodeMcpDisableArgs: ["-c", "mcp_servers={}"]
    });
    const script = extractBashLcScript(command);

    expect(command).not.toContain("mapfile");
    expect(command).not.toContain("while IFS= read -r PAIRFLOW_ROLE_MCP_DISABLE_ARG");
    expect(command).not.toContain("PAIRFLOW_ROLE_MCP_DISABLE_OUTPUT=");
    expect(script).toContain("PAIRFLOW_ROLE_MCP_DISABLE_ARGS=('-c' 'mcp_servers={}')");
    await assertBashParses(command);
  });

  it("uses role policy instead of agent policy for same-agent roles", async () => {
    const disabledReviewer = buildAgentCommand({
      agentName: "opencode",
      roleName: "reviewer",
      roleMcpPolicy: "disabled",
      bubbleId: "b_agent_cmd_same_agent_reviewer_01",
      worktreePath: "/tmp/pairflow-worktree/same-agent-reviewer",
      opencodeMcpDisableArgs: ["-c", "mcp_servers={}"]
    });
    const enabledMetaReviewer = buildAgentCommand({
      agentName: "opencode",
      roleName: "meta_reviewer",
      roleMcpPolicy: "enabled",
      bubbleId: "b_agent_cmd_same_agent_meta_01",
      worktreePath: "/tmp/pairflow-worktree/same-agent-meta"
    });

    expect(disabledReviewer).toContain("PAIRFLOW_ROLE_MCP_DISABLE_ARGS");
    expect(enabledMetaReviewer).not.toContain("PAIRFLOW_ROLE_MCP_DISABLE_ARGS");
    await assertBashParses(disabledReviewer);
    await assertBashParses(enabledMetaReviewer);
  });

  it("prefers workspacePath as the canonical agent root when provided", async () => {
    const workspacePath = "/tmp/pairflow-workspace/canonical";
    const command = buildAgentCommand({
      agentName: "opencode",
      bubbleId: "b_agent_cmd_workspace_01",
      workspacePath,
      worktreePath: "/tmp/pairflow-workspace/legacy",
      opencodeMcpDisableArgs: [],
      startupPrompt: "Prompt"
    });
    const script = extractBashLcScript(command);

    expect(script).toContain(`if ! cd ${shellQuote(workspacePath)}; then`);
    expect(script).toContain(`export PAIRFLOW_WORKTREE_ROOT=${shellQuote(workspacePath)}`);
    expect(script).not.toContain("/tmp/pairflow-workspace/legacy");
    await assertBashParses(command);
  });

  it("pins the external pairflow authority when explicitly provided", async () => {
    const workspacePath = "/tmp/pairflow-remote-workspace/canonical";
    const command = buildAgentCommand({
      agentName: "opencode",
      bubbleId: "b_agent_cmd_remote_external_01",
      workspacePath,
      externalPairflowCommand: "/home/dev/.local/share/pnpm/pairflow",
      opencodeMcpDisableArgs: [],
      startupPrompt: "Prompt"
    });
    const script = extractBashLcScript(command);

    expect(script).toContain(
      "export PAIRFLOW_EXTERNAL_COMMAND='/home/dev/.local/share/pnpm/pairflow'"
    );
    await assertBashParses(command);
  });

  it("exports remote workspace authority for remote external panes", async () => {
    const workspacePath = "/remote/repos/pairflow--bubble-01";
    const command = buildAgentCommand({
      agentName: "opencode",
      bubbleId: "b_agent_cmd_remote_authority_01",
      workspacePath,
      externalPairflowCommand: "/home/dev/.local/share/pnpm/pairflow",
      remoteWorkspaceAuthority: {
        workspaceRoot: workspacePath,
        externalPairflowCommand: "/home/dev/.local/share/pnpm/pairflow"
      },
      opencodeMcpDisableArgs: [],
      startupPrompt: "Prompt"
    });
    const script = extractBashLcScript(command);

    expect(script).toContain(
      "export PAIRFLOW_REMOTE_START_MODE='inner_remote_activation'"
    );
    expect(script).toContain(
      "export PAIRFLOW_REMOTE_START_WORKSPACE_ROOT='/remote/repos/pairflow--bubble-01'"
    );
    expect(script).toContain(
      "export PAIRFLOW_REMOTE_START_EXTERNAL_PAIRFLOW_COMMAND='/home/dev/.local/share/pnpm/pairflow'"
    );
    await assertBashParses(command);
  });

  it("builds self_host profile bootstrap when explicitly selected", async () => {
    const worktreePath = "/tmp/pairflow-worktree/opencode";
    const command = buildAgentCommand({
      agentName: "opencode",
      bubbleId: "b_agent_cmd_opencode_01",
      worktreePath,
      pairflowCommandProfile: "self_host",
      startupPrompt: "Reviewer startup prompt."
    });
    const script = extractBashLcScript(command);

    expect(script).toContain(`if ! cd ${shellQuote(worktreePath)}; then`);
    expect(script).toContain("PAIRFLOW_LOCAL_ENTRYPOINT");
    expect(script).toContain("PAIRFLOW_COMMAND_PATH_STALE");
    expect(script).toContain('export PATH="$PAIRFLOW_WRAPPER_DIR:$PATH"');
    expect(command).toContain("--dangerously-skip-permissions");
    expect(command).toContain("--permission-mode");
    expect(command).toContain("bypassPermissions");
    await assertBashParses(command);
  });

  it("passes an explicit model to the selected agent CLI", async () => {
    const command = buildAgentCommand({
      agentName: "opencode",
      model: "opencode-sonnet-4-5",
      bubbleId: "b_agent_cmd_model_01",
      workspacePath: "/tmp/pairflow-worktree/model"
    });

    expect(command).toContain("--model");
    expect(command).toContain("opencode-sonnet-4-5");
    await assertBashParses(command);
  });

  it("fails closed when worktree path is empty", () => {
    expect(() =>
      buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_agent_cmd_invalid_01",
        worktreePath: "   "
      })
    ).toThrow("Workspace path is required");
  });
});
