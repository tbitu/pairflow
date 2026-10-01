import { describe, expect, it } from "vitest";

import type { EmitDeliveryNotificationInput } from "../../../../src/v11/ports/tmuxDelivery.js";
import type { UnifiedDeliveryOrchestrator } from "../../../../src/v11/ports/unifiedDeliveryOrchestrator.js";
import {
  executeRoleHandoffDelivery,
  shouldRetryRoleHandoffDelivery
} from "../../../../src/v11/shared/delivery/roleHandoffDelivery.js";
import {
  CleanupPolicy,
  ConvergencePolicy,
  StartupStrategy
} from "../../../../src/v11/shared/delivery/unifiedDeliveryOrchestrator.js";

function createDeliveryInput(recipientRole: "implementer" | "reviewer" | "meta_reviewer" = "implementer"): EmitDeliveryNotificationInput {
  return {
    bubbleId: "b_shared_role_delivery_01",
    bubbleConfig: {
      id: "b_shared_role_delivery_01",
      repo_path: "/tmp/repo",
      base_branch: "main",
      bubble_branch: "pf/b_shared_role_delivery_01",
      work_mode: "worktree",
      quality_mode: "strict",
      review_artifact_type: "code",
      pairflow_command_profile: "external",
      reviewer_context_mode: "fresh",
      watchdog_timeout_minutes: 5,
      max_rounds: 8,
      severity_gate_round: 4,
      commit_requires_approval: true,
      attach_launcher: "auto",
      agents: {
        implementer: "reasonix",
        reviewer: "reasonix",
        meta_reviewer: "opencode"
      },
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck"
      },
      notifications: {
        enabled: true
      },
      doc_contract_gates: {
        round_gate_applies_after: 2
      }
    },
    sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
    envelope: {
      id: "msg_20260403_200",
      ts: "2026-04-03T12:20:00.000Z",
      bubble_id: "b_shared_role_delivery_01",
      sender: "reasonix",
      recipient: "reasonix",
      type: "PASS",
      round: 1,
      payload: {
        summary: "handoff"
      },
      refs: []
    },
    recipientRole,
    messageRef: "artifact://handoff.md"
  };
}

describe("roleHandoffDelivery", () => {
  it("delivers to implementer and retries on delivery_unconfirmed with 30s delay", async () => {
    const calls: Parameters<UnifiedDeliveryOrchestrator["deliverToRole"]>[0][] = [];
    const result = await executeRoleHandoffDelivery({
      deliveryInput: createDeliveryInput("implementer"),
      strategy: StartupStrategy.UpfrontCli,
      cleanupPolicy: CleanupPolicy.Persist,
      convergencePolicy: ConvergencePolicy.Respawn,
      orchestrator: {
        deliverToRole: async (input) => {
          calls.push(input);
          if (calls.length === 1) {
            return {
              ok: false,
              reason: "pane_not_ready",
              maxRetryAttempts: 0,
              lastError: "unconfirmed"
            };
          }
          return {
            ok: true,
            resultCode: "delivery_ok",
            message: "ok",
            sessionName: "pf_bubble",
            targetPaneIndex: 1
          };
        }
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      strategy: StartupStrategy.UpfrontCli,
      cleanupPolicy: CleanupPolicy.Persist,
      convergencePolicy: ConvergencePolicy.Respawn
    });
    expect(calls[1]).toMatchObject({
      initialDelayMs: 30000,
      deliveryAttempts: 6
    });
    expect(result).toEqual({
      result: {
        status: "accepted",
        message: "ok",
        sessionName: "pf_bubble",
        targetPaneIndex: 1
      },
      retried: true
    });
  });

  it("delivers to reviewer with PostReadinessTmux and invokes onUndelivered on failure", async () => {
    const undeliveredCalls: unknown[] = [];
    const calls: Parameters<UnifiedDeliveryOrchestrator["deliverToRole"]>[0][] = [];
    const result = await executeRoleHandoffDelivery({
      deliveryInput: createDeliveryInput("reviewer"),
      strategy: StartupStrategy.PostReadinessTmux,
      cleanupPolicy: CleanupPolicy.Persist,
      convergencePolicy: ConvergencePolicy.Respawn,
      orchestrator: {
        deliverToRole: async (input) => {
          calls.push(input);
          return {
            ok: false,
            reason: "target_not_resolvable",
            message: "no session"
          };
        }
      },
      onUndelivered: (res, retried) => {
        undeliveredCalls.push({ res, retried });
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      strategy: StartupStrategy.PostReadinessTmux
    });
    expect(undeliveredCalls).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(result.result?.status).toBe("rejected");
  });

  it("identifies retryable error reasons correctly", () => {
    expect(shouldRetryRoleHandoffDelivery({
      status: "rejected",
      reason: "delivery_unconfirmed",
      reason_code: "DELIVERY_ACK_REJECTED",
      message: ""
    })).toBe(true);

    expect(shouldRetryRoleHandoffDelivery({
      status: "rejected",
      reason: "no_runtime_session",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
      message: ""
    })).toBe(true);

    expect(shouldRetryRoleHandoffDelivery({
      status: "rejected",
      reason: "command_failed",
      reason_code: "DELIVERY_ACK_REJECTED",
      message: ""
    })).toBe(true);

    expect(shouldRetryRoleHandoffDelivery({
      status: "rejected",
      reason: "pane_busy",
      reason_code: "DELIVERY_ACK_REJECTED",
      message: ""
    })).toBe(false);

    expect(shouldRetryRoleHandoffDelivery({
      status: "accepted",
      message: "ok"
    })).toBe(false);
  });
});
