import { describe, expect, it } from "vitest";

import type { BubbleConfig } from "../../../../src/v11/shared/config/bubbleConfigTypes.js";
import type { ProtocolEnvelope } from "../../../../src/v11/shared/protocol/protocolEnvelopeContract.js";
import { buildTmuxDeliveryMessage } from "../../../../src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.js";

function createBubbleConfig(overrides: Partial<BubbleConfig> = {}): BubbleConfig {
  return {
    id: "b_delivery_msg_01",
    repo_path: "/tmp/repo",
    base_branch: "main",
    bubble_branch: "bubble/b_delivery_msg_01",
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
    },
    ...overrides
  };
}

function createEnvelope(overrides: Partial<ProtocolEnvelope> = {}): ProtocolEnvelope {
  return {
    id: "msg_20260319_001",
    ts: "2026-03-19T12:00:00.000Z",
    bubble_id: "b_delivery_msg_01",
    sender: "opencode",
    recipient: "opencode",
    type: "PASS",
    round: 1,
    payload: {
      summary: "handoff"
    },
    refs: [],
    ...overrides
  } as ProtocolEnvelope;
}

describe("buildTmuxDeliveryMessage OVERFLOW_2 minimal formatting for opencode recipients", () => {
  it("returns minimal implementer delivery action for opencode implementer recipient (PASS event)", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope(),
      messageRef: "artifact://handoff.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "codex" as never
        }
      }),
      recipientRole: "implementer"
    });

    expect(message).toContain("Action: Reviewer feedback received. Implement fixes.");
  });

  it("returns minimal implementer delivery action for opencode implementer recipient (TASK event)", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope({ type: "TASK" }),
      messageRef: "artifact://task.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "opencode",
          reviewer: "codex" as never,
          meta_reviewer: "codex" as never
        }
      }),
      recipientRole: "implementer"
    });

    expect(message).toContain("Action: Implementation task received. Continue implementation.");
  });

  it("returns minimal implementer delivery action for opencode implementer recipient (HUMAN_REPLY event)", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope({ type: "HUMAN_REPLY" }),
      messageRef: "artifact://reply.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "opencode",
          reviewer: "codex" as never,
          meta_reviewer: "codex" as never
        }
      }),
      recipientRole: "implementer"
    });

    expect(message).toContain("Action: Human response received. Continue implementation using this input.");
  });

  it("returns minimal implementer delivery action for opencode implementer recipient (APPROVAL_DECISION rework)", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope({
        type: "APPROVAL_DECISION",
        payload: { decision: "rework" as const }
      }),
      messageRef: "artifact://approval.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "opencode",
          reviewer: "codex" as never,
          meta_reviewer: "codex" as never
        }
      }),
      recipientRole: "implementer"
    });

    expect(message).toContain("Action: Rework received. Implement fixes.");
  });

  it("returns minimal meta-reviewer delivery action for opencode meta-reviewer recipient", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope(),
      messageRef: "artifact://handoff.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "codex" as never,
          reviewer: "codex" as never,
          meta_reviewer: "opencode"
        }
      }),
      recipientRole: "meta-reviewer"
    });

    expect(message).toContain("Action: Meta-review task received. Produce autonomous meta-review output.");
    // Should NOT contain command templates or parity notes for opencode
    expect(message).not.toContain("`pairflow agent emit");
    expect(message).not.toContain("--report-json");
  });

  it("returns full verbose action for non-opencode implementer recipient", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope(),
      messageRef: "artifact://handoff.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "codex" as never,
          reviewer: "opencode",
          meta_reviewer: "opencode"
        }
      }),
      recipientRole: "implementer"
    });

    // Non-opencode should contain validation guidance (not minimal action text)
    expect(message).toContain("Reviewer feedback received");
    expect(message).toContain("Run pairflow commands from the active workspace root");
  });

  it("returns full verbose action for non-opencode meta-reviewer recipient", () => {
    const message = buildTmuxDeliveryMessage({
      envelope: createEnvelope(),
      messageRef: "artifact://handoff.md",
      bubbleConfig: createBubbleConfig({
        agents: {
          implementer: "opencode",
          reviewer: "opencode",
          meta_reviewer: "codex" as never
        }
      }),
      recipientRole: "meta-reviewer"
    });

    // Non-opencode should contain command templates
    expect(message).toContain("`pairflow agent emit");
  });
});
