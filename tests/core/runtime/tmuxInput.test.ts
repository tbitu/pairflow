import { describe, expect, it } from "vitest";

import {
  sendAndSubmitTmuxPaneMessage,
  maybeAcceptClaudeTrustPrompt,
  checkTmuxPaneMarkerStatus,
  isOpencodePromptLine,
  detectOpencodeReadiness
} from "../../../src/v11/infrastructure/channel/tmux/tmuxInput.js";

describe("sendAndSubmitTmuxPaneMessage", () => {
  it("exits copy mode before sending text to the pane", async () => {
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "display-message") {
        return {
          stdout: "1",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    await sendAndSubmitTmuxPaneMessage(runner, "pane-1", "hello");

    expect(calls).toEqual([
      ["display-message", "-p", "-t", "pane-1", "#{pane_in_mode}"],
      ["copy-mode", "-q", "-t", "pane-1"],
      ["send-keys", "-t", "pane-1", "-l", "hello"],
      ["send-keys", "-t", "pane-1", "Enter"]
    ]);
  });

  it("skips copy-mode reset when the pane is already in normal mode", async () => {
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "display-message") {
        return {
          stdout: "0",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    await sendAndSubmitTmuxPaneMessage(runner, "pane-1", "hello");

    expect(calls).toEqual([
      ["display-message", "-p", "-t", "pane-1", "#{pane_in_mode}"],
      ["send-keys", "-t", "pane-1", "-l", "hello"],
      ["send-keys", "-t", "pane-1", "Enter"]
    ]);
  });
});

describe("checkTmuxPaneMarkerStatus", () => {
  it("treats a promptless visible marker as still stuck in input", async () => {
    const runner = async (args: string[]) => {
      if (args[0] === "capture-pane") {
        return {
          stdout: "# [pairflow] r1 PASS codex->codex msg=msg_1 ref=artifact://handoff.md.",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    await expect(
      checkTmuxPaneMarkerStatus(runner, "pane-1", "msg=msg_1")
    ).resolves.toBe("stuck_in_input");
  });
});

describe("maybeAcceptClaudeTrustPrompt", () => {
  it("accepts Claude folder trust prompts with Enter", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (captureCount === 1) {
          return {
            stdout: [
              "Accessing workspace:",
              "/home/dev/repos/pairflow--remote-smoke",
              "Security guide",
              "❯ 1. Yes, I trust this folder",
              "2. No, exit",
              "Enter to confirm · Esc to cancel"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          };
        }
        return {
          stdout: "Claude Code is ready.",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    const accepted = await maybeAcceptClaudeTrustPrompt(runner, "pane-1");

    expect(accepted).toBe(true);
    expect(calls).toEqual([
      ["capture-pane", "-pt", "pane-1"],
      ["send-keys", "-t", "pane-1", "Enter"],
      ["capture-pane", "-pt", "pane-1"]
    ]);
  });

  it("accepts Codex workspace trust prompts", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (captureCount === 1) {
          return {
            stdout: [
              "> You are in /home/dev/repos/pairflow--remote-smoke",
              "Do you trust the contents of this directory?",
              "1. Yes, continue",
              "2. No, quit"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          };
        }
        return {
          stdout: "Codex ready.",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    const accepted = await maybeAcceptClaudeTrustPrompt(runner, "pane-1");

    expect(accepted).toBe(true);
    expect(calls).toEqual([
      ["capture-pane", "-pt", "pane-1"],
      ["display-message", "-p", "-t", "pane-1", "#{pane_in_mode}"],
      ["send-keys", "-t", "pane-1", "-l", "1"],
      ["send-keys", "-t", "pane-1", "Enter"],
      ["capture-pane", "-pt", "pane-1"]
    ]);
  });

  it("accepts chained Claude trust and bypass-permissions prompts", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (captureCount === 1) {
          return {
            stdout: [
              "Accessing workspace:",
              "/home/dev/repos/pairflow--remote-smoke",
              "Security guide",
              "❯ 1. Yes, I trust this folder",
              "2. No, exit",
              "Enter to confirm · Esc to cancel"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          };
        }
        if (captureCount === 2) {
          return {
            stdout: [
              "WARNING: Claude Code running in Bypass Permissions mode",
              "❯ 1. No, exit",
              "2. Yes, I accept",
              "Enter to confirm · Esc to cancel"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          };
        }
        return {
          stdout: "Claude Code is ready.",
          stderr: "",
          exitCode: 0
        };
      }
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    };

    const accepted = await maybeAcceptClaudeTrustPrompt(runner, "pane-1");

    expect(accepted).toBe(true);
    expect(calls).toEqual([
      ["capture-pane", "-pt", "pane-1"],
      ["send-keys", "-t", "pane-1", "Enter"],
      ["capture-pane", "-pt", "pane-1"],
      ["display-message", "-p", "-t", "pane-1", "#{pane_in_mode}"],
      ["send-keys", "-t", "pane-1", "-l", "2"],
      ["send-keys", "-t", "pane-1", "Enter"],
      ["capture-pane", "-pt", "pane-1"]
    ]);
  });
});

describe("isOpencodePromptLine", () => {
  it("returns false by default until an opencode-specific pattern is defined", () => {
    expect(isOpencodePromptLine()).toBe(false);
    expect(isOpencodePromptLine()).toBe(false);
    expect(isOpencodePromptLine()).toBe(false);
  });
});

describe("detectOpencodeReadiness", () => {
  it("falls back to timeout sentinel when no visual indicator is found within timeout", async () => {
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

    const result = await detectOpencodeReadiness(testRunner as never, "test-pane-01", {
      timeoutMs: 50,
      maxPolls: 3,
      sleepForDelayMs: mockSleep
    });

    expect(result).toBe(true);
    // Should do up to maxPolls polls then fall back with 600ms delay
    // Poll delay changed from 250ms to 150ms (minimal polling for placeholder readiness)
    expect(sleepRecordedDurations).toContain(600);
  });

  it("exits after maxPolls and applies fallback sentinel", async () => {
    // isOpencodePromptLine currently always returns false (TODO placeholder),
    // so the function exhausts polls then falls back to the delay sentinel.
    const sleepRecordedDurations: number[] = [];
    let captureCount = 0;
    const mockSleep = (ms: number) => {
      sleepRecordedDurations.push(ms);
      return Promise.resolve();
    };
    const testRunner = async (args: string[]) => {
      if (args[0] === "capture-pane") {
        captureCount += 1;
        return { stdout: "# [opencode/implementer]\n> ready", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    };

    const result = await detectOpencodeReadiness(testRunner as never, "test-pane-02", {
      timeoutMs: 5000,
      maxPolls: 1,
      sleepForDelayMs: mockSleep
    });

    expect(result).toBe(true);
    expect(captureCount).toBe(1);
    // Fallback delay is always applied after polling exhausts or times out
    expect(sleepRecordedDurations.length).toBeGreaterThanOrEqual(1);
  });

  it("polls multiple times before falling back to timeout sentinel", async () => {
    const sleepRecordedDurations: number[] = [];
    let captureCount = 0;
    const mockSleep = (ms: number) => {
      sleepRecordedDurations.push(ms);
      return Promise.resolve();
    };
    const testRunner = async (args: string[]) => {
      if (args[0] === "capture-pane") {
        captureCount += 1;
        return { stdout: `# pane output #${captureCount}`, stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    };

    const result = await detectOpencodeReadiness(testRunner as never, "test-pane-03", {
      timeoutMs: 5000,
      maxPolls: 5,
      sleepForDelayMs: mockSleep
    });

    expect(result).toBe(true);
    expect(captureCount).toBe(5);
    // Should have poll delays + fallback delay
    // Poll delay changed from 250ms to 150ms (minimal polling for placeholder readiness)
    const pollSlept = sleepRecordedDurations.filter((ms) => ms === 150);
    expect(pollSlept.length).toBe(5);
  });
});
