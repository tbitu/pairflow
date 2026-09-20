import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  buildRoleAgentSyncPlan
} from "./internal/roleAgents/roleAgentSyncPlan.js";
export { SkillsInstallError } from "./skillsInstallErrors.js";
import { SkillsInstallError } from "./skillsInstallErrors.js";
import {
  resolveSourceRoot
} from "./internal/source/sourceRootResolution.js";
import type {
  PairflowSkillName,
  RoleAgentConflict,
  RoleAgentSyncOperation,
  SkillsInstallFileSystem,
  SkillsInstallOperation,
  SkillsInstallOptions,
  SkillsInstallPathStatus,
  SkillsInstallPlan,
  SkillsInstallRuntime,
  SkillsInstallStatus
} from "./skillsInstallContract.js";

interface ManagedPathPreflight {
  path: string;
  status: SkillsInstallPathStatus;
  unsafe: boolean;
}

export const OTHER_AGENT_DIRS = [".claude", ".codex", ".copilot", ".gemini", ".reasonix"] as const;

export function resolveAgentSkillsRoot(homeDir: string, agentDir: string): string {
  if (agentDir === ".gemini") {
    return join(homeDir, ".gemini", "config", "skills");
  }
  return join(homeDir, agentDir, "skills");
}

export function resolveAgentRoot(homeDir: string, agentDir: string): string {
  return join(homeDir, agentDir);
}

async function preflightManagedPaths(input: {
  operations: SkillsInstallOperation[];
  force: boolean;
  fs: SkillsInstallFileSystem;
}): Promise<{
  targetPreflights: ManagedPathPreflight[];
  linkPreflights: ManagedPathPreflight[];
}> {
  const targetPreflights: ManagedPathPreflight[] = [];
  const linkPreflights: ManagedPathPreflight[] = [];

  for (const operation of input.operations) {
    if (operation.kind !== "sync_skill") {
      continue;
    }
    const status = await input.fs.pathStatus(operation.destination);
    targetPreflights.push({
      path: operation.destination,
      status,
      unsafe: status.exists && status.type !== "directory"
    });
  }

  for (const operation of input.operations) {
    if (operation.kind !== "link_other") {
      continue;
    }
    const status = await input.fs.pathStatus(operation.linkPath);
    linkPreflights.push({
      path: operation.linkPath,
      status,
      unsafe: status.exists && status.type !== "symlink"
    });
  }

  const unsafePath = [...targetPreflights, ...linkPreflights].find(
    (preflight) => preflight.unsafe
  );
  if (unsafePath !== undefined && !input.force) {
    throw new SkillsInstallError(
      `Unsafe existing managed path requires --force before replacement: ${unsafePath.path}`
    );
  }

  return {
    targetPreflights,
    linkPreflights
  };
}

async function assertLinkOtherRootsDoNotAlias(input: {
  targetAgentRoot: string;
  otherAgentRoot: string;
  targetRoot: string;
  otherRoot: string;
  fs: SkillsInstallFileSystem;
}): Promise<void> {
  if (resolve(input.targetAgentRoot) === resolve(input.otherAgentRoot)) {
    throw new SkillsInstallError(
      `Cannot use --link-other when target agent roots resolve to the same directory: ${input.targetAgentRoot} and ${input.otherAgentRoot}`
    );
  }
  if (resolve(input.targetRoot) === resolve(input.otherRoot)) {
    throw new SkillsInstallError(
      `Cannot use --link-other when target skills roots resolve to the same directory: ${input.targetRoot} and ${input.otherRoot}`
    );
  }

  const [
    realTargetAgentRoot,
    realOtherAgentRoot,
    realTargetRoot,
    realOtherRoot
  ] = await Promise.all([
    input.fs.realPathIfExists(input.targetAgentRoot),
    input.fs.realPathIfExists(input.otherAgentRoot),
    input.fs.realPathIfExists(input.targetRoot),
    input.fs.realPathIfExists(input.otherRoot)
  ]);
  const [targetStatus, otherStatus, targetSkillsStatus, otherSkillsStatus] = await Promise.all([
    input.fs.pathStatus(input.targetAgentRoot),
    input.fs.pathStatus(input.otherAgentRoot),
    input.fs.pathStatus(input.targetRoot),
    input.fs.pathStatus(input.otherRoot)
  ]);
  const symlinkRoot = [
    { path: input.targetAgentRoot, status: targetStatus, realPath: realTargetAgentRoot },
    { path: input.otherAgentRoot, status: otherStatus, realPath: realOtherAgentRoot },
    { path: input.targetRoot, status: targetSkillsStatus, realPath: realTargetRoot },
    { path: input.otherRoot, status: otherSkillsStatus, realPath: realOtherRoot }
  ].find((root) => {
    if (!root.status.exists || root.status.type !== "symlink") {
      return false;
    }
    return (
      (realTargetAgentRoot !== null && root.realPath === realTargetAgentRoot) ||
      (realTargetRoot !== null && root.realPath === realTargetRoot)
    );
  });

  if (symlinkRoot !== undefined) {
    throw new SkillsInstallError(
      `Cannot use --link-other when an agent or skills root is a symlink that may alias the selected target root: ${symlinkRoot.path}`
    );
  }

  if (
    realTargetAgentRoot !== null
    && realOtherAgentRoot !== null
    && realTargetAgentRoot === realOtherAgentRoot
  ) {
    throw new SkillsInstallError(
      `Cannot use --link-other when target agent roots resolve to the same directory: ${input.targetAgentRoot} and ${input.otherAgentRoot}`
    );
  }
  if (
    realTargetRoot !== null
    && realOtherRoot !== null
    && realTargetRoot === realOtherRoot
  ) {
    throw new SkillsInstallError(
      `Cannot use --link-other when target skills roots resolve to the same directory: ${input.targetRoot} and ${input.otherRoot}`
    );
  }
}

async function assertManagedPathsDoNotOverlapSourceRoot(input: {
  sourceRoot: string;
  operations: SkillsInstallOperation[];
  fs: SkillsInstallFileSystem;
}): Promise<void> {
  const sourceRoot = resolve(input.sourceRoot);
  const realSourceRoot = await input.fs.realPathIfExists(sourceRoot);
  for (const operation of input.operations) {
    if (operation.kind === "sync_role_agent") {
      continue;
    }
    const managedPath =
      operation.kind === "sync_skill" ? operation.destination : operation.linkPath;
    if (isSameOrInside(sourceRoot, managedPath)) {
      throw new SkillsInstallError(
        `Managed install path overlaps Pairflow skill source root and would risk deleting source files: ${managedPath}`
      );
    }
    if (
      realSourceRoot !== null
      && await managedPathResolvesInsideSourceRoot({
        managedPath,
        realSourceRoot,
        fs: input.fs
      })
    ) {
      throw new SkillsInstallError(
        `Managed install path resolves inside Pairflow skill source root and would risk deleting source files: ${managedPath}`
      );
    }
  }
}

function isSameOrInside(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(basePath, resolve(candidatePath));
  return (
    relativePath === ""
    || (
      relativePath.length > 0
      && !relativePath.startsWith(`..${sep}`)
      && relativePath !== ".."
      && !isAbsolute(relativePath)
    )
  );
}

async function managedPathResolvesInsideSourceRoot(input: {
  managedPath: string;
  realSourceRoot: string;
  fs: SkillsInstallFileSystem;
}): Promise<boolean> {
  const realManagedPrefix = await realPathOfNearestExistingPath(
    input.managedPath,
    input.fs
  );
  return (
    realManagedPrefix !== null
    && isSameOrInside(input.realSourceRoot, realManagedPrefix)
  );
}

async function realPathOfNearestExistingPath(
  path: string,
  fs: SkillsInstallFileSystem
): Promise<string | null> {
  let candidate = resolve(path);
  while (true) {
    const realPath = await fs.realPathIfExists(candidate);
    if (realPath !== null) {
      return realPath;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

function resolveStatus(input: {
  dryRun: boolean;
  targetPreflights: ManagedPathPreflight[];
  linkPreflights: ManagedPathPreflight[];
}): SkillsInstallStatus {
  if (input.dryRun) {
    return "planned";
  }
  if (
    [...input.targetPreflights, ...input.linkPreflights].some(
      (preflight) => preflight.unsafe
    )
  ) {
    return "replaced_existing";
  }
  if (
    input.targetPreflights.some((preflight) => preflight.status.exists)
    || input.linkPreflights.some((preflight) => preflight.status.exists)
  ) {
    return "updated_existing";
  }
  return "fresh_install";
}

async function executeInstall(input: {
  plan: SkillsInstallPlan;
  preflight: {
    targetPreflights: ManagedPathPreflight[];
    linkPreflights: ManagedPathPreflight[];
  };
  fs: SkillsInstallFileSystem;
}): Promise<void> {
  if (input.plan.dryRun) {
    return;
  }

  await input.fs.ensureDirectory(input.plan.targetRoot);
  if (input.plan.otherRoots !== undefined) {
    for (const otherRoot of input.plan.otherRoots) {
      await input.fs.ensureDirectory(otherRoot);
    }
  }

  const targetPreflights = new Map(
    input.preflight.targetPreflights.map((preflight) => [
      preflight.path,
      preflight.status
    ])
  );
  const linkPreflights = new Map(
    input.preflight.linkPreflights.map((preflight) => [
      preflight.path,
      preflight.status
    ])
  );

  for (const operation of input.plan.operations) {
    if (operation.kind === "sync_role_agent") {
      await input.fs.writeFile(operation.destination, operation.content);
      continue;
    }
    if (operation.kind === "sync_skill") {
      const expectedDestination = targetPreflights.get(operation.destination);
      if (expectedDestination === undefined) {
        throw new SkillsInstallError(
          `Missing preflight status for managed install path: ${operation.destination}`
        );
      }
      await input.fs.replaceDirectoryFromSource({
        source: operation.source,
        destination: operation.destination,
        expectedDestination
      });
    }
  }

  for (const operation of input.plan.operations) {
    if (operation.kind === "link_other") {
      const expectedLinkPath = linkPreflights.get(operation.linkPath);
      if (expectedLinkPath === undefined) {
        throw new SkillsInstallError(
          `Missing preflight status for managed link path: ${operation.linkPath}`
        );
      }
      await input.fs.replaceSymlink({
        target: operation.target,
        linkPath: operation.linkPath,
        expectedLinkPath
      });
    }
  }
}

function buildSkillSyncOperations(input: {
  skills: PairflowSkillName[];
  sourceRoot: string;
  targetRoot: string;
  otherRoots: string[];
  linkOther: boolean;
}): SkillsInstallOperation[] {
  return input.skills.flatMap((skill) => {
    const source = join(input.sourceRoot, skill);
    const destination = join(input.targetRoot, skill);
    const syncOperation: SkillsInstallOperation = {
      kind: "sync_skill",
      skill,
      source,
      destination
    };
    if (!input.linkOther) {
      return [syncOperation];
    }
    const linkOps: SkillsInstallOperation[] = input.otherRoots.map((root) => ({
      kind: "link_other",
      skill,
      linkPath: join(root, skill),
      target: destination
    }));
    return [syncOperation, ...linkOps];
  });
}

export async function installPairflowSkills(
  options: SkillsInstallOptions,
  runtime: SkillsInstallRuntime
): Promise<SkillsInstallPlan> {
  const sourceRoot = await resolveSourceRoot(
    runtime.sourceRootCandidates,
    options.skills,
    runtime.fs
  );
  const targetRoot = resolveAgentSkillsRoot(runtime.homeDir, options.targetDir);
  const targetAgentRoot = resolveAgentRoot(runtime.homeDir, options.targetDir);
  const otherRoots = options.linkOther
    ? OTHER_AGENT_DIRS
        .filter((dir) => dir !== options.targetDir)
        .map((dir) => resolveAgentSkillsRoot(runtime.homeDir, dir))
    : [];
  const otherRoot = options.linkOther
    ? otherRoots.join(", ")
    : undefined;

  const skillOperations = buildSkillSyncOperations({
    skills: options.skills,
    sourceRoot,
    targetRoot,
    otherRoots,
    linkOther: options.linkOther
  });

  await assertManagedPathsDoNotOverlapSourceRoot({
    sourceRoot,
    operations: skillOperations,
    fs: runtime.fs
  });

  const roleAgents = options.roleAgents
    ? await buildRoleAgentSyncPlan({
        homeDir: runtime.homeDir,
        fs: runtime.fs
      })
    : {
        operations: [] as RoleAgentSyncOperation[],
        conflicts: [] as RoleAgentConflict[]
      };
  const operations: SkillsInstallOperation[] = [
    ...skillOperations,
    ...roleAgents.operations
  ];

  if (options.dryRun) {
    return {
      sourceRoot,
      targetRoot,
      targetDir: options.targetDir,
      selectedSkills: options.skills,
      dryRun: options.dryRun,
      force: options.force,
      linkOther: options.linkOther,
      ...(otherRoot === undefined ? {} : { otherRoot, otherRoots }),
      roleAgents: options.roleAgents,
      roleAgentConflicts: roleAgents.conflicts,
      status: "planned",
      operations
    };
  }

  if (options.linkOther) {
    for (const otherDir of OTHER_AGENT_DIRS) {
      if (otherDir === options.targetDir) {
        continue;
      }
      const otherAgentRoot = resolveAgentRoot(runtime.homeDir, otherDir);
      const otherRoot = resolveAgentSkillsRoot(runtime.homeDir, otherDir);
      await assertLinkOtherRootsDoNotAlias({
        targetAgentRoot,
        otherAgentRoot,
        targetRoot,
        otherRoot,
        fs: runtime.fs
      });
    }
  }

  const preflight = await preflightManagedPaths({
    operations,
    force: options.force,
    fs: runtime.fs
  });
  const status = resolveStatus({
    dryRun: options.dryRun,
    targetPreflights: preflight.targetPreflights,
    linkPreflights: preflight.linkPreflights
  });

  const plan: SkillsInstallPlan = {
    sourceRoot,
    targetRoot,
    targetDir: options.targetDir,
    selectedSkills: options.skills,
    dryRun: options.dryRun,
    force: options.force,
    linkOther: options.linkOther,
    ...(otherRoot === undefined ? {} : { otherRoot, otherRoots }),
    roleAgents: options.roleAgents,
    roleAgentConflicts: roleAgents.conflicts,
    status,
    operations
  };

  await executeInstall({
    plan,
    preflight,
    fs: runtime.fs
  });

  return plan;
}
