import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { TmuxRunOptions, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";
import { describe, expect, it } from "vitest";
import {
  postEmitInterruptCodexPane,
  resolveSessionsPath
} from "../../../../../src/v11/infrastructure/channel/tmux/postEmitInterruption.js";

describe("resolveSessionsPath", () => {
  it("should derive sessions.json path from repo path", () => {
    const result = resolveSessionsPath("/home/user/my-repo");
    expect(result).toBe(
      "/home/user/my-repo/.pairflow/runtime/sessions.json"
    );
  });

  it("handles trailing slashes gracefully", () => {
    const result = resolveSessionsPath("/home/user/my-repo/");
    expect(result).toBe(
      "/home/user/my-repo/.pairflow/runtime/sessions.json"
    );
  });
});

describe("postEmitInterruptCodexPane", () => {
  it("should be no-op when sessions registry is missing", async () => {
    const tmuxCalls: string[][] = [];
    function mockRunner(args: string[]): Promise<TmuxRunResult> {
      tmuxCalls.push(args);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }

    await postEmitInterruptCodexPane({
      sessionsPath: "/tmp/nonexistent-sessions.json",
      bubbleId: "test-bubble-1",
      tmuxRunner: mockRunner,
    });

    expect(tmuxCalls).toHaveLength(0);
  });

  it("should be no-op when bubble not in sessions registry", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;
    const nowIso = new Date().toISOString();

    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      sessionsPath,
      JSON.stringify({
        "other-bubble": {
          bubbleId: "other-bubble",
          repoPath: "/home/user/repo",
          worktreePath: "/tmp/worktrees/other-bubble",
          tmuxSessionName: "pf-other",
          updatedAt: nowIso
        }
      })
    );

    try {
      const tmuxCalls: string[][] = [];
      function mockRunner(args: string[]): Promise<TmuxRunResult> {
        tmuxCalls.push(args);
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }

      await postEmitInterruptCodexPane({
        sessionsPath,
        bubbleId: "my-bubble",
        tmuxRunner: mockRunner,
      });

      expect(tmuxCalls).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should send C-c to implementer pane when session is found", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;
    const bubbleId = "test-bubble-1";
    const sessionName = "pf-test-session";
    const nowIso = new Date().toISOString();

    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [bubbleId]: {
          bubbleId,
          repoPath: "/home/user/repo",
          worktreePath: `/tmp/worktrees/${bubbleId}`,
          tmuxSessionName: sessionName,
          updatedAt: nowIso
        }
      })
    );

    try {
      let capturedOptions: { allowFailure?: boolean } | undefined;
      const tmuxCalls: string[][] = [];
      function mockRunner(args: string[], opts?: TmuxRunOptions): Promise<TmuxRunResult> {
        tmuxCalls.push(args);
        capturedOptions = opts ?? {};
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }

      await postEmitInterruptCodexPane({
        sessionsPath,
        bubbleId,
        tmuxRunner: mockRunner,
      });

      expect(tmuxCalls.length).toBeGreaterThanOrEqual(1);
      const sendKeysCall = tmuxCalls[0];
      expect(sendKeysCall).toEqual([
        "send-keys",
        "-t",
        `${sessionName}:0.1`,
        "C-c"
      ]);

      // Verify allowFailure:true is used so non-zero exit codes resolve rather than throw.
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.allowFailure).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should silently handle tmux failures", async () => {
    function mockRunner(): Promise<TmuxRunResult> {
      return Promise.resolve({ stdout: "", stderr: "no session", exitCode: 1 });
    }

    await expect(
      postEmitInterruptCodexPane({
        sessionsPath: "/tmp/sessions.json",
        bubbleId: "test-bubble",
        tmuxRunner: mockRunner,
      })
    ).resolves.toBeUndefined();
  });
  it("should be no-op when sessions registry contains malformed JSON", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;

    await mkdir(tmpDir, { recursive: true });
    // Write invalid JSON that will cause readRuntimeSessionsRegistry to throw.
    await writeFile(sessionsPath, "{not valid json!!!");

    try {
      const tmuxCalls: string[][] = [];
      function mockRunner(args: string[]): Promise<TmuxRunResult> {
        tmuxCalls.push(args);
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }

      await postEmitInterruptCodexPane({
        sessionsPath,
        bubbleId: "malformed-bubble",
        tmuxRunner: mockRunner,
      });

      // Should not attempt any tmux operations when registry is unreadable.
      expect(tmuxCalls).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should handle non-zero tmuxRunner exit codes via allowFailure:true path", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;
    const bubbleId = "test-bubble-2";
    const sessionName = "pf-nonzero-test";
    const nowIso = new Date().toISOString();

    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      sessionsPath,
      JSON.stringify({
        [bubbleId]: {
          bubbleId,
          repoPath: "/home/user/repo",
          worktreePath: `/tmp/worktrees/${bubbleId}`,
          tmuxSessionName: sessionName,
          updatedAt: nowIso
        }
      })
    );

    try {
      let capturedOptions: { allowFailure?: boolean } | undefined;
      function mockRunner(args: string[], opts?: TmuxRunOptions): Promise<TmuxRunResult> {
        // Verify options are passed through (allowFailure:true)
        capturedOptions = opts ?? {};
        // Simulate tmux returning non-zero exit code — with allowFailure:true this
        // should resolve rather than throw, and the function should still complete.
        return Promise.resolve({ stdout: "", stderr: "pane not found", exitCode: 2 });
      }

      await expect(
        postEmitInterruptCodexPane({
          sessionsPath,
          bubbleId,
          tmuxRunner: mockRunner,
        })
      ).resolves.toBeUndefined();

      // Verify allowFailure:true was used (non-zero exit should not throw).
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.allowFailure).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
