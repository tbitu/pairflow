import { describe, expect, it } from "vitest";

import { shouldSubmitStartupPrompt } from "../../../../src/v11/shared/command/startupPromptGate.js";

describe("shouldSubmitStartupPrompt", () => {
  it("never submits via tmux paste for opencode (CLI-arg delivery)", () => {
    expect(shouldSubmitStartupPrompt("opencode", "some prompt")).toBe(false);
    expect(shouldSubmitStartupPrompt("opencode", undefined)).toBe(false);
  });

  it("submits a non-empty startup prompt for reasonix (tmux-paste delivery)", () => {
    expect(shouldSubmitStartupPrompt("reasonix", "resume implementer")).toBe(true);
  });

  it("does not submit empty/whitespace prompts for reasonix", () => {
    expect(shouldSubmitStartupPrompt("reasonix", undefined)).toBe(false);
    expect(shouldSubmitStartupPrompt("reasonix", "   ")).toBe(false);
    expect(shouldSubmitStartupPrompt("reasonix", "")).toBe(false);
  });
});
