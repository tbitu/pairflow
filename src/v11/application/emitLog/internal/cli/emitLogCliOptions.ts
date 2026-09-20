import { parseArgs } from "node:util";

export interface BubbleEmitLogCommandOptions {
  id?: string;
  repo?: string;
  log?: string;
  json: boolean;
  help: false;
}

export interface BubbleEmitLogHelpCommandOptions {
  help: true;
}

export type ParsedBubbleEmitLogCommandOptions =
  | BubbleEmitLogCommandOptions
  | BubbleEmitLogHelpCommandOptions;

export function getBubbleEmitLogHelpText(): string {
  return [
    "Usage:",
    "  pairflow bubble emit-log --id <id> [--repo <path>] [--json]",
    "  pairflow bubble emit-log [--repo <path>] [--json]",
    "  pairflow bubble emit-log --log <path-to-emit-history.ndjson> [--json]",
    "",
    "Reads the agent emit attempt log (`.pairflow/bubbles/<id>/emit-history.ndjson`,",
    "or `.pairflow/runtime/emit-history.ndjson` without `--id`) and groups rejected",
    "attempts by error signature with counts and an example command.",
    "",
    "Options:",
    "  --id <id>             Bubble id (omit to read the repo-wide runtime log)",
    "  --repo <path>         Optional repository path (defaults to cwd ancestry lookup)",
    "  --log <path>          Read an explicit emit-history file (for logs whose bubble no longer resolves)",
    "  --json                Print structured JSON output",
    "  -h, --help            Show this help"
  ].join("\n");
}

export function parseBubbleEmitLogCommandOptions(
  args: string[]
): ParsedBubbleEmitLogCommandOptions {
  const parsed = parseArgs({
    args,
    options: {
      id: {
        type: "string"
      },
      repo: {
        type: "string"
      },
      log: {
        type: "string"
      },
      json: {
        type: "boolean"
      },
      help: {
        type: "boolean",
        short: "h"
      }
    },
    strict: true,
    allowPositionals: false
  });

  if (parsed.values.help ?? false) {
    return { help: true };
  }

  return {
    ...(parsed.values.id !== undefined ? { id: parsed.values.id } : {}),
    ...(parsed.values.repo !== undefined ? { repo: parsed.values.repo } : {}),
    ...(parsed.values.log !== undefined ? { log: parsed.values.log } : {}),
    json: parsed.values.json ?? false,
    help: false
  };
}
