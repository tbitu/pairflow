#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "Initializing Pairflow Devcontainer Environment at Runtime"
echo "=========================================================="

USER_HOME="${HOME:-/home/vscode}"

# 0. Ensure bubble worktree root and persistent volumes are writable
if [ "$(id -u)" -eq 0 ]; then
    mkdir -p /workspaces/.pairflow-worktrees /workspaces
    chmod -R a+rwX /workspaces/.pairflow-worktrees 2>/dev/null || true
    # For backward compatibility if repo is mounted at /workspace:
    if [ ! -L /.pairflow-worktrees ]; then
        if [ ! -d /.pairflow-worktrees ] || [ -z "$(ls -A /.pairflow-worktrees 2>/dev/null)" ]; then
            rm -rf /.pairflow-worktrees 2>/dev/null || true
            ln -sfn /workspaces/.pairflow-worktrees /.pairflow-worktrees 2>/dev/null || true
        fi
    fi
    [ -d /.pairflow-worktrees ] && chmod -R a+rwX /.pairflow-worktrees 2>/dev/null || true

    # In Rootless Docker or when running as root, link /root state to the persistent volumes under /home/vscode
    mkdir -p /home/vscode/.reasonix /home/vscode/.config/opencode /home/vscode/.opencode /home/vscode/.gemini /home/vscode/.npm /home/vscode/.local/share/pnpm /home/vscode/.npm-global
    chmod -R a+rwx /home/vscode 2>/dev/null || true

    mkdir -p /root/.config /root/.local/share
    [ -L /root/.reasonix ] || ln -sfn /home/vscode/.reasonix /root/.reasonix
    [ -L /root/.config/opencode ] || ln -sfn /home/vscode/.config/opencode /root/.config/opencode
    [ -L /root/.opencode ] || ln -sfn /home/vscode/.opencode /root/.opencode
    [ -L /root/.gemini ] || ln -sfn /home/vscode/.gemini /root/.gemini
    [ -L /root/.local/share/pnpm ] || ln -sfn /home/vscode/.local/share/pnpm /root/.local/share/pnpm
    [ -L /root/.npm ] || ln -sfn /home/vscode/.npm /root/.npm
    [ -L /root/.npm-global ] || ln -sfn /home/vscode/.npm-global /root/.npm-global
elif command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p /workspaces/.pairflow-worktrees /workspaces 2>/dev/null || true
    sudo chmod -R a+rwX /workspaces/.pairflow-worktrees 2>/dev/null || sudo chown -R vscode:vscode /workspaces/.pairflow-worktrees 2>/dev/null || true
    if [ ! -L /.pairflow-worktrees ]; then
        if [ ! -d /.pairflow-worktrees ] || [ -z "$(sudo ls -A /.pairflow-worktrees 2>/dev/null)" ]; then
            sudo rm -rf /.pairflow-worktrees 2>/dev/null || true
            sudo ln -sfn /workspaces/.pairflow-worktrees /.pairflow-worktrees 2>/dev/null || true
        fi
    fi
    [ -d /.pairflow-worktrees ] && (sudo chmod -R a+rwX /.pairflow-worktrees 2>/dev/null || true)
fi

# Ensure workspace and worktree directories are fully writable by current user
for ws_dir in "/workspaces" "/workspace"; do
    if [ -d "$ws_dir" ]; then
        if [ ! -w "$ws_dir" ] || find "$ws_dir" -maxdepth 2 ! -writable 2>/dev/null | grep -q .; then
            echo "⚠️  $ws_dir contains files not writable by current user ($(id -un)). Granting write permissions..."
            if [ "$(id -u)" -eq 0 ]; then
                chmod -R u+rwX,g+rwX,o+rwX "$ws_dir" 2>/dev/null || true
            elif command -v sudo >/dev/null 2>&1; then
                sudo chmod -R u+rwX,g+rwX,o+rwX "$ws_dir" 2>/dev/null || true
            fi
        fi
    fi
done

# Ensure system /tmp is fully open for scratch work (e.g. Reasonix base-check folders)
chmod 1777 /tmp 2>/dev/null || true

# 1. Verify Pairflow CLI and Developer Tooling availability
echo "[1/4] Checking Pairflow CLI and TypeScript tooling..."
if ! command -v pairflow >/dev/null 2>&1 && [ ! -x "${USER_HOME}/.npm-global/bin/pairflow" ]; then
    echo "ERROR: Pairflow CLI is not installed in the devcontainer image." >&2
    exit 1
fi
echo "✓ Pairflow CLI is ready: $(command -v pairflow || echo "${USER_HOME}/.npm-global/bin/pairflow")"

if ! command -v tsc >/dev/null 2>&1 || ! command -v tsx >/dev/null 2>&1; then
    echo "Installing missing global TypeScript tooling (typescript, tsx)..."
    npm install -g typescript tsx 2>/dev/null || true
fi
if command -v tsc >/dev/null 2>&1; then
    echo "✓ TypeScript compiler ready: $(command -v tsc)"
fi

# Ensure clipboard utilities (wl-clipboard, xclip) are available
if ! command -v wl-copy >/dev/null 2>&1 && ! command -v xclip >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
        apt-get update -y && apt-get install -y --no-install-recommends wl-clipboard xclip && rm -rf /var/lib/apt/lists/* 2>/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then
        sudo apt-get update -y && sudo apt-get install -y --no-install-recommends wl-clipboard xclip && sudo rm -rf /var/lib/apt/lists/* 2>/dev/null || true
    fi
fi
if command -v wl-copy >/dev/null 2>&1 || command -v xclip >/dev/null 2>&1; then
    echo "✓ Clipboard tooling ready: $(command -v wl-copy || command -v xclip)"
fi

# Ensure Antigravity CLI (agy) is available
if ! command -v agy >/dev/null 2>&1; then
    echo "Installing missing Antigravity CLI (agy)..."
    if [ "$(id -u)" -eq 0 ]; then
        curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin 2>/dev/null || true
    elif command -v sudo >/dev/null 2>&1; then
        curl -fsSL https://antigravity.google/cli/install.sh | sudo bash -s -- --dir /usr/local/bin 2>/dev/null || true
    else
        curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir "${USER_HOME}/.local/bin" 2>/dev/null || true
    fi
fi
if command -v agy >/dev/null 2>&1; then
    echo "✓ Antigravity CLI ready: $(command -v agy)"
fi

# Ensure pnpm handles cross-volume links gracefully inside containers
pnpm config set package-import-method copy 2>/dev/null || true

# 2. Setup Reasonix Persistent State & API Keys
echo "[2/4] Initializing Reasonix configuration and credentials..."
mkdir -p "${USER_HOME}/.reasonix" "${USER_HOME}/.gemini"
REASONIX_ENV="${USER_HOME}/.reasonix/.env"
touch "${REASONIX_ENV}"
chmod 666 "${REASONIX_ENV}"

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
default_model = "deepseek-flash"

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

# Ensure existing Reasonix configs use deepseek-flash as default model
for cfg in "${USER_HOME}/.reasonix/config.toml" "/home/vscode/.reasonix/config.toml"; do
    if [ -f "$cfg" ] && grep -q 'default_model = ".*pairflow-implementer.*"' "$cfg"; then
        sed -i 's/default_model = ".*pairflow-implementer.*"/default_model = "deepseek-flash"/g' "$cfg"
        echo "✓ Updated $cfg default_model to \"deepseek-flash\""
    fi
done

chmod -R a+rwX "${USER_HOME}/.reasonix" /home/vscode/.reasonix "${USER_HOME}/.gemini" /home/vscode/.gemini 2>/dev/null || true

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
  },
  "providers": {
    "lmstudio": {
      "name": "Host Local Inference",
      "settings": {
        "baseURL": "http://127.0.0.1:1235/v1"
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
chmod -R a+rwX "${USER_HOME}/.config/opencode" /home/vscode/.config/opencode 2>/dev/null || true

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
