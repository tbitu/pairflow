import { execFile, execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { seedBubbleTmuxPaneMessages } from "../../src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.js";
import { waitForAgentPaneReady } from "../../src/v11/infrastructure/channel/tmux/tmuxPaneReadiness.js";
import { checkTmuxPaneMarkerStatus } from "../../src/v11/infrastructure/channel/tmux/tmuxPaneMarkerConfirmation.js";
import type { TmuxRunner } from "../../src/v11/ports/tmuxSessions.js";

/**
 * LIVE reasonix delivery tests.
 *
 * These boot a REAL reasonix TUI in a REAL tmux session and drive the
 * production bubble-start seed path (`seedBubbleTmuxPaneMessages`) against it,
 * asserting that the `[pairflow] bubble=… kickoff` marker is actually
 * submitted into the pane. They exist because the reasonix "ready pane never
 * receives its initial [pairflow] message" bug cannot be reproduced with mocks
 * (see tmuxManager.ts: "the seed's kickoff never landed, while the watchdog
 * nudge to :0.1 always did").
 *
 * The suite is opt-in so default CI/local runs are unaffected:
 *
 *   PF_LIVE_REASONIX=1 pnpm exec vitest run tests/live/reasonixKickoffSeed.live.test.ts
 *
 * Reasonix must be resolvable via `reasonix` on PATH or via REASONIX_BIN.
 * NOTE: reasonix enforces a machine-wide single active interactive session, so
 * close any other running reasonix session (e.g. an active bubble implementer
 * pane) before running; otherwise the booted pane exits with the "session is
 * in use by another reasonix" failure and the suite reports the launch phase.
 * Each test tears its tmux session down; the booted reasonix only ever sees
 * the inert probe message below, never a real task.
 *
 * Sandboxed environments (write roots restricted to the repo, e.g. the
 * pairflow dev sandbox) need three extra knobs — everything reasonix writes
 * (home, sessions, workspace) must live under an allowed write root:
 *
 *   PF_LIVE_REASONIX=1 \
 *   PF_LIVE_SCRATCH_ROOT=/home/tarjeib/repo/pairflow/.live-scratch \
 *   PF_LIVE_REASONIX_FAKE_HOME=1 \
 *   pnpm exec vitest run tests/live/reasonixKickoffSeed.live.test.ts
 *
 * FAKE_HOME copies the caller's real ~/.reasonix/config.toml into a scratch
 * home so a second reasonix instance can boot without touching the real one.
 * PF_LIVE_REASONIX_FAKE_KEY seeds a placeholder DEEPSEEK_API_KEY into that
 * scratch home's .env when no real key exists, so the boot passes reasonix's
 * key-presence check and delivery mechanics can be exercised (a placeholder
 * key only fails at the model-call step, after the message left the composer).
 * The suite also waits for a visible shell prompt before typing the launch
 * command: keystrokes sent into a pane whose shell is still starting are
 * swallowed (verified live — the same race class as the kickoff bug).
 *
 * Diagnosis aid: when an assertion fails, the test prints timestamped pane
 * captures for each phase (launch echo, readiness polling, composer after the
 * paste, post-Enter state) so the failing sub-step — binary never ready vs.
 * keystrokes never echoed vs. Enter never submitted — is visible at a glance.
 */

const execFileAsync = promisify(execFile);

const LIVE_ENABLED = process.env.PF_LIVE_REASONIX === "1";
const FAKE_HOME_ENABLED = process.env.PF_LIVE_REASONIX_FAKE_HOME === "1";
// When booting under a fake home without a real provider key, reasonix
// fail-closes on `missing env DEEPSEEK_API_KEY` before reaching the composer.
// reasonix resolves secrets from its home .env, so a placeholder key can be
// seeded there to exercise delivery mechanics (a dummy key only fails at the
// model-call step, after the message left the composer).
const FAKE_HOME_API_KEY = process.env.PF_LIVE_REASONIX_FAKE_KEY?.trim() ?? "";

function resolveReasonixCommand(): string | null {
  const envBin = process.env.REASONIX_BIN?.trim();
  if (envBin !== undefined && envBin.length > 0) {
    return envBin;
  }
  try {
    const found = execFileSync("bash", ["-lc", "command -v reasonix"], {
      encoding: "utf8"
    }).trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

const REASONIX_COMMAND = LIVE_ENABLED ? resolveReasonixCommand() : null;

const describeLive = describe.skipIf(
  !LIVE_ENABLED || REASONIX_COMMAND === null
);

async function createTmuxRunner(): Promise<TmuxRunner> {
  return async (args: string[]) => {
    try {
      const result = await execFileAsync("tmux", args, {
        maxBuffer: 16 * 1024 * 1024
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0
      };
    } catch (error) {
      const err = error as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: typeof err.code === "number" ? err.code : 1
      };
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function resolveScratchRoot(): string {
  const override = process.env.PF_LIVE_SCRATCH_ROOT?.trim();
  return override !== undefined && override.length > 0 ? override : tmpdir();
}

const SCRATCH_ROOT = LIVE_ENABLED ? resolveScratchRoot() : tmpdir();

interface LiveReasonixPane {
  runner: TmuxRunner;
  sessionName: string;
  targetPane: string;
  workspacePath: string;
  cleanupPaths: string[];
}

/**
 * Wait until the pane shows a plain shell prompt (before any agent TUI is
 * launched). Typing into a pane whose shell is still initializing drops the
 * input, so the launch command must only be sent once the prompt is visible.
 */
async function waitForShellPrompt(input: {
  runner: TmuxRunner;
  targetPane: string;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, input.attempts ?? 30);
  const retryDelayMs = input.retryDelayMs ?? 500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const capture = await input.runner(
      ["capture-pane", "-p", "-t", input.targetPane],
      { allowFailure: true }
    );
    if (capture.exitCode === 0) {
      const trimmed = capture.stdout.trimEnd();
      const lastLine = trimmed.split("\n").at(-1) ?? "";
      // Shell prompts end in $/#/> (distrobox adds a 📦 prefix). The reasonix
      // composer glyphs (›/❯) must NOT count — no agent is launched yet.
      if (/[$#>]\s*$/u.test(lastLine) || /^\s*[$#>]/u.test(lastLine)) {
        return true;
      }
    }
    if (attempt < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }
  return false;
}

/**
 * Resolve the reasonix home for the booted instance. Real hosts use the
 * caller's real $HOME. Sandboxed hosts (fake home) get a scratch home with a
 * copy of the caller's ~/.reasonix/config.toml so boot does not touch the
 * real reasonix state and does not need writes outside the scratch root.
 */
async function resolveBootHome(cleanupPaths: string[]): Promise<string | undefined> {
  if (!FAKE_HOME_ENABLED) {
    return undefined;
  }
  const homeDir = await mkdtemp(join(SCRATCH_ROOT, "pf-rx-home-"));
  cleanupPaths.push(homeDir);
  const rxHome = join(homeDir, ".reasonix");
  await mkdir(rxHome, { recursive: true });
  const sourceConfig = join(homedir(), ".reasonix", "config.toml");
  try {
    await copyFile(sourceConfig, join(rxHome, "config.toml"));
  } catch {
    throw new Error(
      `PF_LIVE_REASONIX_FAKE_HOME=1 requires a readable real config at ${sourceConfig} to copy.`
    );
  }
  await writeFile(
    join(rxHome, ".env"),
    FAKE_HOME_API_KEY.length > 0 ? `DEEPSEEK_API_KEY=${FAKE_HOME_API_KEY}\n` : ""
  );
  return homeDir;
}

async function bootReasonixPane(): Promise<LiveReasonixPane> {
  const runner = await createTmuxRunner();
  const cleanupPaths: string[] = [];
  const workspacePath = await mkdtemp(join(SCRATCH_ROOT, "pf-live-reasonix-"));
  cleanupPaths.push(workspacePath);
  const sessionName = `pf-live-${process.pid}-${Date.now()}`;
  const targetPane = `${sessionName}:0.0`;

  // Mirror buildReasonixPreparation (agentCommand.ts): per-workspace config so
  // the booted reasonix passes permissions and can write under its sandbox.
  await writeFile(
    join(workspacePath, "reasonix.toml"),
    [
      "[permissions]",
      'mode = "allow"',
      "",
      "[sandbox]",
      `workspace_root = ${JSON.stringify(workspacePath)}`,
      `allow_write = [${JSON.stringify(workspacePath)}]`,
      'bash = "enforce"',
      "network = true"
    ].join("\n")
  );

  const bootHome = await resolveBootHome(cleanupPaths);
  await runner(["new-session", "-d", "-s", sessionName, "-c", workspacePath]);

  const promptReady = await waitForShellPrompt({ runner, targetPane });
  console.log(`[live] shell prompt visible=${promptReady}`);
  if (!promptReady) {
    const tail = await capturePaneTail({ runner, targetPane });
    console.log(`[live] pane before launch (no shell prompt seen):\n${tail}`);
  }

  const homePrefix = bootHome !== undefined ? `HOME=${JSON.stringify(bootHome)} ` : "";
  const launchLine =
    `${homePrefix}${REASONIX_COMMAND} code --dir ${JSON.stringify(workspacePath)} --permission-mode bypassPermissions`;
  await runner(["send-keys", "-t", targetPane, "-l", launchLine]);
  await runner(["send-keys", "-t", targetPane, "Enter"]);

  return { runner, sessionName, targetPane, workspacePath, cleanupPaths };
}

async function capturePaneTail(input: {
  runner: TmuxRunner;
  targetPane: string;
}): Promise<string> {
  const capture = await input.runner(
    ["capture-pane", "-p", "-S", "-80", "-t", input.targetPane],
    { allowFailure: true }
  );
  return capture.exitCode === 0 ? capture.stdout : `<capture failed: ${capture.stderr}>`;
}

async function teardownPane(input: LiveReasonixPane): Promise<void> {
  await input.runner(["kill-session", "-t", input.sessionName], {
    allowFailure: true
  });
  const paths = [...input.cleanupPaths];
  for (const path of paths) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

const livePanes: LiveReasonixPane[] = [];

afterEach(async () => {
  const panes = livePanes.splice(0);
  for (const pane of panes) {
    await teardownPane(pane);
  }
});

describeLive("live reasonix pane delivery", () => {
  it(
    "seedBubbleTmuxPaneMessages submits the [pairflow] kickoff marker into a ready reasonix pane",
    async () => {
      expect(REASONIX_COMMAND, "REASONIX_BIN or `reasonix` on PATH is required").not.toBeNull();
      const pane = await bootReasonixPane();
      livePanes.push(pane);
      const { runner, targetPane } = pane;

      const bootAttempts = Number.parseInt(
        process.env.PF_LIVE_BOOT_ATTEMPTS ?? "120",
        10
      );
      const ready = await waitForAgentPaneReady("reasonix", {
        runner,
        targetPane,
        attempts: bootAttempts,
        retryDelayMs: 1000
      });
      console.log(`[live] boot ready=${ready} pane=${targetPane}`);
      if (!ready) {
        const tail = await capturePaneTail({ runner, targetPane });
        console.log(`[live] pane after failed readiness:\n${tail}`);
        expect(
          ready,
          "reasonix never reached a ready composer state (see pane capture above). This is the launch/readiness phase — not yet the delivery phase."
        ).toBe(true);
      }

      const marker = "[pairflow] bubble=b_live_reasonix_probe";
      const kickoffMessage =
        `${marker} kickoff. Live delivery probe: read this message and reply OK. Do not modify any files.`;

      console.log(`[live] seeding kickoff (chars=${kickoffMessage.length})`);
      await seedBubbleTmuxPaneMessages({
        runner,
        implementerPaneId: targetPane,
        reviewerPaneId: targetPane,
        metaReviewerPaneId: targetPane,
        implementerAgentName: "reasonix",
        reviewerAgentName: "reasonix",
        metaReviewerAgentName: "reasonix",
        launchReviewerAgent: false,
        launchMetaReviewerAgent: false,
        implementerKickoffMessage: kickoffMessage
      });
      console.log("[live] seed returned");

      // Model first-turn latency can be long; give the echo/submit generous time.
      let status = "not_found";
      for (let attempt = 0; attempt < 60; attempt += 1) {
        status = await checkTmuxPaneMarkerStatus(runner, targetPane, marker);
        if (status === "submitted") {
          break;
        }
        await sleep(2000);
      }
      console.log(`[live] final marker status=${status}`);
      if (status !== "submitted") {
        const tail = await capturePaneTail({ runner, targetPane });
        console.log(`[live] pane after kickoff seed (status=${status}):\n${tail}`);
      }
      expect(
        status,
        "the [pairflow] kickoff marker must move above the reasonix composer prompt (submitted). A not_found/stuck status reproduces the reported bug: pane ready+idle but the initial message never lands. See pane capture above."
      ).toBe("submitted");
    },
    300_000
  );

  it(
    "baseline: plain keystrokes echo into a ready reasonix composer",
    async () => {
      expect(REASONIX_COMMAND, "REASONIX_BIN or `reasonix` on PATH is required").not.toBeNull();
      const pane = await bootReasonixPane();
      livePanes.push(pane);
      const { runner, targetPane } = pane;

      const bootAttempts = Number.parseInt(
        process.env.PF_LIVE_BOOT_ATTEMPTS ?? "120",
        10
      );
      const ready = await waitForAgentPaneReady("reasonix", {
        runner,
        targetPane,
        attempts: bootAttempts,
        retryDelayMs: 1000
      });
      console.log(`[live] baseline boot ready=${ready}`);
      if (!ready) {
        const tail = await capturePaneTail({ runner, targetPane });
        console.log(`[live] baseline pane after failed readiness:\n${tail}`);
        expect(ready, "reasonix never reached a ready composer state").toBe(true);
      }

      const probeText = `PF-LIVE-KEYSTROKE-${Date.now()}`;
      await runner(["send-keys", "-t", targetPane, "-l", probeText]);
      await sleep(3000);
      const tail = await capturePaneTail({ runner, targetPane });
      console.log(`[live] pane after typing probe:\n${tail}`);
      expect(
        tail.includes(probeText),
        "the probe text must appear in the pane after send-keys. If this fails, keystrokes never reach reasonix even when readiness reported true (input-buffer drop during TUI warm-up)."
      ).toBe(true);
    },
    240_000
  );
});
