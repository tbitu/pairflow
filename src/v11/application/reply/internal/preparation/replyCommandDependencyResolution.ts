import type { EmitHumanReplyDependencies } from "../../replyCommandContract.js";
import type { RefreshImplementerContextPort } from "../../../../ports/implementerContext.js";
import type { RefreshReviewerContextPort } from "../../../../ports/reviewerContext.js";
import {
  appendProtocolEnvelope,
  startCommandContextDefaults
} from "../../../start/startCommandDependencyDefaults.js";
import { reviewerDeliveryDefaults } from "../../../pass/reviewerDeliveryDefaults.js";

async function emitDeliveryNotificationAck(
  ...args: Parameters<typeof reviewerDeliveryDefaults.emitDeliveryNotificationAck>
): Promise<
  Awaited<ReturnType<typeof reviewerDeliveryDefaults.emitDeliveryNotificationAck>>
> {
  return reviewerDeliveryDefaults.emitDeliveryNotificationAck(...args);
}

async function ensureBubbleInstanceIdForMutation(
  ...args: Parameters<typeof startCommandContextDefaults.ensureBubbleInstanceIdForMutation>
): Promise<
  Awaited<ReturnType<typeof startCommandContextDefaults.ensureBubbleInstanceIdForMutation>>
> {
  return startCommandContextDefaults.ensureBubbleInstanceIdForMutation(...args);
}

async function readStateSnapshot(
  ...args: Parameters<typeof startCommandContextDefaults.readStateSnapshot>
): Promise<Awaited<ReturnType<typeof startCommandContextDefaults.readStateSnapshot>>> {
  return startCommandContextDefaults.readStateSnapshot(...args);
}

async function resolveBubbleById(
  ...args: Parameters<typeof startCommandContextDefaults.resolveBubbleById>
): Promise<Awaited<ReturnType<typeof startCommandContextDefaults.resolveBubbleById>>> {
  return startCommandContextDefaults.resolveBubbleById(...args);
}

function resolveDeliveryMessageRef(
  ...args: Parameters<typeof reviewerDeliveryDefaults.resolveDeliveryMessageRef>
): ReturnType<typeof reviewerDeliveryDefaults.resolveDeliveryMessageRef> {
  return reviewerDeliveryDefaults.resolveDeliveryMessageRef(...args);
}

export function refreshImplementerContext(): Promise<
  Awaited<ReturnType<RefreshImplementerContextPort>>
> {
  return Promise.resolve({
    refreshed: false,
    reason: "no_runtime_session"
  });
}

export function refreshReviewerContext(): Promise<
  Awaited<ReturnType<RefreshReviewerContextPort>>
> {
  return Promise.resolve({
    refreshed: false,
    reason: "no_runtime_session"
  });
}

const writeStateSnapshot = startCommandContextDefaults.writeStateSnapshot;

const replyCommandDependencyDefaults = {
  appendProtocolEnvelope,
  emitDeliveryNotificationAck,
  ensureBubbleInstanceIdForMutation,
  readStateSnapshot,
  resolveBubbleById,
  resolveDeliveryMessageRef,
  refreshImplementerContext,
  refreshReviewerContext,
  writeStateSnapshot
} as const;

export interface ResolvedReplyCommandDependencies {
  appendProtocolEnvelope: NonNullable<EmitHumanReplyDependencies["appendProtocolEnvelope"]>;
  emitDeliveryNotificationAck: NonNullable<
    EmitHumanReplyDependencies["emitDeliveryNotificationAck"]
  >;
  ensureBubbleInstanceIdForMutation: NonNullable<
    EmitHumanReplyDependencies["ensureBubbleInstanceIdForMutation"]
  >;
  readStateSnapshot: NonNullable<EmitHumanReplyDependencies["readStateSnapshot"]>;
  resolveBubbleById: NonNullable<EmitHumanReplyDependencies["resolveBubbleById"]>;
  resolveDeliveryMessageRef: NonNullable<
    EmitHumanReplyDependencies["resolveDeliveryMessageRef"]
  >;
  refreshImplementerContext: NonNullable<
    EmitHumanReplyDependencies["refreshImplementerContext"]
  >;
  refreshReviewerContext: NonNullable<
    EmitHumanReplyDependencies["refreshReviewerContext"]
  >;
  writeStateSnapshot: NonNullable<EmitHumanReplyDependencies["writeStateSnapshot"]>;
}

export function resolveReplyCommandDependencies(
  dependencies: EmitHumanReplyDependencies = {}
): ResolvedReplyCommandDependencies {
  return {
    appendProtocolEnvelope:
      dependencies.appendProtocolEnvelope
      ?? replyCommandDependencyDefaults.appendProtocolEnvelope,
    emitDeliveryNotificationAck:
      dependencies.emitDeliveryNotificationAck
      ?? replyCommandDependencyDefaults.emitDeliveryNotificationAck,
    ensureBubbleInstanceIdForMutation:
      dependencies.ensureBubbleInstanceIdForMutation
      ?? replyCommandDependencyDefaults.ensureBubbleInstanceIdForMutation,
    readStateSnapshot:
      dependencies.readStateSnapshot
      ?? replyCommandDependencyDefaults.readStateSnapshot,
    resolveBubbleById:
      dependencies.resolveBubbleById ?? replyCommandDependencyDefaults.resolveBubbleById,
    resolveDeliveryMessageRef:
      dependencies.resolveDeliveryMessageRef
      ?? replyCommandDependencyDefaults.resolveDeliveryMessageRef,
    refreshImplementerContext:
      dependencies.refreshImplementerContext
      ?? replyCommandDependencyDefaults.refreshImplementerContext,
    refreshReviewerContext:
      dependencies.refreshReviewerContext
      ?? replyCommandDependencyDefaults.refreshReviewerContext,
    writeStateSnapshot:
      dependencies.writeStateSnapshot
      ?? replyCommandDependencyDefaults.writeStateSnapshot
  };
}
