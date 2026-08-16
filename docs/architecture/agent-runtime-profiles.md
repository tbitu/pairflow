# Agent Runtime Profiles

Pairflow supports multiple coding agents as bubble role agents (`implementer`,
`reviewer`, `meta_reviewer`). The supported set is declared in
`src/contracts/kernel/agentIdentity.ts` (`agentNames`), and every behavior that
differs between agents is expressed as a **per-agent runtime profile** in
`src/v11/shared/agent/agentRuntimeProfiles.ts` instead of scattered
`agentName === "opencode"` checks.

Supported agents today:

- `opencode` — the original bubble agent (launched as `opencode ...`, startup
  prompt via CLI args).
- `reasonix` — npm `reasonix`, launched as `reasonix code --dir <workspace>`
  (or `npx --yes reasonix code ...` fallback). reasonix has no `--agent` and no
  `--prompt` flag, so role identity and startup prompts are delivered through
  tmux paste.

## Profile fields

| Field | opencode | reasonix |
| --- | --- | --- |
| `startupPromptDelivery` | `cli_arg` | `tmux_paste` |
| `minimalPastedGuidance` | `true` (OVERFLOW rules) | `false` (full guidance text) |
| `postEmitInterruption` | `opencode_double_escape` | `none` |
| `trustPromptHandling` | `opencode` | `none` |
| `readiness` | `opencode` | `reasonix` |
| `planWatchBackend` | `opencode` | `reasonix` |
| `supportsConcurrentPanes` | `true` | `false` |

## opencode-scoped behaviors (kept opencode-only)

The following were written specifically for opencode and remain opencode-only;
reasonix either has an equivalent or explicitly does not need them:

- **CLI-arg startup prompt**: opencode receives `--prompt <startup>` and
  `--agent PF-<role>` on launch; `shouldSubmitStartupPrompt` returns `false`
  for it (no tmux paste of the startup prompt).
- **Double-Escape-with-delay post-emit interruption**
  (`postEmitInterruptOpencodePane`): after `pairflow agent emit`, two Escape
  presses (with delay and "esc again to interrupt" detection) stop the opencode
  turn. reasonix does NOT use this sequence — a single Escape cancels a running
  turn and a double Escape on the idle composer opens the rewind picker — so
  `postEmitInterruption: "none"` makes the interruption a no-op. The CLI
  dispatches via `postEmitInterruptAgentPane` using `ActorEmitResult._meta.agentName`.
- **Folder-trust / bypass-permissions prompts**
  (`maybeAcceptOpencodeTrustPrompt`): accepted during pane bootstrap and
  delivery, opencode only. reasonix has no folder-trust prompt (its first-run
  setup is the `reasonix setup` wizard, run before Pairflow launches it).
- **TUI glyph detection** (`isOpencodePromptLine`, `detectOpencodeReadiness`,
  `▀▀▀▀` / `┃` / "ask anything" / "tab agents" / "ctrl+p commands"): used only
  by the opencode readiness module.
- **`OPENCODE_CONFIG_CONTENT` env injection**: opencode-only; reasonix is
  file-configured (`reasonix.toml` / `~/.reasonix/config.toml`) and Pairflow
  never injects provider config for it.

## reasonix-specific behavior

- **Launch**: `reasonix code --dir <workspace> [--model <model>]
  --permission-mode bypassPermissions` (autonomous loop agents run without
  human prompting, mirroring opencode's `permission: allow`). Missing binary
  falls back to `npx --yes reasonix`.
- **Startup prompt delivery**: `shouldSubmitStartupPrompt` returns `true` for
  `tmux_paste` agents; the seed pastes the startup prompt text into the pane
  (instead of a bare Enter).
- **Readiness** (`tmuxReasonixReadiness.ts`): process-alive descendant check
  (`comm` matches `reasonix`) plus generic composer prompt-line heuristic
  (`> ` / `❯`), and fail-closed on known startup errors ("session is in use by
  another Reasonix", missing provider API key, "not a terminal").
- **Single-active-session constraint**: the reasonix interactive TUI refuses to
  start while another reasonix session is active machine-wide
  ("this session is in use by another Reasonix window or process"),
  independent of `--dir`. Consequences:
  - At fresh bubble start only the initially active implementer pane launches;
    reviewer/meta-reviewer panes start with a placeholder and respawn lazily on
    their first delivery.
  - Before activating a role pane (delivery, watchdog respawn, reviewer/
    implementer context activation), the other role panes are **deactivated**
    (respawned with a placeholder shell) when the activated agent is
    non-concurrent (`deactivateOtherRolePanes` in
    `src/v11/shared/channel/rolePaneLifecycle.ts`), releasing the session lock.
  - The plan-watch runner backend uses headless `reasonix run --events-jsonl`,
    which is NOT blocked by the interactive session lock.
- **Plan-watch backend** (`src/v11/infrastructure/executor/planWatch/reasonix/**`):
  `reasonix run --events-jsonl --dir <repo> <prompt>`; the prompt asks the
  runner to end with exactly one JSON object matching the pairflow
  structured-output schema, recovered from stdout by
  `parseStructuredAgentRunnerOutput`.

## Where profiles are consumed

- `src/v11/shared/command/agentCommand.ts` — launch argv (per
  `startupPromptDelivery`), missing-binary message, npx fallback.
- `src/v11/shared/command/startupPromptGate.ts` — seed-time prompt submission.
- `src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts` —
  seed flags and launch-only-implementer decision for non-concurrent agents.
- `src/v11/infrastructure/channel/tmux/tmuxPaneReadiness.ts` — readiness
  dispatcher (`waitForAgentPaneReady`).
- `src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.ts` /
  `tmuxDelivery.ts` — readiness probe + respawn for any registered agent,
  trust-prompt scoping, pre-delivery deactivation.
- `src/v11/infrastructure/channel/tmux/postEmitInterruption.ts` — agent
  dispatch of the post-emit interruption.
- `src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivityMonitoring.ts`
  — nudge/respawn for any registered agent.
- `src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts` —
  minimal pasted guidance for `minimalPastedGuidance` agents only.
- `src/v11/application/metaReviewGate/metaReviewGateNotify.ts` — trust-prompt
  acceptance opencode-only.
- `src/v11/defaults/planWatch/agentRunnerBridgeDefaults.ts` — plan-watch
  backends.

Unknown/legacy agent names (e.g. pre-reasonix test fixtures) fall back to the
opencode behavior path. Dispatch helpers (`waitForAgentPaneReady`,
`ensureAgentPaneReady`, `deactivateOtherRolePanes`, delivery/trust-prompt
scoping) guard every registry lookup with `isAgentNameRegistered` first, so
unregistered names never throw and take the opencode behavior path.
`getAgentRuntimeProfile` itself is intentionally strict: it throws
`AGENT_RUNTIME_PROFILE_UNKNOWN` for unregistered names, so callers that hold a
validated `AgentName` (config/snapshot-derived) fail fast instead of silently
running opencode behavior.
