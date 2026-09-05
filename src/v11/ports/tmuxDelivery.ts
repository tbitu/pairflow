import type {
  DeliveryAck,
  EmitDeliveryNotificationInput,
  ResolveDeliveryMessageRefInput
} from "../shared/delivery/tmuxDeliveryContract.js";
import type * as TmuxDeliveryContract from "../shared/delivery/tmuxDeliveryContract.js";

export type {
  AcceptedDeliveryAck,
  DeliveryAck,
  DeliveryAckReasonCode,
  DeliveryAckStatus,
  DeliveryFailureReason,
  DeliveryTargetReasonCode,
  EmitDeliveryNotificationInput,
  RejectedDeliveryAck,
  ResolveDeliveryMessageRefInput,
  RetryStuckAgentInputOptions,
  RetryStuckAgentInputResult
} from "../shared/delivery/tmuxDeliveryContract.js";

export type EmitDeliveryNotificationAckPort = (
  input: EmitDeliveryNotificationInput
) => Promise<DeliveryAck>;

export type ResolveDeliveryMessageRefPort = (
  input: ResolveDeliveryMessageRefInput
) => string;

import type { TmuxRunner } from "./tmuxSessions.js";

export type RetryStuckAgentInputPort = (
  input: TmuxDeliveryContract.RetryStuckAgentInputOptions
) => Promise<TmuxDeliveryContract.RetryStuckAgentInputResult>;

/**
 * Options accepted by the single tmux pane write primitive
 * (`sendAndSubmitTmuxPaneMessage`). Declared here (ports) so the DI port and
 * the concrete infrastructure implementation share one contract instead of the
 * port silently narrowing the implementation's option set.
 */
export interface SendAndSubmitTmuxPaneMessageOptions {
  requireSuccess?: boolean;
  submitDelayMs?: number;
  sleepForDelayMs?: (delayMs: number) => Promise<void>;
  maxChunkLength?: number;
  /** Gap between literal send-keys chunks. Defaults to 200ms. */
  interChunkDelayMs?: number;
  /** Submit each chunk as its own turn (Enter per chunk). */
  submitPerChunk?: boolean;
  /** Paste via the tmux paste buffer instead of literal keystrokes. */
  pasteViaBuffer?: boolean;
  /** Buffer name for the paste-buffer path. */
  pasteBufferName?: string;
  /** Override the temp-file writer for the paste-buffer path (testing). */
  writeTempFile?: (content: string) => Promise<string>;
  /** Collapse newline sequences to a single space before pasting. */
  collapseNewlines?: boolean;
  /** Extra quiet time before the paste (TUI prompt rendered but not yet input-ready). */
  settleMs?: number;
}

export type SendAndSubmitTmuxPaneMessagePort = (
  runner: TmuxRunner,
  targetPane: string,
  message: string,
  options?: SendAndSubmitTmuxPaneMessageOptions
) => Promise<void>;
