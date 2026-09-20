import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseEmitHistoryLine,
  readEmitHistoryEntries
} from "../../../../../src/v11/infrastructure/artifact/actorProtocol/emitHistoryReportReader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function writeTempLog(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pairflow-emit-log-reader-"));
  tempDirs.push(dir);
  const logPath = join(dir, "emit-history.ndjson");
  await writeFile(logPath, contents, "utf8");
  return logPath;
}

describe("emitHistoryReportReader", () => {
  it("returns an empty list when the log does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pairflow-emit-log-missing-"));
    tempDirs.push(dir);

    await expect(
      readEmitHistoryEntries({ logPath: join(dir, "emit-history.ndjson") })
    ).resolves.toEqual([]);
  });

  it("parses recorded attempts and skips malformed lines", async () => {
    const logPath = await writeTempLog(
      [
        JSON.stringify({
          ts: "2026-08-15T22:00:00.000Z",
          bubble_id: "b-1",
          repo: "/repo",
          role: "reviewer",
          kind: "pass",
          status: "rejected",
          error_reason: "boom",
          args: ["--kind", "pass"]
        }),
        "{ not json at all",
        JSON.stringify({ ts: "2026-08-15T22:01:00.000Z", status: "unknown" }),
        JSON.stringify({
          ts: "2026-08-15T22:02:00.000Z",
          kind: "pass",
          status: "success",
          args: ["--kind", "pass", 42],
          duration_ms: 12
        }),
        ""
      ].join("\n")
    );

    const entries = await readEmitHistoryEntries({ logPath });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      ts: "2026-08-15T22:00:00.000Z",
      bubble_id: "b-1",
      status: "rejected",
      error_reason: "boom"
    });
    expect(entries[1]).toMatchObject({
      status: "success",
      kind: "pass",
      args: ["--kind", "pass"],
      duration_ms: 12
    });
    expect(entries[1]?.error_reason).toBeNull();
  });

  it("returns null for lines that cannot carry a usable attempt", () => {
    expect(parseEmitHistoryLine("")).toBeNull();
    expect(parseEmitHistoryLine("[]")).toBeNull();
    expect(parseEmitHistoryLine(JSON.stringify({ status: "rejected" }))).toBeNull();
  });
});
