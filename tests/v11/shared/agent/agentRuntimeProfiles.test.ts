import { describe, expect, it } from "vitest";

import {
  getAgentRuntimeProfile,
  isAgentNameRegistered,
  isPaneBusyOutput,
  resolvePaneBusyPatterns,
  resolveTmuxPasteOptions
} from "../../../../src/v11/shared/agent/agentRuntimeProfiles.js";

describe("agentRuntimeProfiles", () => {
  it("keeps the opencode profile byte-identical to the pre-reasonix behavior", () => {
    const profile = getAgentRuntimeProfile("opencode");
    expect(profile.startupPromptDelivery).toBe("cli_arg");
    expect(profile.minimalPastedGuidance).toBe(true);
    expect(profile.postEmitInterruption).toBe("opencode_double_escape");
    expect(profile.trustPromptHandling).toBe("opencode");
    expect(profile.readiness).toBe("opencode");
    expect(profile.planWatchBackend).toBe("opencode");
    expect(profile.supportsConcurrentPanes).toBe(true);
  });

  it("declares the reasonix profile for non-concurrent operation with file-based role instructions", () => {
    const profile = getAgentRuntimeProfile("reasonix");
    expect(profile.startupPromptDelivery).toBe("none");
    // Short kickoff (minimal guidance) so the pasted message stays tiny and
    // reasonix reads the task artifact itself; keystroke delivery (not buffer).
    expect(profile.minimalPastedGuidance).toBe(true);
    expect(profile.tmuxPasteViaBuffer).toBe(false);
    // Collapse newlines so pasted messages stay single-line and Enter sends.
    expect(profile.collapsePastedNewlines).toBe(true);
    // reasonix does not use the opencode double-Escape-with-delay sequence.
    expect(profile.postEmitInterruption).toBe("none");
    // reasonix has no folder-trust / bypass-permissions prompt.
    expect(profile.trustPromptHandling).toBe("none");
    expect(profile.readiness).toBe("reasonix");
    expect(profile.planWatchBackend).toBe("reasonix");
    // Machine-wide single active interactive session -> no concurrent panes.
    expect(profile.supportsConcurrentPanes).toBe(false);
  });

  it("throws a stable-code error for unknown agents", () => {
    expect(() => getAgentRuntimeProfile("codex" as never)).toThrow(
      "AGENT_RUNTIME_PROFILE_UNKNOWN"
    );
  });

  it("registers only supported agent names", () => {
    expect(isAgentNameRegistered("opencode")).toBe(true);
    expect(isAgentNameRegistered("reasonix")).toBe(true);
    expect(isAgentNameRegistered("codex")).toBe(false);
    expect(isAgentNameRegistered("claude")).toBe(false);
  });

  it("batches reasonix long pastes into small chunks with inter-chunk and submit delays", () => {
    const options = resolveTmuxPasteOptions("reasonix");
    expect(options.maxChunkLength).toBe(200);
    expect(options.interChunkDelayMs).toBe(250);
    expect(options.submitDelayMs).toBe(1500);
    // Deliver via keystrokes (proven-working), not buffer paste.
    expect(options.pasteViaBuffer).toBeUndefined();
  });

  it("keeps the legacy 1024-char / 200ms / dynamic-delay paste for opencode", () => {
    expect(resolveTmuxPasteOptions("opencode")).toEqual({});
    expect(resolveTmuxPasteOptions(undefined)).toEqual({});
  });

  it("detects reasonix as busy during checking, working, compacting, and tool execution", () => {
    const samples = [
      "  ⣯  checking · 283s · ↓25.1K · ✎ 1 in inbox",
      "  ⣾  checking · 392s · ↓59.2K",
      "  ⡿  working · 243s · ↓18.6K · ✎ 1 in inbox",
      "  ⎿  ⠴ working · 5s",
      "  ⣾  compacting · 12s",
      "  ⠋  indexing · 2s",
      "  ● Bash(cd /repo && dotnet build)",
      "thought for 12s",
      "thinking",
      "ctrl-c cancels",
      "✎ 1 in inbox",
      "esc interrupt"
    ];

    for (const sample of samples) {
      expect(
        isPaneBusyOutput({ agentName: "reasonix", paneOutput: sample }),
        `expected sample to be busy: ${sample}`
      ).toBe(true);
    }
  });

  it("distinguishes idle reasonix TUI screen from busy states", () => {
    const patterns = resolvePaneBusyPatterns("reasonix");
    expect(patterns.length).toBeGreaterThan(0);

    const idleScreen = [
      " To-dos 5/5",
      "   ✔ Task complete",
      " ❯ ",
      "   YOLO  · Shift+Tab read-only/workspace/YOLO/plan · Ctrl+Y YOLO    MODEL deepseek-v4-flash",
      "  5-llm-ui-and-config@bubble/5-llm-ui-and-config  +294 -32 ?4"
    ].join("\n");

    expect(isPaneBusyOutput({ agentName: "reasonix", paneOutput: idleScreen })).toBe(false);
  });

  it("falls back to all known busy patterns when agentName is undefined or unregistered", () => {
    expect(
      isPaneBusyOutput({
        agentName: undefined,
        paneOutput: "  ⣯  checking · 283s · ↓25.1K"
      })
    ).toBe(true);
    expect(
      isPaneBusyOutput({
        agentName: undefined,
        paneOutput: "esc interrupt"
      })
    ).toBe(true);
    expect(
      isPaneBusyOutput({
        agentName: undefined,
        paneOutput: "❯ \nidle prompt"
      })
    ).toBe(false);
  });
});
