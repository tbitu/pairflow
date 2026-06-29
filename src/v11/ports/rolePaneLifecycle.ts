/**
 * Port: RolePaneLifecycle
 *
 * Unified interface for pane lifecycle operations across all roles.
 * Used by delivery modules (pass, converged, meta-review gate, etc.) to
 * activate panes and check readiness before sending instructions.
 */

import type { RolePaneLifecycle, PaneReadinessConfig, PaneLifecycleResult } from "../shared/channel/rolePaneLifecycle.js";

export type { RolePaneLifecycle, PaneReadinessConfig, PaneLifecycleResult };

export type RolePaneLifecyclePort = (
  ...args: Parameters<RolePaneLifecycle["activatePaneForRole"]>
) => ReturnType<RolePaneLifecycle["activatePaneForRole"]>;
