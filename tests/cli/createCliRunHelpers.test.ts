import { describe, expect, it, vi } from "vitest";

import {
  buildCreateBubbleInput,
  resolveBubbleCreateCommandDependencies
} from "../../src/cli/commands/bubble/createCliRunHelpers.js";

describe("create CLI run helpers", () => {
  it("leaves repo registry wiring to the caller boundary", () => {
    const resolved = resolveBubbleCreateCommandDependencies({});

    expect(resolved.register).toBeUndefined();
  });

  it("keeps explicit dependency overrides intact", () => {
    const createBubble = vi.fn();
    const registerRepoInRegistry = vi.fn();

    const resolved = resolveBubbleCreateCommandDependencies({
      createBubble,
      registerRepoInRegistry
    });

    expect(resolved.create).toBe(createBubble);
    expect(resolved.register).toBe(registerRepoInRegistry);
  });

  it("forwards remote alias into the create input", () => {
    const built = buildCreateBubbleInput(
      {
        id: "b_create_remote_helper_01",
        repo: "/tmp/repo",
        base: "main",
        reviewArtifactType: "code",
        task: "Implement remote create",
        remote: "homelab"
      },
      "/tmp"
    );

    expect(built.input.remote).toBe("homelab");
  });

  it("omits baseBranch from create input when --base is absent", () => {
    const built = buildCreateBubbleInput(
      {
        id: "b_create_repo_default_base",
        repo: "/tmp/repo",
        reviewArtifactType: "code",
        task: "Use repo default base"
      },
      "/tmp"
    );

    expect(built.input).not.toHaveProperty("baseBranch");
  });

  it("forwards normalized explicit baseBranch into create input", () => {
    const built = buildCreateBubbleInput(
      {
        id: "b_create_normalized_base",
        repo: "/tmp/repo",
        base: "main",
        reviewArtifactType: "code",
        task: "Normalized base"
      },
      "/tmp"
    );

    expect(built.input.baseBranch).toBe("main");
  });

  it("forwards role agent and model options into create input", () => {
    const built = buildCreateBubbleInput(
      {
        id: "b_create_models",
        repo: "/tmp/repo",
        base: "main",
        reviewArtifactType: "code",
        task: "Model options",
        implementer: "opencode",
        implementerModel: "impl-model",
        reviewer: "opencode",
        reviewerModel: "rev-model",
        metaReviewer: "opencode",
        metaReviewerModel: "meta-model"
      },
      "/tmp"
    );

    expect(built.input.implementer).toBe("opencode");
    expect(built.input.implementerModel).toBe("impl-model");
    expect(built.input.reviewer).toBe("opencode");
    expect(built.input.reviewerModel).toBe("rev-model");
    expect(built.input.metaReviewer).toBe("opencode");
    expect(built.input.metaReviewerModel).toBe("meta-model");
  });
});

