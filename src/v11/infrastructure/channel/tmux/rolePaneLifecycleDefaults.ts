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
import { waitForAgentPaneReady } from "./tmuxPaneReadiness.js";
import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";

/**
 * Create the default RolePaneLifecycle implementation for a tmux-based bubble session.
 * Used by all delivery modules (pass, converged, meta-review gate, ask-human, etc.)
 * to activate role panes uniformly.
 */
export function createDefaultRolePaneLifecycle(input?: {
  readinessConfig?: typeof DEFAULT_PANE_READINESS_CONFIG;
}): RolePaneLifecycle {
  return createRolePaneLifecycle({
    topologyPaneIndexForRole: getSharedTopologySlotPaneIndexForRole,
    respawnPane: async (respawnInput: Parameters<typeof respawnTmuxPaneCommand>[0]) => {
      await respawnTmuxPaneCommand({
        sessionName: respawnInput.sessionName,
        paneIndex: respawnInput.paneIndex,
        cwd: respawnInput.cwd,
        command: respawnInput.command,
        runner: respawnInput.runner ?? (await import("./tmuxRunner.js").then(m => m.runTmux))
      });
    },
    waitForPaneReady: async (readyInput: {
      runner: Parameters<typeof waitForAgentPaneReady>[1]["runner"];
      targetPane: string;
      attempts?: number;
      retryDelayMs?: number;
      agentName?: AgentName;
    }) => {
      return waitForAgentPaneReady(readyInput.agentName, {
        runner: readyInput.runner,
        targetPane: readyInput.targetPane,
        attempts: readyInput.attempts ?? 20,
        retryDelayMs: readyInput.retryDelayMs ?? 300
      });
    },
    readinessConfig: input?.readinessConfig ?? DEFAULT_PANE_READINESS_CONFIG
  });
}
