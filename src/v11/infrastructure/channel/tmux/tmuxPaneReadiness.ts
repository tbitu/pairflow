import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered,
  isPaneBusyOutput
} from "../../../shared/agent/agentRuntimeProfiles.js";
import { waitForOpencodePaneReady } from "./tmuxOpencodeReadiness.js";
import { waitForReasonixPaneReady } from "./tmuxReasonixReadiness.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

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

export interface WaitForAgentPaneIdleInput {
  runner: Parameters<typeof waitForOpencodePaneReady>[0]["runner"];
  targetPane: string;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
  /** Tail window (lines) captured for busy-marker detection; mirrors the watchdog sampler. */
  captureStartLine?: number;
  /** Extra quiet time after the first idle observation before confirming idle. */
  settleDelayMs?: number;
}

/**
 * Wait until the target agent pane shows no mid-turn busy marker (the agent's
 * `paneBusyPatterns` per its runtime profile). Handoff delivery must never type
 * into a busy agent: opencode silently drops input typed mid-turn, and reasonix
 * queues it as a literal message. The watchdog uses this same signal before
 * nudging; this gate applies it to delivery so a round handover only lands on a
 * pane that is actually idle — "ready" (TUI chrome visible) is not enough.
 *
 * Returns false once the attempt budget is exhausted and the pane is still busy.
 */
export async function waitForAgentPaneIdle(
  agentName: AgentName | undefined,
  input: WaitForAgentPaneIdleInput
): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 120);
  const retryDelayMs = input.retryDelayMs ?? 5000;
  const captureStartLine = input.captureStartLine ?? 20;
  const settleDelayMs = input.settleDelayMs ?? 500;
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const capture = await input.runner(
      ["capture-pane", "-p", "-t", input.targetPane, "-S", `-${captureStartLine}`],
      { allowFailure: true }
    );
    const paneOutput = capture.exitCode === 0 ? capture.stdout : "";
    if (!isPaneBusyOutput({ agentName, paneOutput })) {
      if (settleDelayMs > 0 && !process.env.VITEST) {
        await sleepForDelayMs(settleDelayMs);
      }
      return true;
    }
    if (attempt < attempts - 1 && retryDelayMs > 0) {
      await sleepForDelayMs(retryDelayMs);
    }
  }
  return false;
}
