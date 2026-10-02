import { ensureBubbleInstanceIdForMutation } from "../../infrastructure/artifact/bubble/bubbleInstanceId.js";
import { resolveBubbleById } from "../../infrastructure/executor/workspace/bubbleLookup.js";
import {
  readStateSnapshot,
  writeStateSnapshot
} from "../../infrastructure/state/stateStore.js";
import { appendProtocolEnvelope } from "../../infrastructure/artifact/transcript/transcriptStore.js";
import {
  emitDeliveryNotificationAck,
  resolveDeliveryMessageRef
} from "../../infrastructure/channel/tmux/tmuxDelivery.js";
import type { EmitHumanReplyDependencies } from "../../application/reply/replyCommandContract.js";

export const replyBubbleDependencyDefaults: EmitHumanReplyDependencies = {
  appendProtocolEnvelope,
  emitDeliveryNotificationAck,
  ensureBubbleInstanceIdForMutation,
  readStateSnapshot,
  resolveBubbleById,
  resolveDeliveryMessageRef,
  writeStateSnapshot
};
