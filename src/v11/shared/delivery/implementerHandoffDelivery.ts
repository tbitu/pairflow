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
  createEmitDeliveryOrchestrator,
  mapDeliveryResultToDeliveryAck
} from "./deliveryOrchestratorFactory.js";

export interface ExecuteImplementerHandoffDeliveryResult {
  result: DeliveryAck;
  retried: boolean;
}

export function shouldRetryImplementerHandoffDelivery(
  result: DeliveryAck | undefined
): boolean {
  return (
    result !== undefined &&
    result.status === "rejected" &&
    (
      result.reason === "no_runtime_session" ||
      result.reason === "delivery_unconfirmed" ||
      result.reason === "command_failed"
    )
  );
}

function buildUnexpectedDeliveryFailureResult(): DeliveryAck {
  return {
    status: "rejected",
    message: "",
    reason: "command_failed",
    reason_code: "DELIVERY_ACK_REJECTED"
  };
}

function deliverImplementerHandoffOnce(input: {
  deliveryInput: EmitDeliveryNotificationInput;
  orchestrator: UnifiedDeliveryOrchestrator;
}): Promise<DeliveryAck> {
  return input.orchestrator.deliverToRole({
    bubbleId: input.deliveryInput.bubbleId,
    bubbleConfig: input.deliveryInput.bubbleConfig,
    sessionsPath: input.deliveryInput.sessionsPath,
    envelope: input.deliveryInput.envelope,
    ...(input.deliveryInput.recipientRole !== undefined
      ? { role: input.deliveryInput.recipientRole }
      : {}),
    ...(input.deliveryInput.messageRef !== undefined
      ? { messageRef: input.deliveryInput.messageRef }
      : {}),
    ...(input.deliveryInput.initialDelayMs !== undefined
      ? { initialDelayMs: input.deliveryInput.initialDelayMs }
      : {}),
    ...(input.deliveryInput.deliveryAttempts !== undefined
      ? { deliveryAttempts: input.deliveryInput.deliveryAttempts }
      : {}),
    strategy: StartupStrategy.UpfrontCli,
    cleanupPolicy: CleanupPolicy.Persist,
    convergencePolicy: ConvergencePolicy.Respawn
  }).then((result) => mapDeliveryResultToDeliveryAck(result));
}

export async function executeImplementerHandoffDelivery(input: {
  deliveryInput: EmitDeliveryNotificationInput;
  orchestrator?: UnifiedDeliveryOrchestrator;
  emitDelivery?: (input: EmitDeliveryNotificationInput) => Promise<DeliveryAck>;
}): Promise<ExecuteImplementerHandoffDeliveryResult> {
  const orchestrator =
    input.orchestrator ?? createEmitDeliveryOrchestrator(
      input.emitDelivery !== undefined
        ? { emitDelivery: input.emitDelivery }
        : {}
    );
  let deliveryResult = await deliverImplementerHandoffOnce({
    deliveryInput: input.deliveryInput,
    orchestrator
  })
    .catch(() => buildUnexpectedDeliveryFailureResult());
  let deliveryRetried = false;

  if (shouldRetryImplementerHandoffDelivery(deliveryResult)) {
    deliveryRetried = true;
    const initialFailureResult = deliveryResult;
    deliveryResult = await deliverImplementerHandoffOnce({
      deliveryInput: {
        ...input.deliveryInput,
      // Newly activated implementer/meta-reviewer panes can still be warming up.
      // Retry once with the same timing used by the stable reviewer handoff flow (30 seconds).
        initialDelayMs: 30000,
        deliveryAttempts: 6
      },
      orchestrator
    }).catch(() => initialFailureResult);
  }

  return {
    result: deliveryResult,
    retried: deliveryRetried
  };
}
