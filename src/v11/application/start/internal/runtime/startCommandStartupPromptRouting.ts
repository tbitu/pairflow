/* eslint-disable @typescript-eslint/no-unused-vars */
import type { AgentName } from "../../../../../contracts/kernel/agentIdentity.js";
import type { StartExecutionContext } from "./startCommandContext.js";

export function shouldSubmitStartupPrompt(
  _agentName: AgentName,
  _startupPrompt?: string  
): boolean {
  return false;
}

function resolveBootstrapStartupPrompt(
  agentName: AgentName,
  startupPrompt: string | undefined
): string | undefined {
  if (agentName !== "opencode") {
    return undefined;
  }
  return (startupPrompt?.trim().length ?? 0) > 0 ? startupPrompt : undefined;
}

function resolveResumeBootstrapStartupPrompt(input: {
  agentName: AgentName;
  roleLabel: "implementer" | "reviewer" | "meta-reviewer";
  startupPrompt: string | undefined;
  bubbleId: string;
  taskArtifactPath: string;
  loadedState: StartExecutionContext["loadedState"]["state"];
}): string | undefined {
  return resolveBootstrapStartupPrompt(input.agentName, input.startupPrompt);
}

export function resolveResumeBootstrapStartupMessages(input: {
  context: StartExecutionContext;
  implementerStartupPrompt: string | undefined;
  reviewerStartupPrompt: string | undefined;
  metaReviewerStartupPrompt: string | undefined;
  metaReviewerAgent: AgentName;
}): {
  implementerBootstrapMessage?: string;
  reviewerBootstrapMessage?: string;
  metaReviewerBootstrapMessage?: string;
} {
  const implementerBootstrapMessage = resolveResumeBootstrapStartupPrompt({
    agentName: input.context.resolved.bubbleConfig.agents.implementer,
    roleLabel: "implementer",
    startupPrompt: input.implementerStartupPrompt,
    bubbleId: input.context.resolved.bubbleId,
    taskArtifactPath: input.context.resolved.bubblePaths.taskArtifactPath,
    loadedState: input.context.loadedState.state
  });
  const reviewerBootstrapMessage = resolveResumeBootstrapStartupPrompt({
    agentName: input.context.resolved.bubbleConfig.agents.reviewer,
    roleLabel: "reviewer",
    startupPrompt: input.reviewerStartupPrompt,
    bubbleId: input.context.resolved.bubbleId,
    taskArtifactPath: input.context.resolved.bubblePaths.taskArtifactPath,
    loadedState: input.context.loadedState.state
  });
  const metaReviewerBootstrapMessage = resolveResumeBootstrapStartupPrompt({
    agentName: input.metaReviewerAgent,
    roleLabel: "meta-reviewer",
    startupPrompt: input.metaReviewerStartupPrompt,
    bubbleId: input.context.resolved.bubbleId,
    taskArtifactPath: input.context.resolved.bubblePaths.taskArtifactPath,
    loadedState: input.context.loadedState.state
  });

  return {
    ...(implementerBootstrapMessage !== undefined
      ? { implementerBootstrapMessage }
      : {}),
    ...(reviewerBootstrapMessage !== undefined
      ? { reviewerBootstrapMessage }
      : {}),
    ...(metaReviewerBootstrapMessage !== undefined
      ? { metaReviewerBootstrapMessage }
      : {})
  };
}

export function resolveCommandStartupPrompt(
  agentName: AgentName,
  startupPrompt: string | undefined
): string | undefined {
  if (agentName === "opencode") {
    return undefined;
  }
  return startupPrompt;
}

export function resolveBootstrapStartupMessages(input: {
  implementerAgent: AgentName;
  implementerStartupPrompt: string | undefined;
  reviewerAgent?: AgentName;
  reviewerStartupPrompt?: string | undefined;
  metaReviewerAgent?: AgentName;
  metaReviewerStartupPrompt?: string | undefined;
}): {
  implementerBootstrapMessage?: string;
  reviewerBootstrapMessage?: string;
  metaReviewerBootstrapMessage?: string;
} {
  const implementerBootstrapMessage = resolveBootstrapStartupPrompt(
    input.implementerAgent,
    input.implementerStartupPrompt
  );
  const reviewerBootstrapMessage =
    input.reviewerAgent !== undefined
      ? resolveBootstrapStartupPrompt(
          input.reviewerAgent,
          input.reviewerStartupPrompt
        )
      : undefined;
  const metaReviewerBootstrapMessage =
    input.metaReviewerAgent !== undefined
      ? resolveBootstrapStartupPrompt(
          input.metaReviewerAgent,
          input.metaReviewerStartupPrompt
        )
      : undefined;
  return {
    ...(implementerBootstrapMessage !== undefined
      ? { implementerBootstrapMessage }
      : {}),
    ...(reviewerBootstrapMessage !== undefined
      ? { reviewerBootstrapMessage }
      : {}),
    ...(metaReviewerBootstrapMessage !== undefined
      ? { metaReviewerBootstrapMessage }
      : {})
  };
}
