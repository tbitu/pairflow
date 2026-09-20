import { join } from "node:path";

import {
  buildEmitHistoryReport
} from "../../../../shared/actorProtocol/emitHistoryReport.js";
import {
  getBubbleEmitHistoryPath,
  getRuntimeEmitHistoryPath
} from "../../../../shared/actorProtocol/emitHistoryStore.js";
import type {
  BubbleEmitLogDependencies,
  BubbleEmitLogInput,
  BubbleEmitLogResult
} from "../../emitLogCommandContract.js";

/**
 * Resolve and read the emit attempt log for one of three scopes:
 *
 * - `logPath` -> that file verbatim (for logs whose bubble no longer resolves),
 * - `bubbleId` -> `.pairflow/bubbles/<id>/emit-history.ndjson`,
 * - neither -> the repo-wide `.pairflow/runtime/emit-history.ndjson`.
 *
 * Success attempts are always recorded on the bubble log; rejections fall back
 * to the runtime log when the bubble could not be resolved from the argv. All
 * three scopes use the same reader and the same report shape.
 */
export async function runBubbleEmitLog(
  input: BubbleEmitLogInput,
  dependencies: BubbleEmitLogDependencies
): Promise<BubbleEmitLogResult> {
  const explicitLogPath = input.logPath?.trim();
  if (explicitLogPath !== undefined && explicitLogPath.length > 0) {
    const entries = await dependencies.readEmitHistoryEntries({
      logPath: explicitLogPath
    });
    return {
      scope: "file",
      bubbleId: null,
      repoPath: null,
      report: buildEmitHistoryReport({ entries, logPath: explicitLogPath })
    };
  }

  const bubbleId = input.bubbleId?.trim();

  if (bubbleId !== undefined && bubbleId.length > 0) {
    const resolved = await dependencies.resolveBubbleById({
      bubbleId,
      ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {})
    });
    const logPath = getBubbleEmitHistoryPath(resolved.bubblePaths.bubbleDir);
    const entries = await dependencies.readEmitHistoryEntries({ logPath });
    return {
      scope: "bubble",
      bubbleId: resolved.bubbleId,
      repoPath: resolved.repoPath,
      report: buildEmitHistoryReport({ entries, logPath })
    };
  }

  const repoPath = await dependencies.resolveRepoPath({
    ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {})
  });
  const logPath = getRuntimeEmitHistoryPath(
    join(repoPath, ".pairflow", "runtime")
  );
  const entries = await dependencies.readEmitHistoryEntries({ logPath });
  return {
    scope: "repo",
    bubbleId: null,
    repoPath,
    report: buildEmitHistoryReport({ entries, logPath })
  };
}
