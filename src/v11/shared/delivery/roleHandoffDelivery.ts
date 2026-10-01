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

export interface ExecuteRoleHandoffDeliveryInput {
  deliveryInput: EmitDeliveryNotificationInput;
  strategy?: StartupStrategy | undefined;
  cleanupPolicy?: CleanupPolicy | undefined;
  convergencePolicy?: ConvergencePolicy | undefined;
  orchestrator?: UnifiedDeliveryOrchestrator | undefined;
  emitDelivery?: ((input: EmitDeliveryNotificationInput) => Promise<DeliveryAck>) | undefined;
  onUndelivered?: ((result: DeliveryAck | undefined, retried: boolean) => void) | undefined;
}

export interface ExecuteRoleHandoffDeliveryResult {
  result: DeliveryAck | undefined;
  retried: boolean;
}

export function shouldRetryRoleHandoffDelivery(
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

export async function executeRoleHandoffDelivery(
  input: ExecuteRoleHandoffDeliveryInput
): Promise<ExecuteRoleHandoffDeliveryResult> {
  const orchestrator =
    input.orchestrator ??
    createEmitDeliveryOrchestrator(
      input.emitDelivery !== undefined
        ? { emitDelivery: input.emitDelivery }
        : {}
    );
  const strategy =
    input.strategy ??
    (input.deliveryInput.recipientRole === "reviewer"
      ? StartupStrategy.PostReadinessTmux
      : StartupStrategy.UpfrontCli);
  const cleanupPolicy = input.cleanupPolicy ?? CleanupPolicy.Persist;
  const convergencePolicy = input.convergencePolicy ?? ConvergencePolicy.Respawn;

  const deliverOnce = (deliveryInput: EmitDeliveryNotificationInput): Promise<DeliveryAck> => {
    return orchestrator.deliverToRole({
      bubbleId: deliveryInput.bubbleId,
      bubbleConfig: deliveryInput.bubbleConfig,
      sessionsPath: deliveryInput.sessionsPath,
      envelope: deliveryInput.envelope,
      ...(deliveryInput.recipientRole !== undefined
        ? { role: deliveryInput.recipientRole }
        : {}),
      ...(deliveryInput.messageRef !== undefined
        ? { messageRef: deliveryInput.messageRef }
        : {}),
      ...(deliveryInput.initialDelayMs !== undefined
        ? { initialDelayMs: deliveryInput.initialDelayMs }
        : {}),
      ...(deliveryInput.deliveryAttempts !== undefined
        ? { deliveryAttempts: deliveryInput.deliveryAttempts }
        : {}),
      ...(deliveryInput.reviewerBrief !== undefined
        ? { reviewerBrief: deliveryInput.reviewerBrief }
        : {}),
      ...(deliveryInput.reviewerFocus !== undefined
        ? { reviewerFocus: deliveryInput.reviewerFocus }
        : {}),
      ...(deliveryInput.reviewerTestDirective !== undefined
        ? { reviewerTestDirective: deliveryInput.reviewerTestDirective }
        : {}),
      strategy,
      cleanupPolicy,
      convergencePolicy
    }).then((result) => mapDeliveryResultToDeliveryAck(result));
  };

  let deliveryResult: DeliveryAck | undefined = await deliverOnce(input.deliveryInput)
    .catch(() => buildUnexpectedDeliveryFailureResult());
  let deliveryRetried = false;

  if (shouldRetryRoleHandoffDelivery(deliveryResult)) {
    deliveryRetried = true;
    const initialFailureResult = deliveryResult;
    deliveryResult = await deliverOnce({
      ...input.deliveryInput,
      // Newly activated agent panes can still be warming up.
      // Retry once with a 30s warm-up window across all roles.
      initialDelayMs: 30000,
      deliveryAttempts: 6
    }).catch(() => initialFailureResult);
  }

  if (input.onUndelivered !== undefined) {
    input.onUndelivered(deliveryResult, deliveryRetried);
  }

  return {
    result: deliveryResult,
    retried: deliveryRetried
  };
}
