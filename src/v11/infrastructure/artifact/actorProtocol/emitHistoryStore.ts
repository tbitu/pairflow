import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentEmitAttemptEntry } from "../../../shared/actorProtocol/emitHistoryStore.js";

export {
  getBubbleEmitHistoryPath,
  getRuntimeEmitHistoryPath,
  type AgentEmitAttemptEntry
} from "../../../shared/actorProtocol/emitHistoryStore.js";

export async function appendEmitAttemptLog(input: {
  filePath: string;
  entry: AgentEmitAttemptEntry;
}): Promise<void> {
  await mkdir(dirname(input.filePath), { recursive: true });
  await appendFile(input.filePath, `${JSON.stringify(input.entry)}\n`, "utf8");
}

export async function recordAgentEmitAttemptBestEffort(input: {
  targetPath?: string | undefined;
  entry: AgentEmitAttemptEntry;
}): Promise<void> {
  if (!input.targetPath) {
    return;
  }
  try {
    await appendEmitAttemptLog({
      filePath: input.targetPath,
      entry: input.entry
    });
  } catch {
    // Best-effort attempt logging; never fail the emit command flow
  }
}
