import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { TmuxRunOptions, TmuxRunResult } from "../../../../../src/v11/ports/tmuxSessions.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { topologySlotPaneIndexCatalog} from "../../../../../src/v11/shared/topology/topologySlotPaneProjection.js";
import {
  postEmitInterruptOpencodePane,
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

describe("postEmitInterruptOpencodePane", () => {
  let savedTmuxPane: string | undefined;
  let savedTmuxSession: string | undefined;

  beforeEach(() => {
    // Clear TMUX_PANE and TMUX env vars so tests always exercise the
    // session-registry-based pane targeting path, not the invoking-pane shortcut.
    // Without this, running tests inside a tmux session would cause every test
    // to use process.env.TMUX_PANE as the target pane instead of the expected
    // `${sessionName}:0.${index}` format.
    savedTmuxPane = process.env.TMUX_PANE;
    savedTmuxSession = process.env.TMUX;
    delete process.env.TMUX_PANE;
    delete process.env.TMUX;
  });

  afterEach(() => {
    // Restore original env vars after each test.
    if (savedTmuxPane !== undefined) {
      process.env.TMUX_PANE = savedTmuxPane;
    } else {
      delete process.env.TMUX_PANE;
    }
    if (savedTmuxSession !== undefined) {
      process.env.TMUX = savedTmuxSession;
    } else {
      delete process.env.TMUX;
    }
  });

  it.each([
    ["implementer", "implementer", topologySlotPaneIndexCatalog.implementer],
    ["reviewer", "reviewer", topologySlotPaneIndexCatalog.reviewer],
    ["meta_reviewer", "meta_reviewer", topologySlotPaneIndexCatalog.meta_reviewer],
  ] as const)(
    "should target %s pane (index %d) for originatingRole=%s",
    async (_label, role, expectedIndex) => {
      const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
      const sessionsPath = `${tmpDir}/sessions.json`;
      const bubbleId = "test-bubble-role";
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
            updatedAt: nowIso,
          },
        })
      );

      const tmuxCalls: string[][] = [];
        function mockRunner(args: string[]): Promise<TmuxRunResult> {
          tmuxCalls.push(args);
          if (args[0] === "capture-pane") {
            return Promise.resolve({ stdout: "esc again to interrupt", stderr: "", exitCode: 0 });
          }
          return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
        }

        await postEmitInterruptOpencodePane({
          sessionsPath,
          bubbleId,
          originatingRole: role,
          tmuxRunner: mockRunner,
        });

        const sendKeysCalls = tmuxCalls.filter((c) => c[0] === "send-keys");
        expect(sendKeysCalls).toHaveLength(2);
        const firstSendKeysCall = sendKeysCalls[0];
        const secondSendKeysCall = sendKeysCalls[1];
        // expectedIndex comes from it.each data, pre-validated against the catalog.
        expect(firstSendKeysCall).toEqual([
          "send-keys",
          "-t",
          `${sessionName}:0.${expectedIndex}`,
          "Escape",
        ]);
        expect(secondSendKeysCall).toEqual([
          "send-keys",
          "-t",
          `${sessionName}:0.${expectedIndex}`,
          "Escape",
        ]);

        await rm(tmpDir, { recursive: true, force: true });
    },
  );

  it("should be no-op when sessions registry is missing", async () => {
    const tmuxCalls: string[][] = [];
    function mockRunner(args: string[]): Promise<TmuxRunResult> {
      tmuxCalls.push(args);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    }

    await postEmitInterruptOpencodePane({
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

      await postEmitInterruptOpencodePane({
        sessionsPath,
        bubbleId: "my-bubble",
        tmuxRunner: mockRunner,
      });

      expect(tmuxCalls).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should send two Escape keys to implementer pane when session is found", async () => {
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
        if (args[0] === "capture-pane") {
          return Promise.resolve({ stdout: "esc again to interrupt", stderr: "", exitCode: 0 });
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }

      await postEmitInterruptOpencodePane({
        sessionsPath,
        bubbleId,
        tmuxRunner: mockRunner,
      });

      const sendKeysCalls = tmuxCalls.filter((c) => c[0] === "send-keys");
      expect(sendKeysCalls).toHaveLength(2);
      const firstSendKeysCall = sendKeysCalls[0];
      const secondSendKeysCall = sendKeysCalls[1];
      expect(firstSendKeysCall).toEqual([
        "send-keys",
        "-t",
        `${sessionName}:0.1`,
        "Escape"
      ]);
      expect(secondSendKeysCall).toEqual([
        "send-keys",
        "-t",
        `${sessionName}:0.1`,
        "Escape"
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
      postEmitInterruptOpencodePane({
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

      await postEmitInterruptOpencodePane({
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
        postEmitInterruptOpencodePane({
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

  it("applies an inter-escape delay between the two Escape key presses", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;
    const bubbleId = "test-bubble-delay";
    const sessionName = "pf-delay-test";
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
      const tmuxCalls: string[][] = [];
      const delayCalls: number[] = [];
      function mockRunner(args: string[]): Promise<TmuxRunResult> {
        tmuxCalls.push(args);
        if (args[0] === "capture-pane") {
          return Promise.resolve({ stdout: "esc again to interrupt", stderr: "", exitCode: 0 });
        }
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      }
      const sleepForDelayMs = async (delayMs: number): Promise<void> => {
        delayCalls.push(delayMs);
      };

      await postEmitInterruptOpencodePane({
        sessionsPath,
        bubbleId,
        tmuxRunner: mockRunner,
        interEscapeDelayMs: 100,
        sleepForDelayMs
      });

      const sendKeysCalls = tmuxCalls.filter((c) => c[0] === "send-keys");
      expect(sendKeysCalls).toHaveLength(2);
      expect(sendKeysCalls).toEqual([
        ["send-keys", "-t", `${sessionName}:0.1`, "Escape"],
        ["send-keys", "-t", `${sessionName}:0.1`, "Escape"]
      ]);
      expect(delayCalls).toContain(100);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should not send the second Escape if 'esc again to interrupt' is not detected", async () => {
    const tmpDir = `/tmp/pf-test-sessions-${randomUUID().slice(0, 8)}`;
    const sessionsPath = `${tmpDir}/sessions.json`;
    const bubbleId = "test-bubble-no-detect";
    const sessionName = "pf-no-detect-test";
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
      const tmuxCalls: string[][] = [];
      function mockRunner(args: string[]): Promise<TmuxRunResult> {
        tmuxCalls.push(args);
        // Return stdout that does not contain 'esc again to interrupt'
        return Promise.resolve({ stdout: "some other terminal output", stderr: "", exitCode: 0 });
      }

      await postEmitInterruptOpencodePane({
        sessionsPath,
        bubbleId,
        tmuxRunner: mockRunner,
      });

      const sendKeysCalls = tmuxCalls.filter((c) => c[0] === "send-keys");
      // Only the first Escape should be sent
      expect(sendKeysCalls).toHaveLength(1);
      expect(sendKeysCalls[0]).toEqual(["send-keys", "-t", `${sessionName}:0.1`, "Escape"]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
