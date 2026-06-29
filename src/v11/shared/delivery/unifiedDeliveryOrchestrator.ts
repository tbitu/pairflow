/**
 * Unified Delivery Orchestration (Phase 3, extended in Phase 4)
 *
 * Consolidates 4 divergent delivery paths (implementer, reviewer, meta-reviewer, converged)
 * into a single orchestrator that parameterizes:
 * - Startup prompt strategies (upfront CLI, post-readiness tmux, none)
 * - Pane lifecycle policies (respawn, assume-running)
 * - Cleanup policies (persist, deactivate, lazy-reactivate)
 * - Pane binding capabilities (respawn, readiness polling, cleanup) — Phase 4
 *
 * Phase 4 Extension: Support pane binding operations (respawn, readiness, cleanup) for
 * meta-reviewer and future pane-based delivery scenarios. Passes metadata through orchestrator
 * so buildAgentCommand can access context without duplicating prompt-building logic.
 *
 * This abstraction enables future multi-agent delivery patterns and Phase 4 ask-human unification.
 */

import type { ProtocolEnvelope } from "../protocol/protocolEnvelopeContract.js";
import type { BubbleConfig } from "../config/bubbleConfigTypes.js";
import type { DeliveryTargetRole } from "./deliveryTargetMetadataContract.js";
import type { ReviewerFocusExtractionResult } from "../reviewer/reviewerBrief.js";
import type { ReviewerTestExecutionDirective } from "../reviewer/testEvidence.js";

/**
 * Parameterizes when the startup prompt is submitted.
 *
 * - UpfrontCli: Prompt is embedded in pane startup command args (implementer, meta-reviewer)
 * - PostReadinessTmux: Prompt submitted after pane readiness signal (reviewer)
 * - None: No startup prompt submission (converged, ask-human)
 */
export enum StartupStrategy {
  UpfrontCli = "upfront_cli",
  PostReadinessTmux = "post_readiness_tmux",
  None = "none"
}

/**
 * Parameterizes pane cleanup after delivery.
 *
 * - Persist: Keep pane alive across handoffs (implementer, reviewer)
 * - Deactivate: Deactivate pane after delivery (meta-reviewer)
 * - LazyReactivate: Deactivate but allow reactivation on next delivery (future)
 */
export enum CleanupPolicy {
  Persist = "persist",
  Deactivate = "deactivate",
  LazyReactivate = "lazy_reactivate"
}

/**
 * Parameterizes pane activation behavior during delivery.
 *
 * - Respawn: Full activation (respawn pane, wait for readiness)
 * - AssumeRunning: Assume pane is already running; verify readiness only (converged)
 */
export enum ConvergencePolicy {
  Respawn = "respawn",
  AssumeRunning = "assume_running"
}

/**
 * Result of a unified delivery operation.
 */
export type DeliveryResult =
  | {
      ok: true;
      resultCode: "delivery_ok";
      message: string;
      sessionName?: string;
      targetPaneIndex?: number;
    }
  | {
      ok: false;
      reason: "pane_not_ready";
      maxRetryAttempts: number;
      lastError: string;
    }
  | {
      ok: false;
      reason: "instruction_delivery_failed";
      envelope: ProtocolEnvelope;
      underlyingError: unknown;
    }
  | {
      ok: false;
      reason: "cleanup_failed";
      afterDeliveryOk: boolean;
      cleanupError: unknown;
    }
  | {
      ok: false;
      reason: "timeout";
      phase: "readiness" | "confirmation";
      durationMs: number;
    }
  | {
      ok: false;
      reason: "target_not_resolvable";
      message: string;
    }
  | {
      ok: false;
      reason: "session_not_found";
      bubbleId: string;
    };

/**
 * Unified orchestrator for agent delivery across all delivery paths.
 */
export interface UnifiedDeliveryOrchestrator {
  /**
   * Deliver a protocol envelope to an agent via tmux pane.
   *
   * Unified lifecycle:
   * 1. Resolve target pane by role + delivery metadata
   * 2. Activate pane (respawn or assume-running based on convergencePolicy)
   * 3. Submit startup prompt (strategy-specific: upfront, post-readiness, or none)
   * 4. Deliver envelope via tmux send-keys
   * 5. Cleanup per policy (persist, deactivate, lazy-reactivate)
   *
   * All steps return structured errors; no silent fallbacks.
   *
   * Phase 4 extension: Supports pane binding operations for meta-reviewer and future roles.
   * Passes metadata (bubbleId, round, taskPath, repoPath, etc.) through buildAgentCommand
   * so recipient agent (e.g., opencode) can reconstruct situational context internally
   * without duplicating prompt-building logic in delivery paths.
   */
  deliverToRole(input: {
    bubbleId: string;
    envelope: ProtocolEnvelope;
    bubbleConfig: BubbleConfig;
    sessionsPath: string;
    role?: DeliveryTargetRole;
    messageRef?: string;
    initialDelayMs?: number;
    deliveryAttempts?: number;
    reviewerBrief?: string;
    reviewerFocus?: ReviewerFocusExtractionResult;
    reviewerTestDirective?: ReviewerTestExecutionDirective;
    strategy: StartupStrategy;
    cleanupPolicy: CleanupPolicy;
    convergencePolicy?: ConvergencePolicy;
    startupPrompt?: string;
    runner?: unknown; // TmuxRunner (import type conflicts avoided)
    
    // Phase 4: Pane binding context for meta-reviewer and future pane-based delivery
    // These fields enable buildAgentCommand to receive metadata for situational awareness
    // without duplicating prompt-building logic. Implementation decides whether to
    // pre-build prompt or pass metadata directly to agent.
    round?: number;
    repoPath?: string;
    taskArtifactPath?: string;
    pairflowCommandProfile?: string; // e.g. "external", "internal"
    metaReviewerModel?: string;
    paneBindingRuntime?: unknown; // MetaReviewGatePaneBindingRuntimeCapabilities
    paneBindingTmux?: unknown; // MetaReviewGatePaneBindingTmuxCapabilities
    setMetaReviewerPane?: unknown; // (input) => Promise<SetMetaReviewerPaneBindingResult>
  }): Promise<DeliveryResult>;
}
