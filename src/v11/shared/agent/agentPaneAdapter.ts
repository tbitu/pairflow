import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";
import type { TmuxRunner } from "../../ports/tmuxSessions.js";
import type { SendAndSubmitTmuxPaneMessageOptions } from "../../ports/tmuxDelivery.js";
import type {
  PostEmitInterruptionMode,
  StartupPromptDeliveryMode,
  TrustPromptHandlingMode
} from "./agentRuntimeProfiles.js";

export interface AgentPaneReadinessOptions {
  attempts?: number;
  retryDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  settleDelayMs?: number;
}

/**
 * Per-agent tmux pane behavior, collapsed into one seam.
 *
 * Every agent-differing pane concern (readiness-for-input, prompt/input-box
 * detection, trust prompts, mid-turn busy detection, paste batching, pane
 * concurrency) is expressed here. Role/delivery code depends only on this
 * interface and never on agent identity or a concrete agent name.
 *
 * Concrete adapters live in infrastructure (the tmux channel), next to the
 * per-agent readiness modules they compose. This interface stays in shared so
 * `shared/channel` role abstractions can depend on it without importing
 * infrastructure.
 */
export interface AgentPaneAdapter {
  readonly name: AgentName;

  /** Wait until the pane is ready to receive input (agent-specific readiness). */
  waitForReady(
    runner: TmuxRunner,
    targetPane: string,
    options?: AgentPaneReadinessOptions
  ): Promise<boolean>;

  /**
   * Index of the last prompt/input-box line in captured pane output, or -1.
   * Used to confirm that a pasted marker was submitted (scrolled above the
   * prompt) versus still sitting in the composer.
   */
  findLastPromptIndex(lines: readonly string[]): number;

  /** Whether the captured pane output currently shows an input surface. */
  hasVisiblePrompt(output: string): boolean;

  /** Accept the agent's first-run trust/security prompt if present. */
  acceptTrustPrompt(runner: TmuxRunner, targetPane: string): Promise<boolean>;

  /** Whether captured pane output shows the agent mid-turn. */
  isBusy(paneOutput: string): boolean;

  /** Full resolved paste/delivery options, including the maxChunkLength default. */
  resolvePasteOptions(): SendAndSubmitTmuxPaneMessageOptions;

  /** Whether multiple panes of this agent can run concurrently in one bubble. */
  readonly supportsConcurrentPanes: boolean;
  readonly startupPromptDelivery: StartupPromptDeliveryMode;
  readonly trustPromptHandling: TrustPromptHandlingMode;
  readonly postEmitInterruption: PostEmitInterruptionMode;
  /** Extra quiet time after first prompt render before the seed's first paste (ms). */
  readonly startupPasteSettleMs: number;
  readonly minimalPastedGuidance: boolean;
  readonly planWatchBackend: string;
}
