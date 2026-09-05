import { describe, expect, it } from "vitest";

import type { TmuxRunner, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";
import { sendAndSubmitTmuxPaneMessage } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxPaneWrite.js";

function captureRunner(): { runner: TmuxRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: TmuxRunner = async (args: string[]): Promise<TmuxRunResult> => {
    calls.push(args);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { runner, calls };
}

describe("sendAndSubmitTmuxPaneMessage pasteViaBuffer", () => {
  it("loads the message into a tmux buffer, pastes it, and deletes the buffer", async () => {
    const { runner, calls } = captureRunner();
    const written: string[] = [];

    await sendAndSubmitTmuxPaneMessage(runner, "%11", "hello\nworld", {
      pasteViaBuffer: true,
      pasteBufferName: "pf-test-buf",
      writeTempFile: async (content) => {
        written.push(content);
        return "/tmp/pairflow-paste-test.md";
      },
      submitDelayMs: 0
    });

    // load-buffer, paste-buffer, delete-buffer, then Enter
    const commandFirst = calls.map((c) => c[0]);
    expect(commandFirst).toContain("load-buffer");
    expect(commandFirst).toContain("paste-buffer");
    expect(commandFirst).toContain("delete-buffer");
    expect(commandFirst).toContain("send-keys");
    expect(written).toEqual(["hello\nworld"]);

    const loadCall = calls.find((c) => c[0] === "load-buffer");
    expect(loadCall).toEqual(["load-buffer", "-b", "pf-test-buf", "/tmp/pairflow-paste-test.md"]);
    const pasteCall = calls.find((c) => c[0] === "paste-buffer");
    expect(pasteCall).toEqual(["paste-buffer", "-b", "pf-test-buf", "-t", "%11"]);
    const deleteCall = calls.find((c) => c[0] === "delete-buffer");
    expect(deleteCall).toEqual(["delete-buffer", "-b", "pf-test-buf"]);
  });

  it("falls back to keystrokes when pasteViaBuffer is off", async () => {
    const { runner, calls } = captureRunner();
    await sendAndSubmitTmuxPaneMessage(runner, "%11", "hi", {
      maxChunkLength: 10,
      interChunkDelayMs: 0,
      submitDelayMs: 0
    });
    expect(calls.some((c) => c[0] === "load-buffer")).toBe(false);
    expect(calls.some((c) => c[0] === "paste-buffer")).toBe(false);
  });

  it("falls back to keystrokes when buffer paste fails, so input is not dropped", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = async (args: string[]): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "load-buffer") {
        return { stdout: "", stderr: "tmux load-buffer failed", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await sendAndSubmitTmuxPaneMessage(runner, "%11", "hello world", {
      pasteViaBuffer: true,
      maxChunkLength: 200,
      interChunkDelayMs: 0,
      submitDelayMs: 0,
      writeTempFile: async () => "/tmp/paste-fail.md"
    });

    // It attempted buffer paste, then fell back to send-keys keystrokes.
    expect(calls.some((c) => c[0] === "load-buffer")).toBe(true);
    const sendKeysCalls = calls.filter((c) => c[0] === "send-keys");
    expect(sendKeysCalls.length).toBeGreaterThan(0);
  });

  it("propagates the buffer-paste failure when requireSuccess and keystrokes also fail", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = async (args: string[]): Promise<TmuxRunResult> => {
      calls.push(args);
      return { stdout: "", stderr: "fail", exitCode: 1 };
    };

    await expect(
      sendAndSubmitTmuxPaneMessage(runner, "%11", "hello world", {
        pasteViaBuffer: true,
        requireSuccess: true,
        writeTempFile: async () => "/tmp/paste-fail.md"
      })
    ).rejects.toThrow(/TMUX_BUFFER_PASTE_FAILED|TMUX_MESSAGE_WRITE_FAILED/u);
  });

  it("collapses newlines to a single space when collapseNewlines is set", async () => {
    const { runner, calls } = captureRunner();
    await sendAndSubmitTmuxPaneMessage(runner, "%11", "line one\nline two\n\nline three", {
      maxChunkLength: 1000,
      interChunkDelayMs: 0,
      submitDelayMs: 0,
      collapseNewlines: true
    });
    const literalWrites = calls.filter((c) => c[0] === "send-keys" && c.includes("-l"));
    expect(literalWrites).toHaveLength(1);
    expect(literalWrites[0]?.[4]).toContain("line one line two line three");
    expect(literalWrites[0]?.[4]).not.toContain("\n");
  });
});

describe("sendAndSubmitTmuxPaneMessage submitPerChunk", () => {
  it("submits each chunk with its own Enter before the final Enter", async () => {
    const sleepForDelayMs = async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
    };
    const { runner, calls } = captureRunner();

    const message = "chunk-one | chunk-two | chunk-three"; // 35 chars
    await sendAndSubmitTmuxPaneMessage(runner, "%11", message, {
      maxChunkLength: 10,
      interChunkDelayMs: 0,
      submitDelayMs: 0,
      sleepForDelayMs,
      submitPerChunk: true
    });

    const sendKeysCalls = calls.filter((c) => c[0] === "send-keys");
    // 4 literal-write chunks (10-char slices), each followed by an Enter
    // (3 intermediate + 1 final).
    const literalWrites = sendKeysCalls.filter((c) => c.includes("-l"));
    const enterCalls = sendKeysCalls.filter((c) => c.includes("Enter"));
    expect(literalWrites).toHaveLength(4);
    expect(enterCalls).toHaveLength(4);

    // Enter must follow each chunk: write, enter, write, enter, ...
    const sequence = sendKeysCalls.map((c) => (c.includes("-l") ? "write" : "enter"));
    expect(sequence).toEqual([
      "write",
      "enter",
      "write",
      "enter",
      "write",
      "enter",
      "write",
      "enter"
    ]);
  });

  it("without submitPerChunk only submits one final Enter (legacy behavior)", async () => {
    const sleepForDelayMs = async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
    };
    const { runner, calls } = captureRunner();

    const message = "chunk-one | chunk-two"; // 22 chars -> 3 chunks at 10-char max
    await sendAndSubmitTmuxPaneMessage(runner, "%11", message, {
      maxChunkLength: 10,
      interChunkDelayMs: 0,
      submitDelayMs: 0,
      sleepForDelayMs
    });

    const sendKeysCalls = calls.filter((c) => c[0] === "send-keys");
    const literalWrites = sendKeysCalls.filter((c) => c.includes("-l"));
    const enterCalls = sendKeysCalls.filter((c) => c.includes("Enter"));
    expect(literalWrites).toHaveLength(3);
    expect(enterCalls).toHaveLength(1);
  });
});
