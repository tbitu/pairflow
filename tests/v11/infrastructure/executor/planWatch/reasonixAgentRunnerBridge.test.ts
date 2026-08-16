import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AgentRunnerBridgeInput,
  AgentRunnerCommandIdentity,
  AgentRunnerContinuationPayload
} from "../../../../../src/v11/shared/planWatchRunner/agentRunnerBridgeContract.js";
import {
  buildReasonixRunnerArgs,
  createReasonixPlanWatchRunnerBackendAdapter,
  reasonixPlanWatchRunnerBackendAdapter,
  validateContinuationPayload
} from "../../../../../src/v11/infrastructure/executor/planWatch/reasonix/reasonixAgentRunnerBridge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

function payload(): AgentRunnerContinuationPayload {
  return {
    kind: "pairflow.execute_pairflow_plan.continuation",
    workflow: "ExecutePairflowPlan",
    invocation_id: "invocation-001",
    plan_path: "/repo/plans/local-plan-watch-plan-v1.md",
    repo_path: "/repo",
    triggered_at: "2026-05-01T10:00:00.000Z",
    trigger: {
      source: "test",
      reason: "bubble_passed",
      observedAt: "2026-05-01T09:59:00.000Z",
      refs: ["bubble:demo"]
    }
  };
}

function input(): AgentRunnerBridgeInput {
  return {
    planPath: "/repo/plans/local-plan-watch-plan-v1.md",
    repoPath: "/repo",
    invocationId: "invocation-001",
    now: new Date("2026-05-01T10:00:00.000Z"),
    trigger: {
      source: "test",
      reason: "bubble_passed",
      observedAt: "2026-05-01T09:59:00.000Z",
      refs: ["bubble:demo"]
    }
  };
}

function command(): AgentRunnerCommandIdentity {
  return {
    command: "reasonix",
    args: ["run", "--events-jsonl", "--dir", "/repo", "task"],
    cwd: "/repo",
    inputMode: "none",
    idleTimeoutMs: 5000,
    envKeys: []
  };
}

async function createArtifactDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pairflow-reasonix-runner-"));
  tempDirs.push(dir);
  return dir;
}

describe("buildReasonixRunnerArgs", () => {
  it("uses headless run with JSONL events pinned to the repo", () => {
    const args = buildReasonixRunnerArgs({ payload: payload() });
    expect(args[0]).toBe("run");
    expect(args).toContain("--events-jsonl");
    expect(args).toContain("--dir");
    expect(args).toContain("/repo");
    expect(args.join(" ")).toContain("ExecutePairflowPlan");
    expect(args.join(" ")).toContain("settled_checkpoint|human_checkpoint|blocked");
  });
});

describe("validateContinuationPayload", () => {
  it("accepts an ExecutePairflowPlan continuation", () => {
    expect(validateContinuationPayload(payload())).toBeUndefined();
  });

  it("rejects non-ExecutePairflowPlan workflows", () => {
    expect(
      validateContinuationPayload({ ...payload(), workflow: "OtherWorkflow" })
    ).toBe("PLAN_WATCH_RUNNER_WORKFLOW_UNSUPPORTED");
  });
});

describe("reasonixPlanWatchRunnerBackendAdapter", () => {
  it("prepares a reasonix run invocation with inputMode none", async () => {
    const adapter = createReasonixPlanWatchRunnerBackendAdapter({
      prepareRunnerFiles: async () => ({
        artifactDir: "/repo/.pairflow/runtime/plan-watch/agent-runner/artifacts",
        artifactDirRef: ".pairflow/runtime/plan-watch/agent-runner/artifacts",
        schemaFilePath: "/repo/.pairflow/runtime/plan-watch/agent-runner/artifacts/structured-output.schema.json",
        metadataFilePath: "/repo/.pairflow/runtime/plan-watch/agent-runner/artifacts/metadata.json",
        eventsFilePath: "/repo/.pairflow/runtime/plan-watch/agent-runner/artifacts/events.ndjson",
        timelineFilePath: "/repo/.pairflow/runtime/plan-watch/agent-runner/artifacts/timeline.ndjson"
      })
    });
    const prepared = await adapter.prepareInvocationConfig({
      input: input(),
      config: {},
      payload: payload(),
      pathExists: async () => true,
      startedAt: "2026-05-01T10:00:00.000Z"
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      return;
    }
    expect(prepared.config.backend).toBe("reasonix");
    expect(prepared.config.command).toBe("reasonix");
    expect(prepared.config.inputMode).toBe("none");
    expect(prepared.config.cwd).toBe("/repo");
    expect(prepared.config.args?.[0]).toBe("run");
    expect(prepared.config.args).toContain("--events-jsonl");
  });

  it("classifies a settled checkpoint from stdout JSONL + final schema object", async () => {
    const artifactDir = await createArtifactDir();
    const result = await reasonixPlanWatchRunnerBackendAdapter.classifyProcessResult({
      input: input(),
      processResult: {
        exitCode: 0,
        stdout: [
          '{"type":"event","text":"running"}',
          '{"status":"settled_checkpoint","reason_code":"PLAN_SETTLED","summary":"done","changed_artifacts":null,"route_ledger_summary":null}'
        ].join("\n"),
        stderr: ""
      },
      startedAt: "2026-05-01T10:00:00.000Z",
      completedAt: "2026-05-01T10:00:05.000Z",
      command: command(),
      payload: payload(),
      config: {
        backend: "reasonix",
        command: "reasonix",
        args: ["run", "--events-jsonl", "--dir", "/repo", "task"],
        cwd: "/repo",
        inputMode: "none",
        runnerArtifactFiles: {
          artifactDir,
          artifactDirRef: artifactDir,
          schemaFilePath: join(artifactDir, "structured-output.schema.json"),
          metadataFilePath: join(artifactDir, "metadata.json"),
          eventsFilePath: join(artifactDir, "events.ndjson"),
          timelineFilePath: join(artifactDir, "timeline.ndjson")
        }
      }
    });

    expect(result.status).toBe("settled_checkpoint");
    expect(result.reasonCode).toBe("PLAN_SETTLED");
    expect(result.runnerSummary).toBe("done");
    expect(result.exitCode).toBe(0);
  });

  it("fails closed with AGENT_RUNNER_OUTPUT_INVALID when stdout lacks a schema object", async () => {
    const artifactDir = await createArtifactDir();
    const result = await reasonixPlanWatchRunnerBackendAdapter.classifyProcessResult({
      input: input(),
      processResult: {
        exitCode: 0,
        stdout: '{"type":"event","text":"no final envelope"}',
        stderr: ""
      },
      startedAt: "2026-05-01T10:00:00.000Z",
      completedAt: "2026-05-01T10:00:05.000Z",
      command: command(),
      payload: payload(),
      config: {
        backend: "reasonix",
        command: "reasonix",
        args: ["run"],
        cwd: "/repo",
        inputMode: "none",
        runnerArtifactFiles: {
          artifactDir,
          artifactDirRef: artifactDir,
          schemaFilePath: join(artifactDir, "structured-output.schema.json"),
          metadataFilePath: join(artifactDir, "metadata.json"),
          eventsFilePath: join(artifactDir, "events.ndjson"),
          timelineFilePath: join(artifactDir, "timeline.ndjson")
        }
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("AGENT_RUNNER_OUTPUT_INVALID");
  });
});
