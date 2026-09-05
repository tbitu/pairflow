/**
 * Default RolePaneLifecycle Implementation
 *
 * Integrates with existing tmux infrastructure:
 * - Uses respawnTmuxPaneCommand for pane reset
 * - Uses waitForOpencodePaneReady for readiness polling
 * - Centralizes topology slot-to-pane-index mapping
 */

import { createRolePaneLifecycle, type RolePaneLifecycle, DEFAULT_PANE_READINESS_CONFIG } from "../../../shared/channel/rolePaneLifecycle.js";
import { getSharedTopologySlotPaneIndexForRole } from "../../../shared/topology/topologySlotPaneProjection.js";
import { respawnTmuxPaneCommand } from "./tmuxManagerRuntime.js";
import { resolveAgentPaneAdapter } from "./agentPaneAdapters.js";
import type { AgentRole } from "../../../../contracts/kernel/agentIdentity.js";
import type { AgentPaneAdapter } from "../../../shared/agent/agentPaneAdapter.js";

/**
 * Create the default RolePaneLifecycle implementation for a tmux-based bubble session.
 * Used by all delivery modules (pass, converged, meta-review gate, ask-human, etc.)
 * to activate role panes uniformly.
 */
export function createDefaultRolePaneLifecycle(input?: {
  readinessConfig?: typeof DEFAULT_PANE_READINESS_CONFIG;
  configureRoleAgent?: ((role: AgentRole) => AgentPaneAdapter | undefined) | undefined;
}): RolePaneLifecycle {
  return createRolePaneLifecycle({
    topologyPaneIndexForRole: getSharedTopologySlotPaneIndexForRole,
    ...(input?.configureRoleAgent !== undefined
      ? { configureRoleAgent: input.configureRoleAgent }
      : {}),
    respawnPane: async (respawnInput: Parameters<typeof respawnTmuxPaneCommand>[0]) => {
      await respawnTmuxPaneCommand({
        sessionName: respawnInput.sessionName,
        paneIndex: respawnInput.paneIndex,
        cwd: respawnInput.cwd,
        command: respawnInput.command,
        runner: respawnInput.runner ?? (await import("./tmuxRunner.js").then(m => m.runTmux))
      });
    },
    waitForPaneReady: async (readyInput) => {
      const paneAgent = readyInput.paneAgent ?? resolveAgentPaneAdapter(undefined);
      return paneAgent.waitForReady(readyInput.runner, readyInput.targetPane, {
        attempts: readyInput.attempts ?? 100,
        retryDelayMs: readyInput.retryDelayMs ?? 300
      });
    },
    readinessConfig: input?.readinessConfig ?? DEFAULT_PANE_READINESS_CONFIG
  });
}
