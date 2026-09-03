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

import type { AgentName, AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import type { TmuxRunner } from "../../ports/tmuxSessions.js";
import { getAgentRuntimeProfile, isAgentNameRegistered } from "../agent/agentRuntimeProfiles.js";

/** Roles that share a bubble's pane topology (implementer, reviewer, meta_reviewer). */
const ALL_ROLE_PANES: readonly AgentRole[] = [
  "implementer",
  "reviewer",
  "meta_reviewer"
];

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
  markerSettleMs: 500,
  maxRetryAttempts: 100,
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
    /** Configured agent for the role; selects readiness module and concurrency rules. */
    expectedPaneAgent?: AgentName;
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
    /** Configured agent for the pane; selects the readiness module. */
    agentName?: AgentName;
  }) => Promise<boolean>;
  readinessConfig?: PaneReadinessConfig;
  /** Resolve whether a given role pane runs a non-concurrent agent. */
  configureRoleAgent?: ((role: AgentRole) => AgentName | undefined) | undefined;
}): RolePaneLifecycle {
  const config = input.readinessConfig ?? DEFAULT_PANE_READINESS_CONFIG;

  return {
    async activatePaneForRole(activateInput) {
      const paneIndex = input.topologyPaneIndexForRole(activateInput.role);
      const targetPane = `${activateInput.sessionName}:0.${paneIndex}`;

      try {
        // Step 0: For agents that cannot run concurrent panes (reasonix enforces
        // a machine-wide single active interactive session), deactivate the other
        // role panes first so their agent processes release the session lock
        // before this role's agent starts.
        await deactivateOtherRolePanes({
          activateInput,
          topologyPaneIndexForRole: input.topologyPaneIndexForRole,
          respawnPane: input.respawnPane,
          ...(input.configureRoleAgent !== undefined
            ? { configureRoleAgent: input.configureRoleAgent }
            : {})
        });

        // Step 1: Respawn pane with new command (kills previous process, resets context)
        await input.respawnPane({
          sessionName: activateInput.sessionName,
          paneIndex,
          command: activateInput.command,
          cwd: activateInput.cwd,
          runner: activateInput.runner
        });

        // Step 2: Wait for pane readiness (agent startup complete)
        const isReady = await input.waitForPaneReady({
          runner: activateInput.runner,
          targetPane,
          attempts: config.maxRetryAttempts,
          retryDelayMs: config.retryDelayMs,
          ...(activateInput.expectedPaneAgent !== undefined
            ? { agentName: activateInput.expectedPaneAgent }
            : {})
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

/** Placeholder that keeps a pane alive without running an agent. */
const PANE_DEACTIVATION_PLACEHOLDER = "sh -lc 'while :; do sleep 3600; done'";

export async function deactivateOtherRolePanes(input: {
  activateInput: {
    sessionName: string;
    role: AgentRole;
    cwd: string;
    runner: TmuxRunner;
    expectedPaneAgent?: AgentName;
  };
  topologyPaneIndexForRole: (role: AgentRole) => number;
  respawnPane: (input: {
    sessionName: string;
    paneIndex: number;
    command: string;
    cwd: string;
    runner: TmuxRunner;
  }) => Promise<void>;
  /**
   * Resolve whether a given role pane runs a non-concurrent agent. When
   * provided, only panes running another non-concurrent (reasonix) agent are
   * deactivated — so activating a non-concurrent implementer does NOT turn the
   * opencode reviewer/meta-reviewer panes into dead shells. Optional for
   * backwards compatibility: when omitted, "deactivate all other panes" is
   * retained.
   */
  configureRoleAgent?: (role: AgentRole) => AgentName | undefined;
}): Promise<void> {
  const agentName = input.activateInput.expectedPaneAgent;
  if (agentName === undefined || !isAgentNameRegistered(agentName)) {
    return;
  }
  if (getAgentRuntimeProfile(agentName).supportsConcurrentPanes) {
    return;
  }
  for (const role of ALL_ROLE_PANES) {
    if (role === input.activateInput.role) {
      continue;
    }
    // Only deactivate other panes that actually run a conflicting
    // (non-concurrent, single-session) agent. An opencode reviewer/meta pane
    // shares none of reasonix's machine-wide session lock, so it must NOT be
    // turned into a placeholder when the reasonix implementer becomes active —
    // otherwise the review message gets dropped and the reviewer never starts.
    if (input.configureRoleAgent !== undefined) {
      const otherAgent = input.configureRoleAgent(role);
      if (
        otherAgent === undefined
        || !isAgentNameRegistered(otherAgent)
        || getAgentRuntimeProfile(otherAgent).supportsConcurrentPanes
      ) {
        continue;
      }
    }
    const otherPaneIndex = input.topologyPaneIndexForRole(role);
    try {
      // Replaces the other pane's agent process with a placeholder, releasing
      // the reasonix single-active-session lock. The pane is respawned with
      // its agent command on its next delivery.
      await input.respawnPane({
        sessionName: input.activateInput.sessionName,
        paneIndex: otherPaneIndex,
        command: PANE_DEACTIVATION_PLACEHOLDER,
        cwd: input.activateInput.cwd,
        runner: input.activateInput.runner
      });
    } catch {
      // Deactivation is best-effort; a failure must not block activation.
    }
  }
}
