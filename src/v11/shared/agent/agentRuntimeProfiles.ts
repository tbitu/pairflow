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
    minimalPastedGuidance: false,
    postEmitInterruption: "none",
    trustPromptHandling: "none",
    readiness: "reasonix",
    planWatchBackend: "reasonix",
    supportsConcurrentPanes: false
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
