import { readFile } from "node:fs/promises";

import { buildAgentCommand } from "../../shared/command/agentCommand.js";
import { resolveBubbleById } from "../../infrastructure/executor/workspace/bubbleLookup.js";
import {
  appendProtocolEnvelope,
  readTranscriptEnvelopes
} from "../../infrastructure/artifact/transcript/transcriptStore.js";
import {
  readStateSnapshot,
  writeStateSnapshot
} from "../../infrastructure/state/stateStore.js";
import { setMetaReviewerPaneBinding } from "../../infrastructure/channel/tmux/metaReviewerPaneBinding.js";
import { runTmux } from "../../infrastructure/channel/tmux/tmuxManager.js";
import {
  confirmMetaReviewSubmission,
  deactivateOtherMetaReviewPanes,
  resolveMetaReviewAgentPaneAdapter,
  respawnMetaReviewPane,
  sendMetaReviewSubmissionRequest,
  waitForMetaReviewPaneReady
} from "../../infrastructure/channel/tmux/metaReviewGateTmuxDefaultBindings.js";
import type {
  ApplyMetaReviewGateOnConvergenceDependencies,
  MetaReviewGateNotifyRuntimeCapabilities,
  MetaReviewGatePaneBindingRuntimeCapabilities
} from "../../shared/metaReviewGate/index.js";

export interface MetaReviewGateDependencyDefaults {
  appendProtocolEnvelope:
    NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["appendProtocolEnvelope"]>;
  readFile: NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["readFile"]>;
  readTranscriptEnvelopes:
    NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["readTranscriptEnvelopes"]>;
  readStateSnapshot:
    NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["readStateSnapshot"]>;
  resolveBubbleById:
    NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["resolveBubbleById"]>;
  setMetaReviewerPaneBinding:
    NonNullable<
      ApplyMetaReviewGateOnConvergenceDependencies["setMetaReviewerPaneBinding"]
    >;
  runtime: {
    notify: {
      tmux: {
        runner:
          NonNullable<
            NonNullable<MetaReviewGateNotifyRuntimeCapabilities["tmux"]>["runner"]
          >;
        resolveAgentPaneAdapter:
          NonNullable<
            NonNullable<
              MetaReviewGateNotifyRuntimeCapabilities["tmux"]
            >["resolveAgentPaneAdapter"]
          >;
        sendSubmissionRequestMessage:
          NonNullable<
            NonNullable<
              MetaReviewGateNotifyRuntimeCapabilities["tmux"]
            >["sendSubmissionRequestMessage"]
          >;
        confirmSubmission:
          NonNullable<
            NonNullable<
              MetaReviewGateNotifyRuntimeCapabilities["tmux"]
            >["confirmSubmission"]
          >;
      };
    };
    paneBinding: {
      buildAgentCommand:
        NonNullable<MetaReviewGatePaneBindingRuntimeCapabilities["buildAgentCommand"]>;
      tmux: {
        runner:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["runner"]
          >;
        resolveAgentPaneAdapter:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["resolveAgentPaneAdapter"]
          >;
        respawnPaneCommand:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["respawnPaneCommand"]
          >;
        deactivateOtherRolePanes?:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["deactivateOtherRolePanes"]
          >;
        waitForPaneReady?:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["waitForPaneReady"]
          >;
        sendSubmissionRequestMessage?:
          NonNullable<
            NonNullable<
              MetaReviewGatePaneBindingRuntimeCapabilities["tmux"]
            >["sendSubmissionRequestMessage"]
          >;
      };
    };
  };
  writeStateSnapshot:
    NonNullable<ApplyMetaReviewGateOnConvergenceDependencies["writeStateSnapshot"]>;
}

export const metaReviewGateDependencyDefaults = {
  appendProtocolEnvelope,
  readFile,
  readTranscriptEnvelopes,
  readStateSnapshot,
  resolveBubbleById,
  setMetaReviewerPaneBinding,
  runtime: {
    notify: {
      tmux: {
        runner: runTmux,
        resolveAgentPaneAdapter: resolveMetaReviewAgentPaneAdapter,
        sendSubmissionRequestMessage: sendMetaReviewSubmissionRequest,
        confirmSubmission: confirmMetaReviewSubmission
      }
    },
    paneBinding: {
      buildAgentCommand,
      tmux: {
        runner: runTmux,
        resolveAgentPaneAdapter: resolveMetaReviewAgentPaneAdapter,
        respawnPaneCommand: respawnMetaReviewPane,
        deactivateOtherRolePanes: deactivateOtherMetaReviewPanes,
        waitForPaneReady: waitForMetaReviewPaneReady,
        sendSubmissionRequestMessage: sendMetaReviewSubmissionRequest
      }
    }
  },
  writeStateSnapshot
} as const satisfies MetaReviewGateDependencyDefaults;
