#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "Initializing Pairflow Devcontainer Environment at Runtime"
echo "=========================================================="

USER_HOME="${HOME:-/home/vscode}"

# 1. Update / Install Coding Agents (Opencode & Reasonix)
echo "[1/4] Fetching latest opencode-ai and warming reasonix..."
npm install -g opencode-ai@latest
npx --yes reasonix --version >/dev/null 2>&1 || true

# 2. Pairflow CLI Setup
echo "[2/4] Ensuring Pairflow CLI is available..."
if [ -f "/workspace/package.json" ] && grep -q '"name": "@pairflow/cli"' "/workspace/package.json"; then
    echo "Detected Pairflow source repository. Linking workspace CLI..."
    (cd /workspace && pnpm install --frozen-lockfile && pnpm build && pnpm link --global) || {
        echo "Warning: Local build failed, falling back to npm install @pairflow/cli..."
        npm install -g @pairflow/cli@latest
    }
else
    echo "Installing @pairflow/cli@latest..."
    npm install -g @pairflow/cli@latest
fi

# 3. Setup Reasonix Persistent State & API Keys
echo "[3/4] Initializing Reasonix configuration and credentials..."
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

REASONIX_CONFIG="${USER_HOME}/.reasonix/config.toml"
if [ ! -f "${REASONIX_CONFIG}" ]; then
    cat <<'EOF' > "${REASONIX_CONFIG}"
# Reasonix configuration for Pairflow Devcontainer
default_model = "local/pairflow-implementer"

[permissions]
mode = "allow"

[sandbox]
bash = "enforce"
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
fi

# 4. Setup Opencode Persistent Configuration
echo "[4/4] Initializing Opencode configuration..."
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

echo "=========================================================="
echo "Pairflow Devcontainer Runtime Initialization Complete"
echo "=========================================================="
