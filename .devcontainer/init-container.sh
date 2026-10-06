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

# 1. Verify Pairflow CLI availability (with optional local workspace override)
echo "[1/4] Checking Pairflow CLI..."
if [ -f "/workspace/package.json" ] && grep -q '"name": "@pairflow/cli"' "/workspace/package.json" 2>/dev/null && [ -f "/workspace/dist/cli/index.js" ]; then
    mkdir -p "${USER_HOME}/.npm-global/bin"
    cat <<'EOF' > "${USER_HOME}/.npm-global/bin/pairflow"
#!/usr/bin/env bash
exec node /workspace/dist/cli/index.js "$@"
EOF
    chmod +x "${USER_HOME}/.npm-global/bin/pairflow"
    echo "✓ Linked workspace Pairflow CLI override: ${USER_HOME}/.npm-global/bin/pairflow -> /workspace/dist/cli/index.js"
fi

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
