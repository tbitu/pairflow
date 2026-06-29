import type {
  DeliveryAck,
  EmitDeliveryNotificationAckPort
} from "../../ports/tmuxDelivery.js";
import type {
  UnifiedDeliveryOrchestrator,
  DeliveryResult
} from "./unifiedDeliveryOrchestrator.js";
import type { ProtocolEnvelope } from "../protocol/protocolEnvelopeContract.js";

interface CreateUnifiedDeliveryOrchestratorInput {
  emitDelivery?: EmitDeliveryNotificationAckPort;
}

function mapDeliveryAckToDeliveryResult(input: {
  deliveryAck: DeliveryAck;
  bubbleId: string;
  envelope: ProtocolEnvelope;
}): DeliveryResult {
  const { deliveryAck } = input;

  if (deliveryAck.status === "accepted") {
    return {
      ok: true,
      resultCode: "delivery_ok",
      message: deliveryAck.message,
      ...(deliveryAck.sessionName !== undefined
        ? { sessionName: deliveryAck.sessionName }
        : {}),
      ...(deliveryAck.targetPaneIndex !== undefined
        ? { targetPaneIndex: deliveryAck.targetPaneIndex }
        : {})
    };
  }

  switch (deliveryAck.reason) {
    case "no_runtime_session":
      return {
        ok: false,
        reason: "session_not_found",
        bubbleId: input.bubbleId
      };
    case "delivery_unconfirmed":
      return {
        ok: false,
        reason: "pane_not_ready",
        maxRetryAttempts: 0,
        lastError: deliveryAck.message
      };
    case "command_failed":
      return {
        ok: false,
        reason: "instruction_delivery_failed",
        envelope: input.envelope,
        underlyingError: deliveryAck.message
      };
    default:
      return {
        ok: false,
        reason: "target_not_resolvable",
        message: deliveryAck.message
      };
  }
}

/**
 * Map a DeliveryResult from the unified orchestrator back to a legacy DeliveryAck.
 *
 * Used by delivery path callers that still return DeliveryAck to their own callers.
 * Exported so reviewer and other delivery paths can use it without duplicating logic.
 */
export function mapDeliveryResultToDeliveryAck(
  result: DeliveryResult
): DeliveryAck {
  if (result.ok) {
    return {
      status: "accepted",
      message: result.message,
      ...(result.sessionName !== undefined
        ? { sessionName: result.sessionName }
        : {}),
      ...(result.targetPaneIndex !== undefined
        ? { targetPaneIndex: result.targetPaneIndex }
        : {})
    };
  }

  switch (result.reason) {
    case "session_not_found":
      return {
        status: "rejected",
        message: "",
        reason: "no_runtime_session",
        reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE"
      };
    case "pane_not_ready":
      return {
        status: "rejected",
        message: result.lastError,
        reason: "delivery_unconfirmed",
        reason_code: "DELIVERY_ACK_REJECTED"
      };
    case "instruction_delivery_failed":
      return {
        status: "rejected",
        message: "",
        reason: "command_failed",
        reason_code: "DELIVERY_ACK_REJECTED"
      };
    default:
      return {
        status: "rejected",
        message: "",
        reason: "command_failed",
        reason_code: "DELIVERY_ACK_REJECTED"
      };
  }
}

/**
 * Create a unified delivery orchestrator backed by an emitDelivery port.
 *
 * This factory belongs to the shared layer so application and defaults modules
 * can construct an orchestrator without importing from infrastructure.
 *
 * The factory delegates every delivery call to the provided emitDelivery port
 * and maps the legacy DeliveryAck result to the orchestrator's DeliveryResult
 * union. 
 *
 * **Phase 3 Coverage**: Implementer, reviewer, converged delivery paths.
 * **Phase 4 Extension**: For meta-reviewer pane binding, use createPaneBindingOrchestrator()
 * factory which integrates pane respawn, readiness polling, and cleanup operations.
 */
export function createEmitDeliveryOrchestrator(
  dependencies: CreateUnifiedDeliveryOrchestratorInput = {}
): UnifiedDeliveryOrchestrator {
  return {
    deliverToRole(input): Promise<DeliveryResult> {
      if (dependencies.emitDelivery === undefined) {
        return Promise.resolve({
          ok: false,
          reason: "target_not_resolvable",
          message:
            "UnifiedDeliveryOrchestrator requires an emitDelivery dependency for the current migration slice."
        });
      }

      return dependencies.emitDelivery({
        bubbleId: input.bubbleId,
        bubbleConfig: input.bubbleConfig,
        sessionsPath: input.sessionsPath,
        envelope: input.envelope,
        ...(input.role !== undefined ? { recipientRole: input.role } : {}),
        ...(input.messageRef !== undefined ? { messageRef: input.messageRef } : {}),
        ...(input.initialDelayMs !== undefined
          ? { initialDelayMs: input.initialDelayMs }
          : {}),
        ...(input.deliveryAttempts !== undefined
          ? { deliveryAttempts: input.deliveryAttempts }
          : {}),
        ...(input.reviewerBrief !== undefined
          ? { reviewerBrief: input.reviewerBrief }
          : {}),
        ...(input.reviewerFocus !== undefined
          ? { reviewerFocus: input.reviewerFocus }
          : {}),
        ...(input.reviewerTestDirective !== undefined
          ? { reviewerTestDirective: input.reviewerTestDirective }
          : {})
      }).then((deliveryAck) => mapDeliveryAckToDeliveryResult({
        deliveryAck,
        bubbleId: input.bubbleId,
        envelope: input.envelope
      }));
    }
  };
}
