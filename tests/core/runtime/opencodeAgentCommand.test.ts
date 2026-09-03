import { describe, expect, it } from "vitest";
import { buildAgentCommand } from "../../../src/v11/shared/command/agentCommand.js";

describe("buildAgentCommand for opencode", () => {
  it("includes startup prompt with --prompt option for opencode", () => {
    const cmd = buildAgentCommand({
      agentName: "opencode",
      roleName: "meta_reviewer",
      bubbleId: "b_opencode_test_01",
      workspacePath: "/tmp/worktree/opencode-test",
      startupPrompt: "Test startup prompt"
    });

    expect(cmd).toContain("opencode");
    expect(cmd).toContain("--agent");
    expect(cmd).toContain("PF-meta-reviewer");
    expect(cmd).toContain("--prompt");
    expect(cmd).toContain("Test startup prompt");
  });

  it("includes startup prompt with --prompt option for implementer role as well", () => {
    const cmd = buildAgentCommand({
      agentName: "opencode",
      roleName: "implementer",
      bubbleId: "b_opencode_test_02",
      workspacePath: "/tmp/worktree/opencode-test",
      startupPrompt: "Implement task details"
    });

    expect(cmd).toContain("opencode");
    expect(cmd).toContain("--agent");
    expect(cmd).toContain("PF-implementer");
    expect(cmd).toContain("--prompt");
    expect(cmd).toContain("Implement task details");
  });
});

describe("buildAgentCommand for reasonix", () => {
  it("launches code-mode TUI pinned to the workspace without --prompt or --agent", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_01",
      workspacePath: "/tmp/worktree/reasonix-test",
      startupPrompt: "Test startup prompt"
    });

    expect(cmd).toContain("reasonix");
    expect(cmd).toContain("code");
    expect(cmd).toContain("--dir");
    expect(cmd).toContain("/tmp/worktree/reasonix-test");
    expect(cmd).toContain("--permission-mode");
    expect(cmd).toContain("bypassPermissions");
    // reasonix has no --agent and no --prompt flags; the startup prompt is
    // delivered through tmux paste instead.
    expect(cmd).not.toContain("--agent");
    expect(cmd).not.toContain("--prompt");
    expect(cmd).not.toContain("PF-implementer");
    expect(cmd).not.toContain("Test startup prompt");
  });

  it("passes the model through with --model", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "reviewer",
      model: "deepseek-flash",
      bubbleId: "b_reasonix_test_02",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("--model");
    expect(cmd).toContain("deepseek-flash");
  });

  it("falls back to npx --yes reasonix when the binary is missing from PATH", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_03",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("command -v reasonix");
    expect(cmd).toContain("command -v npx");
    // The npx fallback branch passes --yes through to npx (tokens are
    // shell-quoted and the outer wrapper re-escapes inner quotes).
    expect(cmd).toContain("--yes");
    expect(cmd).toContain("reasonix CLI not found in PATH");
  });

  it("keeps reasonix as the npx package name so 'code' stays a subcommand (regression)", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_05",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    // The npx fallback must be `npx --yes reasonix code --dir ...`, never
    // `npx --yes code ...` (which would make npm fetch the unrelated `code`
    // package and fail with "could not determine executable to run").
    const npxInvocation = cmd
      .split("\n")
      .find((line) => line.includes("npx") && line.includes("code"));
    expect(npxInvocation).toBeDefined();
    if (npxInvocation === undefined) {
      throw new Error("npx invocation line missing from launch script");
    }
    expect(npxInvocation).toContain("reasonix");
    expect(npxInvocation.indexOf("reasonix")).toBeLessThan(
      npxInvocation.indexOf("code")
    );
  });

  it("renders a distinct dropped-shell message for the npx fallback", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_04",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("reasonix (via npx) exited (code");
  });

  it("writes a per-bubble reasonix.toml that permits pairflow's agent writes", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_06",
      workspacePath: "/tmp/worktree/reasonix-test",
      repoPath: "/tmp/repo"
    });

    // Permission fallback allows writes so `pairflow agent emit` does not prompt.
    expect(cmd).toContain("reasonix.toml");
    expect(cmd).toContain('mode = "allow"');
    // Sandbox anchors to the worktree and allows .pairflow writes.
    expect(cmd).toContain("workspace_root = \"/tmp/worktree/reasonix-test\"");
    expect(cmd).toContain("/tmp/worktree/reasonix-test/.pairflow");
    // Git-worktree bubbles need the shared repo .git metadata for raw git ops.
    expect(cmd).toContain("/tmp/repo/.git");
    // Bubble LIVE pairflow state (bubbles/, runtime/, evidence/) lives under the
    // HOST repo's .pairflow, so it must also be writable or reasonix blocks every
    // `agent emit` with an interactive sandbox permission prompt.
    expect(cmd).toContain("/tmp/repo/.pairflow");
    // The config write happens before the launch (guard: only when absent).
    const configLineIndex = cmd.indexOf("reasonix.toml");
    const launchIndex = cmd.indexOf("command -v reasonix");
    expect(configLineIndex).toBeGreaterThan(-1);
    expect(launchIndex).toBeGreaterThan(configLineIndex);
  });

  it("starts reasonix fresh on every launch — never resumes a prior session", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_07",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    // A fresh task/handover must never reuse a prior reasonix session. The
    // launch must not pass --resume / --continue / -r / -c (reasonix has no
    // --fresh flag; a plain `code --dir <ws>` starts a new session).
    expect(cmd).not.toContain("--resume");
    expect(cmd).not.toContain("--continue");
    // The reasonix launch line is the sole `code` invocation; make sure it's
    // not a `run` (headless) or resume path, and that no `-r` flag is passed
    // as a standalone argv token to reasonix.
    const launchLines = cmd.split("\n").filter((line) => line.includes("'code'"));
    expect(launchLines.length).toBeGreaterThan(0);
    for (const line of launchLines) {
      expect(line).not.toContain("--resume");
      expect(line).not.toContain("--continue");
      expect(line).not.toMatch(/\s-r'\s|\s-r\s/u);
    }
  });
});
