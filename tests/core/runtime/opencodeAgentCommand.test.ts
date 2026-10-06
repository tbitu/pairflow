import { describe, expect, it } from "vitest";
import { buildAgentCommand } from "../../../src/v11/shared/command/agentCommand.js";

describe("buildAgentCommand for opencode", () => {
  it("includes startup prompt with --prompt option for opencode without --agent PF-* flags", () => {
    const cmd = buildAgentCommand({
      agentName: "opencode",
      roleName: "meta_reviewer",
      bubbleId: "b_opencode_test_01",
      workspacePath: "/tmp/worktree/opencode-test",
      startupPrompt: "Test startup prompt"
    });

    expect(cmd).toContain("opencode");
    expect(cmd).not.toContain("--agent");
    expect(cmd).not.toContain("PF-meta-reviewer");
    expect(cmd).toContain("--prompt");
    expect(cmd).toContain("Test startup prompt");
  });

  it("passes model through with --model option without --agent PF-* flags", () => {
    const cmd = buildAgentCommand({
      agentName: "opencode",
      roleName: "implementer",
      bubbleId: "b_opencode_test_02",
      workspacePath: "/tmp/worktree/opencode-test",
      model: "lmstudio/pairflow-reviewer"
    });

    expect(cmd).toContain("opencode");
    expect(cmd).not.toContain("--agent");
    expect(cmd).not.toContain("PF-implementer");
    expect(cmd).toContain("--model");
    expect(cmd).toContain("lmstudio/pairflow-reviewer");
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
    expect(cmd).toContain("danger-full-access");
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

  it("checks for reasonix executable in PATH directly and does not fall back to npx", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_03",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("command -v reasonix");
    expect(cmd).not.toContain("command -v npx");
    expect(cmd).not.toContain("npx");
    expect(cmd).toContain("reasonix CLI not found in PATH");
  });

  it("writes a per-bubble reasonix.toml and passes --add-dir for the host repo", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_06",
      workspacePath: "/tmp/worktree/reasonix-test",
      repoPath: "/tmp/repo"
    });

    // Project-level reasonix.toml must not set mode = "allow" (only user config sets this).
    expect(cmd).toContain("reasonix.toml");
    expect(cmd).not.toContain('mode = "allow"');
    // Sandbox anchors to the worktree and allows .pairflow writes under the worktree.
    expect(cmd).toContain("workspace_root = \"/tmp/worktree/reasonix-test\"");
    expect(cmd).toContain("/tmp/worktree/reasonix-test/.pairflow");
    // Host repo (including .git and .pairflow) is granted via --add-dir so the Reasonix
    // OS sandbox permits agent emit and git commits without EROFS blocks.
    expect(cmd).toContain("--add-dir");
    expect(cmd).toContain("/tmp/repo");
    // External paths must not be placed in project reasonix.toml allow_write (which ignores them).
    expect(cmd).not.toContain("/tmp/repo/.git");
    expect(cmd).not.toContain("/tmp/repo/.pairflow");
    // Bash sandbox must be off so commands execute unconfined without requiring bubblewrap.
    expect(cmd).toContain('bash = "off"');
    expect(cmd).not.toContain('bash = "enforce"');
    // Pre-acknowledges YOLO mode in Reasonix home before launch.
    expect(cmd).toContain("yolo-acknowledged.json");
    expect(cmd).toContain('rx_home="${REASONIX_HOME:-$HOME/.reasonix}"');
    // The config write happens before the launch (guard: only when absent).
    const configLineIndex = cmd.indexOf("reasonix.toml");
    const launchIndex = cmd.indexOf("'reasonix'");
    expect(configLineIndex).toBeGreaterThan(-1);
    expect(launchIndex).toBeGreaterThan(configLineIndex);
  });

  it("pre-acknowledges reasonix YOLO mode in Reasonix home before launch", () => {
    const cmd = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_06_yolo",
      workspacePath: "/tmp/worktree/reasonix-test"
    });

    expect(cmd).toContain("yolo-acknowledged.json");
    expect(cmd).toContain('rx_home="${REASONIX_HOME:-$HOME/.reasonix}"');
    const yoloIndex = cmd.indexOf("yolo-acknowledged.json");
    const launchIndex = cmd.indexOf("'reasonix'");
    expect(yoloIndex).toBeGreaterThan(-1);
    expect(launchIndex).toBeGreaterThan(yoloIndex);
  });

  it("does not pass --add-dir when repoPath is undefined or identical to workspacePath", () => {
    const cmdNoRepo = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_06b",
      workspacePath: "/tmp/worktree/reasonix-test"
    });
    expect(cmdNoRepo).not.toContain("--add-dir");

    const cmdSameRepo = buildAgentCommand({
      agentName: "reasonix",
      roleName: "implementer",
      bubbleId: "b_reasonix_test_06c",
      workspacePath: "/tmp/worktree/reasonix-test",
      repoPath: "/tmp/worktree/reasonix-test"
    });
    expect(cmdSameRepo).not.toContain("--add-dir");
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
