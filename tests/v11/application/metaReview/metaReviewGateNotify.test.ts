import { afterEach, describe, expect, it, vi } from "vitest";

import {
  notifyMetaReviewerSubmissionRequest
} from "../../../../src/v11/application/metaReviewGate/metaReviewGateNotify.js";
import type { AgentPaneAdapter } from "../../../../src/v11/shared/agent/agentPaneAdapter.js";

function mockPaneAgent(overrides: Partial<AgentPaneAdapter> = {}): AgentPaneAdapter {
  return {
    name: "opencode",
    waitForReady: vi.fn(async () => true),
    findLastPromptIndex: () => -1,
    hasVisiblePrompt: () => true,
    acceptTrustPrompt: vi.fn(async () => false),
    isBusy: () => false,
    resolvePasteOptions: () => ({}),
    supportsConcurrentPanes: true,
    startupPromptDelivery: "cli_arg",
    trustPromptHandling: "opencode",
    postEmitInterruption: "opencode_double_escape",
    startupPasteSettleMs: 0,
    minimalPastedGuidance: true,
    planWatchBackend: "opencode",
    ...overrides
  };
}

async function notifyMetaReviewer(input: {
  bubbleId: string;
  round: number;
  targetPane: string;
  metaReviewerAgent?: "opencode";
}, dependencies?: Parameters<typeof notifyMetaReviewerSubmissionRequest>[1]) {
  return await notifyMetaReviewerSubmissionRequest({
    ...input,
    metaReviewerAgent: input.metaReviewerAgent ?? "opencode"
  }, dependencies);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("metaReviewGateNotify", () => {
  it.each([
    {
      label: "tmux.runner is missing",
      runtime: {
        tmux: {
          sendSubmissionRequestMessage: vi.fn(async () => undefined),
          confirmSubmission: vi.fn(async () => false)
        }
      }
    },
    {
      label: "tmux.sendSubmissionRequestMessage is missing",
      runtime: {
        tmux: {
          runner: vi.fn(),
          confirmSubmission: vi.fn(async () => false)
        }
      }
    },
    {
      label: "tmux.confirmSubmission is missing",
      runtime: {
        tmux: {
          runner: vi.fn(),
          sendSubmissionRequestMessage: vi.fn(async () => undefined)
        }
      }
    }
  ])("fails closed when notify runtime capabilities are incomplete: $label", async ({ runtime }) => {
    const result = await notifyMetaReviewer({
      bubbleId: "b_meta_review_notify_runtime_missing",
      round: 2,
      targetPane: "pf-b_meta_review_notify_runtime_missing:0.3"
    }, {
      runtime
    });

    expect(result).toEqual({
      status: "failed",
      reasonCode: "META_REVIEW_REQUEST_DELIVERY_RUNTIME_UNAVAILABLE",
      message: "meta-review gate notify runtime capabilities are unavailable."
    });
  });

  it("accepts the trust prompt through the resolved agent adapter", async () => {
    const acceptTrustPrompt = vi.fn(async () => false);
    const sendSubmissionRequestMessage = vi.fn(async () => undefined);
    const confirmSubmission = vi.fn(async () => true);

    const result = await notifyMetaReviewer({
      bubbleId: "b_meta_review_notify_trust_prompt",
      round: 3,
      targetPane: "pf-b_meta_review_notify_trust_prompt:0.3"
    }, {
      runtime: {
        tmux: {
          runner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
          resolveAgentPaneAdapter: () => mockPaneAgent({ acceptTrustPrompt }),
          sendSubmissionRequestMessage,
          confirmSubmission
        }
      }
    });

    expect(result.status).toBe("confirmed");
    expect(acceptTrustPrompt).toHaveBeenCalledTimes(1);
    expect(sendSubmissionRequestMessage).toHaveBeenCalledTimes(1);
  });

  it("confirms delivery when the marker submission is confirmed", async () => {
    const sendSubmissionRequestMessage = vi.fn(async () => undefined);
    const confirmSubmission = vi.fn(async () => true);

    const result = await notifyMetaReviewer({
      bubbleId: "b_meta_review_notify_confirmed",
      round: 4,
      targetPane: "pf-b_meta_review_notify_confirmed:0.3"
    }, {
      runtime: {
        tmux: {
          runner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
          sendSubmissionRequestMessage,
          confirmSubmission
        }
      }
    });

    expect(result).toEqual({
      status: "confirmed",
      reasonCode: null,
      message: "meta-review submit request delivery confirmed from pane scrollback."
    });
    expect(sendSubmissionRequestMessage).toHaveBeenCalledTimes(1);
    expect(confirmSubmission).toHaveBeenCalledTimes(1);
  });

  it("returns uncertain when the marker is never confirmed", async () => {
    const sendSubmissionRequestMessage = vi.fn(async () => undefined);
    const confirmSubmission = vi.fn(async () => false);

    const result = await notifyMetaReviewer({
      bubbleId: "b_meta_review_notify_uncertain",
      round: 5,
      targetPane: "pf-b_meta_review_notify_uncertain:0.3"
    }, {
      runtime: {
        tmux: {
          runner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
          sendSubmissionRequestMessage,
          confirmSubmission
        }
      }
    });

    expect(result).toEqual({
      status: "uncertain",
      reasonCode: "META_REVIEW_REQUEST_DELIVERY_UNCONFIRMED",
      message: "meta-reviewer pane did not confirm structured submit request delivery."
    });
    expect(confirmSubmission).toHaveBeenCalledTimes(1);
  });

  it("returns failed when pane scrollback shows the configured meta-reviewer exited", async () => {
    const runTmux = vi.fn(async () => ({
      stdout: "opencode exited (code 1). Dropping to interactive shell.",
      stderr: "",
      exitCode: 0
    }));
    const sendSubmissionRequestMessage = vi.fn(async () => undefined);
    const confirmSubmission = vi.fn(async () => true);

    const result = await notifyMetaReviewer({
      bubbleId: "b_meta_review_notify_pane_exited",
      round: 6,
      targetPane: "pf-b_meta_review_notify_pane_exited:0.3",
      metaReviewerAgent: "opencode"
    }, {
      runtime: {
        tmux: {
          runner: runTmux,
          sendSubmissionRequestMessage,
          confirmSubmission
        }
      }
    });

    expect(result).toEqual({
      status: "failed",
      reasonCode: "META_REVIEWER_PANE_EXITED",
      message: "meta-reviewer pane fell back to interactive shell after opencode exit."
    });
    expect(confirmSubmission).not.toHaveBeenCalled();
  });
});
