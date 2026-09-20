---
description: Install or update Pairflow skills into global ~/.opencode/skills
argument-hint: [--skills all|UsePairflow|CreatePairflowSpec|ExecutePairflowPlan[,<name>...]] [--target-dir .opencode|.reasonix] [--link-other] [--role-agents] [--force] [--dry-run] [--json]
allowed-tools: Bash
---

# Install Pairflow Skills

Install selected Pairflow skills from this repository or installed Pairflow package into a global agent skills directory.

Preferred CLI:

```bash
pairflow skills install --skills all --target-dir .opencode
```

Use this workflow document as the source-policy reference and fallback manual procedure. Global skill directories are derived targets only; never copy from installed global directories as source.

## Variables

SKILLS_ARG: extracted from `--skills`, default `all`
TARGET_DIR_NAME: extracted from `--target-dir`, default `.opencode`
LINK_OTHER: extracted from `--link-other`, default `false`
ROLE_AGENTS: extracted from `--role-agents`, default `false`
FORCE: extracted from `--force`, default `false`
DRY_RUN: extracted from `--dry-run`, default `false`
JSON: extracted from `--json`, default `false`
SUPPORTED_SKILLS:
1. `UsePairflow`
2. `CreatePairflowSpec`
3. `ExecutePairflowPlan`

## Instructions

- Resolve `SOURCE_ROOT` as the package-local or repo-local `.claude/skills/` directory containing the supported skill source directories.
- Allowed target directory values:
   1. `.opencode` (install destination `$HOME/.opencode/skills`)
   2. `.reasonix` (install destination `$HOME/.reasonix/skills`, reasonix's skill root)
- Agent skill discovery (this repo runs opencode and reasonix; there is no Claude/Codex agent):
   - opencode reads project `.opencode/skills/<name>/SKILL.md`, global
     `~/.config/opencode/skills` (canonical) and `~/.opencode/skills`, and the
     external auto-load roots `~/.claude/skills` and `~/.agents/skills`.
   - reasonix reads project `.reasonix/skills`, global `~/.reasonix/skills`, and
     convention roots including `~/.agents/skills`.
   - `~/.agents/skills` is the one root both agents auto-load, but it is NOT an
     install destination: `--target-dir` accepts only `.opencode` and
     `.reasonix`, and `--link-other` does not link into `.agents`. Only
     `--role-agents` writes there (the `PF-*` role definitions).
- **Availability is not usage.** Both agents surface only name + description and
  load the body on demand, so a missing/stale `description` silently disables a
  skill. Verify with `opencode debug skill` (resolved list + source paths),
  `opencode debug agent PF-<role>`, and `reasonix subagent list`.
- `--role-agents` also syncs the repo-owned `PF-implementer|PF-reviewer|PF-meta-reviewer`
  definitions to `$HOME/.config/opencode/agent/PF-<role>.md` and
  `$HOME/.agents/skills/PF-<role>/SKILL.md`. Frontmatter keys Pairflow does not own
  (for example `model`) are preserved. An inline `agent.PF-*` prompt in
  `~/.config/opencode/opencode.jsonc` is reported as a conflict and never rewritten.
- In-repo, `.opencode/skills/**` is a thin pointer tree (relative symlinks to
  `../../.claude/skills/<name>`); the installer follows those links and installs real content.
- Install destination format:
  - `TARGET_ROOT="$HOME/<TARGET_DIR_NAME>/skills"`
- `--link-other` also links the selected skills into every other agent directory listed by the installer (`.claude`, `.codex`, `.copilot`, `.gemini`, `.reasonix`), excluding the primary target directory itself. `.opencode` is not in that list, so it must be the primary target to be covered: `--target-dir .opencode --link-other` covers opencode (`~/.opencode/skills`) and reasonix (`~/.reasonix/skills`) in one command, whereas `--target-dir .reasonix --link-other` reaches opencode only through its external `~/.claude/skills` root.
- Never modify source files in the repo; copy one-way from `SOURCE_ROOT` to global target.
- Use deletion-preserving sync semantics so deleted source files are removed from destination too.
- Existing selected target skill directories may be refreshed.
- Existing non-directory selected target paths require `--force`.

## Workflow

1. Resolve defaults:
   ```bash
   SKILLS_ARG="${SKILLS_ARG:-all}"
   TARGET_DIR_NAME="${TARGET_DIR_NAME:-.opencode}"
   ```
2. Validate `TARGET_DIR_NAME` is `.opencode` or `.reasonix` (the CLI rejects any other value).
3. Resolve `INSTALL_SKILLS`:
   - if `SKILLS_ARG=all`, use all supported skills
   - otherwise parse comma-separated values and validate each against `SUPPORTED_SKILLS`
4. If `DRY_RUN=true`, report the plan and stop without creating, copying, deleting, or linking.
5. Prepare target:
   ```bash
   mkdir -p "$TARGET_ROOT"
   ```
6. Before writes, preflight every selected target skill path:
   - allow absent paths
   - allow existing selected target directories
   - require `--force` for existing selected target paths that are not directories
7. For each selected skill:
   - verify source exists: `"$SOURCE_ROOT/<skill>/"`
   - sync:
     ```bash
     rsync -a --delete "$SOURCE_ROOT/<skill>/" "$TARGET_ROOT/<skill>/"
     ```
8. Verify by listing installed folders.

## Usage Examples

1. Install all skills into `~/.opencode/skills` (default):
   - `pairflow skills install --skills all --target-dir .opencode`
2. Install only `CreatePairflowSpec` into `~/.opencode/skills`:
   - `pairflow skills install --skills CreatePairflowSpec --target-dir .opencode`
3. Install only `ExecutePairflowPlan` into `~/.opencode/skills`:
   - `pairflow skills install --skills ExecutePairflowPlan --target-dir .opencode`
4. Preview all default operations without writes:
   - `pairflow skills install --dry-run --json`
5. Install for both opencode and reasonix in one command:
   - `pairflow skills install --skills all --target-dir .opencode --link-other`

## Report

```
Pairflow skills install summary:

- Source root: <SOURCE_ROOT>
- Target root: <TARGET_ROOT>
- Installed skills: <list>
- Dry run: <true/false>
- Force: <true/false>
- Status: <planned | fresh install | updated existing | replaced existing>
```

If any step fails, report the exact error and stop.
