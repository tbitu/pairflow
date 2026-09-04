import { describe, expect, it } from "vitest";

import { resolveWatchdogTimeoutMinutesForAgent } from "../../../../src/v11/shared/config/watchdogTimeoutResolution.js";

describe("resolveWatchdogTimeoutMinutesForAgent", () => {
  it("falls back to the flat watchdog_timeout_minutes when no override map is configured", () => {
    expect(
      resolveWatchdogTimeoutMinutesForAgent(
        { watchdog_timeout_minutes: 30 },
        "opencode"
      )
    ).toBe(30);
  });

  it("falls back to the flat value when the agent has no entry in the override map", () => {
    expect(
      resolveWatchdogTimeoutMinutesForAgent(
        {
          watchdog_timeout_minutes: 30,
          watchdog_timeout_minutes_by_agent: { opencode: 120 }
        },
        "reasonix"
      )
    ).toBe(30);
  });

  it("uses the per-agent override when configured", () => {
    expect(
      resolveWatchdogTimeoutMinutesForAgent(
        {
          watchdog_timeout_minutes: 30,
          watchdog_timeout_minutes_by_agent: { opencode: 120, reasonix: 30 }
        },
        "opencode"
      )
    ).toBe(120);
  });

  it("falls back to the flat value when no agent is active", () => {
    expect(
      resolveWatchdogTimeoutMinutesForAgent(
        {
          watchdog_timeout_minutes: 30,
          watchdog_timeout_minutes_by_agent: { opencode: 120 }
        },
        null
      )
    ).toBe(30);
  });
});
