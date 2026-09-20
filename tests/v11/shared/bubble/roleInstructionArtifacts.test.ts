import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureRoleInstructionArtifacts,
  getRoleInstructionArtifactFileName,
  roleImplementerArtifactFileName,
  roleMetaReviewerArtifactFileName,
  roleReviewerArtifactFileName
} from "../../../../src/v11/shared/bubble/roleInstructionArtifacts.js";
import { getBubblePaths, getRoleInstructionArtifactPath } from "../../../../src/v11/shared/bubble/bubblePaths.js";

describe("roleInstructionArtifacts", () => {
  it("resolves correct artifact file names for each role", () => {
    expect(getRoleInstructionArtifactFileName("implementer")).toBe(
      roleImplementerArtifactFileName
    );
    expect(getRoleInstructionArtifactFileName("reviewer")).toBe(
      roleReviewerArtifactFileName
    );
    expect(getRoleInstructionArtifactFileName("meta_reviewer")).toBe(
      roleMetaReviewerArtifactFileName
    );
  });

  it("exposes role instruction artifact paths on BubblePaths", () => {
    const paths = getBubblePaths("/tmp/repo", "b_test_01");
    expect(paths.roleImplementerArtifactPath).toBe(
      join(paths.artifactsDir, "role-implementer.md")
    );
    expect(paths.roleReviewerArtifactPath).toBe(
      join(paths.artifactsDir, "role-reviewer.md")
    );
    expect(paths.roleMetaReviewerArtifactPath).toBe(
      join(paths.artifactsDir, "role-meta-reviewer.md")
    );

    expect(getRoleInstructionArtifactPath(paths, "implementer")).toBe(
      paths.roleImplementerArtifactPath
    );
    expect(getRoleInstructionArtifactPath(paths, "reviewer")).toBe(
      paths.roleReviewerArtifactPath
    );
    expect(getRoleInstructionArtifactPath(paths, "meta_reviewer")).toBe(
      paths.roleMetaReviewerArtifactPath
    );
  });

  it("ensures role instruction artifact files are written with markdown instructions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pf-role-artifacts-test-"));
    const artifactsDir = join(tempDir, "artifacts");

    try {
      const result = await ensureRoleInstructionArtifacts(artifactsDir);

      expect(result.roleImplementerArtifactPath).toBe(
        join(artifactsDir, "role-implementer.md")
      );
      expect(result.roleReviewerArtifactPath).toBe(
        join(artifactsDir, "role-reviewer.md")
      );
      expect(result.roleMetaReviewerArtifactPath).toBe(
        join(artifactsDir, "role-meta-reviewer.md")
      );

      const implementerContent = await readFile(
        result.roleImplementerArtifactPath,
        "utf8"
      );
      expect(implementerContent).toContain("# Pairflow Implementer Instructions");
      expect(implementerContent).toContain("--kind pass");

      const reviewerContent = await readFile(
        result.roleReviewerArtifactPath,
        "utf8"
      );
      expect(reviewerContent).toContain("# Pairflow Reviewer Instructions");
      expect(reviewerContent).toContain("Reviewer decision gate");

      const metaReviewerContent = await readFile(
        result.roleMetaReviewerArtifactPath,
        "utf8"
      );
      expect(metaReviewerContent).toContain("# Pairflow Meta-Reviewer Instructions");
      expect(metaReviewerContent).toContain("Minimal clean approve payload");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
