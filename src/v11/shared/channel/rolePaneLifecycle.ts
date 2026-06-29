/**
 * Unified Pane Lifecycle Model (Phase 1)
 *
 * Consolidates lifecycle behavior for all role panes (implementer, reviewer, meta_reviewer).
 * Previously: Each role had custom respawn/reset logic scattered across delivery modules.
 * Now: Single abstraction with consistent reset, readiness polling, and instruction delivery.
 *
 * Lifecycle Contract (Persistent Pane Model):
 * 1. Pane exists for entire bubble lifetime (created at bubble start, reused for all handoffs)
 * 2. On each handoff to a role:
 *    a. respawn-pane with new command (kills old process cleanly)
 *    b. Wait for pane readiness marker (opencode startup indicator)
 *    c. Send startup prompt via tmux send-keys (not paste)
 * 3. Between handoffs: Pane remains idle, ready for next role
 * 4. On cleanup: Pane is killed with session termination
 */

import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import type { TmuxRunner } from "../../ports/tmuxSessions.js";

/**
 * Configuration for pane readiness polling and warmup.
 * Set once per bubble start, reused across all role handoffs.
 */
export interface PaneReadinessConfig {
  /** How long to wait after respawn before first readiness check (ms) */
  respawnWarmupMs: number;

  /** How long to wait for readiness marker to settle after first detection (ms) */
  markerSettleMs: number;

  /** Maximum attempts to poll for pane readiness */
  maxRetryAttempts: number;

  /** Delay between readiness poll attempts (ms) */
  retryDelayMs: number;
}

/**
 * Default readiness configuration.
 * Calibrated from existing implementer/reviewer/meta-reviewer handoff behavior:
 * - respawnWarmupMs: 0 (check immediately after respawn)
 * - markerSettleMs: 300ms (typical latency for opencode startup prompt to appear)
 * - maxRetryAttempts: 20 (covers ~6 seconds total retry window)
 * - retryDelayMs: 300ms (between attempts)
 */
export const DEFAULT_PANE_READINESS_CONFIG: PaneReadinessConfig = {
  respawnWarmupMs: 0,
  markerSettleMs: 300,
  maxRetryAttempts: 20,
  retryDelayMs: 300
};

/**
 * Result of a pane lifecycle operation.
 */
export type PaneLifecycleResult =
  | { ok: true; paneIndex: number }
  | {
      ok: false;
      reason:
        | "respawn_failed"
        | "readiness_timeout"
        | "session_not_found"
        | "readiness_check_failed";
    };

/**
 * Unified interface for pane lifecycle operations.
 * Abstracts role-specific behavior (implementer, reviewer, meta_reviewer).
 */
export interface RolePaneLifecycle {
  /**
   * Activate pane for a role: respawn, wait for ready, return pane index.
   * Idempotent within a bubble lifecycle (respawn replaces previous process).
   */
  activatePaneForRole(input: {
    sessionName: string;
    role: AgentRole;
    command: string;
    cwd: string;
    runner: TmuxRunner;
  }): Promise<PaneLifecycleResult>;

  /**
   * Check if pane is ready to receive instructions (agent startup complete).
   * Used by delivery logic to determine if pane is ready for send-keys.
   */
  isPaneReady(input: {
    sessionName: string;
    paneIndex: number;
    runner: TmuxRunner;
  }): Promise<boolean>;

  /**
   * Get pane index for a role (no-op, just lookup).
   * Used by instruction delivery to find target pane.
   */
  getPaneIndexForRole(role: AgentRole): number;

  /**
   * Get current readiness configuration (used by callers to understand retry budget).
   */
  getReadinessConfig(): PaneReadinessConfig;
}

/**
 * Factory: Create a unified pane lifecycle manager.
 * Consolidates logic from reviewerContext.ts, implementerHandoffDelivery.ts, metaReviewGateCleanRerunDelivery.ts.
 */
export function createRolePaneLifecycle(input: {
  topologyPaneIndexForRole: (role: AgentRole) => number;
  respawnPane: (input: {
    sessionName: string;
    paneIndex: number;
    command: string;
    cwd: string;
    runner: TmuxRunner;
  }) => Promise<void>;
  waitForPaneReady: (input: {
    runner: TmuxRunner;
    targetPane: string;
    attempts?: number;
    retryDelayMs?: number;
  }) => Promise<boolean>;
  readinessConfig?: PaneReadinessConfig;
}): RolePaneLifecycle {
  const config = input.readinessConfig ?? DEFAULT_PANE_READINESS_CONFIG;

  return {
    async activatePaneForRole(activateInput) {
      const paneIndex = input.topologyPaneIndexForRole(activateInput.role);
      const targetPane = `${activateInput.sessionName}:0.${paneIndex}`;

      try {
        // Step 1: Respawn pane with new command (kills previous process, resets context)
        await input.respawnPane({
          sessionName: activateInput.sessionName,
          paneIndex,
          command: activateInput.command,
          cwd: activateInput.cwd,
          runner: activateInput.runner
        });

        // Step 2: Wait for pane readiness (opencode startup complete)
        const isReady = await input.waitForPaneReady({
          runner: activateInput.runner,
          targetPane,
          attempts: config.maxRetryAttempts,
          retryDelayMs: config.retryDelayMs
        });

        if (!isReady) {
          return {
            ok: false,
            reason: "readiness_timeout"
          };
        }

        return {
          ok: true,
          paneIndex
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("can't find session")
        ) {
          return {
            ok: false,
            reason: "session_not_found"
          };
        }
        return {
          ok: false,
          reason: "respawn_failed"
        };
      }
    },

    async isPaneReady(readyInput) {
      const targetPane = `${readyInput.sessionName}:0.${readyInput.paneIndex}`;
      return input.waitForPaneReady({
        runner: readyInput.runner,
        targetPane,
        attempts: 1,
        retryDelayMs: 0
      });
    },

    getPaneIndexForRole(role) {
      return input.topologyPaneIndexForRole(role);
    },

    getReadinessConfig() {
      return config;
    }
  };
}
