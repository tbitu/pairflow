# Pairflow Devcontainer

A portable containerized development environment for Pairflow, Opencode, and Reasonix paired with local or remote LLM inference.

## Key Architecture

- **`tcpproxy` Background Service**: Listens inside the container on `127.0.0.1:1235`. It transparently proxies OpenAI requests to your host's inference engine (`Ollama`, `LM Studio`, `vLLM`), maps Pairflow virtual model roles (`pairflow-implementer`, `pairflow-reviewer`, `pairflow-meta-reviewer`), and injects role-specific sampling hyperparameters.
- **Runtime Tool Updates**: Opencode, Reasonix, and Pairflow CLI are fetched/updated at container creation rather than frozen into the base image.
- **State & Credential Persistence**:
  - `pairflow-reasonix-state`: Persists `~/.reasonix/.env` (API keys), provider config, and history.
  - `pairflow-opencode-state`: Persists Opencode settings and plugins.
  - `pairflow-npm-cache`: Caches package downloads so runtime startup is fast.
- **Automated GHCR CI/CD**: The GitHub Actions workflow (`.github/workflows/devcontainer.yml`) automatically builds multi-arch (`linux/amd64`, `linux/arm64`) images on push to `main` and publishes them to the GitHub Container Registry (`ghcr.io`).

---

## Configuration Parameters

Parameters can be passed as host environment variables or edited in `devcontainer.json`:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `PAIRFLOW_OPENAI_ENDPOINT` | `http://host.docker.internal:11434/v1` | URL to upstream inference server |
| `PAIRFLOW_TARGET_MODEL` | `qwen3.8-27b:q8_0` | Actual model name on host backend |
| `PAIRFLOW_BACKEND` | `ollama` | Backend engine: `ollama`, `lmstudio`, or `generic` |
| `PAIRFLOW_UPSTREAM_API_KEY` | *(empty)* | Optional Bearer token for upstream |
| `DEEPSEEK_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |
| `OPENAI_API_KEY` | *(empty)* | Optional API key automatically populated into `~/.reasonix/.env` |

---

## Usage

### 1. Host Inference Setup

Ensure your host inference engine is running and bound to `0.0.0.0` or accessible to containers:

- **Ollama**:
  ```bash
  OLLAMA_HOST=0.0.0.0:11434 ollama serve
  ```
- **LM Studio**:
  Enable the local server and check **Serve on local network** (port 1234).
  Set host variables:
  ```bash
  export PAIRFLOW_OPENAI_ENDPOINT="http://host.docker.internal:1234/v1"
  export PAIRFLOW_TARGET_MODEL="qwen3.8-27b@q8_0"
  export PAIRFLOW_BACKEND="lmstudio"
  ```

### 2. Launch Devcontainer

- **In VS Code**: Open the repository and select **Dev Containers: Reopen in Container**.
- **Using Devcontainer CLI**:
  ```bash
  devcontainer up --workspace-folder .
  devcontainer exec --workspace-folder . bash
  ```

### 3. Inside the Container

All agents connect through `http://127.0.0.1:1235/v1` automatically:

```bash
# Pairflow bubble orchestration
pairflow bubble start ...

# Interactive agents
opencode
npx reasonix code
```

---

## Building & Publishing to GHCR

### Automated (GitHub Actions)
Whenever changes are pushed to `main` under `.devcontainer/**`, GitHub Actions builds multi-architecture images and pushes them to:
```text
ghcr.io/<owner>/<repo>/pairflow-devcontainer:latest
ghcr.io/<owner>/<repo>/pairflow-devcontainer:<sha>
```

### Local Build Script
Build locally with Docker, Podman, or Devcontainer CLI:
```bash
# Build local image
pnpm devcontainer:build

# Or build and push directly to a custom registry:
bash scripts/build-devcontainer.sh --tag=ghcr.io/myuser/pairflow-devcontainer:latest --push
```
