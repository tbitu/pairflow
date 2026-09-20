import {
  parseBubbleEmitLogCommandOptions,
  type BubbleEmitLogCommandOptions
} from "./emitLogCliOptions.js";
import {
  runBubbleEmitLog
} from "../flow/emitLogRunner.js";
import type {
  BubbleEmitLogDependencies,
  BubbleEmitLogResult
} from "../../emitLogCommandContract.js";

export async function runBubbleEmitLogCommand(
  args: string[] | BubbleEmitLogCommandOptions,
  cwd: string,
  dependencies: BubbleEmitLogDependencies
): Promise<BubbleEmitLogResult | null> {
  const options = Array.isArray(args)
    ? parseBubbleEmitLogCommandOptions(args)
    : args;
  if (options.help) {
    return null;
  }

  return runBubbleEmitLog(
    {
      ...(options.id !== undefined ? { bubbleId: options.id } : {}),
      ...(options.repo !== undefined ? { repoPath: options.repo } : {}),
      ...(options.log !== undefined ? { logPath: options.log } : {}),
      cwd
    },
    dependencies
  );
}
