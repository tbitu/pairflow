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
