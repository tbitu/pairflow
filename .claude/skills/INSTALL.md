---
description: Install or update Pairflow skills into global ~/.opencode/skills
argument-hint: [--skills all|UsePairflow|CreatePairflowSpec|ExecutePairflowPlan[,<name>...]] [--target-dir .opencode] [--force] [--dry-run] [--json]
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
   1. `.opencode`
- Install destination format:
  - `TARGET_ROOT="$HOME/<TARGET_DIR_NAME>/skills"`
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
2. Validate `TARGET_DIR_NAME` is `.opencode`.
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
