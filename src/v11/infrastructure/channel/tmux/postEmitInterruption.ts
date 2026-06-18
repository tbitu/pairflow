import { join } from "node:path";
import { readRuntimeSessionsRegistry } from "../../executor/sessionRuntime/runtimeSessionsRegistry.js";
import { topologySlotPaneIndexCatalog } from "../../../shared/topology/topologySlotPaneProjection.js";
import { runTmux } from "./tmuxRunner.js";
import type { TmuxRunOptions } from "../../../ports/tmuxSessions.js";

export interface PostEmitInterruptionInput {
  /** Path to the runtime sessions registry JSON file. */
  sessionsPath: string;
  /** Bubble ID whose implementer pane should be interrupted. */
  bubbleId: string;
  /** Optional custom tmux runner (for testing). Defaults to `runTmux`. */
  tmuxRunner?: typeof runTmux;
  /** Optional tmux command options (for testing). */
  tmuxOptions?: TmuxRunOptions;
}

/**
 * Post-emit interruption — sends SIGINT via tmux send-keys to the implementer
 * pane of the specified bubble. This interrupts the calling codex process
 * cleanly after `pairflow agent emit` completes successfully, ensuring no
 * concurrent workers run in parallel.
 *
 * Best-effort: all failures are silently logged and never thrown. The emit
 * result is already committed at this point — interruption is a side effect.
 */
export async function postEmitInterruptCodexPane(
  input: PostEmitInterruptionInput,
): Promise<void> {
  const tmuxRunner = input.tmuxRunner ?? runTmux;
  const tmuxOpts = input.tmuxOptions ?? { allowFailure: true };

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

  // Use topology catalog to derive the implementer pane index for consistent targeting.
  const implementerIndex = topologySlotPaneIndexCatalog.implementer;
  const targetPane = `${sessionName}:0.${implementerIndex}`;

  try {
    // Send SIGINT (Ctrl+C) to gracefully stop the codex process in the pane.
    await tmuxRunner(["send-keys", "-t", targetPane, "C-c"], tmuxOpts);
  } catch {
    // Tmux may not be available or session may have ended — log for diagnostics, then best-effort skip.
    console.error(`[postEmitInterrupt] tmux send-keys to ${targetPane} failed: session may have ended`);
  }

  // Brief settle delay (250 ms) to let the SIGINT signal propagate and reach the target tmux
  // pane before this process exits. This value was chosen as a conservative midpoint between:
  // — <50 ms where signals may not be delivered if the process is killed immediately,
  // — >1 s which adds unnecessary latency when emit results are already committed.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Derive sessions path from repo path using the standard Pairflow convention:
 * `<repoPath>/.pairflow/runtime/sessions.json`.
 */
export function resolveSessionsPath(repoPath: string): string {
  return join(repoPath, ".pairflow", "runtime", "sessions.json");
}

