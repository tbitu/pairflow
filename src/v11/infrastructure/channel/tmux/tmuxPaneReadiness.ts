import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered
} from "../../../shared/agent/agentRuntimeProfiles.js";
import { waitForOpencodePaneReady } from "./tmuxOpencodeReadiness.js";
import { waitForReasonixPaneReady } from "./tmuxReasonixReadiness.js";

export interface WaitForAgentPaneReadyInput {
  runner: Parameters<typeof waitForOpencodePaneReady>[0]["runner"];
  targetPane: string;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}

/**
 * Dispatch pane readiness polling to the per-agent readiness module.
 * Undefined/unknown agents fall back to the opencode check (backwards
 * compatible with callers that predate agent-parametric readiness, including
 * legacy test fixtures that still carry pre-reasonix agent names).
 */
export async function waitForAgentPaneReady(
  agentName: AgentName | undefined,
  input: WaitForAgentPaneReadyInput
): Promise<boolean> {
  const profile =
    agentName !== undefined && isAgentNameRegistered(agentName)
      ? getAgentRuntimeProfile(agentName)
      : undefined;
  if (profile?.readiness === "reasonix") {
    return waitForReasonixPaneReady(input);
  }
  return waitForOpencodePaneReady(input);
}
