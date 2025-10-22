FROM mcr.microsoft.com/devcontainers/typescript-node:20

# Install system dependencies (matches Dockerfile.dev)
RUN apt-get update && apt-get install -y \
    sqlite3 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm and AI coding agent CLIs (always get latest versions)
RUN npm install -g pnpm@latest @anthropic-ai/claude-code@latest @google/gemini-cli@latest @openai/codex@latest

# Set working directory
WORKDIR /workspace

# Run as root in sandbox (simpler for Codespaces dev environment)
# Docker-in-Docker works better with root, no permission issues
