import { rename, rm, writeFile } from "node:fs/promises";

import type {
  AgentRunnerBridgeFailureReasonCode,
  AgentRunnerBridgeInput,
  AgentRunnerBridgeResult,
  AgentRunnerCommandIdentity,
  AgentRunnerContinuationPayload,
  AgentRunnerProcessResult,
  RequiredAgentRunnerCommandConfig
} from "../../../../shared/planWatchRunner/agentRunnerBridgeContract.js";
import { normalizeOpencodeTimeline } from "../opencode/opencodeAgentRunnerTimeline.js";
import { parseReasonixJsonlStream } from "./reasonixAgentRunnerStream.js";

export async function classifyReasonixEventsProcessResult(input: {
  input: AgentRunnerBridgeInput;
  processResult: AgentRunnerProcessResult;
  startedAt: string;
  completedAt: string;
  command: AgentRunnerCommandIdentity;
  payload: AgentRunnerContinuationPayload;
  artifactFiles: NonNullable<RequiredAgentRunnerCommandConfig["runnerArtifactFiles"]>;
}): Promise<AgentRunnerBridgeResult> {
  const processFailure = processFailureResult(input);
  const parsed = parseReasonixJsonlStream(input.processResult.stdout);
  const finalOutputForTimeline =
    processFailure !== undefined ? null : parsed.finalOutput;
  const timeline = normalizeOpencodeTimeline({
    events: parsed.events,
    finalOutput: finalOutputForTimeline,
    completedAt: input.completedAt
  });
  try {
    await writeTextAtomic(
      input.artifactFiles.timelineFilePath,
      timeline.length > 0
        ? `${timeline.map((row) => JSON.stringify(row)).join("\n")}\n`
        : ""
    );
  } catch (error) {
    if (processFailure !== undefined) {
      return processFailure;
    }
    return fileIoBlocked(
      input,
      error instanceof Error ? error.message : String(error)
    );
  }
  if (processFailure !== undefined) {
    return processFailure;
  }
  if (
    parsed.rawLines.length === 0
    || parsed.finalOutput === null
  ) {
    return blocked({
      input,
      reasonCode: "AGENT_RUNNER_OUTPUT_INVALID",
      stderr: input.processResult.stderr
    });
  }
  const structuredOutput = parsed.finalOutput;
  return {
    status: structuredOutput.status,
    invocationId: input.input.invocationId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    reasonCode: structuredOutput.reasonCode,
    command: input.command,
    exitCode: input.processResult.exitCode,
    stdout: input.processResult.stdout,
    stderr: input.processResult.stderr,
    artifactDir: input.artifactFiles.artifactDirRef,
    ...(structuredOutput.summary !== undefined
      ? { runnerSummary: structuredOutput.summary }
      : parsed.runnerSummary !== undefined
        ? { runnerSummary: parsed.runnerSummary }
        : {}),
    ...(structuredOutput.changedArtifacts !== undefined
      ? { changedArtifacts: structuredOutput.changedArtifacts }
      : {}),
    ...(structuredOutput.routeLedgerSummary !== undefined
      ? { routeLedgerSummary: structuredOutput.routeLedgerSummary }
      : {}),
    ...(parsed.reasonixSessionId !== undefined
      ? { reasonixSessionId: parsed.reasonixSessionId }
      : {}),
    payload: input.payload
  };
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function fileIoBlocked(
  input: Parameters<typeof classifyReasonixEventsProcessResult>[0],
  stderr: string
): AgentRunnerBridgeResult {
  return blocked({
    input,
    reasonCode: "PLAN_WATCH_RUNNER_FILE_IO_FAILED",
    stderr: joinStderr(input.processResult.stderr, stderr)
  });
}

function joinStderr(processStderr: string, diagnostic: string): string {
  if (processStderr.length === 0) {
    return diagnostic;
  }
  if (diagnostic.length === 0) {
    return processStderr;
  }
  return `${processStderr}\n${diagnostic}`;
}

function processFailureResult(
  input: Parameters<typeof classifyReasonixEventsProcessResult>[0]
): AgentRunnerBridgeResult | undefined {
  if (input.processResult.aborted) {
    return processBlocked(input, "AGENT_RUNNER_ABORTED", "abort");
  }
  if (input.processResult.timedOut) {
    return processBlocked(
      input,
      input.processResult.timeoutKind === "idle"
        ? "AGENT_RUNNER_IDLE_TIMEOUT"
        : "AGENT_RUNNER_TIMEOUT",
      "timeout"
    );
  }
  if (input.processResult.exitCode !== 0) {
    return processBlocked(input, "AGENT_RUNNER_NON_ZERO_EXIT", "exit");
  }
  return undefined;
}

function processBlocked(
  input: Parameters<typeof classifyReasonixEventsProcessResult>[0],
  reasonCode: AgentRunnerBridgeFailureReasonCode,
  failureStage: NonNullable<AgentRunnerBridgeResult["failureStage"]>
): AgentRunnerBridgeResult {
  return {
    status: "blocked",
    invocationId: input.input.invocationId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    reasonCode,
    command: input.command,
    failureStage,
    exitCode: input.processResult.exitCode,
    stdout: input.processResult.stdout,
    stderr: input.processResult.stderr,
    payload: input.payload,
    artifactDir: input.artifactFiles.artifactDirRef
  };
}

function blocked(input: {
  input: {
    input: AgentRunnerBridgeInput;
    processResult: AgentRunnerProcessResult;
    startedAt: string;
    completedAt: string;
    command: AgentRunnerCommandIdentity;
    payload: AgentRunnerContinuationPayload;
    artifactFiles: NonNullable<RequiredAgentRunnerCommandConfig["runnerArtifactFiles"]>;
  };
  reasonCode: AgentRunnerBridgeFailureReasonCode;
  stderr: string;
}): AgentRunnerBridgeResult {
  return {
    status: "blocked",
    invocationId: input.input.input.invocationId,
    startedAt: input.input.startedAt,
    completedAt: input.input.completedAt,
    reasonCode: input.reasonCode,
    command: input.input.command,
    failureStage: "output",
    exitCode: input.input.processResult.exitCode,
    stdout: input.input.processResult.stdout,
    stderr: input.stderr,
    payload: input.input.payload,
    artifactDir: input.input.artifactFiles.artifactDirRef
  };
}
