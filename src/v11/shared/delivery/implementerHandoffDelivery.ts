import type {
  DeliveryAck,
  EmitDeliveryNotificationInput
} from "./tmuxDeliveryContract.js";
import type {
  UnifiedDeliveryOrchestrator
} from "../../ports/unifiedDeliveryOrchestrator.js";
import {
  CleanupPolicy,
  ConvergencePolicy,
  StartupStrategy
} from "./unifiedDeliveryOrchestrator.js";
import {
  executeRoleHandoffDelivery,
  shouldRetryRoleHandoffDelivery
} from "./roleHandoffDelivery.js";

export interface ExecuteImplementerHandoffDeliveryResult {
  result: DeliveryAck;
  retried: boolean;
}

export function shouldRetryImplementerHandoffDelivery(
  result: DeliveryAck | undefined
): boolean {
  return shouldRetryRoleHandoffDelivery(result);
}

export async function executeImplementerHandoffDelivery(input: {
  deliveryInput: EmitDeliveryNotificationInput;
  orchestrator?: UnifiedDeliveryOrchestrator;
  emitDelivery?: (input: EmitDeliveryNotificationInput) => Promise<DeliveryAck>;
}): Promise<ExecuteImplementerHandoffDeliveryResult> {
  const deliveryResult = await executeRoleHandoffDelivery({
    deliveryInput: input.deliveryInput,
    strategy: StartupStrategy.UpfrontCli,
    cleanupPolicy: CleanupPolicy.Persist,
    convergencePolicy: ConvergencePolicy.Respawn,
    ...(input.orchestrator !== undefined ? { orchestrator: input.orchestrator } : {}),
    ...(input.emitDelivery !== undefined ? { emitDelivery: input.emitDelivery } : {})
  });

  return {
    result: deliveryResult.result ?? {
      status: "rejected",
      message: "",
      reason: "command_failed",
      reason_code: "DELIVERY_ACK_REJECTED"
    },
    retried: deliveryResult.retried
  };
}
