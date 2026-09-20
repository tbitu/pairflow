import type { SkillsInstallFileSystem } from "../../ports/skillsInstallFileSystem.js";
import type { RoleAgentName } from "../../shared/agent/roleAgentStandingPrompts.js";

export type {
  SkillsInstallFileSystem,
  SkillsInstallPathStatus
} from "../../ports/skillsInstallFileSystem.js";

export const supportedPairflowSkillNames = [
  "UsePairflow",
  "CreatePairflowSpec",
  "ExecutePairflowPlan"
] as const;

export type PairflowSkillName = (typeof supportedPairflowSkillNames)[number];

export type SkillInstallTargetDir = ".opencode" | ".reasonix";

/**
 * Role-agent definition dialect.
 *
 * - `opencode` -> `$HOME/.config/opencode/agent/PF-<role>.md` (global agent file)
 * - `reasonix` -> `$HOME/.agents/skills/PF-<role>/SKILL.md` (shared convention root
 *   that both opencode and reasonix auto-load)
 */
export type RoleAgentDialect = "opencode" | "reasonix";

export interface RoleAgentSyncOperation {
  kind: "sync_role_agent";
  name: RoleAgentName;
  dialect: RoleAgentDialect;
  destination: string;
  content: string;
}

/**
 * A location that already defines the same role agent outside Pairflow's managed
 * files, so the deployed definition may be shadowed. Reported, never rewritten.
 */
export interface RoleAgentConflict {
  name: RoleAgentName;
  path: string;
  reason: "inline_agent_prompt";
}

export type SkillsInstallStatus =
  | "planned"
  | "fresh_install"
  | "updated_existing"
  | "replaced_existing";

export type SkillsInstallOperation =
  | {
      kind: "sync_skill";
      skill: PairflowSkillName;
      source: string;
      destination: string;
    }
  | {
      kind: "link_other";
      skill: PairflowSkillName;
      linkPath: string;
      target: string;
    }
  | RoleAgentSyncOperation;

export interface SkillsInstallPlan {
  sourceRoot: string;
  targetRoot: string;
  targetDir: SkillInstallTargetDir;
  selectedSkills: PairflowSkillName[];
  dryRun: boolean;
  force: boolean;
  linkOther: boolean;
  otherRoot?: string;
  otherRoots?: string[];
  roleAgents: boolean;
  roleAgentConflicts: RoleAgentConflict[];
  status: SkillsInstallStatus;
  operations: SkillsInstallOperation[];
}

export interface SkillsInstallOptions {
  skills: PairflowSkillName[];
  targetDir: SkillInstallTargetDir;
  linkOther: boolean;
  force: boolean;
  dryRun: boolean;
  roleAgents: boolean;
}

export interface SkillsInstallRuntime {
  homeDir: string;
  sourceRootCandidates: string[];
  fs: SkillsInstallFileSystem;
}
