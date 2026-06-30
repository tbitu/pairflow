import { join } from "node:path";

export interface WatchdogPaneActivityRecord {
  bubble_id: string;
  sampled_at: string;
  pane_hash: string;
  last_changed_at: string;
  session_name?: string;
  target_pane?: string;
  last_sample_status?: "sampled" | "no_session" | "pane_unreadable";
  last_sample_error?: string;
  last_seen_esc_interrupt_at?: string;
  last_nudge_at?: string;
  last_nudge_count?: number;
  last_nudge_round?: number;
  last_nudge_role?: string;
  last_nudge_execution_id?: string;
}

export type ReadWatchdogPaneActivityResult =
  | {
      status: "ok";
      record: WatchdogPaneActivityRecord;
    }
  | {
      status: "missing";
    }
  | {
      status: "invalid";
      error: string;
    };

export type ReadWatchdogPaneActivity = (
  input: {
    runtimeDir: string;
    bubbleId: string;
  }
) => Promise<ReadWatchdogPaneActivityResult>;

export function getWatchdogPaneActivityPath(
  runtimeDir: string,
  bubbleId: string
): string {
  return join(runtimeDir, "watchdog-health", `${bubbleId}.json`);
}
