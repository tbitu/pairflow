import { describe, expect, it } from "vitest";

import { shouldSkipKickoffAfterStartup } from "../../../../../src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.js";

describe("shouldSkipKickoffAfterStartup (two-paste model)", () => {
  it("does not skip the per-task kickoff when no startup prompt was submitted", () => {
    expect(shouldSkipKickoffAfterStartup("reasonix", false)).toBe(false);
    expect(shouldSkipKickoffAfterStartup("opencode", false)).toBe(false);
    expect(shouldSkipKickoffAfterStartup(undefined, false)).toBe(false);
  });

  it("keeps delivering the kickoff for reasonix (tmux_paste) after a role startup prompt", () => {
    // reasonix: role-identity startup paste + per-task kickoff paste are both
    // intended ("two paste" model), so the kickoff must NOT be skipped.
    expect(shouldSkipKickoffAfterStartup("reasonix", true)).toBe(false);
  });

  it("skips the kickoff for opencode after its CLI --agent role prompt", () => {
    // opencode receives the role via `--agent PF-*`; a duplicate kickoff paste
    // would be "double input" steering confusion.
    expect(shouldSkipKickoffAfterStartup("opencode", true)).toBe(true);
  });

  it("keeps the historical skip for unknown/undefined agents", () => {
    expect(shouldSkipKickoffAfterStartup(undefined, true)).toBe(true);
  });
});
