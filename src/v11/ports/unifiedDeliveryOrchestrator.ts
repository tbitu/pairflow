import type { UnifiedDeliveryOrchestrator } from "../shared/delivery/unifiedDeliveryOrchestrator.js";

export type {
  UnifiedDeliveryOrchestrator,
  StartupStrategy,
  CleanupPolicy,
  ConvergencePolicy,
  DeliveryResult
} from "../shared/delivery/unifiedDeliveryOrchestrator.js";

/**
 * Port: Dependency injection interface for UnifiedDeliveryOrchestrator.
 *
 * Implementations:
 * - `src/v11/infrastructure/channel/tmux/unifiedDeliveryOrchestrationDefaults.ts`: Tmux-based implementation
 */
export interface UnifiedDeliveryOrchestratorPort {
  deliverToRole: UnifiedDeliveryOrchestrator["deliverToRole"];
}
