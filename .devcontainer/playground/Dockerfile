FROM mcr.microsoft.com/devcontainers/typescript-node:20

# Install system dependencies
RUN apt-get update && apt-get install -y \
    sqlite3 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN curl -fsSL "$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep 'browser_download_url.*linux_amd64.tar.gz"' | cut -d'"' -f4)" | \
    tar -xz -C /tmp && \
    mv /tmp/gh_*/bin/gh /usr/local/bin/ && \
    rm -rf /tmp/gh_*

# Install foundation packages one at a time (more robust against npm hiccups)
RUN npm install -g @anthropic-ai/claude-code@latest && \
    npm install -g @google/gemini-cli@latest && \
    npm install -g @openai/codex@latest

# Copy package.json as cache-buster for agor-live (rebuilds only when version changes)
COPY packages/agor-live/package.json /tmp/agor-live-package.json

# Install agor-live (rebuilds when package.json changes)
RUN npm install -g agor-live@latest

WORKDIR /workspace

# Run as root for simplified sandbox
