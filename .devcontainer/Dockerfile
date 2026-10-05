FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/bash
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 1. Base tools: git, tmux, python3, build tools, curl, jq, procps, sudo
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    tmux \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    jq \
    procps \
    lsof \
    sudo \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 2. Node.js 22 LTS & pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

# 3. Setup non-root vscode user (UID 1000) with passwordless sudo.
# Ubuntu 24.04 noble includes a default "ubuntu" user with UID 1000.
RUN if id -u ubuntu >/dev/null 2>&1; then \
        usermod -l vscode -d /home/vscode -m ubuntu && \
        groupmod -n vscode ubuntu; \
    elif ! id -u vscode >/dev/null 2>&1; then \
        useradd -m -s /bin/bash -u 1000 vscode; \
    fi \
    && echo "vscode ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/nopasswd \
    && chmod 0440 /etc/sudoers.d/nopasswd

# 4. Configure user-space npm global prefix and pnpm directories so vscode user can install without sudo
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

# 5. Git safe directory config for mounted workspaces
RUN git config --system --add safe.directory "*"

# 6. Copy proxy and lifecycle scripts
COPY tcpproxy.py /usr/local/bin/tcpproxy.py
COPY init-container.sh /usr/local/bin/init-container.sh
COPY start-services.sh /usr/local/bin/start-services.sh
RUN chmod +x /usr/local/bin/tcpproxy.py /usr/local/bin/init-container.sh /usr/local/bin/start-services.sh

USER vscode
WORKDIR /workspace
