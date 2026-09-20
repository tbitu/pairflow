import { join } from "node:path";

import { SkillsInstallError } from "../../skillsInstallErrors.js";
import type {
  PairflowSkillName,
  SkillsInstallFileSystem,
  SkillsInstallPathStatus
} from "../../skillsInstallContract.js";

function isDirectory(status: SkillsInstallPathStatus): boolean {
  return status.exists && status.type === "directory";
}

/**
 * Directory-ness that also accepts a symlink pointing at a directory.
 *
 * The repo-local skill source may be a thin pointer tree (for example
 * `.opencode/skills/<name>` -> `../../.claude/skills/<name>` so both agent
 * conventions resolve the same source). `pathStatus` reports a symlink as
 * `symlink`, so source detection must resolve the link target explicitly
 * instead of treating every symlink as a non-directory.
 */
export async function isDirectoryLike(
  path: string,
  fs: SkillsInstallFileSystem
): Promise<boolean> {
  const status = await fs.pathStatus(path);
  if (isDirectory(status)) {
    return true;
  }
  if (!status.exists || status.type !== "symlink") {
    return false;
  }
  const realPath = await fs.realPathIfExists(path);
  if (realPath === null || realPath === path) {
    return false;
  }
  return isDirectory(await fs.pathStatus(realPath));
}

export async function resolveSourceRoot(
  sourceRootCandidates: string[],
  selectedSkills: PairflowSkillName[],
  fs: SkillsInstallFileSystem
): Promise<string> {
  for (const sourceRoot of sourceRootCandidates) {
    if (!(await isDirectoryLike(sourceRoot, fs))) {
      continue;
    }

    let containsAllSelectedSkills = true;
    for (const skill of selectedSkills) {
      if (!(await isDirectoryLike(join(sourceRoot, skill), fs))) {
        containsAllSelectedSkills = false;
        break;
      }
    }

    if (containsAllSelectedSkills) {
      return sourceRoot;
    }
  }

  throw new SkillsInstallError(
    `Pairflow skill source files were not found. Expected all selected skills under one package or checkout source root: ${sourceRootCandidates.join(", ")}`
  );
}
