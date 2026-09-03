import { describe, expect, it, vi } from "vitest";

import {
  buildTranscriptFallbackRef,
  emitDeliveryNotificationAck as emitDeliveryNotificationAckRuntime,
  resolveDeliveryMessageRef,
  retryStuckAgentInput
} from "../../../src/v11/infrastructure/channel/tmux/tmuxDelivery.js";
import {
  attemptTmuxDelivery,
  createAcceptedDeliveryAck,
  createRejectedDeliveryAck,
  type TmuxDeliveryTimingOptions
} from "../../../src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.js";
import {
  resolveEnvelopeTargetPane
} from "../../../src/v11/infrastructure/channel/tmux/tmuxDeliveryTargeting.js";
import { BubbleWatchdogError } from "../../../src/v11/shared/watchdog/watchdogCommandError.js";
import {
  REVIEWER_COMMAND_GATE_FORBIDDEN,
  REVIEWER_COMMAND_GATE_REQ_A,
  REVIEWER_COMMAND_GATE_REQ_C,
  REVIEWER_COMMAND_GATE_REQ_E
} from "../../../src/v11/shared/reviewer/reviewerCommandGateGuidance.js";
import type {
  RuntimeSessionRecord,
  RuntimeSessionsRegistry
} from "../../../src/v11/ports/runtimeSessions.js";
import {
  runtimePaneIndices,
  type TmuxRunResult,
  type TmuxRunner
} from "../../../src/v11/infrastructure/channel/tmux/tmuxManager.js";
import {
  topologySlotPaneIndexCatalog
} from "../../../src/v11/shared/topology/topologySlotPaneProjection.js";
import * as topologySlotPaneProjection from "../../../src/v11/shared/topology/topologySlotPaneProjection.js";
import type { ReviewerTestExecutionDirective } from "../../../src/v11/shared/reviewer/testEvidence.js";
import {
  resolveUniquelyConfiguredRoleForAgent
} from "../../../src/v11/domain/agentIdentity/agentIdentity.js";
import type { BubbleConfig } from "../../../src/v11/shared/config/bubbleConfigTypes.js";
import {
  deliveryTargetRoleMetadataKey,
  parseDeliveryTargetRoleMetadata,
  type DeliveryTargetRole
} from "../../../src/v11/shared/delivery/deliveryTargetMetadataContract.js";
import type { LegacyMetaReviewerProtocolRecipient } from "../../../src/v11/shared/protocol/legacyMetaReviewerRecipientContract.js";
import type { ProtocolEnvelope } from "../../../src/v11/shared/protocol/protocolEnvelopeContract.js";

const baseConfig: BubbleConfig = {
  id: "b_delivery_01",
  repo_path: "/tmp/repo",
  base_branch: "main",
  bubble_branch: "pf/b_delivery_01",
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
  notifications: {
    enabled: true
  },
  doc_contract_gates: {
    round_gate_applies_after: 2
  }
};

function createEnvelope(overrides: Partial<ProtocolEnvelope> = {}): ProtocolEnvelope {
  return {
    id: "msg_20260222_101",
    ts: "2026-02-22T12:00:00.000Z",
    bubble_id: "b_delivery_01",
    sender: "opencode",
    recipient: "opencode",
    type: "PASS",
    round: 1,
    payload: {
      summary: "handoff"
    },
    refs: ["artifact://handoff.md"],
    ...overrides
  } as ProtocolEnvelope;
}

function submittedPaneOutput(markerLine: string): string {
  return ["Ask anything...", markerLine, "", ">"].join("\n");
}

// Wraps a marker line with opencode readiness indicators so that
// waitForOpencodePaneReady returns true on the first capture-pane call.
function submittedOpencodeReadyPaneOutput(markerLine: string): string {
  return ["Ask anything...", submittedPaneOutput(markerLine)].join("\n");
}

type CompatProtocolEnvelope = Omit<ProtocolEnvelope, "recipient"> & {
  recipient: ProtocolEnvelope["recipient"] | LegacyMetaReviewerProtocolRecipient;
};

type RuntimeSessionRecordOverrides = {
  [Key in keyof RuntimeSessionRecord]?: RuntimeSessionRecord[Key] | undefined;
};

function createRegistry(
  overrides: RuntimeSessionRecordOverrides = {}
): RuntimeSessionsRegistry {
  const record = {
    bubbleId: "b_delivery_01",
    repoPath: "/tmp/repo",
    worktreePath: "/tmp/worktree",
    workspacePath: "/tmp/worktree",
    workspaceKind: "worktree" as const,
    tmuxSessionName: "pf-b_delivery_01",
    updatedAt: "2026-02-22T12:00:00.000Z",
    ...overrides
  };
  return {
    b_delivery_01: {
      bubbleId: record.bubbleId ?? "b_delivery_01",
      repoPath: record.repoPath ?? "/tmp/repo",
      worktreePath: record.worktreePath ?? "/tmp/worktree",
      ...(record.workspacePath !== undefined
        ? { workspacePath: record.workspacePath }
        : {}),
      ...(record.workspaceKind !== undefined
        ? { workspaceKind: record.workspaceKind }
        : {}),
      tmuxSessionName: record.tmuxSessionName ?? "pf-b_delivery_01",
      updatedAt: record.updatedAt ?? "2026-02-22T12:00:00.000Z"
    }
  };
}

function mockUnmappedMetaReviewerPane(): {
  restore: () => void;
} {
  const getTopologySlotPaneIndexSpy = vi.spyOn(
    topologySlotPaneProjection,
    "getSharedTopologySlotPaneIndex"
  );
  const getTopologySlotPaneIndexForRoleSpy = vi.spyOn(
    topologySlotPaneProjection,
    "getSharedTopologySlotPaneIndexForRole"
  );

  getTopologySlotPaneIndexSpy.mockImplementation((slotId) => {
    switch (slotId) {
      case "meta_reviewer":
        return undefined as unknown as number;
      case "status":
        return topologySlotPaneIndexCatalog.status;
      case "implementer":
        return topologySlotPaneIndexCatalog.implementer;
      case "reviewer":
        return topologySlotPaneIndexCatalog.reviewer;
    }
  });
  getTopologySlotPaneIndexForRoleSpy.mockImplementation((role) => {
    switch (role) {
      case "meta_reviewer":
        return undefined as unknown as number;
      case "implementer":
        return topologySlotPaneIndexCatalog.implementer;
      case "reviewer":
        return topologySlotPaneIndexCatalog.reviewer;
    }
  });

  return {
    restore: () => {
      getTopologySlotPaneIndexSpy.mockRestore();
      getTopologySlotPaneIndexForRoleSpy.mockRestore();
    }
  };
}

function createSharedAgentConfig(
  agent: "opencode"    
): BubbleConfig {
  return {
    ...baseConfig,
    agents: {
      implementer: agent,
      reviewer: agent,
      meta_reviewer: "opencode"
    }
  };
}

type TestEmitDeliveryNotificationInput =
  Omit<Parameters<typeof emitDeliveryNotificationAckRuntime>[0], "recipientRole"> & {
    recipientRole?: DeliveryTargetRole;
  };

const fastDeliveryTiming: TmuxDeliveryTimingOptions = {
  sleepForDelayMs: () => Promise.resolve(),
  submitDelayMs: 0,
  markerSettleDelayMs: 0,
  markerRetryDelayMs: 0
};

function resolveLegacyRecipientRoleForTest(input: {
  envelope: CompatProtocolEnvelope;
  bubbleConfig: BubbleConfig;
}): DeliveryTargetRole | undefined {
  const parsed = parseDeliveryTargetRoleMetadata(input.envelope.payload.metadata);
  if (parsed.status === "valid") {
    return parsed.role;
  }
  if (input.envelope.recipient === "human" || input.envelope.recipient === "orchestrator") {
    return "status";
  }
  if (input.envelope.recipient === "meta-reviewer") {
    return "meta_reviewer";
  }
  if (input.envelope.recipient === "opencode" || input.envelope.recipient === "reasonix") {
    return resolveUniquelyConfiguredRoleForAgent({
      agents: input.bubbleConfig.agents,
      agent: input.envelope.recipient,
      roles: ["implementer", "reviewer"]
    });
  }
  return undefined;
}

async function emitDeliveryNotificationAck(
  input: TestEmitDeliveryNotificationInput
) {
  return emitDeliveryNotificationAckRuntime({
    ...input,
    deliveryTiming: input.deliveryTiming ?? fastDeliveryTiming,
    ...(input.recipientRole !== undefined
      ? { recipientRole: input.recipientRole }
      : (() => {
          const resolvedRole = resolveLegacyRecipientRoleForTest({
            envelope: input.envelope,
            bubbleConfig: input.bubbleConfig
          });
          return resolvedRole !== undefined ? { recipientRole: resolvedRole } : {};
        })())
  });
}

function expectStringOccurrence(
  text: string | undefined,
  snippet: string,
  expectedCount: number
): void {
  expect(text).toBeDefined();
  const actualCount = (text ?? "").split(snippet).length - 1;
  expect(actualCount).toBe(expectedCount);
}

function expectNoForbiddenReviewerCommandGateTokens(text: string | undefined): void {
  expect(text).toBeDefined();
  for (const forbiddenToken of REVIEWER_COMMAND_GATE_FORBIDDEN) {
    expect(text).not.toContain(forbiddenToken);
  }
}


describe("tmux delivery canonical ack helpers", () => {
  it("creates canonical accepted and rejected acknowledgements", () => {
    const acceptedInput = {
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      message: "handoff delivered",
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_INVALID" as const
    };
    const rejectedInput = {
      reason: "unsupported_recipient" as const,
      message: "handoff blocked",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED" as const
    };

    expect(createAcceptedDeliveryAck(acceptedInput)).toEqual({
      status: "accepted",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      message: "handoff delivered",
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_INVALID"
    });
    expect(createRejectedDeliveryAck(rejectedInput)).toEqual({
      status: "rejected",
      reason: "unsupported_recipient",
      reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      message: "handoff blocked",
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
    });
  });

  it("covers every canonical delivery ack union member", () => {
    const canonicalCases = [
      {
        title: "accepted",
        ack: createAcceptedDeliveryAck({
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff delivered",
          deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_INVALID"
        }),
        expectedAck: {
          status: "accepted",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff delivered",
          deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_INVALID"
        }
      },
      {
        title: "no_runtime_session",
        ack: createRejectedDeliveryAck({
          reason: "no_runtime_session",
          message: "handoff blocked 0",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2
        }),
        expectedAck: {
          status: "rejected",
          reason: "no_runtime_session",
          reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff blocked 0"
        }
      },
      {
        title: "registry_read_failed",
        ack: createRejectedDeliveryAck({
          reason: "registry_read_failed",
          message: "handoff blocked 1"
        }),
        expectedAck: {
          status: "rejected",
          reason: "registry_read_failed",
          reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
          message: "handoff blocked 1"
        }
      },
      {
        title: "unsupported_recipient",
        ack: createRejectedDeliveryAck({
          reason: "unsupported_recipient",
          message: "handoff blocked 2",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
        }),
        expectedAck: {
          status: "rejected",
          reason: "unsupported_recipient",
          reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff blocked 2",
          deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
        }
      },
      {
        title: "delivery_unconfirmed",
        ack: createRejectedDeliveryAck({
          reason: "delivery_unconfirmed",
          message: "handoff blocked 3",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2
        }),
        expectedAck: {
          status: "rejected",
          reason: "delivery_unconfirmed",
          reason_code: "DELIVERY_ACK_REJECTED",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff blocked 3"
        }
      },
      {
        title: "command_failed",
        ack: createRejectedDeliveryAck({
          reason: "command_failed",
          message: "handoff blocked 4",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2
        }),
        expectedAck: {
          status: "rejected",
          reason: "command_failed",
          reason_code: "DELIVERY_ACK_REJECTED",
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2,
          message: "handoff blocked 4"
        }
      }
    ] as const;

    for (const canonicalCase of canonicalCases) {
      expect(canonicalCase.ack, canonicalCase.title).toEqual(canonicalCase.expectedAck);
    }
  });
});

describe("tmux delivery explicit recipient-role routing", () => {
  it("keeps bare agent recipients from implicitly resolving meta-review routing", async () => {
    const resolution = resolveEnvelopeTargetPane(
      createEnvelope({
        id: "msg_20260222_100",
        sender: "orchestrator",
        recipient: "opencode",
        type: "TASK",
        payload: {
          summary: "Meta-review fallback route."
        },
        refs: ["artifact://meta-review-task.md"]
      }),
      createSharedAgentConfig("opencode")
    );

    expect(resolution).toEqual({
      targetPaneIndex: undefined,
      recipientRole: "opencode",
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_ABSENT"
    });
  });

  it("routes explicit meta-reviewer delivery input without relying on envelope metadata", async () => {
    const runner: TmuxRunner = vi.fn(async (args: string[]): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return {
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const ack = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      envelope: createEnvelope({
        recipient: "opencode",
        payload: {
          summary: "handoff"
        }
      }),
      recipientRole: "meta_reviewer",
      readSessionsRegistry: async () =>
        createRegistry({
          tmuxSessionName: "pf-b_delivery_01",
          workspacePath: "/tmp/worktree"
        }),
      runner
    });

    expect(ack).toMatchObject(
      createAcceptedDeliveryAck({
        sessionName: "pf-b_delivery_01",
        targetPaneIndex: runtimePaneIndices.metaReviewer,
        message: ack.message
      })
    );
    expect(runner).toHaveBeenCalledWith(
      [
        "send-keys",
        "-t",
        `pf-b_delivery_01:0.${String(runtimePaneIndices.metaReviewer)}`,
        "-l",
        expect.stringContaining("Meta-review task received.")
      ],
      {
        allowFailure: true
      }
    );
  });

  it("keeps explicit recipient-role authority ahead of conflicting envelope metadata", async () => {
    const runner = vi.fn(async (args: string[]): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return {
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_102 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const ack = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      envelope: createEnvelope({
        recipient: "opencode",
        payload: {
          summary: "handoff",
          metadata: {
            delivery_target_role: "meta_reviewer"
          }
        }
      }),
      recipientRole: "implementer",
      readSessionsRegistry: async () =>
        createRegistry({
          tmuxSessionName: "pf-b_delivery_01",
          workspacePath: "/tmp/worktree"
        }),
      runner
    });

    expect(ack.sessionName).toBe("pf-b_delivery_01");
    expect(ack.targetPaneIndex).toBe(runtimePaneIndices.implementer);
    expect(
      runner.mock.calls.some(
        (call) =>
          call[0][0] === "send-keys"
          && call[0][2] === `pf-b_delivery_01:0.${String(runtimePaneIndices.implementer)}`
      )
    ).toBe(true);
  });
});

describe("emitDeliveryNotificationAck", () => {
  it("returns an accepted canonical acknowledgement from runtime truth", async () => {
    const createRunner = (): TmuxRunner => (args) => {
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }

      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };
    const sharedInput = {
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    };

    const canonicalAck = await emitDeliveryNotificationAck({
      ...sharedInput,
      recipientRole: "reviewer",
      runner: createRunner()
    });

    expect(canonicalAck).toMatchObject(
      createAcceptedDeliveryAck({
        sessionName: "pf-b_delivery_01",
        targetPaneIndex: 2,
        message: canonicalAck.message
      })
    );
    expect(canonicalAck.message).toContain(
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
    );
  });

  it("fails closed with no_runtime_session before any tmux side effect", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: () => Promise.resolve({})
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "no_runtime_session",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE"
    });
    expect(calls).toHaveLength(0);
  });

  it("returns unsupported_recipient canonical ack when no pane can be resolved", async () => {
    const metaReviewerPaneMock = mockUnmappedMetaReviewerPane();
    try {
      const calls: string[][] = [];
      const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
        calls.push(args);
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      };
      const result = await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: createSharedAgentConfig("opencode"),
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope: createEnvelope({
          id: "msg_20260222_401",
          sender: "orchestrator",
          recipient: "opencode",
          type: "TASK",
          payload: {
            summary: "Unmapped explicit + unsupported legacy route.",
            metadata: {
              [deliveryTargetRoleMetadataKey]: "meta_reviewer"
            }
          },
          refs: ["artifact://meta-review-task.md"]
        }),
        runner,
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      });

      expect(result).toMatchObject({
        status: "rejected",
        reason: "unsupported_recipient",
        reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
        sessionName: "pf-b_delivery_01",
        deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
      });
      expect(calls).toHaveLength(0);
    } finally {
      metaReviewerPaneMock.restore();
    }
  });

  it("returns registry_read_failed canonical ack before any tmux side effect", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: async () => Promise.reject(new Error("invalid json"))
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "registry_read_failed",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
      deliveryTargetReasonCode: "DELIVERY_TARGET_REGISTRY_READ_FAILED"
    });
    expect(calls).toHaveLength(0);
  });

  it("keeps registry_read_failed message on explicit meta-review role even when the pane is unmapped", async () => {
    const metaReviewerPaneMock = mockUnmappedMetaReviewerPane();
    try {
      const calls: string[][] = [];
      const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
        calls.push(args);
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      };

      const result = await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: createSharedAgentConfig("opencode"),
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope: createEnvelope({
          id: "msg_20260222_402",
          sender: "orchestrator",
          recipient: "opencode",
          type: "TASK",
          payload: {
            summary: "Meta-review task should keep explicit recipient-role guidance.",
            metadata: {
              [deliveryTargetRoleMetadataKey]: "meta_reviewer"
            }
          },
          refs: ["artifact://meta-review-task.md"]
        }),
        runner,
        readSessionsRegistry: async () => Promise.reject(new Error("invalid json"))
      });

      expect(result).toMatchObject({
        status: "rejected",
        reason: "registry_read_failed",
        reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
        deliveryTargetReasonCode: "DELIVERY_TARGET_REGISTRY_READ_FAILED"
      });
      expect(result.message).toContain("Meta-review task received.");
      expect(calls).toHaveLength(0);
    } finally {
      metaReviewerPaneMock.restore();
    }
  });

  it("returns command_failed canonical ack when the tmux delivery command throws", async () => {
    const runner: TmuxRunner = () => Promise.reject(new Error("tmux unavailable"));

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result).toMatchObject({
      status: "rejected",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      reason: "command_failed",
      reason_code: "DELIVERY_ACK_REJECTED"
    });
    expect(result.message).toContain(
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
    );
  });

  it("respawns the target opencode pane before delivery when opencode is not running", async () => {
    const calls: string[][] = [];
    let respawned = false;
    let captureCount = 0;
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "respawn-pane") {
        respawned = true;
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      }
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (!respawned) {
          return Promise.resolve({
            stdout: "sh prompt",
            stderr: "",
            exitCode: 0
          });
        }
        if (respawned && captureCount <= 4) {
          return Promise.resolve({
            stdout: [
              "Ask anything...",
              "Build · Qwen3.6 35B a3b-mtp Q6 XL (Reviewer) LM Studio (local)",
              "tab agents  ctrl+p commands"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          });
        }
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        recipient: "opencode"
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(
      calls.some(
        (call) =>
          call[0] === "respawn-pane"
          && call[3] === "pf-b_delivery_01:0.2"
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2"
      )
    ).toBe(true);
  });

  it("accepts delivery when opencode pane capture indicates live OpenCode despite shell command name", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            [
              "Ask anything...",
              "Build · Qwen3.6 35B a3b-mtp Q6 XL (Reviewer) LM Studio (local)",
              "tab agents  ctrl+p commands",
              submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.")
            ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        recipient: "opencode"
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(
      calls.some(
        (call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2"
      )
    ).toBe(true);
  });

  it("continues delivery after successful opencode respawn when pane identity probes remain stale", async () => {
    const calls: string[][] = [];
    let respawned = false;
    let captureCount = 0;
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "respawn-pane") {
        respawned = true;
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      }
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (!respawned) {
          return Promise.resolve({
            stdout: "sh prompt",
            stderr: "",
            exitCode: 0
          });
        }
        if (respawned && captureCount <= 4) {
          return Promise.resolve({
            stdout: [
              "Ask anything...",
              "Build · Qwen3.6 35B a3b-mtp Q6 XL (Reviewer) LM Studio (local)",
              "tab agents  ctrl+p commands"
            ].join("\n"),
            stderr: "",
            exitCode: 0
          });
        }
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        recipient: "opencode"
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(respawned).toBe(true);
    expect(result.status).toBe("accepted");
    expect(
      calls.some(
        (call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2"
      )
    ).toBe(true);
    // opencode delivery must not /clear (watchdog-matching): a /clear would
    // open an opencode confirmation modal that swallows the handover message.
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "/clear")
    ).toBe(false);
  });
});

describe("tmux delivery T6 runtime observability baseline", () => {
  it("keeps pane visibility and marker/session inspection diagnostics-only without an explicit accepted ack", async () => {
    // Helper-level T6 coverage. The facade-level emitDeliveryNotificationAck
    // scenario later in this file proves the same baseline through the public
    // delivery surface so the two tests stay intentionally complementary.
    const calls: string[][] = [];
    const targetPane = "pf-b_delivery_01:0.2";
    const message =
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.";
    const expectedCapturePaneCall = [
      "capture-pane",
      "-p",
      "-S",
      "-200",
      "-t",
      targetPane
    ];
    const expectedMessageWriteCall = ["send-keys", "-t", targetPane, "-l", message];
    const expectedEnterCall = ["send-keys", "-t", targetPane, "Enter"];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            "accepted=true running=true handoff_id=handoff_advanced_02 actor acknowledged work",
          stderr: "",
          exitCode: 0
        });
      }

      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    // Fake timers keep the helper's sleep-based confirmation path deterministic.
    vi.useFakeTimers();
    try {
      const resultPromise = attemptTmuxDelivery({
        runner,
        targetPane,
        envelopeId: "msg_20260222_101",
        message,
        sessionName: "pf-b_delivery_01",
        targetPaneIndex: 2,
        // This test isolates the first-attempt fail-closed path; retry behavior
        // is covered separately by the retry-focused scenarios below.
        deliveryAttempts: 1
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const capturePaneCalls = calls.filter((call) => call[0] === "capture-pane");
      const messageWriteCalls = calls.filter(
        (call) => call[0] === "send-keys" && call[3] === "-l"
      );
      const enterCalls = calls.filter(
        (call) => call[0] === "send-keys" && call[3] === "Enter" && call.length === 4
      );

      expect(messageWriteCalls).toEqual([expectedMessageWriteCall]);
      expect(enterCalls).toEqual([expectedEnterCall]);
      expect(capturePaneCalls.length).toBeGreaterThanOrEqual(1);
      expect(capturePaneCalls).toContainEqual(expectedCapturePaneCall);
      expect(result).toEqual(
        createRejectedDeliveryAck({
          reason: "delivery_unconfirmed",
          message,
          sessionName: "pf-b_delivery_01",
          targetPaneIndex: 2
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("emitDeliveryNotificationAck", () => {
  it("mentions meta-reviewer gate context for approval requests tagged with actor metadata", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 APPROVAL_REQUEST orchestrator->opencode msg=msg_20260222_102 ref=artifact://approval.md. Action: Bubble is READY_FOR_HUMAN_APPROVAL after meta-reviewer gate."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_102",
        type: "APPROVAL_REQUEST",
        sender: "orchestrator",
        recipient: "opencode",
        round: 2,
        payload: {
          summary: "Waiting for human decision",
          metadata: {
            actor: "meta-reviewer",
            latest_recommendation: "inconclusive"
          }
        },
        refs: ["artifact://approval.md"]
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result.status).toBe("accepted");
    const messageCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l" &&
        call[4]?.includes("[pairflow] r2 APPROVAL_REQUEST orchestrator->opencode")
    );
    expect(messageCall?.[4]).toContain(
      "Meta-reviewer requested human gate decision"
    );
  });

  it("prioritizes explicit delivery target role over recipient agent matching", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 TASK orchestrator->codex msg=msg_20260222_201 ref=artifact://meta-review-task.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...createSharedAgentConfig("opencode"),
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_201",
        sender: "orchestrator",
        recipient: "opencode",
        type: "TASK",
        payload: {
          summary: "Run meta-review now.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "meta_reviewer"
          }
        },
        refs: ["artifact://meta-review-task.md"]
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(3);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.3")
    ).toBe(true);
    const sendKeysCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.3" &&
        call[3] === "-l"
    );
    const messageCallText = sendKeysCalls.map((call) => call[4] || "").join("");
    // OVERFLOW_2: opencode meta-reviewer receives minimal action text only.
    expect(messageCallText).toContain("Meta-review task received.");
    expect(messageCallText).toContain(
      "Produce autonomous meta-review output"
    );
    // Should NOT contain command templates or parity notes for opencode (OVERFLOW_2)
    expect(messageCallText).not.toContain("--report-json");
    expect(messageCallText).not.toContain("`pairflow agent emit");
  });

  it("falls back to the unique recipient lane when delivery_target_role metadata is invalid", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_202 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        agents: {
          implementer: "opencode",
          reviewer: "manual",
          meta_reviewer: "manual"
        } as never
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_202",
        sender: "opencode",
        recipient: "opencode",
        payload: {
          summary: "Fallback expected.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "meta-reviewer"
          }
        }
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(1);
    expect(result.deliveryTargetReasonCode).toBeUndefined();
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.1")
    ).toBe(true);
  });

  it("fail-closes ambiguous shared-agent fallback when delivery_target_role metadata is invalid", async () => {
    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_202_shared",
        sender: "opencode",
        recipient: "opencode",
        payload: {
          summary: "Ambiguous fallback must fail closed.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "meta-reviewer"
          }
        }
      }),
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "unsupported_recipient",
      reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
      deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_INVALID"
    });
  });

  it("fail-closes metadata-derived meta-review routing when the meta-review pane is unmapped", async () => {
    const metaReviewerPaneMock = mockUnmappedMetaReviewerPane();
    try {
      const calls: string[][] = [];
      const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
        calls.push(args);
        if (args[0] === "capture-pane") {
          return Promise.resolve({
            stdout:
              submittedOpencodeReadyPaneOutput("[pairflow] r1 TASK orchestrator->opencode msg=msg_20260222_203 ref=artifact://meta-review-task.md."),
            stderr: "",
            exitCode: 0
          });
        }
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      };

      const result = await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: createSharedAgentConfig("opencode"),
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope: createEnvelope({
          id: "msg_20260222_203",
          sender: "orchestrator",
          recipient: "opencode",
          type: "TASK",
          payload: {
            summary: "Meta-review dispatch fallback expected.",
            metadata: {
              [deliveryTargetRoleMetadataKey]: "meta_reviewer"
            }
          },
          refs: ["artifact://meta-review-task.md"]
        }),
        runner,
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      });

      expect(result).toEqual({
        status: "rejected",
        reason: "unsupported_recipient",
        reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
        sessionName: "pf-b_delivery_01",
        message: result.message,
        deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
      });
      expect(calls).toHaveLength(0);
    } finally {
      metaReviewerPaneMock.restore();
    }
  });

  it("fail-closes explicit meta-review routing when the meta-reviewer pane is unmapped", async () => {
    const metaReviewerPaneMock = mockUnmappedMetaReviewerPane();
    try {
      const result = await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: baseConfig,
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope: createEnvelope({
          recipient: "opencode",
          payload: {
            summary: "Explicit meta-review route must fail closed."
          }
        }),
        recipientRole: "meta_reviewer",
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      });

      expect(result).toEqual({
        status: "rejected",
        reason: "unsupported_recipient",
        reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
        sessionName: "pf-b_delivery_01",
        message: result.message,
        deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
      });
    } finally {
      metaReviewerPaneMock.restore();
    }
  });

  it("keeps role-target routing parity for shared opencode agent identities", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_204 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_204",
        sender: "opencode",
        recipient: "opencode",
        payload: {
          summary: "Route to reviewer pane.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "reviewer"
          }
        }
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(2);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2")
    ).toBe(true);
  });

  it("routes HUMAN_REPLY to the explicit active role pane when agent identity is shared", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 HUMAN_REPLY human->opencode msg=msg_20260222_205 ref=artifact://reply.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_205",
        sender: "human",
        recipient: "opencode",
        type: "HUMAN_REPLY",
        round: 2,
        payload: {
          message: "Please continue reviewer analysis.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "reviewer"
          }
        },
        refs: ["artifact://reply.md"]
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(2);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2")
    ).toBe(true);
  });

  it("routes PASS delivery to recipient agent pane with compact policy handoff in fresh mode", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const reviewerTestDirective: ReviewerTestExecutionDirective = {
      skip_full_rerun: true,
      reason_code: "no_trigger",
      reason_detail: "Evidence is verified, fresh, and complete.",
      verification_status: "trusted"
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      reviewerTestDirective,
      reviewerBrief: "Verify factual claims against cited sources.",
      reviewerFocus: {
        status: "present",
        source: "section",
        focus_text: "- Validate reason-code fallback behavior",
        focus_items: ["Validate reason-code fallback behavior"]
      },
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result.status).toBe("accepted");
    expect(result.sessionName).toBe("pf-b_delivery_01");
    expect(result.targetPaneIndex).toBe(2);
    expect(result.deliveryTargetReasonCode).toBeUndefined();
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "-l",
      expect.stringContaining(
        "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
      )
    ]);
    const sendKeysCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const messageCallText = sendKeysCalls.map((call) => call[4] || "").join("");
    // OVERFLOW_1: opencode reviewer receives minimal handoff + test directive only.
    expect(messageCallText).toContain(
      "Action: Implementer handoff received. Run a fresh review now"
    );
    expect(messageCallText).toContain(
      "Implementer test evidence has been orchestrator-verified. Do not re-run full tests unless a trigger from the decision matrix applies."
    );
    // Decision matrix reminder is part of formatReviewerTestExecutionDirective (kept for opencode)
    expectStringOccurrence(
      messageCallText,
      "Decision matrix triggers that still require tests:",
      1
    );
    expect(messageCallText).toContain("Reason: Evidence is verified, fresh, and complete.");
    // OVERFLOW_1 omits: ontology, policy file, scout workflow, output contract, command gates, brief/focus reminders.
    expect(messageCallText).not.toContain("Severity Ontology v1 reminder");
    expect(messageCallText).not.toContain(
      "Reviewer policy file: /tmp/repo/.pairflow/bubbles/b_delivery_01/artifacts/reviewer-policy-snapshot.md"
    );
    expect(messageCallText).not.toContain("`Scout Coverage`");
    expect(messageCallText).not.toContain("Required reviewer output contract (machine-checkable)");
    expect(messageCallText).not.toContain(REVIEWER_COMMAND_GATE_REQ_A);
    expect(messageCallText).not.toContain(
      "Reviewer brief reminder (from reviewer-brief.md): Verify factual claims against cited sources."
    );
    expect(messageCallText).not.toContain(
      "Reviewer focus reminder (bridged from reviewer-focus.json)"
    );
    expect(messageCallText).not.toContain(REVIEWER_COMMAND_GATE_REQ_C);
    expect(messageCallText).not.toContain(REVIEWER_COMMAND_GATE_REQ_E);
    expectNoForbiddenReviewerCommandGateTokens(messageCallText);
    // Phase 4: opencode agents receive minimal messages without workspace guidance
    expect(messageCallText).not.toContain(
      "Run pairflow commands from workspace root:"
    );
    // Message must NOT embed CR/LF — Enter is sent as a separate tmux command.
    expect(messageCallText).not.toMatch(/[\r\n]$/);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
    expect(calls).toContainEqual([
      "capture-pane",
      "-pt",
      "pf-b_delivery_01:0.2"
    ]);
  });

  it("omits reviewer focus reminder text when reviewer focus status is absent", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh"
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      reviewerFocus: {
        status: "absent",
        source: "none",
        reason_code: "REVIEWER_FOCUS_ABSENT"
      },
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result.status).toBe("accepted");
    const messageCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l" &&
        call[4]?.includes("[pairflow] r1 PASS opencode->opencode")
    );
    expect(messageCall?.[4]).toContain(
      "Action: Implementer handoff received. Run a fresh review now"
    );
    expect(messageCall?.[4]).not.toContain(
      "Reviewer focus reminder (bridged from reviewer-focus.json):"
    );
    expect(messageCall?.[4]).not.toContain("reviewer-focus.json):");
  });

  it("keeps delivery success transport-only even when confirmed pane output contains acceptance-like tokens", async () => {
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received.\naccepted=true running=true handoff_id=handoff_advanced_02 actor acknowledged work"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "opencode",
        recipient: "opencode",
        type: "PASS",
        payload: {
          summary: "Please apply reviewer fixes."
        }
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.sessionName).toBe("pf-b_delivery_01");
    expect(result.targetPaneIndex).toBe(2);
    expect(result.message).toContain(
      "Implementer handoff received. Run a fresh review now."
    );
    expect(result).not.toHaveProperty("reason");
    expect(result).not.toHaveProperty("reason_code");
    expect(Object.keys(result).sort()).toEqual([
      "message",
      "sessionName",
      "status",
      "targetPaneIndex"
    ]);
  });

  it("does not treat acceptance-like pane output as canonical delivery when the pairflow marker is missing", { timeout: 5_000 }, async () => {
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            "Ask anything...\naccepted=true running=true handoff_id=handoff_advanced_02 actor acknowledged work",
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        payload: {
          summary: "handoff",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "reviewer"
          }
        }
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 1
    });

    expect(result.status).toBe("rejected");
    expect(result.sessionName).toBe("pf-b_delivery_01");
    expect(result.targetPaneIndex).toBe(2);
    expect(result.message).toContain(
      "Implementer handoff received. Run a fresh review now."
    );
    expect(result.reason).toBe("delivery_unconfirmed");
  });

  it("renders docs-only skip directive reason without extra tmux formatting changes", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const reviewerTestDirective: ReviewerTestExecutionDirective = {
      skip_full_rerun: true,
      reason_code: "no_trigger",
      reason_detail: "docs-only scope, runtime checks not required",
      verification_status: "trusted"
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        review_artifact_type: "document",
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      reviewerTestDirective,
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    const sendKeysCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const messageCallText = sendKeysCalls.map((call) => call[4] || "").join("");
    // OVERFLOW_1: opencode reviewer receives minimal handoff + test directive only.
    expect(messageCallText).toContain(
      "Implementer handoff received. Run a fresh review now"
    );
    expect(messageCallText).toContain(
      "Implementer test evidence has been orchestrator-verified."
    );
    expect(messageCallText).toContain(
      "Reason: docs-only scope, runtime checks not required"
    );
    // OVERFLOW_1 omits validation claim guardrails (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(messageCallText);
  });

  it("keeps concise ontology reminder in persistent reviewer context mode", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "persistent",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const sendKeysCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const messageCallText = sendKeysCalls.map((call) => call[4] || "").join("");

    // OVERFLOW_1: opencode reviewer receives minimal handoff + fallback directive (no decision matrix for persistent mode).
    expect(messageCallText).toContain(
      "Implementer handoff received. Run a fresh review now"
    );
    expect(messageCallText).toContain(
      "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable."
    );
    // OVERFLOW_1 omits: ontology, scout workflow, output contract, command gates (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(messageCallText);
  });

  it("injects clean-path round>=2 command gate for reviewer handoff", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 PASS opencode->opencode msg=msg_20260222_102 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_102",
        round: 2
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");

    // OVERFLOW_1: opencode reviewer receives minimal text with decision matrix reminder (fresh mode).
    expect(fullMessage).toContain(
      "Implementer handoff received. Run a fresh review now"
    );
    expect(fullMessage).toContain(
      "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable."
    );
    // Decision matrix reminder is included for fresh mode (part of OVERFLOW_1 fallback)
    expectStringOccurrence(
      fullMessage,
      "Decision matrix triggers that still require tests:",
      1
    );
    // OVERFLOW_1 omits command gate projections (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("injects findings-path round>=2 command gate for reviewer handoff", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 PASS opencode->opencode msg=msg_20260222_103 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_103",
        round: 2,
        payload: {
          summary: "handoff with explicit findings context",
          findings: [
            {
              severity: "P2",
              title: "existing finding context"
            }
          ]
        }
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");

    // OVERFLOW_1: opencode reviewer receives minimal text with decision matrix reminder (fresh mode).
    expect(fullMessage).toContain(
      "Implementer handoff received. Run a fresh review now"
    );
    expectStringOccurrence(
      fullMessage,
      "Decision matrix triggers that still require tests:",
      1
    );
    // OVERFLOW_1 omits command gate projections (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("keeps shared command-gate invariants across round>=2 clean and findings projections", async () => {
    const calls: string[][] = [];
    let lastDeliveryMessage = "";
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "send-keys" && args[3] === "-l") {
        if (args[4]?.includes("[pairflow]")) {
          lastDeliveryMessage = args[4];
        } else {
          lastDeliveryMessage += args[4] ?? "";
        }
      }
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: lastDeliveryMessage,
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_104",
        round: 2
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });
    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_105",
        round: 2,
        payload: {
          summary: "handoff findings branch",
          findings: [
            {
              severity: "P2",
              title: "finding"
            }
          ]
        }
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const reviewerMessages: string[] = [];
    let currentMessage = "";
    for (const call of calls) {
      if (call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2" && call[3] === "-l") {
        if (call[4]?.includes("[pairflow]")) {
          if (currentMessage) reviewerMessages.push(currentMessage);
          currentMessage = call[4];
        } else {
          currentMessage += call[4] ?? "";
        }
      }
    }
    if (currentMessage) reviewerMessages.push(currentMessage);

    expect(reviewerMessages).toHaveLength(2);
    const cleanMessage = reviewerMessages[0] ?? "";
    const findingsMessage = reviewerMessages[1] ?? "";

    // OVERFLOW_1: opencode reviewer receives minimal text (no command gate projections).
    for (const msg of [cleanMessage, findingsMessage]) {
      expect(msg).toContain("Implementer handoff received. Run a fresh review now");
    }
    // Decision matrix reminder is included for fresh mode
    for (const msg of [cleanMessage, findingsMessage]) {
      expectStringOccurrence(
        msg,
        "Decision matrix triggers that still require tests:",
        1
      );
    }
    // OVERFLOW_1 omits command gate projections (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(cleanMessage);
    expectNoForbiddenReviewerCommandGateTokens(findingsMessage);
  });

  it("projects non-default reviewer thresholds into tmux reviewer delivery without forbidden drift", async () => {
    const calls: string[][] = [];
    let lastDeliveryMessage = "";
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "send-keys" && args[3] === "-l") {
        if (args[4]?.includes("[pairflow]")) {
          lastDeliveryMessage = args[4];
        } else {
          lastDeliveryMessage += args[4] ?? "";
        }
      }
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: lastDeliveryMessage,
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        review_policy: {
          review_loop_mode: "full",
          reviewer_blocking_min_severity: "P2",
          meta_review_auto_rework_min_severity: "P3",
          meta_review_consecutive_clean_runs_required: 1,
        },
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_106",
        round: 2
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });
    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        review_policy: {
          review_loop_mode: "full",
          reviewer_blocking_min_severity: "P1",
          meta_review_auto_rework_min_severity: "P3",
          meta_review_consecutive_clean_runs_required: 1,
        },
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_107",
        round: 2,
        payload: {
          summary: "handoff findings branch",
          findings: [
            {
              severity: "P2",
              title: "finding"
            }
          ]
        }
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const reviewerMessages: string[] = [];
    let currentMessage = "";
    for (const call of calls) {
      if (call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2" && call[3] === "-l") {
        if (call[4]?.includes("[pairflow]")) {
          if (currentMessage) reviewerMessages.push(currentMessage);
          currentMessage = call[4];
        } else {
          currentMessage += call[4] ?? "";
        }
      }
    }
    if (currentMessage) reviewerMessages.push(currentMessage);

    expect(reviewerMessages).toHaveLength(2);

    const cleanMessage = reviewerMessages[0] ?? "";
    const findingsMessage = reviewerMessages[1] ?? "";

    // OVERFLOW_1: opencode reviewer receives minimal text (no command gate projections with thresholds).
    for (const msg of [cleanMessage, findingsMessage]) {
      expect(msg).toContain("Implementer handoff received. Run a fresh review now");
      expectStringOccurrence(
        msg,
        "Decision matrix triggers that still require tests:",
        1
      );
    }
    // OVERFLOW_1 omits threshold-specific command gate projections (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(cleanMessage);
    expectNoForbiddenReviewerCommandGateTokens(findingsMessage);
  });

  it("keeps compact reviewer policy delivery on every fresh-mode reviewer handoff round with directive", async () => {
    const calls: string[][] = [];
    let lastDeliveryMessage = "";
    const reviewerTestDirective: ReviewerTestExecutionDirective = {
      skip_full_rerun: true,
      reason_code: "no_trigger",
      reason_detail: "Evidence is verified, fresh, and complete.",
      verification_status: "trusted"
    };
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "send-keys" && args[3] === "-l") {
        if (args[4]?.includes("[pairflow]")) {
          lastDeliveryMessage = args[4];
        } else {
          lastDeliveryMessage += args[4] ?? "";
        }
      }
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: lastDeliveryMessage,
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_101",
        round: 1
      }),
      recipientRole: "reviewer",
      reviewerTestDirective,
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_102",
        round: 2
      }),
      recipientRole: "reviewer",
      reviewerTestDirective,
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const reviewerMessages: string[] = [];
    let currentMessage = "";
    for (const call of calls) {
      if (call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2" && call[3] === "-l") {
        if (call[4]?.includes("[pairflow]")) {
          if (currentMessage) reviewerMessages.push(currentMessage);
          currentMessage = call[4];
        } else {
          currentMessage += call[4] ?? "";
        }
      }
    }
    if (currentMessage) reviewerMessages.push(currentMessage);

    expect(reviewerMessages).toHaveLength(2);
    for (const messageText of reviewerMessages) {
      // OVERFLOW_1: opencode reviewer receives minimal handoff + test directive only.
      expect(messageText).toContain("Implementer handoff received. Run a fresh review now");
      expect(messageText).toContain(
        "Implementer test evidence has been orchestrator-verified. Do not re-run full tests unless a trigger from the decision matrix applies."
      );
      // Decision matrix reminder is part of formatReviewerTestExecutionDirective (kept for opencode)
      expectStringOccurrence(
        messageText,
        "Decision matrix triggers that still require tests:",
        1
      );
    }
  });

  it("injects decision matrix reminder in fresh mode when reviewer test directive is unavailable", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md. Action: Implementer handoff received."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        reviewer_context_mode: "fresh",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");
    // OVERFLOW_1: opencode reviewer receives minimal text with decision matrix (fresh mode, no directive).
    expect(fullMessage).toContain(
      "Implementer handoff received. Run a fresh review now"
    );
    expect(fullMessage).toContain(
      "Run required checks before final judgment. Reason: reviewer test verification directive was unavailable."
    );
    // Decision matrix reminder is included for fresh mode (part of OVERFLOW_1 fallback)
    expectStringOccurrence(
      fullMessage,
      "Decision matrix triggers that still require tests:",
      1
    );
    // OVERFLOW_1 omits: Phase 1 flow, output contract, scout scan, ontology, policy file, guardrails (non-opencode only).
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("uses document-focused reviewer guidance when review artifact type is document", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        review_artifact_type: "document",
        agents: {
          ...baseConfig.agents,
          reviewer: "codex" as never
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");
    // OVERFLOW_1: opencode reviewer receives minimal text (no document-focused guidance or command gates).
    expect(fullMessage).toContain("Implementer handoff received. Run a fresh review now");
    // OVERFLOW_1 omits document-focused reviewer guidance and command gate projections (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("routes human recipient notifications to status pane", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 HUMAN_QUESTION opencode->human msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "opencode",
        recipient: "human",
        type: "HUMAN_QUESTION"
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(0);
    const toStatusPane = calls.find(
      (call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.0"
    );
    expect(toStatusPane).toBeDefined();
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.0",
      "Enter"
    ]);
    expect(calls.some((call) => call[0] === "capture-pane")).toBe(true);
  });

  it("routes explicit status delivery target to status pane for non-status recipients", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 APPROVAL_REQUEST orchestrator->opencode msg=msg_20260222_206 ref=artifact://approval.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_206",
        sender: "orchestrator",
        recipient: "opencode",
        type: "APPROVAL_REQUEST",
        round: 2,
        payload: {
          summary: "Human gate is pending.",
          metadata: {
            [deliveryTargetRoleMetadataKey]: "status"
          }
        },
        refs: ["artifact://approval.md"]
      }),
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(0);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.0")
    ).toBe(true);
  });

  it("routes approval-wait notification to implementer pane with stop instruction", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 APPROVAL_REQUEST orchestrator->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "orchestrator",
        recipient: "opencode",
        type: "APPROVAL_REQUEST"
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(1);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.1")
    ).toBe(true);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.1",
      "Enter"
    ]);
    expect(calls.some((call) => call[0] === "capture-pane")).toBe(true);
    const approvalCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l" &&
        call[4]?.includes("APPROVAL_REQUEST")
    );
    expect(approvalCall?.[4]).toContain(
      "Bubble is READY_FOR_HUMAN_APPROVAL. Stop coding and wait for human decision"
    );
  });

  it("uses origin-neutral rework instruction when implementer delivery lacks explicit origin metadata", async () => {
    const reworkRef = buildTranscriptFallbackRef(
      "b_delivery_01",
      "/tmp/repo/.pairflow/runtime/sessions.json",
      "msg_20260222_101"
    );
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: submittedPaneOutput(
            `[pairflow] r2 APPROVAL_DECISION human->opencode msg=msg_20260222_101 ref=${reworkRef}.`
          ),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "human",
        recipient: "opencode",
        type: "APPROVAL_DECISION",
        round: 2,
        payload: {
          decision: "rework",
          message: "Please address reviewer findings."
        }
      }),
      recipientRole: "implementer",
      messageRef: reworkRef,
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(1);
    const approvalCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l" &&
        call[4]?.includes("APPROVAL_DECISION human->opencode")
    );
    expect(approvalCall?.[4]).toContain("Rework received.");
    expect(approvalCall?.[4]).not.toContain("Human requested rework.");
    expect(approvalCall?.[4]).not.toContain("reviewer requested rework");
    expect(approvalCall?.[4]).not.toContain("Meta-review");
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.1",
      "Enter"
    ]);
  });

  it("uses meta-origin-aware implementer rework guidance for meta auto-rework delivery", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 APPROVAL_DECISION orchestrator->opencode msg=msg_20260222_103 ref=artifact://auto-rework.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_103",
        sender: "orchestrator",
        recipient: "opencode",
        type: "APPROVAL_DECISION",
        round: 2,
        payload: {
          decision: "rework",
          message: "Please address meta-review findings.",
          metadata: {
            actor: "meta-reviewer"
          }
        },
        refs: ["artifact://auto-rework.md"]
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    const approvalCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l" &&
        call[4]?.includes("APPROVAL_DECISION orchestrator->opencode")
    );
    expect(approvalCall?.[4]).toContain("Meta-review auto-rework received.");
    expect(approvalCall?.[4]).not.toContain("Rework received.");
    expect(approvalCall?.[4]).not.toContain("Human requested rework.");
  });

  it("uses meta-origin-aware guidance for meta-review-gate actor metadata as well", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r2 APPROVAL_DECISION orchestrator->opencode msg=msg_20260222_104 ref=artifact://gate-auto-rework.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        id: "msg_20260222_104",
        sender: "orchestrator",
        recipient: "opencode",
        type: "APPROVAL_DECISION",
        round: 2,
        payload: {
          decision: "rework",
          message: "Please address gate-routed findings.",
          metadata: {
            actor: "meta-review-gate"
          }
        },
        refs: ["artifact://gate-auto-rework.md"]
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    const approvalCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l" &&
        call[4]?.includes("APPROVAL_DECISION orchestrator->opencode")
    );
    expect(approvalCall?.[4]).toContain("Meta-review auto-rework received.");
    expect(approvalCall?.[4]).not.toContain("Human requested rework.");
  });

  it("uses docs-only implementer guidance that avoids skip-claim and runtime-log-ref contradiction", async () => {
    async function deliverToImplementer(
      envelope: ProtocolEnvelope
    ): Promise<string | undefined> {
      const calls: string[][] = [];
      const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
        calls.push(args);
        if (args[0] === "capture-pane") {
          return Promise.resolve({
            stdout: `[pairflow] r${envelope.round} ${envelope.type} ${envelope.sender}->${envelope.recipient} msg=${envelope.id} ref=artifact://handoff.md.`,
            stderr: "",
            exitCode: 0
          });
        }
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      };

      await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: {
          ...baseConfig,
          review_artifact_type: "document",
          agents: {
            ...baseConfig.agents,
            implementer: "opencode"
          }
        },
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope,
        recipientRole: "implementer",
        runner,
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      });

      const matchCalls = calls.filter(
        (call) =>
          call[0] === "send-keys" &&
          call[2] === "pf-b_delivery_01:0.1" &&
          call[3] === "-l"
      );
      return matchCalls.map((call) => call[4]).join("");
    }

    const passMessage = await deliverToImplementer(
      createEnvelope({
        sender: "opencode",
        recipient: "opencode",
        type: "PASS",
        payload: {
          summary: "Fix request from reviewer"
        }
      })
    );
    // OVERFLOW_2: opencode implementer receives minimal action text only.
    expect(passMessage).toContain("Reviewer feedback received. Implement fixes.");
    // OVERFLOW_2 omits docs-only mode guidance, document guard, validation warnings (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(passMessage);
  });


  it("keeps non-document implementer delivery guidance free of docs-only mode text", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        review_artifact_type: "code",
        agents: {
          ...baseConfig.agents,
          implementer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "opencode",
        recipient: "opencode",
        type: "PASS",
        payload: {
          summary: "Please apply reviewer fixes."
        }
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");
    // OVERFLOW_2: opencode implementer receives minimal action text + workspace/command guidance.
    expect(fullMessage).toContain("Reviewer feedback received. Implement fixes.");
    // Phase 4: opencode implementer receives minimal action text only, no workspace guidance
    expect(fullMessage).not.toContain(
      "Default command profile is `external`; Pairflow commands are resolved from PATH."
    );
    expect(fullMessage).not.toContain("--pairflow-command-profile self_host");
    // OVERFLOW_2 omits: implementer action guidance, evidence ref instructions (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("warns implementer delivery on invalid empty required validation policy", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: {
        ...baseConfig,
        review_artifact_type: "code",
        commands: {
          ...baseConfig.commands,
          validation_required: []
        },
        agents: {
          ...baseConfig.agents,
          implementer: "opencode"
        }
      },
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "opencode",
        recipient: "opencode",
        type: "PASS",
        payload: {
          summary: "Please apply reviewer fixes."
        }
      }),
      recipientRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    const matchCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.1" &&
        call[3] === "-l"
    );
    const fullMessage = matchCalls.map((call) => call[4]).join("");
    // OVERFLOW_2: opencode implementer receives minimal action text only (no validation warnings).
    expect(fullMessage).toContain("Reviewer feedback received. Implement fixes.");
    // OVERFLOW_2 omits validation policy warnings and required commands guidance (non-opencode only)
    expectNoForbiddenReviewerCommandGateTokens(fullMessage);
  });

  it("uses absolute transcript path fallback ref when envelope has no refs", async () => {
    const fallbackRef = buildTranscriptFallbackRef(
      "b_delivery_01",
      "/tmp/repo/.pairflow/runtime/sessions.json",
      "msg_20260222_101"
    );
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: submittedPaneOutput(
            `[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=${fallbackRef}.`
          ),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        refs: []
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    const messageCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l" &&
        call[4]?.includes("[pairflow] r1 PASS opencode->opencode")
    );
    expect(messageCall?.[4]).toContain(`ref=${fallbackRef}.`);
    expect(messageCall?.[4]).not.toContain("ref=transcript.ndjson#");
  });

  it("uses envelope refs[0] when explicit messageRef is not provided", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://priority-source.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        refs: ["artifact://priority-source.md"]
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    const messageCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l" &&
        call[4]?.includes("[pairflow] r1 PASS opencode->opencode")
    );
    expect(messageCall?.[4]).toContain("ref=artifact://priority-source.md.");
    expect(messageCall?.[4]).not.toContain("/.pairflow/bubbles/b_delivery_01/transcript.ndjson#");
  });

  it("routes approval-wait notification to reviewer pane with hold instruction", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 APPROVAL_REQUEST orchestrator->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope({
        sender: "orchestrator",
        recipient: "opencode",
        type: "APPROVAL_REQUEST"
      }),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.status).toBe("accepted");
    expect(result.targetPaneIndex).toBe(2);
    expect(
      calls.some((call) => call[0] === "send-keys" && call[2] === "pf-b_delivery_01:0.2")
    ).toBe(true);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
    expect(calls.some((call) => call[0] === "capture-pane")).toBe(true);
    const approvalCall = calls.find(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "-l" &&
        call[4]?.includes("APPROVAL_REQUEST")
    );
    expect(approvalCall?.[4]).toContain(
      "Bubble is READY_FOR_HUMAN_APPROVAL. Review is complete; wait for human decision"
    );
  });

  it("uses explicit canonical workspace authority for delivery guidance", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () =>
        Promise.resolve(
          createRegistry({
            workspacePath: "/tmp/runtime-workspace",
            workspaceKind: "worktree"
          })
        )
    });

    expect(result.status).toBe("accepted");
    // Phase 4: opencode reviewer receives minimal messages without workspace guidance
    expect(result.message).not.toContain(
      "Run pairflow commands from workspace root:"
    );
    expect(result.message).not.toContain(
      "Run pairflow commands from workspace root: /tmp/worktree."
    );
  });

  it("fails closed when explicit workspace authority is absent during delivery", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout:
            submittedOpencodeReadyPaneOutput("[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve(
          createRegistry({
            workspacePath: undefined,
            workspaceKind: undefined
          })
        )
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "no_runtime_session"
    });
    expect(result.message).toContain(
      "Run pairflow commands from the active workspace root."
    );
    expect(calls).toHaveLength(0);
  });

  it("returns no_runtime_session when registry has no entry", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: () => Promise.resolve({})
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "no_runtime_session",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE"
    });
    expect(result.message).toContain(
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
    );
    expect(result.message).toContain(
      "Run pairflow commands from the active workspace root."
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed when runtime workspace authority is missing", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve(
          createRegistry({
            worktreePath: "   ",
            workspacePath: undefined,
            workspaceKind: undefined
          })
        )
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "no_runtime_session",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE"
    });
    expect(result.message).toContain(
      "Run pairflow commands from the active workspace root."
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed when clone-mode session has no canonical workspace authority during delivery", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      runner,
      readSessionsRegistry: () =>
        Promise.resolve(
          createRegistry({
            workspacePath: undefined,
            workspaceKind: "clone"
          })
        )
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "no_runtime_session",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE"
    });
    expect(result.message).toContain(
      "Run pairflow commands from the active workspace root."
    );
    expect(calls).toHaveLength(0);
  });

  it("preserves unsupported-recipient behavior when explicit role and legacy recipient routes are both unavailable", async () => {
    const metaReviewerPaneMock = mockUnmappedMetaReviewerPane();
    try {
      const result = await emitDeliveryNotificationAck({
        bubbleId: "b_delivery_01",
        bubbleConfig: createSharedAgentConfig("opencode"),
        sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
        envelope: createEnvelope({
          id: "msg_20260222_401",
          sender: "orchestrator",
          recipient: "opencode",
          type: "TASK",
          payload: {
            summary: "Unmapped explicit + unsupported legacy route.",
            metadata: {
              [deliveryTargetRoleMetadataKey]: "meta_reviewer"
            }
          },
          refs: ["artifact://meta-review-task.md"]
        }),
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      });

      expect(result).toMatchObject({
        status: "rejected",
        reason: "unsupported_recipient",
        reason_code: "DELIVERY_ACK_TARGET_UNSUPPORTED",
        deliveryTargetReasonCode: "DELIVERY_TARGET_ROLE_UNMAPPED"
      });
    } finally {
      metaReviewerPaneMock.restore();
    }
  });

  it("returns registry_read_failed when session registry load fails", async () => {
    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      readSessionsRegistry: async () => Promise.reject(new Error("invalid json"))
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "registry_read_failed",
      reason_code: "DELIVERY_ACK_RUNTIME_SESSION_UNAVAILABLE",
      deliveryTargetReasonCode: "DELIVERY_TARGET_REGISTRY_READ_FAILED"
    });
    expect(result.message).toContain(
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
    );
    expect(result.message).toContain(
      "Run pairflow commands from the active workspace root."
    );
  });

  it("returns command_failed when tmux command fails", async () => {
    const runner: TmuxRunner = () => Promise.reject(new Error("tmux unavailable"));

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result).toMatchObject({
      status: "rejected",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      reason: "command_failed",
      reason_code: "DELIVERY_ACK_REJECTED"
    });
    expect(result.message).toContain(
      "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
    );
    // Phase 4: opencode reviewer receives minimal messages without workspace guidance
    expect(result.message).not.toContain(
      "Run pairflow commands from workspace root:"
    );
  });

  it("returns command_failed when literal pane write exits non-zero", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (
        args[0] === "send-keys" &&
        args[2] === "pf-b_delivery_01:0.2" &&
        args[3] === "-l"
      ) {
        return Promise.resolve({
          stdout: "",
          stderr: "can't find pane",
          exitCode: 1
        });
      }

      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result).toMatchObject({
      status: "rejected",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2,
      reason: "command_failed",
      reason_code: "DELIVERY_ACK_REJECTED"
    });
    expect(
      calls.some(
        (call) =>
          call[0] === "send-keys" &&
          call[2] === "pf-b_delivery_01:0.2" &&
          call[3] === "Enter" &&
          call.length === 4
      )
    ).toBe(false);
    expect(calls.filter((call) => call[0] === "capture-pane").length).toBeGreaterThanOrEqual(1);
  });

  it("retries delivery when handoff marker is not visible after first submit", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        return Promise.resolve({
          stdout:
            captureCount >= 7
              ? [
                  "Ask anything...",
                  "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.",
                  "",
                  ">"
                ].join("\n")
              : "Ask anything...\n",
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 3
    });

    expect(result.status).toBe("accepted");
    const enterCalls = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "Enter"
    );
    // 1 initial Enter + 2 retry Enters = 3.
    expect(enterCalls.length).toBe(3);
    const captureCalls = calls.filter((call) => call[0] === "capture-pane");
    expect(captureCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("detects marker stuck in input buffer and retries Enter", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (captureCount <= 5) {
          // Marker appears after the > prompt — stuck in input buffer.
          return Promise.resolve({
            stdout: [
              "Claude Code is ready.",
              "",
              "> [pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
            ].join("\n"),
            stderr: "",
            exitCode: 0
          });
        }
        // After retry Enter, marker moves to output area (before prompt).
        return Promise.resolve({
          stdout: [
            "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.",
            "",
            ">"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 3
    });

    expect(result.status).toBe("accepted");
    // Verify retry Enter was sent after detecting stuck_in_input.
    const enterRetries = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "Enter" &&
        call.length === 4
    );
    // Initial Enter (from sendAndSubmitTmuxPaneMessage) + at least one retry Enter.
    expect(enterRetries.length).toBeGreaterThanOrEqual(2);
  });

  it("detects marker stuck when prompt line has pane-border prefix", async () => {
    const calls: string[][] = [];
    let captureCount = 0;
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        captureCount += 1;
        if (captureCount <= 5) {
          return Promise.resolve({
            stdout: [
              "Claude Code is ready.",
              "",
              "│ ❯ [pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md."
            ].join("\n"),
            stderr: "",
            exitCode: 0
          });
        }
        return Promise.resolve({
          stdout: [
            "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.",
            "",
            "│ ❯"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 3
    });

    expect(result.status).toBe("accepted");
    const enterRetries = calls.filter(
      (call) =>
        call[0] === "send-keys" &&
        call[2] === "pf-b_delivery_01:0.2" &&
        call[3] === "Enter" &&
        call.length === 4
    );
    expect(enterRetries.length).toBeGreaterThanOrEqual(2);
  });

  it("returns delivery_unconfirmed when marker never appears", { timeout: 10_000 }, async () => {
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 2
    });

    expect(result).toMatchObject({
      status: "rejected",
      reason: "delivery_unconfirmed",
      reason_code: "DELIVERY_ACK_REJECTED",
      sessionName: "pf-b_delivery_01",
      targetPaneIndex: 2
    });
  });

  it("accepts delivery when the pairflow marker is only visible in recent pane scrollback", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "Earlier output above the current viewport:",
            "[pairflow] r1 PASS opencode->opencode msg=msg_20260222_101 ref=artifact://handoff.md.",
            "",
            "Claude Code is ready.",
            "",
            ">"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0
      });
    };

    const result = await emitDeliveryNotificationAck({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/repo/.pairflow/runtime/sessions.json",
      envelope: createEnvelope(),
      recipientRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry()),
      deliveryAttempts: 3
    });

    expect(result.status).toBe("accepted");
    expect(calls).toContainEqual([
      "capture-pane",
      "-p",
      "-S",
      "-200",
      "-t",
      "pf-b_delivery_01:0.2"
    ]);
  });
});

describe("resolveDeliveryMessageRef", () => {
  it("applies messageRef -> envelope.ref -> transcript fallback priority in order", () => {
    const envelopeWithRef = createEnvelope({
      refs: ["artifact://primary.md"]
    });
    const envelopeWithoutRef = createEnvelope({
      refs: []
    });
    const sessionsPath = "/tmp/repo/.pairflow/runtime/sessions.json";

    expect(
      resolveDeliveryMessageRef({
        bubbleId: "b_delivery_01",
        sessionsPath,
        envelope: envelopeWithRef,
        messageRef: "manual://override"
      })
    ).toBe("manual://override");

    expect(
      resolveDeliveryMessageRef({
        bubbleId: "b_delivery_01",
        sessionsPath,
        envelope: envelopeWithRef
      })
    ).toBe("artifact://primary.md");

    expect(
      resolveDeliveryMessageRef({
        bubbleId: "b_delivery_01",
        sessionsPath,
        envelope: envelopeWithoutRef
      })
    ).toBe("/tmp/repo/.pairflow/bubbles/b_delivery_01/transcript.ndjson#msg_20260222_101");
  });
});

describe("buildTranscriptFallbackRef", () => {
  it("resolves .pairflow directory via marker lookup, not fixed dirname depth", () => {
    const ref = buildTranscriptFallbackRef(
      "b_delivery_01",
      "/tmp/repo/.pairflow/runtime/nested/sessions.json",
      "msg_20260222_101"
    );

    expect(ref).toBe(
      "/tmp/repo/.pairflow/bubbles/b_delivery_01/transcript.ndjson#msg_20260222_101"
    );
  });

  it("falls back to repo/.pairflow when sessions path lacks explicit .pairflow segment", () => {
    const ref = buildTranscriptFallbackRef(
      "b_delivery_01",
      "/tmp/repo/runtime/sessions.json",
      "msg_20260222_101"
    );

    expect(ref).toBe(
      "/tmp/repo/.pairflow/bubbles/b_delivery_01/transcript.ndjson#msg_20260222_101"
    );
  });

  it("does not mis-detect .pairflow-worktrees as .pairflow root", () => {
    const ref = buildTranscriptFallbackRef(
      "b_delivery_01",
      "/Users/felho/dev/.pairflow-worktrees/pairflow/transcript-ref-resolution-fix-implementation-01/.pairflow/runtime/sessions.json",
      "msg_20260222_101"
    );

    expect(ref).toBe(
      "/Users/felho/dev/.pairflow-worktrees/pairflow/transcript-ref-resolution-fix-implementation-01/.pairflow/bubbles/b_delivery_01/transcript.ndjson#msg_20260222_101"
    );
  });
});

describe("retryStuckAgentInput", () => {
  it("sends Enter when pairflow marker is stuck in input buffer", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "Claude Code is ready.",
            "",
            "❯ [pairflow] r1 PASS opencode->opencode msg=msg_123 ref=handoff.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
  });

  it("treats pane-border-prefixed prompt as stuck-input prompt marker", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "Claude Code is ready.",
            "",
            "│ ❯ [pairflow] r1 PASS opencode->opencode msg=msg_123 ref=handoff.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
  });

  it("does not retry when marker is in output area (already submitted)", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "[pairflow] r1 PASS opencode->opencode msg=msg_123 ref=handoff.md.",
            "Processing...",
            "❯"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result).toMatchObject({ retried: false, reason: "not_stuck" });
    const enterCalls = calls.filter((c) => c[0] === "send-keys" && c[3] === "Enter");
    expect(enterCalls).toHaveLength(0);
  });

  it("retries when the same marker is already in scrollback but still stuck in the live prompt", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "[pairflow] r1 PASS opencode->opencode msg=msg_123 ref=handoff.md.",
            "Claude Code welcome screen",
            "❯ [pairflow] r1 PASS opencode->opencode msg=msg_123 ref=handoff.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
  });

  it("does not retry when no pairflow marker is present", async () => {
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: "❯ hello world",
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result).toMatchObject({ retried: false, reason: "not_stuck" });
  });

  it("returns no_session when sessions registry is empty", async () => {
    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      readSessionsRegistry: () => Promise.resolve({})
    });

    expect(result).toMatchObject({ retried: false, reason: "no_session" });
  });

  it("routes implementer agent to pane 1", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "",
            "❯ [pairflow] r1 TASK orchestrator->opencode msg=msg_123 ref=task.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: baseConfig,
      sessionsPath: "/tmp/sessions.json",
      activeRole: "implementer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "capture-pane",
      "-pt",
      "pf-b_delivery_01:0.1"
    ]);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.1",
      "Enter"
    ]);
  });

  it("routes shared agent retries from explicit active role instead of agent identity guess", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "",
            "❯ [pairflow] r2 HUMAN_REPLY human->opencode msg=msg_456 ref=reply.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/sessions.json",
      activeRole: "reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "capture-pane",
      "-pt",
      "pf-b_delivery_01:0.2"
    ]);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.2",
      "Enter"
    ]);
  });

  it("routes meta-reviewer retries from explicit active role to pane 3", async () => {
    const calls: string[][] = [];
    const runner: TmuxRunner = (args): Promise<TmuxRunResult> => {
      calls.push(args);
      if (args[0] === "capture-pane") {
        return Promise.resolve({
          stdout: [
            "",
            "❯ [pairflow] r2 PASS opencode->opencode msg=msg_789 ref=meta-review.md."
          ].join("\n"),
          stderr: "",
          exitCode: 0
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };

    const result = await retryStuckAgentInput({
      bubbleId: "b_delivery_01",
      bubbleConfig: createSharedAgentConfig("opencode"),
      sessionsPath: "/tmp/sessions.json",
      activeRole: "meta_reviewer",
      runner,
      readSessionsRegistry: () => Promise.resolve(createRegistry())
    });

    expect(result.retried).toBe(true);
    expect(calls).toContainEqual([
      "capture-pane",
      "-pt",
      "pf-b_delivery_01:0.3"
    ]);
    expect(calls).toContainEqual([
      "send-keys",
      "-t",
      "pf-b_delivery_01:0.3",
      "Enter"
    ]);
  });

  it("fails closed with BubbleWatchdogError when retry receives an invalid active role", async () => {
    await expect(
      retryStuckAgentInput({
        bubbleId: "b_delivery_01",
        bubbleConfig: baseConfig,
        sessionsPath: "/tmp/sessions.json",
        activeRole: "human" as never,
        readSessionsRegistry: () => Promise.resolve(createRegistry())
      })
    ).rejects.toBeInstanceOf(BubbleWatchdogError);
  });
});
