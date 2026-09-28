import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach } from "vitest";

import "../../src/v11/defaults/converged/convergedDependencyDefaults.js";
import "../../src/v11/defaults/pass/passValidationCommandDefaults.js";
import "../../src/v11/defaults/start/startBubbleDefaults.js";

const previousMetricsRoot = process.env.PAIRFLOW_METRICS_EVENTS_ROOT;
const previousGlobalConfigPath = process.env.PAIRFLOW_GLOBAL_CONFIG_PATH;
const workerMetricsRoot = mkdtempSync(
  join(tmpdir(), "pairflow-metrics-events-vitest-")
);

process.env.PAIRFLOW_METRICS_EVENTS_ROOT = workerMetricsRoot;
process.env.PAIRFLOW_GLOBAL_CONFIG_PATH = join(
  workerMetricsRoot,
  "isolated-pairflow-global-config.toml"
);

beforeEach(async () => {
  await import("../../src/v11/defaults/converged/convergedDependencyDefaults.js");
  await import("../../src/v11/defaults/pass/passValidationCommandDefaults.js");
  await import("../../src/v11/defaults/start/startBubbleDefaults.js");
});

process.on("exit", () => {
  rmSync(workerMetricsRoot, { recursive: true, force: true });

  if (previousMetricsRoot === undefined) {
    delete process.env.PAIRFLOW_METRICS_EVENTS_ROOT;
  } else {
    process.env.PAIRFLOW_METRICS_EVENTS_ROOT = previousMetricsRoot;
  }

  if (previousGlobalConfigPath === undefined) {
    delete process.env.PAIRFLOW_GLOBAL_CONFIG_PATH;
  } else {
    process.env.PAIRFLOW_GLOBAL_CONFIG_PATH = previousGlobalConfigPath;
  }
});
