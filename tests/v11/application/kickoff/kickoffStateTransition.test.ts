import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBubble } from "../../../../src/v11/defaults/create/createBubbleApi.js";
import { readStateSnapshot } from "../../../../src/v11/infrastructure/state/stateStore.js";
import { buildKickoffNextState } from "../../../../src/v11/application/kickoff/internal/mutation/kickoffStateTransition.js";
import { initGitRepository } from "../../../helpers/git.js";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pairflow-kickoff-state-v11-"));
  tempDirs.push(root);
  await initGitRepository(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("buildKickoffNextState", () => {
  it("builds round-1 implementer state and appends round-role history entry once", async () => {
    const repoPath = await createTempRepo();
    const created = await createBubble({
      id: "b_kickoff_state_transition_01",
      repoPath,
      baseBranch: "main",
      reviewArtifactType: "code",
      ideation: true,
      cwd: repoPath
    });
    const loaded = await readStateSnapshot(created.paths.statePath);

    const nowIso = "2026-03-19T22:00:00.000Z";
    const next = buildKickoffNextState({
      state: loaded.state,
      bubbleConfig: created.config,
      nowIso
    });
    const nextAgain = buildKickoffNextState({
      state: next,
      bubbleConfig: created.config,
      nowIso
    });

    expect(next.round).toBe(1);
    expect(next.active_agent).toBe(created.config.agents.implementer);
    expect(next.active_role).toBe("implementer");
    expect(next.active_since).toBe(nowIso);
    expect(next.last_command_at).toBe(nowIso);

    const roundOneEntries = next.round_role_history.filter((entry) => entry.round === 1);
    expect(roundOneEntries).toHaveLength(1);
    expect(roundOneEntries[0]).toEqual({
      round: 1,
      implementer: created.config.agents.implementer,
      reviewer: created.config.agents.reviewer,
      switched_at: nowIso
    });
    expect(nextAgain.round_role_history.filter((entry) => entry.round === 1)).toHaveLength(
      1
    );
  });

  it("applies a per-agent watchdog timeout override for the round-1 implementer deadline", async () => {
    const repoPath = await createTempRepo();
    const created = await createBubble({
      id: "b_kickoff_state_transition_02",
      repoPath,
      baseBranch: "main",
      reviewArtifactType: "code",
      ideation: true,
      cwd: repoPath
    });
    const loaded = await readStateSnapshot(created.paths.statePath);
    const nowIso = "2026-03-19T22:00:00.000Z";

    const next = buildKickoffNextState({
      state: loaded.state,
      bubbleConfig: {
        ...created.config,
        watchdog_timeout_minutes: 30,
        watchdog_timeout_minutes_by_agent: { opencode: 120, reasonix: 30 }
      },
      nowIso
    });

    expect(created.config.agents.implementer).toBe("opencode");
    expect(next.execution_context?.deadline_at).toBe(
      "2026-03-20T00:00:00.000Z"
    );
  });
});

