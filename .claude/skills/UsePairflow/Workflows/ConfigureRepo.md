---
description: Build or update pairflow.toml in the repository root for Pairflow bubble defaults and validation
argument-hint: [<repo-path>] [--dry-run] [--force]
allowed-tools: Bash, Read, Glob, Write, AskUserQuestion
---

# Configure Pairflow Repository (`pairflow.toml`)

## Purpose

Inspect a repository's build toolchain, testing infrastructure, and agent environment to construct or update a strictly valid `pairflow.toml` in the repository root.

## Relevant Files & Templates

- `templates/pairflow.toml` — Master annotated template and sample file
- `references/pairflow-toml-spec.md` — Authoritative schema specification and parser rules

## Variables

- `REPO_PATH`: $1 or `git rev-parse --show-toplevel`
- `DRY_RUN`: `true` if `--dry-run` is present, default `false`
- `FORCE`: `true` if `--force` is present, default `false`

## Instructions

- Always inspect the actual repository files first before generating configuration.
- Never invent commands that do not exist in the project.
- **Strict TOML Syntax Rules (Mandatory)**:
  1. **No dotted keys**: Every sub-table must use an explicit header (e.g. `[defaults.agents]`, not `defaults.agents.implementer = "..."`).
  2. **No multiline strings**: Strings must be single-line and enclosed in quotes.
  3. **No array-of-tables**: `[[section]]` is forbidden.
  4. **Command & Target IDs**: Must match `^[a-z][a-z0-9_-]{0,63}$` and must not be reserved.
  5. **Review Severity**: Allowed thresholds are `"P1"`, `"P2"`, `"P3"`. **"P4" is invalid** and will be rejected.
- If `pairflow.toml` already exists and `FORCE!=true`, present the proposed diff and ask for confirmation before writing.

---

## Workflow

### 1. Verify Git Repository Root

1. Resolve `REPO_PATH`:
   ```bash
   git rev-parse --show-toplevel
   ```
2. Verify that `REPO_PATH` is a valid git repository.
3. Check if `pairflow.toml` exists at `$REPO_PATH/pairflow.toml`.

### 2. Detect Default Base Branch

Identify the project's primary development branch:
```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || git branch -l main master | head -n1 | tr -d ' *'
```
Default to `"main"` if undetected.

### 3. Detect Build Toolchain & Quality Gates

Examine the codebase to determine the appropriate commands for:
- `bootstrap`: workspace installation / compilation
- `lint`: style and static analysis checks
- `typecheck`: type checking (if applicable)
- `test`: automated test execution

#### Ecosystem Detection Matrix:

| Ecosystem | Indicators | Common Bootstrap | Common Lint | Common Typecheck | Common Test |
|---|---|---|---|---|---|
| **Node.js (pnpm)** | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | `pnpm lint` | `pnpm typecheck` or `pnpm exec tsc --noEmit` | `pnpm test` |
| **Node.js (npm)** | `package-lock.json` | `npm ci` | `npm run lint` | `npm run typecheck` or `npx tsc --noEmit` | `npm test` |
| **Node.js (yarn)** | `yarn.lock` | `yarn install --immutable` | `yarn lint` | `yarn typecheck` | `yarn test` |
| **Node.js (bun)** | `bun.lockb` / `bun.lock` | `bun install --frozen-lockfile` | `bun run lint` | `bun run typecheck` | `bun test` |
| **Python (uv)** | `uv.lock` | `uv sync` | `uv run ruff check .` | `uv run mypy .` | `uv run pytest` |
| **Python (poetry)** | `poetry.lock` | `poetry install` | `poetry run ruff check .` | `poetry run mypy .` | `poetry run pytest` |
| **Python (pip/venv)** | `requirements.txt` | `pip install -r requirements.txt` | `ruff check .` or `flake8` | `mypy .` | `pytest` |
| **Go** | `go.mod` | `go mod download` | `golangci-lint run` | `go vet ./...` | `go test ./...` |
| **Rust** | `Cargo.toml` | `cargo fetch` | `cargo clippy --all-targets -- -D warnings` | `cargo check --all-targets` | `cargo test` |

*For Node.js projects, inspect `package.json` `"scripts"` directly to use project-specific script names.*

### 4. Check for Monorepo / Multi-Package Targets

Check for workspace indicators:
- `pnpm-workspace.yaml`
- `lerna.json`
- Multiple subdirectories with `package.json` or `Cargo.toml`

If independent packages have distinct build/test loops, consider defining `[validation.targets.<id>]` blocks (e.g. `web`, `api`, `cli`) with distinct `cwd`, `paths`, and `commands`.

### 5. Detect Agent Environment & Connected Models

- Check available CLI agents (`which reasonix`, `which opencode`).
- Determine default agent assignments and connected model strings:
  1. **Reasonix + Host Local Models** (Devcontainer tcpproxy default):
     - `implementer = "reasonix"`, `implementer_model = "local/pairflow-implementer"`
     - `reviewer = "reasonix"`, `reviewer_model = "local/pairflow-reviewer"`
     - `meta_reviewer = "reasonix"`, `meta_reviewer_model = "local/pairflow-meta-reviewer"`
  2. **Reasonix + DeepSeek Cloud API** (`DEEPSEEK_API_KEY`):
     - `implementer = "reasonix"`, `implementer_model = "deepseek/deepseek-flash"`
     - `reviewer = "reasonix"`, `reviewer_model = "deepseek/deepseek-flash"`
     - `meta_reviewer = "reasonix"`, `meta_reviewer_model = "deepseek/deepseek-flash"`
  3. **Opencode + Host Local Models** (Devcontainer tcpproxy lmstudio provider):
     - `implementer = "opencode"`, `implementer_model = "lmstudio/pairflow-implementer"`
     - `reviewer = "opencode"`, `reviewer_model = "lmstudio/pairflow-reviewer"`
     - `meta_reviewer = "opencode"`, `meta_reviewer_model = "lmstudio/pairflow-meta-reviewer"`
     - Configure per-agent watchdog timeout overrides (local opencode inference is often slower):
       ```toml
       [defaults.watchdog_timeout_minutes_by_agent]
       opencode = 120
       reasonix = 30
       ```

### 6. Synthesize `pairflow.toml`

Construct the TOML content using explicit table headers:

```toml
[defaults]
base_branch = "main"

[defaults.agents]
implementer = "reasonix"
implementer_model = "local/pairflow-implementer"
reviewer = "reasonix"
reviewer_model = "local/pairflow-reviewer"
meta_reviewer = "reasonix"
meta_reviewer_model = "local/pairflow-meta-reviewer"

[defaults.review_policy]
reviewer_blocking_min_severity = "P3"
meta_review_auto_rework_min_severity = "P3"
meta_review_consecutive_clean_runs_required = 2

[validation]
required = ["lint", "typecheck"]
meta_review_approve_required = ["test"]

[validation.commands]
bootstrap = "..."
lint = "..."
typecheck = "..."
test = "..."
```

### 7. Validate Configuration

Before finalizing, test the configuration using the CLI or parser:

```bash
node -e '
import("@pairflow/cli").then(async ({ parsePairflowRepoConfigToml }) => {
  import("fs").then(({ readFileSync }) => {
    try {
      const content = readFileSync("pairflow.toml", "utf8");
      parsePairflowRepoConfigToml(content);
      console.log("pairflow.toml validation passed.");
    } catch (err) {
      console.error("pairflow.toml validation FAILED:", err.message);
      process.exit(1);
    }
  });
});
'
```

If any validation error is reported, fix the TOML before proceeding.

---

## Output Report

When complete, summarize:
1. **Target Path**: `$REPO_PATH/pairflow.toml`
2. **Detected Stack**: Language, package manager, and test runner.
3. **Configured Gates**:
   - Review pass (`required`): commands run on each pass.
   - Meta-review approval (`meta_review_approve_required`): commands run for final merge gate.
4. **Agent Settings**: Implementer, reviewer, meta-reviewer, and watchdog timeouts.
5. **Validation Status**: Confirmation that the file parsed cleanly without errors.
