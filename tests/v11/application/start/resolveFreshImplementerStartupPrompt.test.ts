import { describe, expect, it } from "vitest";

import { resolveFreshImplementerStartupPrompt } from "../../../../src/v11/application/start/internal/runtime/resumeStartupPrompts.js";
import { shouldSubmitStartupPrompt } from "../../../../src/v11/shared/command/startupPromptGate.js";

function makeContext(agent: "opencode" | "reasonix") {
  return {
    context: {
      resolved: {
        bubbleId: "b_fresh_start_01",
        repoPath: "/tmp/repo",
        bubblePaths: {
          taskArtifactPath: "/tmp/worktree/.pairflow/task.md"
        },
        bubbleConfig: {
          review_artifact_type: "code",
          pairflow_command_profile: "external",
          commands: {}
        }
      }
    },
    launchWorkspacePath: "/tmp/worktree",
    implementerAgent: agent
  } as never;
}

describe("resolveFreshImplementerStartupPrompt", () => {
  it("returns undefined for reasonix so the short single-line kickoff is pasted instead of the long role prompt", () => {
    const prompt = resolveFreshImplementerStartupPrompt(makeContext("reasonix"));
    expect(prompt).toBeUndefined();
    // With no startup prompt, the seed pastes the kickoff message.
    expect(
      shouldSubmitStartupPrompt("reasonix", prompt)
    ).toBe(false);
  });

  it("returns undefined for opencode (its role identity goes through --agent CLI args)", () => {
    expect(
      resolveFreshImplementerStartupPrompt(makeContext("opencode"))
    ).toBeUndefined();
  });
});
