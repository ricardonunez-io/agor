# Docker Development Guide

**TL;DR:** Run `docker compose -p <project-name> up` in any worktree. Use unique project name per worktree.

```bash
# Worktree 1
cd ~/worktrees/agor-main
docker compose -p agor-main up  # UI: http://localhost:5173

# Worktree 2 (different project name = different database)
cd ~/worktrees/agor-feature-x
PORT=5174 docker compose -p agor-feature-x up  # UI: http://localhost:5174
```

**Important:** Use `-p` flag with unique name per worktree to isolate databases!

## Quick Start

### Single Instance

```bash
# Start Agor in dev mode
docker compose up

# Access UI: http://localhost:5173
# Daemon runs internally (not exposed to host)
```

### Custom Port

```bash
# Run on different port
PORT=5174 docker compose up

# Access UI: http://localhost:5174
```

### Multiple Instances (Different Worktrees)

**Use unique `-p` project name per worktree:**

```bash
# Worktree 1 (main branch)
cd ~/worktrees/agor-main
docker compose -p agor-main up              # UI: http://localhost:5173

# Worktree 2 (feature branch)
cd ~/worktrees/agor-feature-x
PORT=5174 docker compose -p feature-x up    # UI: http://localhost:5174

# Worktree 3 (another feature)
cd ~/worktrees/agor-feature-y
PORT=5175 docker compose -p feature-y up    # UI: http://localhost:5175
```

**How it works:**

- The `-p` flag sets the project name (used for volume naming)
- `agor-main` → volume: `agor-main_agor-data`
- `feature-x` → volume: `feature-x_agor-data`
- Each project name = isolated database ✅

**Each worktree gets:**

- Its own source code (mounted from that directory)
- Its own database volume (named `<project>_agor-data`)
- Its own UI port (via `PORT` env var)

## Architecture

### Build Context (.dockerignore)

The `.dockerignore` file is aligned with `.gitignore` to exclude:

- `node_modules/` (rebuilt in container)
- `dist/` and build artifacts
- `.env` files
- `.agor/` data directory (uses volume instead)
- IDE and OS files

**Important**: `.dockerignore` does NOT exclude markdown files, so `CLAUDE.md` and `context/` docs are copied into the image for AI agent integration.

### Single Container Design

The dev setup runs both daemon and UI in a single container using `concurrently`:

```
┌─────────────────────────────────┐
│  agor-dev container             │
│                                 │
│  ┌─────────────────────────┐   │
│  │ Daemon (port 3030)      │   │
│  │ - FeathersJS API        │   │
│  │ - WebSocket server      │   │
│  │ - Auto-reload with tsx  │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ UI (port 5173)          │   │
│  │ - Vite dev server       │   │
│  │ - HMR enabled           │   │
│  │ - Auto-reload on change │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

### Port Configuration

**Ports:**

- **Daemon:** Runs on port `3030` inside container (not exposed to host)
- **UI:** Runs on port `$PORT` (default `5173`), exposed to host

**Why daemon isn't exposed:**

- Only the UI needs to be accessed from your browser
- Daemon is accessed by the UI via `http://localhost:3030` (inside container)
- To inspect daemon: Use `docker exec` or `docker compose logs`

Example for 3 worktrees:

| Worktree  | UI Port | Access                |
| --------- | ------- | --------------------- |
| main      | `5173`  | http://localhost:5173 |
| feature-x | `5174`  | http://localhost:5174 |
| feature-y | `5175`  | http://localhost:5175 |

## Volume Mounts

### Source Code (Hot-Reload)

```yaml
volumes:
  - .:/app # Mount entire repo for hot-reload
```

**How it works:**

- **Build time**: Docker copies repo (excluding `.dockerignore` entries) and installs `node_modules`
- **Run time**: Volume mount overlays your local repo onto `/app`, giving you live hot-reload
- `node_modules` persists from build (not overwritten by mount)
- Changes to any source files trigger auto-reload!

### Data Persistence

```yaml
volumes:
  - agor-data:/root/.agor # Database, config, repos
```

Each instance gets its own named volume:

- `agor-data` (instance 1)
- `agor-data-2` (instance 2)
- `agor-data-3` (instance 3)

### SSH Keys (Git Authentication)

```yaml
volumes:
  - ~/.ssh:/root/.ssh:ro # SSH keys for git operations (read-only)
```

**Why needed:**

- Enables git clone/fetch/push with SSH URLs (`git@github.com:...`)
- Uses your host machine's SSH keys (same as `gh` CLI)
- Read-only (`:ro`) for security - container can't modify your keys
- **Dev only** - when running locally (non-Docker), your SSH keys work automatically

**To inspect data:**

```bash
# List volumes
docker volume ls | grep agor

# Inspect volume
docker volume inspect agor_agor-data

# Access volume (while container is running)
docker exec -it agor-dev sh
ls -la /root/.agor
```

## Common Commands

```bash
# Start in foreground (see logs)
docker compose up

# Start in background
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after dependency changes
docker compose build && docker compose up

# Enter running container
docker exec -it agor-dev sh

# Full cleanup (removes database!)
docker compose down -v

# Or with project name
docker compose -p main down -v
```

## Environment Variables

### Available Variables

| Variable            | Default | Description                              |
| ------------------- | ------- | ---------------------------------------- |
| `PORT`              | `5173`  | UI port (exposed to host)                |
| `ANTHROPIC_API_KEY` | -       | Anthropic API key (passed from host)     |
| `OPENAI_API_KEY`    | -       | OpenAI API key (passed from host)        |
| `GEMINI_API_KEY`    | -       | Google Gemini API key (passed from host) |

### Setting Variables

**Option 1: Export in shell**

```bash
# Set API keys once
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...

# Run docker compose (keys are passed through)
PORT=5174 docker compose -p agor-feature up
```

**Option 2: Use .env file**

```bash
# Create .env file
cat > .env <<EOF
PORT=5174
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
EOF

# Run docker compose
docker compose -p agor-feature up
```

**Note:** Each Docker instance gets a fresh database. API keys are inherited from host environment, but no other config is shared.

## Troubleshooting

**Port already in use:**

```bash
# Use different port
PORT=5174 docker compose up
```

**Check daemon logs:**

```bash
# View all logs
docker compose logs -f

# Filter daemon logs
docker compose logs -f | grep daemon
```

**Access daemon directly (for debugging):**

```bash
# Enter container
docker exec -it $(docker ps -q -f name=agor) sh

# Inside container, test daemon
curl http://localhost:3030/health
```

**Changes not reflecting:**

```bash
# Rebuild and restart
docker compose build && docker compose up
```

**Dependencies out of date:**

```bash
# Rebuild after pulling new code
docker compose build
```

## Notes

- This Dockerfile is for **development only**
- Source code changes trigger auto-reload
- Each instance gets its own database volume
- Only rebuild when dependencies change (package.json updates)
