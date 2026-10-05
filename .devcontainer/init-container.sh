#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "Initializing Pairflow Devcontainer Environment at Runtime"
echo "=========================================================="

USER_HOME="${HOME:-/home/vscode}"

# 0. Ensure bubble worktree root is writable
if [ "$(id -u)" -eq 0 ]; then
    mkdir -p /.pairflow-worktrees
    chown -R vscode:vscode /.pairflow-worktrees 2>/dev/null || true
elif command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p /.pairflow-worktrees
    sudo chown -R vscode:vscode /.pairflow-worktrees 2>/dev/null || true
fi

# 1. Update / Install Coding Agents (Opencode & Reasonix)
echo "[1/5] Fetching latest opencode-ai and reasonix..."
npm install -g opencode-ai@latest reasonix@latest

# 2. Pairflow CLI Setup
echo "[2/5] Ensuring Pairflow CLI is available..."
mkdir -p "${USER_HOME}/.npm-global/bin"

if [ -f "/workspace/package.json" ] && grep -q '"name": "@pairflow/cli"' "/workspace/package.json"; then
    echo "Detected Pairflow source repository."
    if [ ! -f "/workspace/dist/cli/index.js" ]; then
        echo "dist/cli/index.js not present; building from workspace source..."
        (cd /workspace && pnpm install --frozen-lockfile && pnpm build) || {
            echo "Local build failed or skipped; installing global fallback..."
            npm install -g @pairflow/cli@latest
        }
    fi
    if [ -f "/workspace/dist/cli/index.js" ]; then
        echo "Found workspace dist/cli/index.js. Linking CLI wrapper..."
        cat <<'EOF' > "${USER_HOME}/.npm-global/bin/pairflow"
#!/usr/bin/env bash
exec node /workspace/dist/cli/index.js "$@"
EOF
        chmod +x "${USER_HOME}/.npm-global/bin/pairflow"
        echo "✓ Linked workspace Pairflow CLI to ${USER_HOME}/.npm-global/bin/pairflow"
    fi
else
    echo "Installing @pairflow/cli@latest..."
    npm install -g @pairflow/cli@latest
fi

# 3. Setup Reasonix Persistent State & API Keys
echo "[3/5] Initializing Reasonix configuration and credentials..."
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
echo "[4/5] Initializing Opencode configuration..."
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

# 5. Install Pairflow Agent Skills (Opencode, Reasonix, Claude, Gemini, etc.)
echo "[5/5] Installing Pairflow agent skills into agent global roots..."
PAIRFLOW_BIN="${USER_HOME}/.npm-global/bin/pairflow"
if [ -x "${PAIRFLOW_BIN}" ]; then
    "${PAIRFLOW_BIN}" skills install --skills all --target-dir .opencode --link-other --force || {
        echo "⚠️ Warning: pairflow skills install exited with non-zero status."
    }
    # Ensure Opencode canonical global config root also discovers the skills
    if [ -d "${USER_HOME}/.opencode/skills" ]; then
        mkdir -p "${USER_HOME}/.config/opencode"
        ln -sfn "${USER_HOME}/.opencode/skills" "${USER_HOME}/.config/opencode/skills"
        echo "✓ Linked canonical Opencode skills: ${USER_HOME}/.config/opencode/skills -> ${USER_HOME}/.opencode/skills"
    fi
else
    echo "⚠️ Pairflow CLI not found at ${PAIRFLOW_BIN}; skipping skills installation."
fi

echo "=========================================================="
echo "Pairflow Devcontainer Runtime Initialization Complete"
echo "=========================================================="
