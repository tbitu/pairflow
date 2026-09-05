import type { AgentName, AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import type { AgentPaneAdapter } from "../agent/agentPaneAdapter.js";
import type {
  PairflowCommandProfile,
  RoleMcpPolicy
} from "../config/bubbleConfigVocabulary.js";
import type { MetaReviewArtifactReadPort } from "../metaReview/metaReviewArtifactIo.js";
import type { ResolveBubbleByIdPort } from "../../ports/bubbleLookup.js";
import type { SetMetaReviewerPaneBindingPort } from "../../ports/runtimeSessions.js";
import type {
  ReadStateSnapshotPort,
  WriteStateSnapshotPort
} from "../../ports/stateSnapshots.js";
import type {
  AppendProtocolEnvelopePort,
  ReadTranscriptEnvelopesPort
} from "../../ports/transcript.js";
import type { MetaReviewGateTmuxRunner } from "./metaReviewGateTmuxCapabilities.js";
import type { SendAndSubmitTmuxPaneMessageOptions } from "../../ports/tmuxDelivery.js";

export interface NotifyMetaReviewerSubmissionRequestInput {
  bubbleId: string;
  round: number;
  targetPane: string;
  metaReviewerAgent: AgentName;
}

export interface MetaReviewGateNotifyTmuxCapabilities {
  runner?: MetaReviewGateTmuxRunner;
  resolveAgentPaneAdapter?: (agentName: AgentName) => AgentPaneAdapter;
  sendSubmissionRequestMessage?: (
    runner: MetaReviewGateTmuxRunner,
    targetPane: string,
    message: string,
    options?: SendAndSubmitTmuxPaneMessageOptions
  ) => Promise<void>;
  confirmSubmission?: (input: {
    runner: MetaReviewGateTmuxRunner;
    targetPane: string;
    marker: string;
    attempts?: number;
    settleDelayMs?: number;
    retryDelayMs?: number;
    sleepForDelayMs?: (delayMs: number) => Promise<void>;
  }) => Promise<boolean>;
}

export interface MetaReviewGateNotifyRuntimeCapabilities {
  tmux?: MetaReviewGateNotifyTmuxCapabilities;
}

export interface NotifyMetaReviewerSubmissionRequestDependencies {
  runtime?: MetaReviewGateNotifyRuntimeCapabilities;
}

export interface MetaReviewRuntimeDeliveryObservation {
  status: "confirmed" | "uncertain" | "failed";
  reasonCode: string | null;
  message: string;
}

export type NotifyMetaReviewerSubmissionRequest = (
  input: NotifyMetaReviewerSubmissionRequestInput,
  dependencies?: NotifyMetaReviewerSubmissionRequestDependencies
) => Promise<MetaReviewRuntimeDeliveryObservation>;

export interface MetaReviewGatePaneBindingTmuxCapabilities {
  runner?: MetaReviewGateTmuxRunner;
  resolveAgentPaneAdapter?: (agentName: AgentName) => AgentPaneAdapter;
  respawnPaneCommand?: (input: {
    sessionName: string;
    paneIndex: number;
    cwd: string;
    command: string;
    runner?: MetaReviewGateTmuxRunner;
  }) => Promise<void>;
  deactivateOtherRolePanes?: (input: {
    activateInput: {
      sessionName: string;
      role: AgentRole;
      cwd: string;
      runner: MetaReviewGateTmuxRunner;
      paneAgent?: AgentPaneAdapter;
    };
    topologyPaneIndexForRole: (role: AgentRole) => number;
    respawnPane: (input: {
      sessionName: string;
      paneIndex: number;
      command: string;
      cwd: string;
      runner: MetaReviewGateTmuxRunner;
    }) => Promise<void>;
    configureRoleAgent?: (role: AgentRole) => AgentPaneAdapter | undefined;
  }) => Promise<void>;
  waitForPaneReady?: (
    agentName: AgentName | undefined,
    input: {
      runner: MetaReviewGateTmuxRunner;
      targetPane: string;
      attempts?: number;
      retryDelayMs?: number;
    }
  ) => Promise<boolean>;
  sendSubmissionRequestMessage?: (
    runner: MetaReviewGateTmuxRunner,
    targetPane: string,
    message: string,
    options?: Record<string, unknown>
  ) => Promise<void>;
}

export interface MetaReviewGatePaneBindingRuntimeCapabilities {
  buildAgentCommand?: (input: {
    agentName: AgentName;
    bubbleId: string;
    workspacePath?: string;
    worktreePath?: string;
    pairflowCommandProfile?: PairflowCommandProfile;
    roleName?: "implementer" | "reviewer" | "meta_reviewer";
    roleMcpPolicy?: RoleMcpPolicy;
    model?: string;
    opencodeMcpDisableArgs?: string[];
    // Phase 4: Pass metadata for agent to reconstruct situational context.
    // buildAgentCommand should NOT pre-build prompts; instead, let the agent
    // use these fields to understand context based on role.
    round?: number;
    repoPath?: string;
    taskArtifactPath?: string;
    startupPrompt?: string | undefined;
  }) => string;
  tmux?: MetaReviewGatePaneBindingTmuxCapabilities;
}

export interface MetaReviewGateRuntimeCapabilities {
  notify?: MetaReviewGateNotifyRuntimeCapabilities;
  paneBinding?: MetaReviewGatePaneBindingRuntimeCapabilities;
}

export interface ResolveMetaReviewerPaneWarningInput {
  setMetaReviewerPane: SetMetaReviewerPaneBindingPort;
  notifySubmissionRequest?: NotifyMetaReviewerSubmissionRequest;
  runtime?: MetaReviewGateRuntimeCapabilities;
  sessionsPath: string;
  bubbleId: string;
  round: number;
  now: Date;
  taskArtifactPath: string;
  pairflowCommandProfile: PairflowCommandProfile;
  metaReviewerAgent: AgentName;
  metaReviewerMcpPolicy?: RoleMcpPolicy;
  metaReviewerModel?: string;
  configureRoleAgent?: (role: AgentRole) => AgentName | undefined;
}

export type ResolveMetaReviewerPaneWarning = (
  input: ResolveMetaReviewerPaneWarningInput
) => Promise<{
  delivery: MetaReviewRuntimeDeliveryObservation;
  shouldDeactivate: boolean;
}>;

export interface ApplyMetaReviewGateOnConvergenceInput {
  bubbleId: string;
  summary: string;
  refs?: string[];
  findings?: Array<{
    severity: "P2" | "P3";
    title: string;
    refs?: string[];
  }>;
  repoPath?: string;
  cwd?: string;
  now?: Date;
}

export interface ApplyMetaReviewGateOnConvergenceDependencies {
  resolveBubbleById?: ResolveBubbleByIdPort;
  readStateSnapshot?: ReadStateSnapshotPort;
  writeStateSnapshot?: WriteStateSnapshotPort;
  appendProtocolEnvelope?: AppendProtocolEnvelopePort;
  readTranscriptEnvelopes?: ReadTranscriptEnvelopesPort;
  setMetaReviewerPaneBinding?: SetMetaReviewerPaneBindingPort;
  notifyMetaReviewerSubmissionRequest?: NotifyMetaReviewerSubmissionRequest;
  resolveMetaReviewerPaneWarning?: ResolveMetaReviewerPaneWarning;
  runtime?: MetaReviewGateRuntimeCapabilities;
  readFile?: MetaReviewArtifactReadPort;
}
