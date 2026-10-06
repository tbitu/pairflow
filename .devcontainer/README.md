# Pairflow Devcontainer Image Builder

This directory contains the Dockerfile, runtime scripts, and image build pipeline for **`ghcr.io/tbitu/pairflow-devcontainer:latest`**.

This repository builds and publishes the devcontainer image so that other software projects (Python, Go, Node.js, Rust, etc.) can easily run Pairflow and coding agents (`opencode-ai`, `reasonix`) in a containerized environment with zero setup.

## Key Architecture

- **Prebuilt Multi-Arch Image via GHCR**: Built on `mcr.microsoft.com/devcontainers/base:ubuntu-24.04` with `build-essential`, Python 3, Node.js 22, pinned `pnpm@10.8.1`, and coding agents (`opencode-ai`, `reasonix`).
- **`tcpproxy` Background Service**: Listens inside the container on `127.0.0.1:1235`. It transparently proxies OpenAI requests to your host's inference engine (`Ollama`, `LM Studio`, `vLLM`), maps Pairflow virtual model roles (`pairflow-implementer`, `pairflow-reviewer`, `pairflow-meta-reviewer`), and injects role-specific sampling hyperparameters.
- **Pre-baked Pairflow & Agent Skills**: The Pairflow CLI is compiled and packaged directly from this repository during image build, pre-installing `@pairflow/cli` and all agent skills (`UsePairflow`, `CreatePairflowSpec`, `ExecutePairflowPlan`) into global agent roots.
- **State & Credential Persistence**:
  - `pairflow-worktrees`: Persists git worktrees created during bubble execution at `/.pairflow-worktrees` outside the workspace mount.
  - `pairflow-reasonix-state`: Persists `~/.reasonix/.env` (API keys), provider config, and history.
  - `pairflow-opencode-state`: Persists Opencode settings and plugins at `~/.config/opencode`.
  - `pairflow-opencode-home`: Persists `~/.opencode` (installed skills and symlinks).
  - `pairflow-npm-cache`: Caches package downloads so runtime startup is fast.
- **Automated GHCR CI/CD**: The GitHub Actions workflow (`.github/workflows/devcontainer.yml`) builds multi-arch (`linux/amd64`, `linux/arm64`) images from this repository and publishes unified manifest lists to `ghcr.io/tbitu/pairflow-devcontainer`.

---

## Using Pairflow Devcontainer in External Projects

To use Pairflow in your own project repository:

### Option A: VS Code Dev Containers

1. Copy the template from [`templates/devcontainer/devcontainer.json`](../templates/devcontainer/devcontainer.json) into your target project:
   ```bash
   mkdir -p <your-project>/.devcontainer
   cp templates/devcontainer/devcontainer.json <your-project>/.devcontainer/devcontainer.json
   ```
2. Ensure your host inference engine is running (e.g. `OLLAMA_HOST=0.0.0.0:11434 ollama serve` or LM Studio local server).
3. Open your project in VS Code and select **Dev Containers: Reopen in Container**.

### Option B: Standalone Docker Compose (Terminal / Headless)

1. Copy the template from [`templates/devcontainer/docker-compose.yml`](../templates/devcontainer/docker-compose.yml) into your target project:
   ```bash
   cp templates/devcontainer/docker-compose.yml <your-project>/docker-compose.yml
   ```
2. Start the container in the background:
   ```bash
   docker compose up -d
   ```
3. Open an interactive shell inside the container:
   ```bash
   docker compose exec -it pairflow bash
   ```

---

## Configuration Parameters

Parameters can be passed as host environment variables or edited in your project's `devcontainer.json` / `docker-compose.yml`:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `PAIRFLOW_OPENAI_ENDPOINT` | `http://host.docker.internal:11434/v1` | URL to upstream inference server |
| `PAIRFLOW_TARGET_MODEL` | `qwen3.8-27b:q8_0` | Actual model name on host backend |
| `PAIRFLOW_BACKEND` | `ollama` | Backend engine: `ollama`, `lmstudio`, or `generic` |
| `PAIRFLOW_UPSTREAM_API_KEY` | *(empty)* | Optional Bearer token for upstream |
| `DEEPSEEK_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |
| `OPENAI_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |

---

## Building Locally & Publishing to GHCR

### Automated (GitHub Actions)
Whenever changes are pushed to `main` under `.devcontainer/**`, GitHub Actions builds multi-architecture images and pushes them to:
```text
ghcr.io/tbitu/pairflow-devcontainer:latest
ghcr.io/tbitu/pairflow-devcontainer:<sha>
```

### Local Build Script
To build the image locally using the repository source:
```bash
# Build local image
pnpm devcontainer:build

# Or build and push directly to GHCR:
bash scripts/build-devcontainer.sh --tag=ghcr.io/tbitu/pairflow-devcontainer:latest --push
```
