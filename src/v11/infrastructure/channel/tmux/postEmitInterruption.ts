import { join } from "node:path";
import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import {
  getSharedTopologySlotPaneIndexForRole,
} from "../../../shared/topology/topologySlotPaneProjection.js";
import type { AgentRole } from "../../../../contracts/kernel/agentIdentity.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import { runTmux } from "./tmuxRunner.js";
import { sendTmuxPaneKeys } from "./tmuxPaneWrite.js";
import type { TmuxRunOptions } from "../../../ports/tmuxSessions.js";

export interface PostEmitInterruptionInput {
  /** Path to the runtime sessions registry JSON file. */
  sessionsPath: string;
  /** Bubble ID whose pane should be interrupted. */
  bubbleId: string;
  /** Optional originating role — resolves the correct pane index dynamically. Defaults to `implementer` when omitted. */
  originatingRole?: AgentRole;
  /** Optional custom tmux runner (for testing). Defaults to `runTmux`. */
  tmuxRunner?: typeof runTmux;
  /** Optional tmux command options (for testing). */
  tmuxOptions?: TmuxRunOptions;
  /** Optional delay between first and second Escape key presses. Defaults to 300ms. */
  interEscapeDelayMs?: number;
  /** Optional sleep override for testing. */
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendDoubleEscape(input: {
  runner: typeof runTmux;
  targetPane: string;
  tmuxOpts: TmuxRunOptions;
  interEscapeDelayMs: number;
  sleepForDelayMs: (delayMs: number) => Promise<void>;
}): Promise<void> {
  await sendTmuxPaneKeys(input.runner, input.targetPane, "Escape", input.tmuxOpts);

  const maxAttempts = 30;
  const pollIntervalMs = 50;
  let detected = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const capture = await input.runner(
      ["capture-pane", "-p", "-t", input.targetPane],
      { ...input.tmuxOpts, allowFailure: true }
    );
    if (capture.exitCode === 0) {
      const output = capture.stdout.toLowerCase();
      if (output.includes("esc again to interrupt")) {
        detected = true;
        break;
      }
    }
    await input.sleepForDelayMs(pollIntervalMs);
  }

  if (detected) {
    if (input.interEscapeDelayMs > 0) {
      await input.sleepForDelayMs(input.interEscapeDelayMs);
    }
    await sendTmuxPaneKeys(input.runner, input.targetPane, "Escape", input.tmuxOpts);
  }
}

/**
 * Post-emit interruption — sends two Escape key presses via tmux send-keys to
 * the originating agent's pane (determined by `originatingRole`). Falls back
 * to the implementer pane if no role is provided. This triggers the agent's
 * terminal-side stop behavior after `pairflow agent emit` completes
 * successfully, ensuring no concurrent workers run in parallel.
 *
 * Best-effort: all failures are silently logged and never thrown. The emit
 * result is already committed at this point — interruption is a side effect.
 */
export async function postEmitInterruptDoubleEscape(
  input: PostEmitInterruptionInput,
): Promise<void> {
  const tmuxRunner = input.tmuxRunner ?? runTmux;
  const tmuxOpts = input.tmuxOptions ?? { allowFailure: true };
  const interEscapeDelayMs = Math.max(0, input.interEscapeDelayMs ?? 300);
  const sleepForDelayMs = input.sleepForDelayMs ?? sleep;
  const invokingPane = process.env.TMUX_PANE?.trim();

  // Prefer interrupting the exact pane that invoked `pairflow agent emit`.
  // This avoids role/pane drift when operators invoke emits from a pane that
  // doesn't match the current active-role lane.
  if (invokingPane !== undefined && invokingPane.length > 0) {
    try {
      await sendDoubleEscape({
        runner: tmuxRunner,
        targetPane: invokingPane,
        tmuxOpts,
        interEscapeDelayMs,
        sleepForDelayMs
      });
    } catch {
      console.error(`[postEmitInterrupt] tmux send-keys to ${invokingPane} failed: session may have ended`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  }

  // Read the sessions registry to find the tmux session name for this bubble.
  let sessionName: string | undefined;
  try {
    const sessions = await readRuntimeSessionsRegistry(input.sessionsPath, {
      allowMissing: true,
    });
    const record = sessions[input.bubbleId];
    if (record && record.tmuxSessionName) {
      sessionName = record.tmuxSessionName;
    } else {
      // No runtime session registered for this bubble — nothing to interrupt.
      return;
    }
  } catch {
    // Registry read failed — log for diagnostics, then best-effort skip.
    console.error(`[postEmitInterrupt] sessions registry read failed: registry unavailable`);
    return;
  }

  if (!sessionName) {
    return;
  }

  // Resolve pane index dynamically from the originating role, falling back to implementer.
  const targetRole = input.originatingRole ?? "implementer";
  const targetPaneIndex = getSharedTopologySlotPaneIndexForRole(targetRole);
  const targetPane = `${sessionName}:0.${targetPaneIndex}`;

  try {
    // The agent-side termination contract requires two Escape presses after emit.
    await sendDoubleEscape({
      runner: tmuxRunner,
      targetPane,
      tmuxOpts,
      interEscapeDelayMs,
      sleepForDelayMs
    });
  } catch {
    // Tmux may not be available or session may have ended — log for diagnostics, then best-effort skip.
    console.error(`[postEmitInterrupt] tmux send-keys to ${targetPane} failed: session may have ended`);
  }

  // Brief settle delay (250 ms) to let the key sequence reach the target pane
  // before this process exits.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Post-emit interruption, dispatched per agent runtime profile.
 *
 * opencode uses the double-Escape-with-delay sequence. reasonix does NOT:
 * a single Escape cancels a running turn, and a double Escape on the idle
 * composer opens the rewind picker — the opencode sequence is not part of its
 * hand-over contract, so the interruption is skipped entirely (no-op).
 */
export async function postEmitInterruptAgentPane(
  input: PostEmitInterruptionInput & { agentName?: AgentName }
): Promise<void> {
  const paneAgent = resolveAgentPaneAdapter(input.agentName ?? "opencode");
  if (paneAgent.postEmitInterruption === "none") {
    return;
  }
  await postEmitInterruptDoubleEscape(input);
}

/**
 * Derive sessions path from repo path using the standard Pairflow convention:
 * `<repoPath>/.pairflow/runtime/sessions.json`.
 */
export function resolveSessionsPath(repoPath: string): string {
  return join(repoPath, ".pairflow", "runtime", "sessions.json");
}
