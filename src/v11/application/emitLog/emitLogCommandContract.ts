import type { AgentEmitAttemptEntry } from "../../shared/actorProtocol/emitHistoryStore.js";
import type { EmitHistoryReport } from "../../shared/actorProtocol/emitHistoryReport.js";
import type {
  ResolveBubbleByIdPort
} from "../../ports/bubbleLookup.js";
import type { ResolveRepoPathPort } from "../../ports/repoResolution.js";

export interface BubbleEmitLogInput {
  bubbleId?: string | undefined;
  repoPath?: string | undefined;
  cwd?: string | undefined;
  logPath?: string | undefined;
}

export interface BubbleEmitLogDependencies {
  resolveBubbleById: ResolveBubbleByIdPort;
  resolveRepoPath: ResolveRepoPathPort;
  readEmitHistoryEntries: (
    input: { logPath: string }
  ) => Promise<AgentEmitAttemptEntry[]>;
}

export interface BubbleEmitLogResult {
  scope: "bubble" | "repo" | "file";
  bubbleId: string | null;
  repoPath: string | null;
  report: EmitHistoryReport;
}
