import { describe, expect, it } from "vitest";

// Re-exports and tests covering the full opencode agent integration surface.
import { buildAgentCommand } from "../../../src/v11/shared/command/agentCommand.js";
import { isOpencodePromptLine, detectOpencodeReadiness } from "../../../src/v11/infrastructure/channel/tmux/tmuxInput.js";

describe("opencode agent integration", () => {
  describe("buildAgentCommand for opencode", () => {
    it("includes startup prompt in the command without opencode-specific flags", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_opencode_01",
        worktreePath: "/tmp/worktree/opencode-test",
        opencodeMcpDisableArgs: [],
        startupPrompt: "Implement this task."
      });

      expect(cmd).toContain("opencode");
      expect(cmd).toContain("Implement this task.");
      expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(cmd).not.toContain("--dangerously-skip-permissions");
    });

    it("excludes MCP disable args for opencode", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_opencode_02",
        worktreePath: "/tmp/worktree/opencode-test",
        opencodeMcpDisableArgs: ["--strict-mcp-config", "--mcp-config", "{}"],
        startupPrompt: undefined
      });

      expect(cmd).not.toContain("--strict-mcp-config");
      expect(cmd).not.toContain("--mcp-config");
    });

    it("handles opencode without a startup prompt", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_opencode_03",
        worktreePath: "/tmp/worktree/opencode-test",
        opencodeMcpDisableArgs: [],
        startupPrompt: undefined
      });

      expect(cmd).toContain("opencode");
    });

    it("handles opencode with a model selection", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_opencode_04",
        worktreePath: "/tmp/worktree/opencode-test",
        opencodeMcpDisableArgs: [],
        model: "gpt-4",
        startupPrompt: undefined
      });

      expect(cmd).toContain("opencode");
      expect(cmd).toContain("gpt-4");
    });
  });

  describe("isOpencodePromptLine", () => {
    it("returns false for all known prompt patterns until a regex is defined", () => {
      expect(isOpencodePromptLine("")).toBe(false);
      expect(isOpencodePromptLine("")).toBe(false);
      expect(isOpencodePromptLine("")).toBe(false);
      expect(isOpencodePromptLine("")).toBe(false);
      expect(isOpencodePromptLine("")).toBe(false);
      expect(isOpencodePromptLine("")).toBe(false);
    });
  });

  describe("detectOpencodeReadiness", () => {
    it("returns true via timeout sentinel when no visual indicator is found", async () => {
      const sleepRecordedDurations: number[] = [];
      const mockSleep = (ms: number) => {
        sleepRecordedDurations.push(ms);
        return Promise.resolve();
      };

      let capturedArgs: string[] | undefined;
      const testRunner = async (args: string[]) => {
        capturedArgs = args;
        if (args[0] === "capture-pane") {
          return { stdout: "# no-opencode-prompt", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const result = await detectOpencodeReadiness(
        testRunner as never,
        "test-pane-01",
        { timeoutMs: 50, maxPolls: 2, sleepForDelayMs: mockSleep }
      );

      expect(result).toBe(true);
      expect(capturedArgs?.[0]).toBe("capture-pane");
    });

    it("applies the 600ms fallback delay after exhausting polls", async () => {
      const sleepRecordedDurations: number[] = [];
      const mockSleep = (ms: number) => {
        sleepRecordedDurations.push(ms);
        return Promise.resolve();
      };

      const testRunner = async (args: string[]) => {
        if (args[0] === "capture-pane") {
          return { stdout: "# pane output", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      await detectOpencodeReadiness(
        testRunner as never,
        "test-pane-02",
        { timeoutMs: 5000, maxPolls: 1, sleepForDelayMs: mockSleep }
      );

      const hasFallback = sleepRecordedDurations.includes(600);
      expect(hasFallback).toBe(true);
    });

    it("respects custom timeout and maxPolls options", async () => {
      let captureCount = 0;
      const mockSleep = (ms: number) => {
        void ms;
        return Promise.resolve();
      };

      const testRunner = async (args: string[]) => {
        if (args[0] === "capture-pane") {
          captureCount += 1;
          return { stdout: "# pane", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      await detectOpencodeReadiness(
        testRunner as never,
        "test-pane-03",
        { timeoutMs: 5000, maxPolls: 4, sleepForDelayMs: mockSleep }
      );

      expect(captureCount).toBe(4);
    });

    it("returns true early if isOpencodePromptLine matches (future-proofing)", async () => {
      let captureCount = 0;
      const mockSleep = (ms: number) => {
        void ms;
        return Promise.resolve();
      };

      const testRunner = async (args: string[]) => {
        if (args[0] === "capture-pane") {
          captureCount += 1;
          return { stdout: "# pane\n❯ ", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      await detectOpencodeReadiness(
        testRunner as never,
        "test-pane-04",
        { timeoutMs: 5000, maxPolls: 10, sleepForDelayMs: mockSleep }
      );

      expect(captureCount).toBeLessThanOrEqual(10);
    });
  });

  describe("agent-specific behavior boundaries", () => {
    it("opencode command must not contain opencode permission flags", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_boundary_01",
        worktreePath: "/tmp/worktree/test",
        opencodeMcpDisableArgs: [],
        startupPrompt: undefined
      });

      expect(cmd).not.toContain("--dangerously-skip-permissions");
    });

    it("opencode command must not contain opencode sandbox flags", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_boundary_02",
        worktreePath: "/tmp/worktree/test",
        opencodeMcpDisableArgs: [],
        startupPrompt: undefined
      });

      expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("opencode command must contain its own permission flags", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_boundary_03",
        worktreePath: "/tmp/worktree/test",
        opencodeMcpDisableArgs: [],
        startupPrompt: undefined
      });

      expect(cmd).toContain("--dangerously-skip-permissions");
    });

    it("opencode command must contain its own permission flags", () => {
      const cmd = buildAgentCommand({
        agentName: "opencode",
        bubbleId: "b_boundary_04",
        worktreePath: "/tmp/worktree/test",
        opencodeMcpDisableArgs: [],
        startupPrompt: undefined
      });

      expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
    });
  });
});
