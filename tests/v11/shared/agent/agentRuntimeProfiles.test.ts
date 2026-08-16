import { describe, expect, it } from "vitest";

import {
  getAgentRuntimeProfile,
  isAgentNameRegistered
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

  it("declares the reasonix profile for tmux-paste, non-concurrent operation", () => {
    const profile = getAgentRuntimeProfile("reasonix");
    expect(profile.startupPromptDelivery).toBe("tmux_paste");
    expect(profile.minimalPastedGuidance).toBe(false);
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
});
