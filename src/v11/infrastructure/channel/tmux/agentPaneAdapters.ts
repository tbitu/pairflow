import type { AgentName } from "../../../../contracts/kernel/agentIdentity.js";
import type {
  AgentPaneAdapter,
  AgentPaneReadinessOptions
} from "../../../shared/agent/agentPaneAdapter.js";
import {
  getAgentRuntimeProfile,
  isAgentNameRegistered,
  resolveStartupPasteSettleMs,
  resolveTmuxPasteOptions
} from "../../../shared/agent/agentRuntimeProfiles.js";
import type { TmuxRunner } from "../../../ports/tmuxSessions.js";
import type { SendAndSubmitTmuxPaneMessageOptions } from "../../../ports/tmuxDelivery.js";
import { waitForOpencodePaneReady } from "./tmuxOpencodeReadiness.js";
import { waitForReasonixPaneReady } from "./tmuxReasonixReadiness.js";
import { sendAndSubmitTmuxPaneMessage } from "./tmuxPaneWrite.js";

/** Generic agent prompt line (`>` / `❯` / `›`), with optional pane-border glyph prefix. */
const PROMPT_LINE_PATTERN = /^\s*(?:[|│┃]\s*)*[>❯›]/u;
/** opencode bottom-bar boundary of the input box. */
const OPENCODE_BOTTOM_BAR_PATTERN = /▀▀▀▀/u;
/** opencode input-box side boundary. */
const OPENCODE_INPUT_BOX_PATTERN = /^\s*┃/u;

function findLastIndex(
  lines: readonly string[],
  predicate: (line: string) => boolean
): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (predicate(lines[i]!)) {
      return i;
    }
  }
  return -1;
}

function isPromptLine(line: string): boolean {
  return PROMPT_LINE_PATTERN.test(line);
}

/** Shared opencode prompt-index derivation (generic prompt first, then bottom-bar fallback). */
function findOpencodePromptIndex(lines: readonly string[]): number {
  const promptIndex = findLastIndex(lines, isPromptLine);
  if (promptIndex >= 0) {
    return promptIndex;
  }
  const bottomBarIndex = findLastIndex(lines, (line) =>
    OPENCODE_BOTTOM_BAR_PATTERN.test(line)
  );
  if (bottomBarIndex > 0) {
    let topOfInputIndex = bottomBarIndex - 1;
    while (
      topOfInputIndex >= 0
      && OPENCODE_INPUT_BOX_PATTERN.test(lines[topOfInputIndex]!)
    ) {
      topOfInputIndex -= 1;
    }
    return topOfInputIndex + 1;
  }
  return -1;
}

function resolvePasteOptions(agentName: AgentName): SendAndSubmitTmuxPaneMessageOptions {
  // opencode keeps the legacy 1024-char chunk default; reasonix overrides with
  // its smaller chunks / per-chunk submit / collapse options.
  return { maxChunkLength: 1024, ...resolveTmuxPasteOptions(agentName) };
}

/**
 * Accept opencode's first-run folder-trust / bypass-permissions prompts.
 * reasonix has no such prompt, so only the opencode adapter uses this.
 */
async function acceptOpencodeTrustPrompt(
  runner: TmuxRunner,
  targetPane: string
): Promise<boolean> {
  let accepted = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const capture = await runner(["capture-pane", "-pt", targetPane], {
      allowFailure: true
    });
    if (capture.exitCode !== 0) {
      return accepted;
    }

    const normalized = capture.stdout.toLowerCase();
    if (
      normalized.includes("ask anything")
      || normalized.includes("tab agents")
      || normalized.includes("ctrl+p commands")
    ) {
      return accepted;
    }

    const looksLikeOpencodeFolderTrustPrompt =
      normalized.includes("security guide")
      && normalized.includes("trust this folder");
    const looksLikeOpencodeBypassPermissionsPrompt =
      normalized.includes("bypass permissions mode")
      && normalized.includes("accept");
    const looksLikeOpencodeTrustPrompt =
      normalized.includes("do you trust the contents of this directory");

    if (looksLikeOpencodeFolderTrustPrompt || looksLikeOpencodeBypassPermissionsPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "Enter");
      accepted = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    if (looksLikeOpencodeTrustPrompt) {
      await sendAndSubmitTmuxPaneMessage(runner, targetPane, "1");
      accepted = true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }

    return accepted;
  }

  return accepted;
}

const opencodePaneAdapter: AgentPaneAdapter = {
  name: "opencode",
  waitForReady(runner, targetPane, options?: AgentPaneReadinessOptions) {
    return waitForOpencodePaneReady({
      runner,
      targetPane,
      ...(options?.attempts !== undefined ? { attempts: options.attempts } : {}),
      ...(options?.retryDelayMs !== undefined
        ? { retryDelayMs: options.retryDelayMs }
        : {}),
      ...(options?.sleepForDelayMs !== undefined
        ? { sleepForDelayMs: options.sleepForDelayMs }
        : {}),
      ...(options?.settleDelayMs !== undefined
        ? { settleDelayMs: options.settleDelayMs }
        : {})
    });
  },
  findLastPromptIndex(lines) {
    return findOpencodePromptIndex(lines);
  },
  hasVisiblePrompt(output) {
    const lines = output.split("\n");
    const hasChrome =
      lines.some((line) => OPENCODE_BOTTOM_BAR_PATTERN.test(line))
      || /ask anything/iu.test(output)
      || /tab agents/iu.test(output)
      || /ctrl\+p commands/iu.test(output)
      || lines.some((line) => OPENCODE_INPUT_BOX_PATTERN.test(line));
    if (hasChrome) {
      return true;
    }
    return lines.some(isPromptLine);
  },
  acceptTrustPrompt(runner, targetPane) {
    return acceptOpencodeTrustPrompt(runner, targetPane);
  },
  isBusy(paneOutput) {
    return getAgentRuntimeProfile("opencode").paneBusyPatterns.some((pattern) =>
      pattern.test(paneOutput)
    );
  },
  resolvePasteOptions() {
    return resolvePasteOptions("opencode");
  },
  supportsConcurrentPanes: true,
  startupPromptDelivery: "cli_arg",
  trustPromptHandling: "opencode",
  postEmitInterruption: "opencode_double_escape",
  startupPasteSettleMs: 0,
  minimalPastedGuidance: true,
  planWatchBackend: "opencode"
};

const reasonixPaneAdapter: AgentPaneAdapter = {
  name: "reasonix",
  waitForReady(runner, targetPane, options?: AgentPaneReadinessOptions) {
    return waitForReasonixPaneReady({
      runner,
      targetPane,
      ...(options?.attempts !== undefined ? { attempts: options.attempts } : {}),
      ...(options?.retryDelayMs !== undefined
        ? { retryDelayMs: options.retryDelayMs }
        : {}),
      ...(options?.sleepForDelayMs !== undefined
        ? { sleepForDelayMs: options.sleepForDelayMs }
        : {})
    });
  },
  findLastPromptIndex(lines) {
    return findLastIndex(lines, isPromptLine);
  },
  hasVisiblePrompt(output) {
    return output.split("\n").some(isPromptLine);
  },
  acceptTrustPrompt() {
    return Promise.resolve(false);
  },
  isBusy(paneOutput) {
    return getAgentRuntimeProfile("reasonix").paneBusyPatterns.some((pattern) =>
      pattern.test(paneOutput)
    );
  },
  resolvePasteOptions() {
    return resolvePasteOptions("reasonix");
  },
  supportsConcurrentPanes: false,
  startupPromptDelivery: "tmux_paste",
  trustPromptHandling: "none",
  postEmitInterruption: "none",
  startupPasteSettleMs: resolveStartupPasteSettleMs("reasonix"),
  minimalPastedGuidance: true,
  planWatchBackend: "reasonix"
};

/** Concrete adapter for a registered agent name. Unknown names fall back to opencode. */
export function getAgentPaneAdapter(agentName: AgentName): AgentPaneAdapter {
  const profile = getAgentRuntimeProfile(agentName);
  return profile.readiness === "reasonix" ? reasonixPaneAdapter : opencodePaneAdapter;
}

/**
 * Resolve the pane adapter for a possibly-undefined agent name. Undefined or
 * unregistered agents keep the historical opencode behavior.
 */
export function resolveAgentPaneAdapter(
  agentName: AgentName | undefined
): AgentPaneAdapter {
  if (agentName !== undefined && isAgentNameRegistered(agentName)) {
    return getAgentPaneAdapter(agentName);
  }
  return opencodePaneAdapter;
}
