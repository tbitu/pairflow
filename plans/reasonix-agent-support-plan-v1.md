---
plan_id: reasonix-agent-support
created_on: 2026-08-16
plan_status: active
status: open
---

# Reasonix Agent Support

## Objective

Add `reasonix` (npm `reasonix`, launch via `npx reasonix code`) as a supported pairflow
coding agent alongside opencode. Every behavior that is coded specifically for opencode
must remain, but scoped to opencode only; reasonix receives equivalent behavior through
a per-agent runtime profile. The opencode post-emit "double Escape with delay"
interruption is explicitly NOT applicable to reasonix.

## External Facts (verified against reasonix 1.25.3 on npm)

- Launch (interactive pane): `reasonix code --dir <ws> [--model <provider>] [--permission-mode ...]`.
  NO `--agent` and NO `--prompt` flags exist (unlike opencode). Startup prompts must be
  delivered via tmux paste for reasonix.
- One-shot (plan-watch runner): `reasonix run --dir <ws> [--permission-mode ...] <prompt>`
  streams the final answer to stdout and is NOT blocked by the interactive session lock.
- **Single-active-session constraint**: the interactive TUI refuses to start while another
  reasonix session is active ("this session is in use by another Reasonix window or
  process") — machine-wide, independent of `--dir`. Consequence: reasonix agent panes in
  one bubble must not be alive concurrently; idle panes must be deactivated before the next
  role's pane starts.
- Esc semantics differ from opencode (single Esc cancels a running turn; double Esc on an
  idle composer opens the rewind picker). The opencode post-emit double-Escape-with-delay
  is a no-op for reasonix.
- TUI readiness: no documented ASCII marker; rely on process-alive check (comm matches
  `reasonix`) plus generic prompt-line heuristic (`> ` / `❯` lines). Fail closed on
  known startup errors: "session is in use", missing provider/API key, "not a terminal".
- Skills: reasonix loads markdown skills from `<project>/.reasonix/skills/` and
  `~/.reasonix/skills/`; Claude-format `SKILL.md` frontmatter is compatible.
- Config is file-based (`reasonix.toml` / `~/.reasonix/config.toml`); pairflow must not
  inject provider config (opencode's `OPENCODE_CONFIG_CONTENT` has no reasonix equivalent).

## Design: per-agent runtime profile

New `src/v11/shared/agent/agentRuntimeProfiles.ts` keyed by `AgentName`:

- `startupPromptDelivery: "cli_arg" | "tmux_paste"` (opencode=cli_arg, reasonix=tmux_paste)
- `minimalDeliveryMessages: boolean` (opencode=true per OVERFLOW rules; reasonix=false)
- `postEmitInterruption: "opencode_double_escape" | "none"` (reasonix=none)
- `trustPromptHandling: "opencode" | "none"` (reasonix=none)
- `readiness: "opencode" | "reasonix"` (resolves to the per-agent readiness module)
- `planWatchBackend: "opencode" | "reasonix"`
- `supportsConcurrentPanes: boolean` (opencode=true; reasonix=false due to the session lock)
- `launchCommandArgs(...)`: per-agent argv construction

opencode profile reproduces today's behavior verbatim.

## Work Items

### A. Contracts & config
1. `src/contracts/kernel/agentIdentity.ts`: add `"reasonix"`; export `describeAgentNames()`.
2. `src/contracts/kernel/protocol.ts`: add `"reasonix"` to `protocolParticipants`.
3. Fix hardcoded `["opencode","opencode","opencode"]` sets/messages:
   - `src/config/repoConfig.ts`, `src/config/bubbleConfig/agents.ts`
   - `src/v11/infrastructure/ui/routerActionResponseValidation.ts`
   - `src/v11/shared/reviewer/internal/verification/reviewVerificationArtifactValidation.ts`
4. `src/config/bubbleConfig/agents.ts`: legacy meta_reviewer fallback → reviewer agent ?? "opencode".
5. `src/config/defaults.ts`: add `".reasonix"` to `DEFAULT_LOCAL_OVERLAY_ENTRIES`.

### B. Command construction & startup prompt delivery
6. `src/v11/shared/command/agentCommand.ts`: profile-driven launch argv; per-agent
   missing-binary message; env preparation stays opencode-only.
7. `src/v11/shared/command/startupPromptGate.ts`: `shouldSubmitStartupPrompt` returns true
   for tmux_paste agents (reasonix), false for opencode.
8. `src/v11/application/start/internal/runtime/startCommandTmuxLaunch.ts`: seed flags from
   profile; at fresh start launch only the initially active pane for non-concurrent agents.
9. `src/v11/application/start/internal/prompts/startCommandResumeKickoff*`: opencode-only
   minimal-message stripping; reasonix gets full guidance.

### C. Tmux channel
10. New `src/v11/infrastructure/channel/tmux/tmuxReasonixReadiness.ts` (process check +
    prompt-line + fail-closed error texts); wire into role pane lifecycle defaults and
    `tmuxDeliveryRuntime.ensurePaneReady`.
11. `src/v11/infrastructure/channel/tmux/tmuxDeliveryRuntime.ts` + `tmuxDelivery.ts`:
    agent-parametric readiness; respawn for any agent; pre-delivery deactivation of other
    role panes for non-concurrent agents.
12. `src/v11/infrastructure/channel/tmux/tmuxInput.ts`: keep opencode text detection scoped;
    add reasonix startup-error detection for fail-closed readiness.
13. `src/v11/infrastructure/channel/tmux/tmuxManagerPaneSeed.ts` +
    `metaReviewGateTmuxDefaultBindings.ts`: trust-prompt acceptance opencode-only.
14. `src/v11/infrastructure/channel/tmux/postEmitInterruption.ts`: agent-conditional;
    `_meta` gains `agentName` (emitActorProtocol) so the CLI decides per agent.
15. `src/v11/application/watchdog/internal/paneActivity/watchdogPaneActivityMonitoring.ts`:
    nudge/respawn for any agent (readiness per agent; keep opencode behavior identical).
16. `src/v11/infrastructure/channel/tmux/tmuxDeliveryMessageBuilder.ts`: minimal-message
    behavior scoped to opencode.

### D. Plan-watch runner
17. New `src/v11/infrastructure/executor/planWatch/reasonix/` backend adapter
    (`reasonix run`); register in `src/v11/defaults/planWatch/agentRunnerBridgeDefaults.ts`.
18. `src/v11/application/planWatch/README.md` + ledger/timeline docs updated.

### E. Skills install
19. `src/v11/application/skills/skillsInstallContract.ts` + `src/cli/commands/skills/install.ts`:
    add `.reasonix` target dir (→ `$HOME/.reasonix/skills`); update help text.
20. `.claude/skills/INSTALL.md` documents the reasonix target.

### F. Docs & fitness
21. `README.md`, `docs/architecture/**` agent docs, `tools/fitness/policy.json` reason
    strings, `pairflow.toml`-adjacent docs.

### G. Tests
22. Update opencode-scoped tests; add reasonix tests for each changed surface.

### H. Verification
23. `pnpm typecheck`, `pnpm lint`, `pnpm fitness:check:ci`, narrow + broad tests, `pnpm test`, `pnpm build`.

## Constraints

- opencode behavior must remain byte-identical (all existing tests keep passing).
- reasonix session lock is an external constraint; surface it as clear errors and
  deactivate idle panes; do not restructure the whole bubble concurrency model.
- No commits to `~/.claude` or `~/.codex` global skill copies in this task.
