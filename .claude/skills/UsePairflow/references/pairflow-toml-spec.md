# Pairflow Repository Configuration Reference (`pairflow.toml`)

This document is the authoritative specification for `pairflow.toml` located in the root of a project repository.

---

## 1. Role and Lifecycle Authority

- **Placement**: `<repo-root>/pairflow.toml`.
- **Purpose**: Defines repository-wide create-time defaults for bubbles (`pairflow bubble create`) and repository validation command suites.
- **Authority Boundary**:
  - `pairflow.toml` controls bubble creation defaults (`[defaults]`) and validation command recipes (`[validation]`).
  - At bubble creation time, Pairflow resolves defaults from `pairflow.toml` (merged with global user defaults from `~/.pairflow/config.toml` if present) and materializes the frozen configuration into `.pairflow/bubbles/<id>/bubble.toml`.
  - Once created, runtime commands (`bubble status`, `pass`, `approve`, `merge`) read from the bubble's `bubble.toml`, ensuring that later edits to `pairflow.toml` on the host do not destabilize active bubbles.

---

## 2. TOML Parser Grammar & Restrictions

Pairflow uses a dedicated, minimal, fast TOML parser with strict adherence to the following rules:

1. **No Dotted Keys**:
   - `defaults.base_branch = "main"` is **rejected**.
   - You must write section headers:
     ```toml
     [defaults]
     base_branch = "main"
     ```
2. **No Array-of-Tables**:
   - `[[section]]` is **rejected**.
3. **No Multiline Strings**:
   - `"""..."""` and `'''...'''` are **rejected**.
   - All string values must be single-line and quoted with double quotes (`"..."`) or single quotes (`'...'`).
4. **Identifiers & Case**:
   - Validation command IDs and target IDs must match the regex: `^[a-z][a-z0-9_-]{0,63}$`.
   - Command and section names are lowercase.
5. **Reserved Command Identifiers**:
   - The following command names are reserved and cannot be used as command IDs:
     - `meta_review_approve_required`
     - `validation_required`
     - `validation_required_explicit`
6. **Reserved Target Identifiers**:
   - The following names cannot be used as validation target IDs:
     - `id`, `commands`, `required`, `default`, `cwd`, `paths`, `targets`, `validation`, `lint`, `test`, `typecheck`, `bootstrap`

---

## 3. Schema & Section Specification

### Top-Level Sections
Allowed top-level sections in `pairflow.toml`:
- `[defaults]`
- `[validation]`
- `[plan_watch]`
- `[enforcement_mode]` (legacy, ignored)

Any unknown top-level section triggers a `SchemaValidationError`.

---

### `[defaults]` Section

Provides fallback values for `pairflow bubble create` when CLI arguments are omitted.

| Field | Type | Default | Allowed Values / Constraints | Description |
|---|---|---|---|---|
| `base_branch` | string | none | Non-empty string (e.g. `"main"`, `"master"`) | Base git branch for worktree branching. Required if `--base` is omitted in `bubble create`. |
| `watchdog_timeout_minutes` | integer | `30` | Positive integer (> 0) | Wall-clock minutes before watchdog flags an idle/stuck loop. |
| `max_rounds` | integer | `10` | Positive integer (> 0) | Maximum review rounds before loop termination. |
| `severity_gate_round` | integer | `4` | Integer >= 4 | Loop round at which severity-based auto-rework filtering activates. |
| `pairflow_command_profile` | string | `"external"` | `"external"`, `"self_host"` | Command execution profile. |
| `reviewer_context_mode` | string | `"fresh"` | `"fresh"`, `"persistent"` | Context retention mode for the reviewer pane across rounds. |

#### Sub-table: `[defaults.agents]`

| Field | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `implementer` | string | `"reasonix"` | `"opencode"`, `"reasonix"` | Agent assigned to code implementation. |
| `implementer_model` | string | optional | String (e.g. `"lmstudio/pairflow-implementer"`) | Model name or local identifier for implementer. |
| `reviewer` | string | `"reasonix"` | `"opencode"`, `"reasonix"` | Agent assigned to code review. |
| `reviewer_model` | string | optional | String (e.g. `"lmstudio/pairflow-reviewer"`) | Model name or local identifier for reviewer. |
| `meta_reviewer` | string | `"reasonix"` | `"opencode"`, `"reasonix"` | Agent assigned to meta-review convergence. |
| `meta_reviewer_model` | string | optional | String (e.g. `"lmstudio/pairflow-meta-reviewer"`) | Model name or local identifier for meta-reviewer. |

*Note: Trailing slashes on model names (e.g. `gpt-5/`) are automatically stripped.*

##### Connected Model Configurations & Environments:
> [!IMPORTANT]
> **Agent-Model Pairing Rule**: Local LLMs are **always** run with `opencode` (`lmstudio/pairflow-*`). `reasonix` is used exclusively for cloud models (e.g. `deepseek/deepseek-flash`). A combination of local LLMs and `reasonix` is never used.

1. **Local LLMs -> Opencode** (Host inference via Devcontainer tcpproxy -> LM Studio / Ollama):
   ```toml
   [defaults.agents]
   implementer = "opencode"
   implementer_model = "lmstudio/pairflow-implementer"
   reviewer = "opencode"
   reviewer_model = "lmstudio/pairflow-reviewer"
   meta_reviewer = "opencode"
   meta_reviewer_model = "lmstudio/pairflow-meta-reviewer"

   [defaults.watchdog_timeout_minutes_by_agent]
   opencode = 120
   reasonix = 30
   ```
2. **Cloud Models -> Reasonix** (DeepSeek API via `DEEPSEEK_API_KEY` in `~/.reasonix/.env`):
   ```toml
   [defaults.agents]
   implementer = "reasonix"
   implementer_model = "deepseek/deepseek-flash"
   reviewer = "reasonix"
   reviewer_model = "deepseek/deepseek-flash"
   meta_reviewer = "reasonix"
   meta_reviewer_model = "deepseek/deepseek-flash"
   ```

#### Sub-table: `[defaults.watchdog_timeout_minutes_by_agent]`

Allows assigning distinct watchdog timeouts to different agent runtimes:

```toml
[defaults.watchdog_timeout_minutes_by_agent]
opencode = 120
reasonix = 30
```

- Keys must be valid agent names (`"opencode"`, `"reasonix"`).
- Values must be positive integers.

#### Sub-table: `[defaults.role_mcp]`

Controls Model Context Protocol (MCP) tool exposure per role:

```toml
[defaults.role_mcp]
implementer = "disabled"
reviewer = "enabled"
meta_reviewer = "disabled"
```

- Keys: `implementer`, `reviewer`, `meta_reviewer`.
- Allowed values: `"disabled"`, `"enabled"`.

#### Sub-table: `[defaults.review_policy]`

| Field | Type | Default | Allowed Values | Description |
|---|---|---|---|---|
| `review_loop_mode` | string | `"full"` | `"full"`, `"meta_only"` | `"full"` runs implementer -> reviewer -> meta-reviewer. `"meta_only"` skips reviewer. |
| `reviewer_blocking_min_severity` | string | `"P3"` | `"P1"`, `"P2"`, `"P3"` | Minimum finding severity that triggers auto-rework. **P4 is invalid**. |
| `meta_review_auto_rework_min_severity` | string | `"P3"` | `"P1"`, `"P2"`, `"P3"` | Minimum finding severity that triggers auto-rework at meta-review. |
| `meta_review_consecutive_clean_runs_required` | integer | `2` | Integer >= 1 | Number of consecutive clean runs before approval is granted. |

#### Sub-table: `[defaults.doc_contract_gates]`

Used for document-mode bubbles (`review_artifact_type = "document"`):

```toml
[defaults.doc_contract_gates]
round_gate_applies_after = 2
```

- `round_gate_applies_after`: Non-negative integer (>= 0).

---

### `[validation]` Section

Controls validation checks executed within the bubble worktree.

| Field | Type | Description |
|---|---|---|
| `required` | array of strings | Command IDs that must succeed during review pass (`pairflow agent emit --kind pass`). |
| `meta_review_approve_required` | array of strings | Command IDs that must succeed before final meta-review approval. |

**Important Constraint**: Every command ID listed in `meta_review_approve_required` must either:
1. Be defined in `[validation.commands.<id>]`, OR
2. Be defined in `[validation.targets.*.commands.<id>]`, OR
3. Be one of the built-in IDs: `"bootstrap"`, `"lint"`, `"typecheck"`, `"test"`.

#### Sub-table: `[validation.commands]`

Key-value mapping of command ID to shell execution command.

```toml
[validation.commands]
bootstrap = "pnpm install --frozen-lockfile && pnpm build"
lint = "pnpm lint"
typecheck = "pnpm typecheck"
fitness = "pnpm fitness:check:ci"
test = "pnpm test"
```

---

### `[validation.targets.<id>]` (Monorepo / Multi-Target)

For monorepos or projects with distinct packages, targets allow defining path-scoped validation suites:

```toml
[validation.targets.web]
default = true
cwd = "apps/web"
paths = ["apps/web/**", "packages/shared/**"]
required = ["lint", "typecheck", "test"]

[validation.targets.web.commands]
lint = "pnpm --filter web lint"
typecheck = "pnpm --filter web typecheck"
test = "pnpm --filter web test"
```

- `default` (boolean): Optional. At most ONE target can set `default = true`.
- `cwd` (string): Optional. Normalized relative directory inside the worktree (e.g. `"apps/web"`). Must not contain `..` or escape the worktree root.
- `paths` (array of strings): Optional. Relative path glob patterns that match files in this target.
- `required` (array of strings): Command IDs required for this target.
- `commands` (table): Command ID to shell command mapping for this target.

---

### `[plan_watch.runner]` (Autonomous Plan Daemon)

Configuration for the `pairflow plan watch` execution runner:

```toml
[plan_watch.runner]
backend = "opencode"
idle_timeout_seconds = 1800
```

- `backend`: Non-empty string specifying the agent backend (e.g. `"opencode"`, `"reasonix"`).
- `idle_timeout_seconds`: Positive integer <= 2,147,483 (Node max timer delay).

---

## 4. Verification & Diagnostics

To check whether a `pairflow.toml` is syntactically and semantically valid:

```bash
node -e '
import("@pairflow/cli").then(async ({ loadPairflowRepoConfig }) => {
  try {
    const config = await loadPairflowRepoConfig(process.cwd());
    console.log("Valid pairflow.toml:", JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Invalid pairflow.toml:", err.message);
    process.exit(1);
  }
});
'
```

Alternatively, running `pairflow bubble create --print --task "test"` will exercise repo config loading and validation.
