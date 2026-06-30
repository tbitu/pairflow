import { emitBubbleNotification } from "../../infrastructure/channel/notifications.js";
import {
  emitDeliveryNotificationAck,
  retryStuckAgentInput
} from "../../infrastructure/channel/tmux/tmuxDelivery.js";
import { sendAndSubmitTmuxPaneMessage } from "../../infrastructure/channel/tmux/tmuxInput.js";
import { appendWatchdogTrace } from "../../infrastructure/artifact/watchdog/watchdogTraceStore.js";
import {
  readStateSnapshot,
  writeStateSnapshot
} from "../../infrastructure/state/stateStore.js";
import { appendProtocolEnvelope } from "../../infrastructure/artifact/transcript/transcriptStore.js";
import { resolveBubbleById } from "../../infrastructure/executor/workspace/bubbleLookup.js";
import { readRuntimeSessionsRegistry } from "../runtimeSessions/runtimeSessionsDefaults.js";
import { runTmux } from "../../infrastructure/channel/tmux/tmuxRunner.js";
import {
  readWatchdogPaneActivity,
  writeWatchdogPaneActivity
} from "./watchdogPaneActivityDefaults.js";
import { restartBubble } from "../../application/restart/restartCommandApi.js";
import { restartBubbleDependencyDefaults } from "../restart/restartCommandDefaults.js";
import type { RestartBubbleInput } from "../../application/restart/restartCommandContract.js";

export const watchdogCommandDefaults = {
  appendProtocolEnvelope,
  appendWatchdogTrace,
  emitBubbleNotification,
  emitDeliveryNotificationAck,
  retryStuckAgentInput,
  sendAndSubmitTmuxPaneMessage,
  readStateSnapshot,
  readRuntimeSessionsRegistry,
  readWatchdogPaneActivity,
  resolveBubbleById,
  runTmux,
  writeStateSnapshot,
  writeWatchdogPaneActivity,
  restartBubble: (input: RestartBubbleInput) => restartBubble(input, restartBubbleDependencyDefaults)
} as const;
