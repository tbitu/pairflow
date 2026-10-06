#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-pairflow-devcontainer:latest}"
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DO_PUSH="${PUSH:-0}"

# Parse command line flags
for arg in "$@"; do
    case "$arg" in
        --push)
            DO_PUSH=1
            ;;
        --tag=*)
            IMAGE_TAG="${arg#*=}"
            ;;
        --help|-h)
            echo "Usage: $0 [--push] [--tag=IMAGE_TAG]"
            exit 0
            ;;
    esac
done

echo "=========================================================="
echo "Building Pairflow Devcontainer"
echo "Workspace: $WORKSPACE_ROOT"
echo "Image Tag: $IMAGE_TAG"
echo "Push after build: $DO_PUSH"
echo "=========================================================="

BUILD_SUCCESS=0
ENGINE=""

# 1. Try official devcontainer CLI if available (unless pushing with docker directly)
if [ "$DO_PUSH" -eq 0 ] && command -v devcontainer >/dev/null 2>&1; then
    echo "Found devcontainer CLI. Building with devcontainer..."
    if devcontainer build --workspace-folder "$WORKSPACE_ROOT" --image-name "$IMAGE_TAG"; then
        BUILD_SUCCESS=1
        ENGINE="devcontainer"
    else
        echo "devcontainer CLI build returned non-zero. Attempting container engine fallback..."
    fi
fi

# 2. Try Docker if daemon is active
if [ "$BUILD_SUCCESS" -eq 0 ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "Found active Docker daemon. Building with docker..."
    docker build \
        -f "$WORKSPACE_ROOT/.devcontainer/Dockerfile" \
        -t "$IMAGE_TAG" \
        "$WORKSPACE_ROOT"
    BUILD_SUCCESS=1
    ENGINE="docker"
fi

# 3. Try Podman as fallback (common on Fedora/Bazzite/RHEL)
if [ "$BUILD_SUCCESS" -eq 0 ] && command -v podman >/dev/null 2>&1; then
    echo "Found Podman. Building with podman..."
    podman build \
        -f "$WORKSPACE_ROOT/.devcontainer/Dockerfile" \
        -t "$IMAGE_TAG" \
        "$WORKSPACE_ROOT"
    BUILD_SUCCESS=1
    ENGINE="podman"
fi

if [ "$BUILD_SUCCESS" -eq 0 ]; then
    echo "ERROR: Unable to build devcontainer. Neither devcontainer CLI, running Docker daemon, nor Podman was available." >&2
    exit 1
fi

echo "=========================================================="
echo "Devcontainer Build Succeeded: $IMAGE_TAG"
echo "=========================================================="

if [ "$DO_PUSH" -eq 1 ]; then
    echo "Pushing $IMAGE_TAG via $ENGINE..."
    case "$ENGINE" in
        docker)
            docker push "$IMAGE_TAG"
            ;;
        podman)
            podman push "$IMAGE_TAG"
            ;;
        *)
            if command -v docker >/dev/null 2>&1; then
                docker push "$IMAGE_TAG"
            elif command -v podman >/dev/null 2>&1; then
                podman push "$IMAGE_TAG"
            else
                echo "ERROR: Neither docker nor podman available to push image." >&2
                exit 1
            fi
            ;;
    esac
    echo "✓ Pushed $IMAGE_TAG successfully."
fi
