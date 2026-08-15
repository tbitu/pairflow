import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendEmitAttemptLog,
  getBubbleEmitHistoryPath,
  getRuntimeEmitHistoryPath,
  recordAgentEmitAttemptBestEffort,
  type AgentEmitAttemptEntry
} from "../../../../../src/v11/infrastructure/artifact/actorProtocol/emitHistoryStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("emitHistoryStore", () => {
  it("resolves correct paths for bubble and runtime emit history", () => {
    expect(getBubbleEmitHistoryPath("/repo/.pairflow/bubbles/b-1")).toBe(
      "/repo/.pairflow/bubbles/b-1/emit-history.ndjson"
    );
    expect(getRuntimeEmitHistoryPath("/repo/.pairflow/runtime")).toBe(
      "/repo/.pairflow/runtime/emit-history.ndjson"
    );
  });

  it("appends emit attempt logs as ndjson lines", async () => {
    const testDir = join(
      tmpdir(),
      `pairflow-emit-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempDirs.push(testDir);
    const logPath = join(testDir, "emit-history.ndjson");

    const entry1: AgentEmitAttemptEntry = {
      ts: "2026-08-15T20:00:00.000Z",
      bubble_id: "b-1",
      repo: "/repo",
      role: "implementer",
      kind: "pass",
      status: "success",
      args: ["--kind", "pass", "--bubble-id", "b-1"],
      duration_ms: 42
    };

    const entry2: AgentEmitAttemptEntry = {
      ts: "2026-08-15T20:01:00.000Z",
      bubble_id: "b-1",
      repo: "/repo",
      role: "reviewer",
      kind: "convergence",
      status: "rejected",
      error_reason: "ACTOR_EMIT_CONTEXT_INVALID: active role mismatch",
      args: ["--kind", "convergence"],
      duration_ms: 15
    };

    await appendEmitAttemptLog({ filePath: logPath, entry: entry1 });
    await appendEmitAttemptLog({ filePath: logPath, entry: entry2 });

    const content = await readFile(logPath, "utf8");
    const lines = content
      .trim()
      .split("\n")
      .map((line): AgentEmitAttemptEntry => JSON.parse(line) as AgentEmitAttemptEntry);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(entry1);
    expect(lines[1]).toEqual(entry2);
  });

  it("recordAgentEmitAttemptBestEffort does not throw on invalid directory or missing path", async () => {
    await expect(
      recordAgentEmitAttemptBestEffort({
        targetPath: undefined,
        entry: {
          ts: "2026-08-15T20:00:00.000Z",
          status: "success",
          args: []
        }
      })
    ).resolves.toBeUndefined();
  });
});
