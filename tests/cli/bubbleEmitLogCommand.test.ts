import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getBubbleEmitLogHelpText,
  parseBubbleEmitLogCommandOptions,
  renderBubbleEmitLogText,
  runBubbleEmitLogCommand
} from "../../src/cli/commands/bubble/emitLog.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function writeTempLog(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pairflow-emit-log-cli-"));
  tempDirs.push(dir);
  const logPath = join(dir, "emit-history.ndjson");
  await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  return logPath;
}

describe("bubble emit-log command", () => {
  it("parses explicit log, repo and json options", () => {
    expect(
      parseBubbleEmitLogCommandOptions([
        "--log",
        "/tmp/emit-history.ndjson",
        "--json"
      ])
    ).toEqual({ log: "/tmp/emit-history.ndjson", json: true, help: false });

    expect(
      parseBubbleEmitLogCommandOptions(["--id", "b-1", "--repo", "/repo"])
    ).toEqual({ id: "b-1", repo: "/repo", json: false, help: false });
  });

  it("advertises the three read scopes in help output", () => {
    const help = getBubbleEmitLogHelpText();

    expect(help).toContain("pairflow bubble emit-log --id <id>");
    expect(help).toContain("pairflow bubble emit-log --log <path");
    expect(help).toContain(".pairflow/runtime/emit-history.ndjson");
  });

  it("reads an explicit log file and groups rejections by signature", async () => {
    const logPath = await writeTempLog([
      JSON.stringify({
        ts: "2026-08-15T22:10:00.000Z",
        bubble_id: "b-1",
        kind: "meta_review_result",
        status: "rejected",
        error_reason: "claim keys missing",
        args: ["--kind", "meta_review_result", "--report-json", "{}"]
      }),
      JSON.stringify({
        ts: "2026-08-15T22:20:00.000Z",
        bubble_id: "b-1",
        kind: "meta_review_result",
        status: "rejected",
        error_reason: "claim keys missing",
        args: ["--kind", "meta_review_result", "--report-json", "{}"]
      }),
      JSON.stringify({
        ts: "2026-08-15T22:30:00.000Z",
        bubble_id: "b-1",
        kind: "pass",
        status: "success",
        args: ["--kind", "pass"]
      })
    ]);

    const result = await runBubbleEmitLogCommand(["--log", logPath]);

    expect(result).not.toBeNull();
    if (result === null) {
      throw new Error("Expected an emit-log result.");
    }
    expect(result.scope).toBe("file");
    expect(result.report.total).toBe(3);
    expect(result.report.rejected).toBe(2);
    expect(result.report.signatures).toHaveLength(1);
    expect(result.report.signatures[0]?.count).toBe(2);

    const text = renderBubbleEmitLogText(result);
    expect(text).toContain("Emit log: explicit log file");
    expect(text).toContain("2x");
    expect(text).toContain("claim keys missing");
    expect(text).toContain("--report-json");
  });

  it("returns null for the help form so the caller can print usage", async () => {
    await expect(runBubbleEmitLogCommand(["--help"])).resolves.toBeNull();
  });

  it("fails closed when a bubble id cannot be resolved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pairflow-emit-log-unresolved-"));
    tempDirs.push(dir);

    await expect(
      runBubbleEmitLogCommand(["--id", "no-such-bubble"], dir)
    ).rejects.toThrow();
  });
});
