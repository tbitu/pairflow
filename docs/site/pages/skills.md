---
title: Skills
description: Current Pairflow skill installation workflow and source-of-truth boundary.
order: 6
---

# Pairflow skills

Pairflow ships agent skills for lifecycle operation and specification work. The repo-local source of truth is `.claude/skills/**`.

## Supported install path

Run the CLI installer from a Pairflow checkout or installed package:

```bash
pairflow skills install --skills all --target-dir .opencode --link-other
```

Supported parameters include:

- `--skills all`
- `--skills UsePairflow,CreatePairflowSpec,ExecutePairflowPlan`
- `--target-dir .opencode` (default)
- `--target-dir .reasonix`
- `--link-other`
- `--role-agents`
- `--dry-run --json`
- `--force`

The command copies from repo-local `.opencode/skills/**` (a thin pointer tree mirroring the editable `.claude/skills/**` source) or from package-local `.claude/skills/**` into global `~/.opencode/skills` or `~/.reasonix/skills`. Global copies are derived artifacts, not editable source.

`--link-other` additionally symlinks the selected skills into every other agent directory the installer knows (`.claude`, `.codex`, `.copilot`, `.gemini`, `.reasonix`), excluding the primary target. `.opencode` is not one of those link destinations, so it must be the `--target-dir` when opencode needs global coverage: `--target-dir .opencode --link-other` covers both opencode (`~/.opencode/skills`) and reasonix (`~/.reasonix/skills`) in one command. `~/.agents/skills` is not an install destination at all — it is only written by `--role-agents`, which deploys the repo-owned `PF-*` role definitions.

## Policy reference

`.claude/skills/INSTALL.md` documents the same source-of-truth boundary and the fallback manual install workflow.
