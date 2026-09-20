import { join } from "node:path";

import {
  renderOpencodeRoleAgentFile,
  renderReasonixRoleAgentProfileFile,
  roleAgentDefinitions,
  roleAgentNames,
  type RoleAgentName
} from "../../../../shared/agent/roleAgentStandingPrompts.js";
import type {
  RoleAgentConflict,
  RoleAgentDialect,
  RoleAgentSyncOperation
} from "../../skillsInstallContract.js";
import type { SkillsInstallFileSystem } from "../../../../ports/skillsInstallFileSystem.js";

/**
 * Per-dialect destination + renderer for the repo-owned role agent definitions.
 *
 * - `opencode` writes a global agent file
 *   (`$HOME/.config/opencode/agent/PF-<role>.md`), which opencode resolves for
 *   `--agent PF-<role>`.
 * - `reasonix` writes the profile under `$HOME/.agents/skills/PF-<role>`, the
 *   convention root that both opencode and reasonix auto-load.
 */
const roleAgentHomes: readonly {
  dialect: RoleAgentDialect;
  destination: (homeDir: string, name: RoleAgentName) => string;
  render: (input: {
    name: RoleAgentName;
    existingContent: string | null;
  }) => string;
}[] = [
  {
    dialect: "opencode",
    destination: (homeDir, name) =>
      join(homeDir, ".config", "opencode", "agent", `${name}.md`),
    render: renderOpencodeRoleAgentFile
  },
  {
    dialect: "reasonix",
    destination: (homeDir, name) =>
      join(homeDir, ".agents", "skills", name, "SKILL.md"),
    render: renderReasonixRoleAgentProfileFile
  }
];

/**
 * Location of the operator's opencode config. Pairflow only ever reads it: an
 * inline `agent.PF-*` prompt lives outside Pairflow's managed files and may
 * shadow the deployed definition, so it is reported rather than rewritten.
 */
export function resolveOpencodeConfigPath(homeDir: string): string {
  return join(homeDir, ".config", "opencode", "opencode.jsonc");
}

export function detectInlineRoleAgentConflicts(
  homeDir: string,
  configContent: string | null
): RoleAgentConflict[] {
  if (configContent === null) {
    return [];
  }
  return roleAgentNames
    .filter((name) => new RegExp(`"${name}"\\s*:`, "u").test(configContent))
    .map((name) => ({
      name,
      path: resolveOpencodeConfigPath(homeDir),
      reason: "inline_agent_prompt" as const
    }));
}

/**
 * Build the role-agent sync operations for both dialects, preserving frontmatter
 * keys Pairflow does not own (for example the operator's `model` selection).
 */
export async function buildRoleAgentSyncPlan(input: {
  homeDir: string;
  fs: SkillsInstallFileSystem;
}): Promise<{
  operations: RoleAgentSyncOperation[];
  conflicts: RoleAgentConflict[];
}> {
  const operations: RoleAgentSyncOperation[] = [];
  for (const home of roleAgentHomes) {
    for (const definition of roleAgentDefinitions) {
      const destination = home.destination(input.homeDir, definition.name);
      const existingContent = await input.fs.readFileIfExists(destination);
      operations.push({
        kind: "sync_role_agent",
        name: definition.name,
        dialect: home.dialect,
        destination,
        content: home.render({
          name: definition.name,
          existingContent
        })
      });
    }
  }
  const configContent = await input.fs.readFileIfExists(
    resolveOpencodeConfigPath(input.homeDir)
  );
  return {
    operations,
    conflicts: detectInlineRoleAgentConflicts(input.homeDir, configContent)
  };
}
