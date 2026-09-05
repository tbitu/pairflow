import { beforeEach, describe, expect, it, vi } from "vitest";
import { deactivateOtherRolePanes } from "../../../../src/v11/shared/channel/rolePaneLifecycle.js";
import { resolveAgentPaneAdapter } from "../../../../src/v11/infrastructure/channel/tmux/agentPaneAdapters.js";
import type { AgentRole } from "../../../../src/contracts/kernel/agentIdentity.js";
import type { TmuxRunner } from "../../../../src/v11/ports/tmuxSessions.js";

function topologyPaneIndexForRole(role: AgentRole): number {
  switch (role) {
    case "implementer":
      return 1;
    case "reviewer":
      return 2;
    case "meta_reviewer":
      return 3;
  }
}

const respawnPane = vi.fn(async (input: {
  sessionName: string;
  paneIndex: number;
  command: string;
  cwd: string;
  runner: TmuxRunner;
}): Promise<void> => {
  void input;
});

describe("deactivateOtherRolePanes", () => {
  beforeEach(() => {
    respawnPane.mockClear();
  });

  it("does not deactivate opencode reviewer/meta panes when reasonix implementer activates", async () => {
    const runner: TmuxRunner = (() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })) as TmuxRunner;
    await deactivateOtherRolePanes({
      activateInput: {
        sessionName: "sess",
        role: "implementer",
        cwd: "/ws",
        runner,
        paneAgent: resolveAgentPaneAdapter("reasonix")
      },
      topologyPaneIndexForRole,
      respawnPane,
      configureRoleAgent: (role) =>
        resolveAgentPaneAdapter(role === "implementer" ? "reasonix" : "opencode")
    });

    // opencode reviewer/meta panes must NOT be deactivated.
    expect(respawnPane).not.toHaveBeenCalled();
  });

  it("deactivates a non-concurrent (reasonix) pane when another reasonix pane activates", async () => {
    const runner: TmuxRunner = (() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })) as TmuxRunner;
    await deactivateOtherRolePanes({
      activateInput: {
        sessionName: "sess",
        role: "reviewer",
        cwd: "/ws",
        runner,
        paneAgent: resolveAgentPaneAdapter("reasonix")
      },
      topologyPaneIndexForRole,
      respawnPane,
      configureRoleAgent: (role) =>
        resolveAgentPaneAdapter(role === "reviewer" ? "reasonix" : "reasonix")
    });

    const calls = respawnPane.mock.calls.map((c) => c[0].paneIndex);
    // Both other roles run reasonix -> both deactivated.
    expect(calls).toEqual(expect.arrayContaining([1, 3]));
    expect(calls).not.toContain(2);
  });

  it("keeps the legacy blanket deactivation when configureRoleAgent is omitted", async () => {
    const runner: TmuxRunner = (() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })) as TmuxRunner;
    await deactivateOtherRolePanes({
      activateInput: {
        sessionName: "sess",
        role: "implementer",
        cwd: "/ws",
        runner,
        paneAgent: resolveAgentPaneAdapter("reasonix")
      },
      topologyPaneIndexForRole,
      respawnPane
    });

    const calls = respawnPane.mock.calls.map((c) => c[0].paneIndex);
    expect(calls).toEqual(expect.arrayContaining([2, 3]));
    expect(calls).not.toContain(1);
  });

  it("does nothing when the activating agent supports concurrent panes", async () => {
    const runner: TmuxRunner = (() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })) as TmuxRunner;
    await deactivateOtherRolePanes({
      activateInput: {
        sessionName: "sess",
        role: "implementer",
        cwd: "/ws",
        runner,
        paneAgent: resolveAgentPaneAdapter("opencode")
      },
      topologyPaneIndexForRole,
      respawnPane
    });

    expect(respawnPane).not.toHaveBeenCalled();
  });
});
