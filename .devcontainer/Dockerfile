# ==============================================================================
# Stage 1: Build Pairflow CLI and package distribution tarball
# ==============================================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /build

# Install build dependencies and pinned pnpm matching repository packageManager
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.8.1

# Copy package manifests for optimal layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ui/package.json ui/pnpm-lock.yaml ./ui/

# Install dependencies using frozen lockfiles
RUN pnpm install --frozen-lockfile \
    && pnpm --dir ui install --frozen-lockfile

# Copy source trees and configurations
COPY tsconfig*.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY ui/ ./ui/
COPY .claude/skills/ ./.claude/skills/
COPY README.md ./

# Build Pairflow CLI + UI and produce distribution package
RUN pnpm build \
    && npm pack \
    && mv pairflow-cli-*.tgz /build/pairflow-cli.tgz

# ==============================================================================
# Stage 2: Runtime devcontainer environment for general-purpose development
# ==============================================================================
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/bash
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 1. General development tools: build tools (gcc, g++, make), Python 3, tmux, procps, lsof, jq
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    tmux \
    jq \
    procps \
    lsof \
    curl \
    wget \
    ca-certificates \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 2. Node.js 22 LTS & exact pnpm version matching package.json (10.8.1)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm@10.8.1 \
    && rm -rf /var/lib/apt/lists/*

# 3. Configure user-space npm global prefix and pnpm directories for vscode user
ENV NPM_CONFIG_PREFIX=/home/vscode/.npm-global
ENV PNPM_HOME=/home/vscode/.local/share/pnpm
ENV PATH="/home/vscode/.npm-global/bin:${PNPM_HOME}:${PATH}"

RUN mkdir -p /home/vscode/.npm-global/bin \
             /home/vscode/.local/share/pnpm \
             /home/vscode/.npm \
             /home/vscode/.opencode \
             /home/vscode/.reasonix \
             /home/vscode/.config/opencode \
             /.pairflow-worktrees \
    && chown -R vscode:vscode /home/vscode /.pairflow-worktrees

# 4. Git safe directory config for mounted workspaces
RUN git config --system --add safe.directory "*"

# 5. Install Coding Agents (Opencode & Reasonix) globally
RUN npm install -g opencode-ai@latest reasonix@latest

# 6. Install baked-in Pairflow CLI package from builder stage
COPY --from=builder /build/pairflow-cli.tgz /tmp/pairflow-cli.tgz
RUN npm install -g /tmp/pairflow-cli.tgz \
    && rm /tmp/pairflow-cli.tgz

# 7. Pre-install Pairflow skills into global agent roots as vscode user
USER vscode
RUN pairflow skills install --skills all --target-dir .opencode --link-other --force \
    && mkdir -p /home/vscode/.config/opencode \
    && ln -sfn /home/vscode/.opencode/skills /home/vscode/.config/opencode/skills
USER root

# 8. Copy proxy and lifecycle scripts
COPY .devcontainer/tcpproxy.py /usr/local/bin/tcpproxy.py
COPY .devcontainer/init-container.sh /usr/local/bin/init-container.sh
COPY .devcontainer/start-services.sh /usr/local/bin/start-services.sh
RUN chmod +x /usr/local/bin/tcpproxy.py /usr/local/bin/init-container.sh /usr/local/bin/start-services.sh

USER vscode
WORKDIR /workspace
