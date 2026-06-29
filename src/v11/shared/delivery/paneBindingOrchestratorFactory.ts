/**
 * Factory for creating a unified delivery orchestrator backed by pane binding operations.
 *
 * **Phase 4 Extension**: Supports meta-reviewer and future pane-based delivery scenarios.
 *
 * This orchestrator integrates:
 * - Pane binding activation (via setMetaReviewerPane)
 * - Pane respawn with agent command (via respawnPaneCommand)
 * - Readiness polling and startup prompt injection
 * - Cleanup policies (persist, deactivate)
 *
 * Key Design Principle: Pass metadata (bubbleId, round, taskPath, repoPath) through
 * buildAgentCommand so the recipient agent (e.g., opencode) can reconstruct situational
 * context without duplicating prompt-building logic in delivery paths.
 *
 * This factory belongs to the shared layer so application and defaults modules
 * can construct an orchestrator without importing infrastructure pane-binding code.
 */

import type {
  UnifiedDeliveryOrchestrator,
  DeliveryResult
} from "./unifiedDeliveryOrchestrator.js";

/**
 * Pane binding runtime capabilities for agent command building and pane operations.
 * These are typically provided by infrastructure layer (defaults module).
 *
 * **Phase 4 Principle**: buildAgentCommand receives metadata (bubbleId, round, taskPath, repoPath)
 * so the agent can reconstruct situational context. We don't pre-build prompts here.
 */
export interface PaneBindingRuntimeCapabilities {
  buildAgentCommand?: (input: {
    agentName: string;
    bubbleId: string;
    workspacePath?: string;
    worktreePath?: string;
    pairflowCommandProfile?: string;
    roleName?: "implementer" | "reviewer" | "meta_reviewer";
    roleMcpPolicy?: string;
    model?: string;
    opencodeMcpDisableArgs?: string[];
    // Phase 4: Metadata for agent to reconstruct situational context
    round?: number;
    repoPath?: string;
    taskArtifactPath?: string;
    startupPrompt?: string | undefined;
  }) => string;
}

/**
 * Pane binding tmux capabilities for respawn operations.
 */
export interface PaneBindingTmuxCapabilities {
  runner?: unknown; // TmuxRunner
  respawnPaneCommand?: (input: {
    sessionName: string;
    paneIndex: number;
    cwd: string;
    command: string;
    runner?: unknown; // TmuxRunner
  }) => Promise<void>;
}

interface CreatePaneBindingOrchestratorInput {
  buildAgentCommand?: PaneBindingRuntimeCapabilities["buildAgentCommand"];
  respawnPaneCommand?: PaneBindingTmuxCapabilities["respawnPaneCommand"];
  setMetaReviewerPane?: (input: {
    sessionsPath: string;
    bubbleId: string;
    active: boolean;
    now?: Date;
  }) => Promise<{
    updated: boolean;
    record?: unknown; // RuntimeSessionRecord
    reason?: string;
  }>;
  tmuxRunner?: unknown; // TmuxRunner
}

/**
 * Create a unified delivery orchestrator backed by pane binding operations.
 *
 * Used by meta-reviewer delivery to:
 * 1. Activate pane binding via setMetaReviewerPane
 * 2. Build agent command via buildAgentCommand (with metadata context)
 * 3. Respawn pane with the command
 * 4. Handle cleanup per policy
 *
 * **Phase 4 Design**: Metadata (bubbleId, round, taskPath, repoPath) flows through
 * orchestrator to buildAgentCommand, allowing the agent to understand context internally.
 * No prompt pre-building at delivery layer.
 */
export function createPaneBindingOrchestrator(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _dependencies: CreatePaneBindingOrchestratorInput = {}
): UnifiedDeliveryOrchestrator {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    deliverToRole(_input): Promise<DeliveryResult> {
      // Placeholder: Phase 4-T2 will implement full pane binding lifecycle
      return Promise.resolve({
        ok: false,
        reason: "target_not_resolvable",
        message:
          "PaneBindingOrchestrator is a Phase 4 placeholder. Implementation details will be added in P4-T2."
      });
    }
  };
}
