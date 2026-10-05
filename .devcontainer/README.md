# Pairflow Devcontainer & Docker Compose

A portable containerized development environment for Pairflow, Opencode, and Reasonix paired with local or remote LLM inference.

## Key Architecture

- **Prebuilt Image via GHCR**: `devcontainer.json` pulls the prebuilt multi-arch image `ghcr.io/tbitu/pairflow-devcontainer:latest`, requiring zero local build time.
- **`tcpproxy` Background Service**: Listens inside the container on `127.0.0.1:1235`. It transparently proxies OpenAI requests to your host's inference engine (`Ollama`, `LM Studio`, `vLLM`), maps Pairflow virtual model roles (`pairflow-implementer`, `pairflow-reviewer`, `pairflow-meta-reviewer`), and injects role-specific sampling hyperparameters.
- **Runtime Tool Updates**: Opencode, Reasonix, and Pairflow CLI are fetched/updated at container creation rather than frozen into the base image.
- **State & Credential Persistence**:
  - `pairflow-worktrees`: Persists git worktrees created during bubble execution at `/.pairflow-worktrees` outside the workspace mount.
  - `pairflow-reasonix-state`: Persists `~/.reasonix/.env` (API keys), provider config, and history.
  - `pairflow-opencode-state`: Persists Opencode settings and plugins at `~/.config/opencode`.
  - `pairflow-opencode-home`: Persists `~/.opencode` (installed skills and symlinks).
  - `pairflow-npm-cache`: Caches package downloads so runtime startup is fast.
- **Agent Skill Installation**:
  Pairflow agent skills (`UsePairflow`, `CreatePairflowSpec`, `ExecutePairflowPlan`) are automatically installed at container startup into global agent roots (`~/.opencode/skills`, `~/.reasonix/skills`, `~/.config/opencode/skills`, `~/.claude/skills`, `~/.gemini/config/skills`), enabling agents in bubbles to immediately discover and use workflow tools.
- **Automated GHCR CI/CD**: The GitHub Actions workflow (`.github/workflows/devcontainer.yml`) builds multi-arch (`linux/amd64`, `linux/arm64`) images in parallel and publishes unified manifest lists to `ghcr.io/tbitu/pairflow-devcontainer`.

---

## Configuration Parameters

Parameters can be passed as host environment variables, in `docker-compose.yml`, or edited in `devcontainer.json`:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `PAIRFLOW_OPENAI_ENDPOINT` | `http://host.docker.internal:11434/v1` | URL to upstream inference server |
| `PAIRFLOW_TARGET_MODEL` | `qwen3.8-27b:q8_0` | Actual model name on host backend |
| `PAIRFLOW_BACKEND` | `ollama` | Backend engine: `ollama`, `lmstudio`, or `generic` |
| `PAIRFLOW_UPSTREAM_API_KEY` | *(empty)* | Optional Bearer token for upstream |
| `DEEPSEEK_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |
| `OPENAI_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |

---

## Usage Modes

### Mode A: VS Code Dev Containers (Pulls Prebuilt Image)

1. Ensure your host inference engine is running (e.g. `OLLAMA_HOST=0.0.0.0:11434 ollama serve` or LM Studio local server).
2. Open the repository in VS Code and select **Dev Containers: Reopen in Container**.
3. VS Code pulls `ghcr.io/tbitu/pairflow-devcontainer:latest` directly and launches into the workspace.

### Mode B: Standalone Docker Compose (Terminal / Headless)

Run the environment directly via Docker Compose on any machine:

```bash
# Start Pairflow container in background
docker compose up -d

# Open a shell in the container
docker compose exec -it pairflow bash

# Optional: Also run a local Ollama container if host has no LLM installed
docker compose --profile with-ollama up -d
```

---

## Building Locally & Publishing to GHCR

### Automated (GitHub Actions)
Whenever changes are pushed to `main` under `.devcontainer/**`, GitHub Actions builds multi-architecture images and pushes them to:
```text
ghcr.io/tbitu/pairflow-devcontainer:latest
ghcr.io/tbitu/pairflow-devcontainer:<sha>
```

### Local Build Script
If you want to modify the base `Dockerfile` and build locally:
```bash
# Build local image
pnpm devcontainer:build

# Or build and push directly to GHCR:
bash scripts/build-devcontainer.sh --tag=ghcr.io/tbitu/pairflow-devcontainer:latest --push
```
