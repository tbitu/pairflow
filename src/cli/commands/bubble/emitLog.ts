import { emitLogCommandDependencyDefaults } from "../../../v11/defaults/emitLog/emitLogCommandDependencyDefaults.js";
import {
  runBubbleEmitLogCommand as runApplicationBubbleEmitLogCommand
} from "../../../v11/application/emitLog/emitLogCliCommand.js";
import type {
  BubbleEmitLogDependencies
} from "../../../v11/application/emitLog/emitLogCommandContract.js";
import type {
  BubbleEmitLogCommandOptions
} from "../../../v11/application/emitLog/emitLogCliCommand.js";

export {
  getBubbleEmitLogHelpText,
  parseBubbleEmitLogCommandOptions,
  renderBubbleEmitLogText
} from "../../../v11/application/emitLog/emitLogCliCommand.js";
export type {
  BubbleEmitLogCommandOptions,
  BubbleEmitLogHelpCommandOptions,
  ParsedBubbleEmitLogCommandOptions
} from "../../../v11/application/emitLog/emitLogCliCommand.js";

export async function runBubbleEmitLogCommand(
  args: string[] | BubbleEmitLogCommandOptions,
  cwd: string = process.cwd(),
  dependencies: Partial<BubbleEmitLogDependencies> = {}
) {
  return runApplicationBubbleEmitLogCommand(args, cwd, {
    ...emitLogCommandDependencyDefaults,
    ...dependencies
  });
}
