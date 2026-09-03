import type { AgentName } from "../../../contracts/kernel/agentIdentity.js";

/**
 * Per-agent runtime profile registry.
 *
 * Every behavior that differs between coding agents (launch argv, startup
 * prompt delivery, pasted-guidance verbosity, post-emit interruption, trust
 * prompt handling, TUI readiness, plan-watch backend, pane concurrency) is
 * expressed here instead of as scattered `agentName === "opencode"` checks.
 *
 * opencode's profile reproduces today's behavior verbatim; reasonix gets its
 * own profile (launch via `npx reasonix code`, npm `reasonix` package).
 */

export type StartupPromptDeliveryMode = "cli_arg" | "tmux_paste";

/** opencode receives its startup prompt through CLI args; reasonix has no
 * `--prompt` flag, so the startup prompt must be pasted into the TUI. */
export const startupPromptDeliveryModes: readonly StartupPromptDeliveryMode[] = [
  "cli_arg",
  "tmux_paste"
];

export type PostEmitInterruptionMode =
  | "opencode_double_escape"
  | "none";

/** The opencode TUI requires two Escape presses (with delay) to interrupt a
 * running turn after `pairflow agent emit`. reasonix does not need this
 * (single Esc cancels a running turn; the double-Esc-with-delay sequence is
 * not part of its hand-over contract). */
export const postEmitInterruptionModes: readonly PostEmitInterruptionMode[] = [
  "opencode_double_escape",
  "none"
];

export type TrustPromptHandlingMode = "opencode" | "none";

/** opencode shows folder-trust / bypass-permissions prompts on first launch in
 * a directory; reasonix has no such prompt (its first-run setup is the
 * `reasonix setup` wizard, run before pairflow launches it). */
export const trustPromptHandlingModes: readonly TrustPromptHandlingMode[] = [
  "opencode",
  "none"
];

export type AgentReadinessMode = "opencode" | "reasonix";

export type PlanWatchBackendName = "opencode" | "reasonix";

export interface AgentRuntimeProfile {
  name: AgentName;
  /** How the startup prompt reaches the agent on launch/resume. */
  startupPromptDelivery: StartupPromptDeliveryMode;
  /**
   * opencode receives its role context via CLI args, so pasted guidance would
   * be redundant (the OVERFLOW double-input rules). reasonix receives all
   * context through tmux paste, so it needs the full guidance text.
   */
  minimalPastedGuidance: boolean;
  /** How the CLI interrupts the agent's turn after `pairflow agent emit`. */
  postEmitInterruption: PostEmitInterruptionMode;
  /** Whether pane bootstrap must accept an agent-specific trust prompt. */
  trustPromptHandling: TrustPromptHandlingMode;
  /** Which tmux readiness module detects the agent TUI. */
  readiness: AgentReadinessMode;
  /** Which plan-watch runner backend drives headless executions. */
  planWatchBackend: PlanWatchBackendName;
  /**
   * Whether multiple agent panes can be alive in one bubble simultaneously.
   * reasonix enforces a machine-wide single active interactive session
   * ("this session is in use by another Reasonix window or process"), so a
   * bubble using reasonix must not keep idle role panes alive.
   */
  supportsConcurrentPanes: boolean;
  /**
   * tmux paste batching for long messages. reasonix's TUI composer drops
   * keystrokes when flooded with large send-keys bursts (a ~1KB chunk at
   * opencode's cadence is lost; short messages arrive fine), so reasonix
   * pastes in smaller chunks with a short gap between them and a modest
   * submit delay. opencode leaves these undefined and keeps the legacy
   * 1024-char / 200 ms / dynamic-delay behavior.
   */
  tmuxPasteChunkLengthChars?: number;
  tmuxPasteChunkDelayMs?: number;
  tmuxPasteSubmitDelayMs?: number;
  /**
   * Whether long messages must be submitted as one turn per chunk (Enter per
   * chunk) because the composer input field is capacity-limited. reasonix
   * overflows its single-line composer on large pastes and then rejects all
   * further input (including Enter); per-chunk submit keeps each turn small.
   */
  tmuxPasteSubmitPerChunk?: boolean;
  /**
   * Whether long messages must be delivered via the tmux paste buffer so a
   * genuine terminal paste event (tea.PasteMsg) reaches the agent. reasonix's
   * Bubble Tea composer only inserts long text on a real paste; send-keys
   * keystrokes overflow its single-line field and lock it.
   */
  tmuxPasteViaBuffer?: boolean;
  /**
   * Whether pasted messages must be delivered as a single line (newlines
   * collapsed to spaces). reasonix's composer switches to multiline mode when
   * the pasted text contains newline bytes; in that mode plain Enter inserts a
   * newline instead of sending, so multiline messages never submit. Collapsing
   * to one line keeps Enter as the send key.
   */
  collapsePastedNewlines?: boolean;
  /**
   * Extra delay applied after the TUI readiness prompt is detected and before
   * the message is pasted. reasonix's composer renders its prompt before it is
   * fully ready to accept input, so pasting immediately after
   * waitForTuiReady (~3s) drops the input. A settle delay restores the
   * historical ~30s paste timing that reliably landed.
   */
  tmuxPasteSettleMs?: number;
}

const profiles: Record<AgentName, AgentRuntimeProfile> = {
  opencode: {
    name: "opencode",
    startupPromptDelivery: "cli_arg",
    minimalPastedGuidance: true,
    postEmitInterruption: "opencode_double_escape",
    trustPromptHandling: "opencode",
    readiness: "opencode",
    planWatchBackend: "opencode",
    supportsConcurrentPanes: true
  },
  reasonix: {
    name: "reasonix",
    startupPromptDelivery: "tmux_paste",
    // reasonix's composer overflows on long pasted guidance; give it the same
    // short kickoff opencode gets (bubble id + state + task path) and let it
    // read the task artifact itself. Keystroke delivery is proven to work.
    minimalPastedGuidance: true,
    postEmitInterruption: "none",
    trustPromptHandling: "none",
    readiness: "reasonix",
    planWatchBackend: "reasonix",
    supportsConcurrentPanes: false,
    tmuxPasteChunkLengthChars: 200,
    tmuxPasteChunkDelayMs: 250,
    tmuxPasteSubmitDelayMs: 1500,
    tmuxPasteSubmitPerChunk: true,
    tmuxPasteViaBuffer: false,
    // Collapse newlines so pasted messages stay single-line and Enter sends.
    collapsePastedNewlines: true,
    // reasonix renders its prompt before it is ready; settle ~25s before paste
    // to restore the historical ~30s paste timing that landed.
    tmuxPasteSettleMs: 25000
  }
};

export function getAgentRuntimeProfile(
  agentName: AgentName
): AgentRuntimeProfile {
  const profile = profiles[agentName];
  if (profile === undefined) {
    throw new Error(
      `AGENT_RUNTIME_PROFILE_UNKNOWN: context=agent_runtime_profile agentName=${agentName} no runtime profile registered.`
    );
  }
  return profile;
}

export function isAgentNameRegistered(agentName: string): boolean {
  return Object.prototype.hasOwnProperty.call(profiles, agentName);
}

/**
 * Resolve per-agent tmux paste batching options for long messages.
 * Returns an empty object for opencode (and unknown/undefined agents), so
 * callers keep the legacy 1024-char / 200 ms / dynamic-submit-delay behavior
 * byte-identical. reasonix returns smaller chunks + inter-chunk delay + a
 * modest submit delay because its TUI composer drops flooded keystrokes.
 */
export function resolveTmuxPasteOptions(
  agentName: AgentName | undefined
): {
  maxChunkLength?: number;
  interChunkDelayMs?: number;
  submitDelayMs?: number;
  submitPerChunk?: boolean;
  pasteViaBuffer?: boolean;
  collapseNewlines?: boolean;
  settleMs?: number;
} {
  if (agentName === undefined || !isAgentNameRegistered(agentName)) {
    return {};
  }
  const profile = getAgentRuntimeProfile(agentName);
  if (profile.tmuxPasteChunkLengthChars === undefined) {
    return {};
  }
  return {
    maxChunkLength: profile.tmuxPasteChunkLengthChars,
    ...(profile.tmuxPasteChunkDelayMs !== undefined
      ? { interChunkDelayMs: profile.tmuxPasteChunkDelayMs }
      : {}),
    ...(profile.tmuxPasteSubmitDelayMs !== undefined
      ? { submitDelayMs: profile.tmuxPasteSubmitDelayMs }
      : {}),
    ...(profile.tmuxPasteSubmitPerChunk === true
      ? { submitPerChunk: true }
      : {}),
    ...(profile.tmuxPasteViaBuffer === true
      ? { pasteViaBuffer: true }
      : {}),
    ...(profile.collapsePastedNewlines === true
      ? { collapseNewlines: true }
      : {}),
    ...(profile.tmuxPasteSettleMs !== undefined
      ? { settleMs: profile.tmuxPasteSettleMs }
      : {})
  };
}
