import type { StructuredAgentRunnerOutput } from "../../../shared/planWatchRunner/agentRunnerBridgeContract.js";
import type { OpencodeJsonEvent } from "./opencode/opencodeAgentRunnerStream.js";
import type { OpencodeTimelineRow } from "./opencode/opencodeAgentRunnerTimeline.js";
import { normalizeOpencodeTimeline } from "./opencode/opencodeAgentRunnerTimeline.js";

export type AgentRunnerTimelineRow = OpencodeTimelineRow;

export function normalizeAgentRunnerTimeline(input: {
  events: readonly OpencodeJsonEvent[];
  finalOutput: StructuredAgentRunnerOutput | null;
  completedAt: string;
}): readonly AgentRunnerTimelineRow[] {
  return normalizeOpencodeTimeline(input);
}
