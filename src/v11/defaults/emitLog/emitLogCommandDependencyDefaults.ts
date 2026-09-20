import {
  readEmitHistoryEntries
} from "../../infrastructure/artifact/actorProtocol/emitHistoryReportReader.js";
import { resolveBubbleById } from "../../infrastructure/executor/workspace/bubbleLookup.js";
import { resolveRepoPath } from "../../infrastructure/executor/workspace/repoResolution.js";

export const emitLogCommandDependencyDefaults = {
  readEmitHistoryEntries,
  resolveBubbleById,
  resolveRepoPath
} as const;
