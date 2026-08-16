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

  it("renders a distinct dropped-shell message for the npx fallback", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_04",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("reasonix (via npx) exited (code");
  });
});
