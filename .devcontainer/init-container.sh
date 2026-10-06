#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "Initializing Pairflow Devcontainer Environment at Runtime"
echo "=========================================================="

USER_HOME="${HOME:-/home/vscode}"

# 0. Ensure bubble worktree root and persistent volumes are writable
if [ "$(id -u)" -eq 0 ]; then
    mkdir -p /.pairflow-worktrees
    chmod 777 /.pairflow-worktrees 2>/dev/null || true

    # In Rootless Docker or when running as root, link /root state to the persistent volumes under /home/vscode
    mkdir -p /home/vscode/.reasonix /home/vscode/.config/opencode /home/vscode/.opencode /home/vscode/.npm /home/vscode/.local/share/pnpm
    chmod -R a+rwx /home/vscode 2>/dev/null || true

    mkdir -p /root/.config
    [ -L /root/.reasonix ] || ln -sfn /home/vscode/.reasonix /root/.reasonix
    [ -L /root/.config/opencode ] || ln -sfn /home/vscode/.config/opencode /root/.config/opencode
    [ -L /root/.opencode ] || ln -sfn /home/vscode/.opencode /root/.opencode
elif command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p /.pairflow-worktrees
    sudo chmod 777 /.pairflow-worktrees 2>/dev/null || sudo chown -R vscode:vscode /.pairflow-worktrees 2>/dev/null || true
fi

# Ensure /workspace is writable by current user
if [ -d "/workspace" ] && [ ! -w "/workspace" ]; then
    echo "⚠️  /workspace is not writable by current user ($(id -un)). Granting write permissions..."
    if [ "$(id -u)" -eq 0 ]; then
        chmod -R u+rwX,g+rwX,o+rwX /workspace 2>/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then
        sudo chmod -R u+rwX,g+rwX,o+rwX /workspace 2>/dev/null || true
    fi
fi

# 1. Verify Pairflow CLI availability
echo "[1/4] Checking Pairflow CLI..."
if ! command -v pairflow >/dev/null 2>&1 && [ ! -x "${USER_HOME}/.npm-global/bin/pairflow" ]; then
    echo "ERROR: Pairflow CLI is not installed in the devcontainer image." >&2
    exit 1
fi
echo "✓ Pairflow CLI is ready: $(command -v pairflow || echo "${USER_HOME}/.npm-global/bin/pairflow")"

# 2. Setup Reasonix Persistent State & API Keys
echo "[2/4] Initializing Reasonix configuration and credentials..."
mkdir -p "${USER_HOME}/.reasonix"
REASONIX_ENV="${USER_HOME}/.reasonix/.env"
touch "${REASONIX_ENV}"
chmod 600 "${REASONIX_ENV}"

# Forward host API keys into ~/.reasonix/.env if provided and not yet present
if [ -n "${DEEPSEEK_API_KEY:-}" ] && ! grep -q "^DEEPSEEK_API_KEY=" "${REASONIX_ENV}"; then
    echo "DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}" >> "${REASONIX_ENV}"
    echo "✓ Populated DEEPSEEK_API_KEY into ${REASONIX_ENV}"
fi

if [ -n "${OPENAI_API_KEY:-}" ] && ! grep -q "^OPENAI_API_KEY=" "${REASONIX_ENV}"; then
    echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> "${REASONIX_ENV}"
    echo "✓ Populated OPENAI_API_KEY into ${REASONIX_ENV}"
fi

# Pre-acknowledge YOLO mode so autonomous loop agents never prompt interactively
REASONIX_YOLO="${USER_HOME}/.reasonix/yolo-acknowledged.json"
if [ ! -f "${REASONIX_YOLO}" ]; then
    printf '{"acknowledged_at":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo 2026-01-01T00:00:00Z)" > "${REASONIX_YOLO}"
    echo "✓ Pre-acknowledged Reasonix YOLO mode in ${REASONIX_YOLO}"
fi

REASONIX_CONFIG="${USER_HOME}/.reasonix/config.toml"
if [ ! -f "${REASONIX_CONFIG}" ]; then
    cat <<'EOF' > "${REASONIX_CONFIG}"
# Reasonix configuration for Pairflow Devcontainer
default_model = "local/pairflow-implementer"

[permissions]
mode = "allow"

[sandbox]
bash = "off"
network = true

[[providers]]
name = "local"
kind = "openai"
base_url = "http://127.0.0.1:1235/v1"
models = ["pairflow-implementer", "pairflow-reviewer", "pairflow-meta-reviewer"]

[[providers]]
name = "deepseek"
kind = "openai"
base_url = "https://api.deepseek.com"
model = "deepseek-flash"
api_key_env = "DEEPSEEK_API_KEY"
EOF
    echo "✓ Generated default ${REASONIX_CONFIG}"
elif grep -q 'bash = "enforce"' "${REASONIX_CONFIG}"; then
    sed -i 's/bash = "enforce"/bash = "off"/g' "${REASONIX_CONFIG}"
    echo "✓ Updated ${REASONIX_CONFIG} sandbox bash to \"off\""
fi

# 3. Setup Opencode Persistent Configuration
echo "[3/4] Initializing Opencode configuration..."
mkdir -p "${USER_HOME}/.config/opencode"
OPENCODE_CONFIG="${USER_HOME}/.config/opencode/opencode.jsonc"
if [ ! -f "${OPENCODE_CONFIG}" ]; then
    cat <<'EOF' > "${OPENCODE_CONFIG}"
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": true,
  "permission": "allow",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Host Local Inference",
      "options": {
        "baseURL": "http://127.0.0.1:1235/v1",
        "headerTimeout": 600000,
        "chunkTimeout": 1800000,
        "timeout": 3600000
      },
      "models": {
        "pairflow-implementer": { "name": "Pairflow Implementer" },
        "pairflow-reviewer": { "name": "Pairflow Reviewer" },
        "pairflow-meta-reviewer": { "name": "Pairflow Meta Reviewer" }
      }
    }
  }
}
EOF
    echo "✓ Generated default ${OPENCODE_CONFIG}"
fi

# 4. Ensure Pairflow Agent Skills (Opencode, Reasonix, Claude, Gemini, etc.)
echo "[4/4] Ensuring Pairflow agent skills are present in agent global roots..."
if [ ! -d "${USER_HOME}/.opencode/skills/UsePairflow" ]; then
    pairflow skills install --skills all --target-dir .opencode --link-other --force
fi

if [ -d "${USER_HOME}/.opencode/skills" ]; then
    mkdir -p "${USER_HOME}/.config/opencode"
    ln -sfn "${USER_HOME}/.opencode/skills" "${USER_HOME}/.config/opencode/skills"
    echo "✓ Linked canonical Opencode skills: ${USER_HOME}/.config/opencode/skills -> ${USER_HOME}/.opencode/skills"
else
    echo "ERROR: Pairflow skills missing at ${USER_HOME}/.opencode/skills after installation." >&2
    exit 1
fi

echo "=========================================================="
echo "Pairflow Devcontainer Runtime Initialization Complete"
echo "=========================================================="
