import { resolve } from "node:path";

import {
  loadPairflowRepoConfig,
  mergeRepoDefaults,
  type PairflowRepoConfig
} from "../../../../../config/repoConfig.js";
import {
  loadPairflowGlobalConfig,
  PAIRFLOW_REMOTE_CONFIG_INVALID,
  type PairflowGlobalConfig
} from "../../../../../config/pairflowConfig.js";
import { SchemaValidationError } from "../../../../shared/validation/primitives.js";
import { getBubblePaths, type BubblePaths } from "../../../../shared/bubble/bubblePaths.js";
import type { ReviewerFocusExtractionResult } from "../../../../shared/reviewer/reviewerBrief.js";
import { createInitialBubbleState } from "../../../../domain/state/initialState.js";
import type {
  BubbleRemotePointerCreated
} from "../../../../shared/remote/remoteExecutionTypes.js";
import type { BubbleConfig } from "../../../../shared/config/bubbleConfigTypes.js";
import type { BubbleStateSnapshot } from "../../../../domain/state/snapshot/bubbleStateSnapshot.js";
import type {
  BubbleCreateDependencies,
  BubbleCreateInput,
  ResolvedTaskInput
} from "../runtime/createCommandContract.js";
import {
  buildBubbleConfig,
  ensureBubbleDoesNotExist,
  ensureRepoPathIsGitRepo,
  resolveCreateReviewArtifactType,
  resolveCreateBubbleRemoteExecution,
  resolveReviewerBriefInput,
  resolveTaskInput,
  toBubbleCreateError,
  validateBubbleId
} from "../runtime/createCommandRuntime.js";
import { buildIdeationPlaceholderTaskContent } from "./createTaskArtifacts.js";
import {
  prepareCreateBubbleInput,
  type PreparedCreateBubbleInput
} from "./createBubblePreparation.js";
import { extractReviewerFocus } from "./createReviewerFocus.js";
import { resolveRepoValidationProfileCommands } from "./repoValidationProfileResolver.js";
import {
  resolveBaseBranch,
  resolveRepoDefaultedCreateInput
} from "../runtime/createRepoDefaultsResolver.js";

export interface CreateBubbleFlowContext {
  repoPath: string;
  paths: BubblePaths;
  task: ResolvedTaskInput;
  reviewerFocus: ReviewerFocusExtractionResult;
  reviewerBrief?: ResolvedTaskInput | undefined;
  remotePointer?: BubbleRemotePointerCreated | undefined;
  prepared: PreparedCreateBubbleInput;
  config: BubbleConfig;
  state: BubbleStateSnapshot;
}

async function resolveTaskForCreateCommand(
  command: BubbleCreateInput
): Promise<ResolvedTaskInput> {
  if (command.ideation === true) {
    return {
      content: buildIdeationPlaceholderTaskContent(command.id),
      source: "ideation_placeholder"
    };
  }
  return resolveTaskInput({
    cwd: command.cwd ?? process.cwd(),
    ...(command.task !== undefined ? { task: command.task } : {}),
    ...(command.taskFile !== undefined ? { taskFile: command.taskFile } : {})
  });
}

async function resolveGlobalConfigForCreateCommand(input: {
  command: BubbleCreateInput;
  dependencies: BubbleCreateDependencies;
}): Promise<PairflowGlobalConfig | undefined> {
  const loadFn =
    input.dependencies.loadPairflowGlobalConfig ?? loadPairflowGlobalConfig;
  try {
    return await loadFn();
  } catch (error) {
    if (input.command.remote !== undefined) {
      if (error instanceof SchemaValidationError) {
        const configErrorMessage = error.message.startsWith(
          `${PAIRFLOW_REMOTE_CONFIG_INVALID}:`
        )
          ? error.message
          : `${PAIRFLOW_REMOTE_CONFIG_INVALID}: ${error.message}`;
        throw toBubbleCreateError({
          message: configErrorMessage,
          context: {
            remote: input.command.remote,
            reason: "invalid_global_config"
          }
        });
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw toBubbleCreateError({
        message:
          `Failed to load global Pairflow config for remote bubble create: ${reason}`,
        context: {
          remote: input.command.remote,
          reason: "load_global_config_failed"
        }
      });
    }

    if (error instanceof SchemaValidationError) {
      throw error;
    }
    return undefined;
  }
}

async function resolveRemoteExecutionForCreateCommand(input: {
  command: BubbleCreateInput;
  dependencies: BubbleCreateDependencies;
  globalConfig: PairflowGlobalConfig | undefined;
}): Promise<Awaited<ReturnType<typeof resolveCreateBubbleRemoteExecution>> | undefined> {
  if (input.command.remote === undefined) {
    return undefined;
  }
  if (input.dependencies.loadPairflowGlobalConfig === undefined) {
    throw toBubbleCreateError({
      message: "Missing required create bubble dependency: loadPairflowGlobalConfig.",
      context: {
        dependency: "loadPairflowGlobalConfig",
        command_name: "create",
        bubble_id: input.command.id,
        remote: input.command.remote
      }
    });
  }
  return resolveCreateBubbleRemoteExecution({
    remote: input.command.remote,
    loadPairflowGlobalConfig: () => Promise.resolve(input.globalConfig ?? {})
  });
}

function applyValidationProfileCommands(input: {
  command: BubbleCreateInput;
  prepared: PreparedCreateBubbleInput;
  repoConfig: PairflowRepoConfig;
  worktreePath: string;
}): void {
  input.prepared.bubbleConfigInput.resolvedValidationCommands =
    resolveRepoValidationProfileCommands({
      explicitCommands: {
        ...(input.command.testCommand !== undefined
          ? { test: input.command.testCommand }
          : {}),
        ...(input.command.typecheckCommand !== undefined
          ? { typecheck: input.command.typecheckCommand }
          : {}),
        ...(input.command.bootstrapCommand !== undefined
          ? { bootstrap: input.command.bootstrapCommand }
          : {})
      },
      ...(input.command.validationTarget !== undefined
        ? { validationTarget: input.command.validationTarget }
        : {}),
      worktreePath: input.worktreePath,
      allowMissingWorktreePath: true,
      ...(input.repoConfig.validation !== undefined
        ? { repoValidation: input.repoConfig.validation }
        : {}),
      legacyDefaults: {
        test: "pnpm test",
        typecheck: "pnpm typecheck"
      }
    });
}

export async function prepareCreateBubbleFlowContext(input: {
  command: BubbleCreateInput;
  createdAt: Date;
  dependencies: BubbleCreateDependencies;
}): Promise<CreateBubbleFlowContext> {
  validateBubbleId(input.command.id);
  const reviewArtifactType = resolveCreateReviewArtifactType(
    input.command.reviewArtifactType
  );

  const repoPath = resolve(input.command.repoPath);
  if (input.dependencies.assertGitRepository === undefined) {
    throw toBubbleCreateError({
      message: "Missing required create bubble dependency: assertGitRepository.",
      context: {
        dependency: "assertGitRepository",
        command_name: "create",
        bubble_id: input.command.id
      }
    });
  }
  await ensureRepoPathIsGitRepo(
    repoPath,
    input.dependencies.assertGitRepository
  );

  const globalConfig = await resolveGlobalConfigForCreateCommand({
    command: input.command,
    dependencies: input.dependencies
  });
  const repoConfig = await loadPairflowRepoConfig(repoPath);
  const mergedDefaults = mergeRepoDefaults(
    globalConfig?.defaults,
    repoConfig.defaults
  );
  const baseBranch = resolveBaseBranch({
    command: input.command,
    ...(mergedDefaults !== undefined
      ? { repoDefaults: mergedDefaults }
      : {})
  });
  const resolvedCommand = resolveRepoDefaultedCreateInput({
    command: input.command,
    ...(mergedDefaults !== undefined
      ? { repoDefaults: mergedDefaults }
      : {}),
    baseBranch
  });

  const paths = getBubblePaths(repoPath, resolvedCommand.id);
  await ensureBubbleDoesNotExist(paths.bubbleDir);

  const task = await resolveTaskForCreateCommand(resolvedCommand);
  const reviewerFocus = extractReviewerFocus(task.content);
  const reviewerBrief = await resolveReviewerBriefInput({
    ...(resolvedCommand.reviewerBrief !== undefined
      ? { reviewerBrief: resolvedCommand.reviewerBrief }
      : {}),
    ...(resolvedCommand.reviewerBriefFile !== undefined
      ? { reviewerBriefFile: resolvedCommand.reviewerBriefFile }
      : {}),
    accuracyCritical: resolvedCommand.accuracyCritical === true,
    cwd: resolvedCommand.cwd ?? process.cwd()
  });
  const remoteExecution = await resolveRemoteExecutionForCreateCommand({
    command: resolvedCommand,
    dependencies: input.dependencies,
    globalConfig
  });

  const prepared = prepareCreateBubbleInput({
    command: resolvedCommand,
    createdAt: input.createdAt,
    repoPath,
    baseBranch,
    reviewArtifactType,
    task,
    ...(remoteExecution !== undefined
      ? { executorRemote: remoteExecution.remoteAlias }
      : {})
  });
  applyValidationProfileCommands({
    command: resolvedCommand,
    prepared,
    repoConfig,
    worktreePath: paths.worktreePath
  });

  return {
    repoPath,
    paths,
    task,
    reviewerFocus,
    ...(reviewerBrief !== undefined ? { reviewerBrief } : {}),
    ...(remoteExecution !== undefined
      ? { remotePointer: remoteExecution.remotePointer }
      : {}),
    prepared,
    config: buildBubbleConfig(prepared.bubbleConfigInput),
    state: createInitialBubbleState(resolvedCommand.id)
  };
}
