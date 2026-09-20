import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentRole } from "../../../contracts/kernel/agentIdentity.js";
import { renderRoleInstructionMarkdown } from "../agent/roleAgentStandingPrompts.js";

export const roleImplementerArtifactFileName = "role-implementer.md";
export const roleReviewerArtifactFileName = "role-reviewer.md";
export const roleMetaReviewerArtifactFileName = "role-meta-reviewer.md";

export function getRoleInstructionArtifactFileName(role: AgentRole): string {
  switch (role) {
    case "implementer":
      return roleImplementerArtifactFileName;
    case "reviewer":
      return roleReviewerArtifactFileName;
    case "meta_reviewer":
      return roleMetaReviewerArtifactFileName;
  }
}

export async function ensureRoleInstructionArtifacts(artifactsDir: string): Promise<{
  roleImplementerArtifactPath: string;
  roleReviewerArtifactPath: string;
  roleMetaReviewerArtifactPath: string;
}> {
  await mkdir(artifactsDir, { recursive: true });
  const implementerPath = join(artifactsDir, roleImplementerArtifactFileName);
  const reviewerPath = join(artifactsDir, roleReviewerArtifactFileName);
  const metaReviewerPath = join(artifactsDir, roleMetaReviewerArtifactFileName);

  await Promise.all([
    writeFile(implementerPath, `${renderRoleInstructionMarkdown("implementer")}\n`, "utf8"),
    writeFile(reviewerPath, `${renderRoleInstructionMarkdown("reviewer")}\n`, "utf8"),
    writeFile(metaReviewerPath, `${renderRoleInstructionMarkdown("meta_reviewer")}\n`, "utf8")
  ]);

  return {
    roleImplementerArtifactPath: implementerPath,
    roleReviewerArtifactPath: reviewerPath,
    roleMetaReviewerArtifactPath: metaReviewerPath
  };
}
