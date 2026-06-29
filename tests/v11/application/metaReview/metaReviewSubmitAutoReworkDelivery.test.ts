import { describe, expect, it } from "vitest";

import {
  finalizeMetaReviewSubmitResult
} from "../../../../src/v11/application/metaReview/internal/submit/routing.js";
import type {
  MetaReviewCommandDependencies,
  MetaReviewResult
} from "../../../../src/v11/shared/metaReview/metaReviewCommandContract.js";
import type { MetaReviewGateResult } from "../../../../src/v11/shared/metaReviewGate/index.js";
import type { DeliveryAck, EmitDeliveryNotificationInput } from "../../../../src/v11/ports/tmuxDelivery.js";

function buildMinimalGateEnvelope() {
  return {
    id: "env_auto_rework_01",
    ts: "2026-06-29T09:00:00.000Z",
    bubble_id: "b_auto_rework_test",
    sender: "orchestrator",
    recipient: "opencode",
    type: "REWORK_REQUEST" as const,
    round: 2,
    payload: {
      summary: "auto rework triggered"
    },
    refs: []
  };
}

function buildMinimalRouted(route: MetaReviewGateResult["route"] = "auto_rework"): MetaReviewGateResult {
  return {
    bubbleId: "b_auto_rework_test",
    route,
    gateSequence: 1,
    gateEnvelope: buildMinimalGateEnvelope() as never,
    state: {} as never
  };
}

function buildMinimalResolved() {
  return {
    bubbleId: "b_auto_rework_test",
    bubbleConfig: {
      id: "b_auto_rework_test",
      repo_path: "/tmp/repo",
      base_branch: "main",
      bubble_branch: "pf/b_auto_rework_test",
      work_mode: "worktree",
      quality_mode: "strict",
      review_artifact_type: "code",
      pairflow_command_profile: "external",
      reviewer_context_mode: "persistent",
      watchdog_timeout_minutes: 5,
      max_rounds: 8,
      severity_gate_round: 4,
      commit_requires_approval: true,
      attach_launcher: "auto",
      agents: {
        implementer: "opencode",
        reviewer: "opencode",
        meta_reviewer: "opencode"
      },
      commands: {
        test: "pnpm test",
        typecheck: "pnpm typecheck"
      },
      notifications: { enabled: true },
      doc_contract_gates: { round_gate_applies_after: 2 }
    },
    bubblePaths: {
      statePath: "/tmp/repo/.pairflow/bubbles/b_auto_rework_test/state.json",
      transcriptPath:
        "/tmp/repo/.pairflow/bubbles/b_auto_rework_test/transcript.ndjson",
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      bubbleDir: "/tmp/repo/.pairflow/bubbles/b_auto_rework_test"
    }
  } as never;
}

function buildMinimalCanonicalRunResult(): MetaReviewResult {
  return {
    bubble_id: "b_auto_rework_test",
    status: "success",
    recommendation: "rework",
    summary: "needs rework",
    rework_target_message: null,
    updated_at: "2026-06-29T09:00:00.000Z",
    warnings: [],
    report_json: {}
  };
}

describe("metaReviewSubmitAutoReworkDelivery", () => {
  it("calls emitDeliveryNotification through the orchestrator when route is auto_rework", async () => {
    const deliveryCalls: EmitDeliveryNotificationInput[] = [];
    const messageRefCalls: unknown[] = [];

    const dependencies: MetaReviewCommandDependencies = {
      emitDeliveryNotification: async (input) => {
        deliveryCalls.push(input);
        return {
          status: "accepted" as const,
          message: "ok",
          sessionName: "pf_bubble",
          targetPaneIndex: 1
        } satisfies DeliveryAck;
      },
      buildDeliveryMessageRef: (input) => {
        messageRefCalls.push(input);
        return "artifact://transcript.ndjson#env_auto_rework_01";
      }
    };

    await finalizeMetaReviewSubmitResult({
      resolved: buildMinimalResolved(),
      routed: buildMinimalRouted("auto_rework"),
      dependencies,
      canonicalRunResult: buildMinimalCanonicalRunResult(),
      canonicalReportJson: {}
    });

    expect(messageRefCalls).toHaveLength(1);
    expect(deliveryCalls).toHaveLength(1);
    const firstCall = deliveryCalls[0] as EmitDeliveryNotificationInput;
    expect(firstCall).toMatchObject({
      bubbleId: "b_auto_rework_test",
      recipientRole: "implementer",
      messageRef: "artifact://transcript.ndjson#env_auto_rework_01",
      envelope: { id: "env_auto_rework_01" }
    });
  });

  it("retries auto-rework delivery once with warm-up options on pane_not_ready", async () => {
    let callCount = 0;
    const initialDelayValues: (number | undefined)[] = [];

    const dependencies: MetaReviewCommandDependencies = {
      emitDeliveryNotification: async (input) => {
        callCount++;
        initialDelayValues.push(input.initialDelayMs);
        if (callCount === 1) {
          return {
            status: "rejected" as const,
            message: "unconfirmed",
            reason: "delivery_unconfirmed" as const,
            reason_code: "DELIVERY_ACK_REJECTED" as const
          } satisfies DeliveryAck;
        }
        return {
          status: "accepted" as const,
          message: "retry ok",
          sessionName: "pf_bubble",
          targetPaneIndex: 1
        } satisfies DeliveryAck;
      },
      buildDeliveryMessageRef: () => "artifact://transcript.ndjson#env_auto_rework_01"
    };

    await finalizeMetaReviewSubmitResult({
      resolved: buildMinimalResolved(),
      routed: buildMinimalRouted("auto_rework"),
      dependencies,
      canonicalRunResult: buildMinimalCanonicalRunResult(),
      canonicalReportJson: {}
    });

    expect(callCount).toBe(2);
    expect(initialDelayValues[1]).toBe(30000);
  });

  it("throws MetaReviewError when emitDeliveryNotification is missing on auto_rework route", async () => {
    const dependencies: MetaReviewCommandDependencies = {
      buildDeliveryMessageRef: () => "artifact://transcript.ndjson#env_auto_rework_01"
      // emitDeliveryNotification intentionally missing
    };

    let thrown: unknown;
    try {
      await finalizeMetaReviewSubmitResult({
        resolved: buildMinimalResolved(),
        routed: buildMinimalRouted("auto_rework"),
        dependencies,
        canonicalRunResult: buildMinimalCanonicalRunResult(),
        canonicalReportJson: {}
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      reasonCode: "META_REVIEW_UNKNOWN_ERROR",
      context: {
        source: "meta_review_command_submit_routing",
        reason: "auto_rework_delivery_capabilities_unavailable"
      }
    });
  });

  it("throws MetaReviewError when buildDeliveryMessageRef is missing on auto_rework route", async () => {
    const dependencies: MetaReviewCommandDependencies = {
      emitDeliveryNotification: async () =>
        ({
          status: "accepted" as const,
          message: "ok"
        }) satisfies DeliveryAck
      // buildDeliveryMessageRef intentionally missing
    };

    let thrown: unknown;
    try {
      await finalizeMetaReviewSubmitResult({
        resolved: buildMinimalResolved(),
        routed: buildMinimalRouted("auto_rework"),
        dependencies,
        canonicalRunResult: buildMinimalCanonicalRunResult(),
        canonicalReportJson: {}
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      reasonCode: "META_REVIEW_UNKNOWN_ERROR",
      context: {
        source: "meta_review_command_submit_routing",
        reason: "auto_rework_delivery_capabilities_unavailable"
      }
    });
  });

  it("does not call emitDeliveryNotification when route is not auto_rework", async () => {
    let deliveryCallCount = 0;

    const dependencies: MetaReviewCommandDependencies = {
      emitDeliveryNotification: async () => {
        deliveryCallCount++;
        return {
          status: "accepted" as const,
          message: "should not be called"
        } satisfies DeliveryAck;
      },
      buildDeliveryMessageRef: () => "artifact://transcript.ndjson#env_auto_rework_01"
    };

    await finalizeMetaReviewSubmitResult({
      resolved: buildMinimalResolved(),
      routed: buildMinimalRouted("human_gate_approve"),
      dependencies,
      canonicalRunResult: buildMinimalCanonicalRunResult(),
      canonicalReportJson: {}
    });

    expect(deliveryCallCount).toBe(0);
  });
});
