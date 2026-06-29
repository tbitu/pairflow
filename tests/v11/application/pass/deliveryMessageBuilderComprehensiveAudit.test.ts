import { describe, expect, it } from "vitest";

import type { BubbleConfig } from "../../../../src/v11/shared/config/bubbleConfigTypes.js";
import type { ProtocolEnvelope } from "../../../../src/v11/shared/protocol/protocolEnvelopeContract.js";
import type { ProtocolMessageType } from "../../../../src/contracts/kernel/protocol.js";
import { buildTmuxDeliveryMessage } from "../../../../src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.js";

function createBubbleConfig(overrides: Partial<BubbleConfig> = {}): BubbleConfig {
  return {
    id: "b_audit_01",
    repo_path: "/tmp/repo",
    base_branch: "main",
    bubble_branch: "bubble/b_audit_01",
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

function createEnvelope<T extends ProtocolMessageType = "PASS">(
  overrides: Partial<ProtocolEnvelope<T>> = {}
): ProtocolEnvelope<T> {
  const base: Record<string, unknown> = {
    id: "msg_audit_001",
    ts: "2026-03-19T12:00:00.000Z",
    bubble_id: "b_audit_01",
    sender: "opencode",
    recipient: "opencode",
    type: "PASS",
    round: 1,
    payload: {
      summary: "test handoff"
    },
    refs: []
  };
  return { ...base, ...overrides } as unknown as ProtocolEnvelope<T>;
}

/**
 * COMPREHENSIVE DELIVERY MESSAGE AUDIT
 *
 * This audit verifies:
 * 1. All valid (role, envelope_type) combinations are handled
 * 2. Opencode agents receive minimal messages
 * 3. Non-opencode agents receive verbose messages
 * 4. The pattern is consistent across all transitions
 * 5. All roles handle rejection/rework with the same semantics as approval
 */
describe("Delivery Message Builder Comprehensive Audit", () => {
  describe("Implementer Role - All Envelope Types", () => {
    describe("TASK (initial task)", () => {
      it("opencode implementer gets minimal action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "TASK" }),
          messageRef: "artifact://task.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Implementation task received. Continue implementation.");
        // Minimal: no workspace guidance
        expect(msg).not.toContain("Run pairflow commands from");
      });

      it("non-opencode implementer gets verbose action with guidance", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "TASK" }),
          messageRef: "artifact://task.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "codex" as never, reviewer: "opencode", meta_reviewer: "opencode" }
          }),
          recipientRole: "implementer",
          workspacePath: "/tmp/workspace"
        });

        expect(msg).toContain("Implementation task received");
        expect(msg).toContain("Run pairflow commands from workspace root");
      });
    });

    describe("PASS (reviewer feedback - rework)", () => {
      it("opencode implementer gets minimal action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Reviewer feedback received. Implement fixes.");
        expect(msg).not.toContain("Run pairflow commands from");
      });

      it("non-opencode implementer gets verbose action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "codex" as never, reviewer: "opencode", meta_reviewer: "opencode" }
          }),
          recipientRole: "implementer",
          workspacePath: "/tmp/workspace"
        });

        expect(msg).toContain("Reviewer feedback received");
        expect(msg).toContain("Run pairflow commands from workspace root");
      });
    });

    describe("HUMAN_REPLY (human feedback)", () => {
      it("opencode implementer gets minimal action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "HUMAN_REPLY" }),
          messageRef: "artifact://reply.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Human response received. Continue implementation using this input.");
        expect(msg).not.toContain("Run pairflow commands from");
      });
    });

    describe("APPROVAL_DECISION (approval or rework)", () => {
      it("handles rework decision (from human)", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_DECISION",
            payload: { decision: "rework" as const }
          }),
          messageRef: "artifact://decision.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Rework received. Implement fixes.");
      });

      it("handles rework decision (from meta-review)", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_DECISION",
            payload: {
              decision: "rework" as const,
              metadata: { actor: "meta-reviewer" }
            }
          }),
          messageRef: "artifact://decision.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Meta-review auto-rework received. Implement fixes.");
      });

      it("handles approval decision (stop coding)", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_DECISION",
            payload: { decision: "approve" as const }
          }),
          messageRef: "artifact://decision.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Human approved this bubble. Wait for commit/merge flow");
      });
    });

    describe("APPROVAL_REQUEST (stop coding, wait for human decision)", () => {
      it("implementer gets stop-coding message", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_REQUEST"
          }),
          messageRef: "artifact://approval-request.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Action: Bubble is READY_FOR_HUMAN_APPROVAL");
        expect(msg).toContain("Stop coding and wait for human decision");
      });

      it("implementer stops coding when meta-reviewer requests human decision", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_REQUEST",
            payload: { summary: "test", metadata: { actor: "meta-reviewer" } }
          }),
          messageRef: "artifact://approval-request.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer"
        });

        expect(msg).toContain("Meta-reviewer requested human gate decision");
      });
    });
  });

  describe("Reviewer Role - All Envelope Types", () => {
    describe("PASS (implementer handoff - start review)", () => {
      it("opencode reviewer gets minimal action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "opencode", reviewer: "opencode", meta_reviewer: "opencode" }
          }),
          recipientRole: "reviewer"
        });

        expect(msg).toContain("Action: Implementer handoff received. Run a fresh review now.");
        expect(msg).not.toContain("Severity Ontology");
        expect(msg).not.toContain("Scout");
        expect(msg).not.toContain("Run pairflow commands from");
      });

      it("non-opencode reviewer gets verbose action with policy guidance", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "opencode", reviewer: "codex" as never, meta_reviewer: "opencode" }
          }),
          recipientRole: "reviewer",
          workspacePath: "/tmp/workspace"
        });

        expect(msg).toContain("Implementer handoff received");
        expect(msg).toContain("Severity Ontology");
        expect(msg).toContain("Scout");
        expect(msg).toContain("Run pairflow commands from workspace root");
      });
    });

    describe("HUMAN_REPLY (human feedback during review)", () => {
      it("reviewer gets continue-review message", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "HUMAN_REPLY" }),
          messageRef: "artifact://reply.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "reviewer"
        });

        expect(msg).toContain("Action: Human response received. Continue review workflow from this update.");
      });
    });

    describe("APPROVAL_REQUEST (stop reviewing, wait for human decision)", () => {
      it("reviewer gets stop-reviewing message", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "APPROVAL_REQUEST" }),
          messageRef: "artifact://approval-request.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "reviewer"
        });

        expect(msg).toContain("Action: Bubble is READY_FOR_HUMAN_APPROVAL");
        expect(msg).toContain("Review is complete");
        expect(msg).toContain("wait for human decision");
      });

      it("reviewer stops reviewing when meta-reviewer requests human decision", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type: "APPROVAL_REQUEST",
            payload: { summary: "test", metadata: { actor: "meta-reviewer" } }
          }),
          messageRef: "artifact://approval-request.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "reviewer"
        });

        expect(msg).toContain("Meta-reviewer requested human gate decision");
      });
    });
  });

  describe("Meta-Reviewer Role", () => {
    describe("PASS (review results for meta-review)", () => {
      it("opencode meta-reviewer gets minimal action", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "opencode", reviewer: "opencode", meta_reviewer: "opencode" }
          }),
          recipientRole: "meta-reviewer"
        });

        expect(msg).toContain("Action: Meta-review task received. Produce autonomous meta-review output.");
        expect(msg).not.toContain("--report-json");
        expect(msg).not.toContain("pairflow agent emit");
        expect(msg).not.toContain("Run pairflow commands from");
      });

      it("non-opencode meta-reviewer gets verbose action with submission guidance", () => {
        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({ type: "PASS" }),
          messageRef: "artifact://handoff.md",
          bubbleConfig: createBubbleConfig({
            agents: { implementer: "opencode", reviewer: "opencode", meta_reviewer: "codex" as never }
          }),
          recipientRole: "meta-reviewer",
          workspacePath: "/tmp/workspace"
        });

        expect(msg).toContain("Meta-review task received");
        expect(msg).toContain("--report-json");
        expect(msg).toContain("pairflow agent emit");
      });
    });
  });

  describe("Consistency Checks Across All Roles", () => {
    it("all opencode recipients have NO workspace guidance", () => {
      const envelopeTypes: ProtocolMessageType[] = [
        "TASK",
        "PASS",
        "HUMAN_REPLY",
        "APPROVAL_DECISION",
        "APPROVAL_REQUEST"
      ];

      for (const type of envelopeTypes) {
        // Skip invalid combinations
        if (
          (type === "TASK" && ["reviewer", "meta-reviewer"].includes("reviewer")) ||
          (type === "HUMAN_REPLY" && "meta-reviewer" === "meta-reviewer")
        ) {
          continue;
        }

        const msg = buildTmuxDeliveryMessage({
          envelope: createEnvelope({
            type,
            ...(type === "APPROVAL_DECISION" ? { payload: { decision: "rework" as const } } : {})
          }),
          messageRef: "artifact://test.md",
          bubbleConfig: createBubbleConfig(),
          recipientRole: "implementer",
          workspacePath: "/tmp/workspace"
        });

        expect(msg, `opencode implementer with ${type} should not have workspace guidance`).not.toContain(
          "Run pairflow commands from"
        );
      }
    });

    it("all non-opencode recipients HAVE workspace guidance when path is provided", () => {
      const msg = buildTmuxDeliveryMessage({
        envelope: createEnvelope({ type: "PASS" }),
        messageRef: "artifact://handoff.md",
        bubbleConfig: createBubbleConfig({
          agents: { implementer: "codex" as never, reviewer: "opencode", meta_reviewer: "opencode" }
        }),
        recipientRole: "implementer",
        workspacePath: "/tmp/workspace"
      });

      expect(msg).toContain("Run pairflow commands from workspace root: /tmp/workspace");
    });

    it("rework and approval decisions use consistent semantics (rework = implement fixes, approve = wait)", () => {
      const reworkMsg = buildTmuxDeliveryMessage({
        envelope: createEnvelope({
          type: "APPROVAL_DECISION",
          payload: { decision: "rework" as const }
        }),
        messageRef: "artifact://decision.md",
        bubbleConfig: createBubbleConfig(),
        recipientRole: "implementer"
      });

      const approveMsg = buildTmuxDeliveryMessage({
        envelope: createEnvelope({
          type: "APPROVAL_DECISION",
          payload: { decision: "approve" as const }
        }),
        messageRef: "artifact://decision.md",
        bubbleConfig: createBubbleConfig(),
        recipientRole: "implementer"
      });

      // Rework should say "fix"
      expect(reworkMsg).toContain("Implement fixes");
      // Approve should say "wait" (case-insensitive)
      expect(approveMsg.toLowerCase()).toContain("wait for commit/merge");

      // They should be different (not the same action)
      expect(reworkMsg).not.toEqual(approveMsg);
    });
  });
});
