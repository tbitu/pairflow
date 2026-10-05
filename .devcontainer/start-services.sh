#!/usr/bin/env bash
set -euo pipefail

echo "=== Starting Pairflow Background Services ==="

UPSTREAM_URL="${UPSTREAM_URL:-http://host.docker.internal:11434/v1}"
TARGET_MODEL="${TARGET_MODEL:-qwen3.8-27b:q8_0}"
BACKEND="${BACKEND:-ollama}"

# 1. Start tcpproxy if not already running
if pgrep -f "tcpproxy.py" >/dev/null 2>&1; then
    echo "✓ tcpproxy is already active on 127.0.0.1:1235"
else
    echo "Starting tcpproxy on 127.0.0.1:1235 -> $UPSTREAM_URL (Model: $TARGET_MODEL, Backend: $BACKEND)..."
    nohup python3 /usr/local/bin/tcpproxy.py > /tmp/tcpproxy.log 2>&1 &
    sleep 1
fi

# 2. Check local proxy listener
if curl -s -m 2 http://127.0.0.1:1235/v1/models >/dev/null 2>&1; then
    echo "✓ Local proxy listener active at http://127.0.0.1:1235/v1"
else
    echo "⚠️  Warning: Local tcpproxy failed to bind. Check /tmp/tcpproxy.log for errors:"
    tail -n 10 /tmp/tcpproxy.log 2>/dev/null || true
fi

# 3. Test upstream connection to host inference
echo "Testing connectivity to host inference: $UPSTREAM_URL..."
if curl -s -m 2 "$UPSTREAM_URL/models" >/dev/null 2>&1 || curl -s -m 2 "$UPSTREAM_URL" >/dev/null 2>&1; then
    echo "✓ Host inference endpoint reachable at $UPSTREAM_URL"
else
    echo "⚠️  Upstream inference at $UPSTREAM_URL did not respond immediately."
    echo "   Ensure host LLM (Ollama/LM Studio/vLLM) is running and bound to 0.0.0.0 or accessible to containers."
fi

# 4. Check agent skills availability
USER_HOME="${HOME:-/home/vscode}"
PAIRFLOW_BIN="${USER_HOME}/.npm-global/bin/pairflow"
if [ -x "${PAIRFLOW_BIN}" ] && [ ! -d "${USER_HOME}/.opencode/skills/UsePairflow" ]; then
    echo "Installing missing agent skills..."
    "${PAIRFLOW_BIN}" skills install --skills all --target-dir .opencode --link-other --force || true
    if [ -d "${USER_HOME}/.opencode/skills" ]; then
        mkdir -p "${USER_HOME}/.config/opencode"
        ln -sfn "${USER_HOME}/.opencode/skills" "${USER_HOME}/.config/opencode/skills"
    fi
fi

echo "=== Services Ready ==="
