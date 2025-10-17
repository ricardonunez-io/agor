<img src="https://github.com/user-attachments/assets/e34f3d25-71dd-4084-8f3e-4f1c73381c66" alt="Agor Logo" width="320" />

# Agor

> **Next-gen agent orchestration — Multi-agent · Multiplayer · Real-time**

**Status:** Phase 2 Complete - Multi-User Foundation

[Installation](#getting-started) · [Documentation](CLAUDE.md) · [Roadmap](PROJECT.md) · [Architecture](context/)

---

## What is Agor?

**The control tower for AI-assisted development.** Manage unlimited agents (Claude Code, Cursor, Codex, Gemini) under one pane of glass—alone or with your team.

Organize sessions on visual boards. Coordinate parallel workflows. Orchestrate complex tasks across multiple agents in real-time. Instead of juggling isolated chat windows, command your entire fleet of AI coding tools from a single tactical interface.

### The Core Insight

> **Context engineering isn't about prompt templates—it's about managing sessions, tasks, and concepts as first-class composable primitives stored in a session tree.**

### Why Agor?

- **Platform play** - Orchestrates all agents, doesn't compete with them
- **Developer-centric** - Git-aware, visual tools, report-driven
- **Source-available** - BSL with future open-source conversion

---

**Current capabilities:**

- 📊 **Visual session canvas** - Organize AI coding sessions on drag-and-drop boards with zones
- 💬 **Full conversation history** - Import and browse Claude Code transcripts with task extraction
- 👥 **Real-time collaboration** - Multi-user boards with facepile, cursor swarm, and presence indicators
- 🔐 **User authentication** - Email/password login with JWT tokens (anonymous mode for local dev)
- 🗄️ **Local-first storage** - SQLite database at `~/.agor/agor.db`
- 🌐 **REST + WebSocket API** - FeathersJS daemon for programmatic access
- 🖥️ **CLI + GUI** - Command-line tools and React-based UI
- 🤖 **Claude Agent SDK** - Live session execution with streaming responses

---

## Quick Look

**Session Canvas:**

Drag and drop sessions to organize your work. Click any session to view the full conversation history with task breakdown.

**CLI:**

```bash
# Import a Claude Code session
pnpm agor session load-claude <session-id>

# List all sessions
pnpm agor session list

# Add to a board
pnpm agor board add-session <board-id> <session-id>
```

**UI:**

Open http://localhost:5173 after starting the daemon to see your sessions on a visual canvas.

---

## The Five Primitives

Everything in Agor is built from five fundamental primitives:

1. **Session** - Everything is a session. Fork, spawn, navigate workflows as trees.
2. **Task** - User prompts are tasks. Checkpoint work, track git state.
3. **Report** - Post-task hooks generate structured learnings automatically.
4. **Worktree** - Git worktrees for session isolation (optional but powerful).
5. **Concept** - Modular context nuggets, compose into session-specific knowledge.

**Currently implemented:**

- ✅ Sessions (import from Claude Code, view conversations)
- ✅ Tasks (extracted from user prompts, tracked in DB)
- ✅ Boards (visual workspace for organizing sessions)
- 🔄 Reports (coming in Phase 3)
- 🔄 Concepts (coming in Phase 3)

See [context/concepts/core.md](context/concepts/core.md) for detailed explanations.

---

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Git
- Claude Code 2.0+ (optional, for session import)

### Installation

```bash
# Clone repository
git clone https://github.com/mistercrunch/agor
cd agor

# Install dependencies
pnpm install

# Initialize database and config
pnpm agor init

# Create first user (optional)
pnpm agor user create
```

### Running the Stack

**Terminal 1 - Start daemon:**

```bash
cd apps/agor-daemon
pnpm dev  # http://localhost:3030
```

**Terminal 2 - Start UI:**

```bash
cd apps/agor-ui
pnpm dev  # http://localhost:5173
```

The daemon auto-rebuilds when you edit code in `packages/core` or `apps/agor-daemon`.

---

## Usage

### CLI Commands

**Sessions:**

```bash
pnpm agor session list                      # List all sessions
pnpm agor session show <id>                 # Show session details
pnpm agor session load-claude <session-id>  # Import Claude Code session
```

**Boards:**

```bash
pnpm agor board list                        # List all boards
pnpm agor board add-session <board> <sess>  # Add session to board
```

**Users:**

```bash
pnpm agor user create                       # Create new user
pnpm agor user list                         # List all users
```

**Configuration:**

```bash
pnpm agor config                            # Show all config
pnpm agor config get <key>                  # Get specific value
pnpm agor config set <key> <value>          # Set value
```

**Repositories:**

```bash
pnpm agor repo add <url>                    # Clone git repository
pnpm agor repo list                         # List repos
pnpm agor repo worktree add <repo> <name>   # Create worktree
```

### Importing Claude Code Sessions

Find your Claude Code session IDs:

```bash
ls -la ~/.claude/projects/
```

Import a session:

```bash
pnpm agor session load-claude <session-id> --board <board-name>
```

Agor extracts tasks from user prompts and stores the full conversation history.

---

## Architecture

**Monorepo structure:**

```
agor/
├── apps/
│   ├── agor-daemon/    # FeathersJS backend (REST + WebSocket)
│   ├── agor-cli/       # oclif CLI commands
│   └── agor-ui/        # React + Ant Design + React Flow
├── packages/
│   └── core/           # Shared types, database, utilities
└── context/            # Architecture documentation
```

**Tech stack:**

- **Backend:** FeathersJS, Drizzle ORM, LibSQL (SQLite)
- **Frontend:** React, TypeScript, Ant Design, React Flow
- **CLI:** oclif, cli-table3
- **Database:** SQLite at `~/.agor/agor.db`
- **Real-time:** Socket.io (WebSocket transport)

**Storage:**

```
~/.agor/
├── agor.db          # SQLite database
├── config.json      # Global config
└── context.json     # CLI active context
```

See [context/concepts/architecture.md](context/concepts/architecture.md) for complete system design.

---

## Current Status (Phase 2 Complete)

**What works now:**

✅ Session import from Claude Code transcripts
✅ Task extraction from user prompts
✅ Visual board canvas with drag-and-drop sessions and zones
✅ Real-time multi-user sync via WebSocket
✅ User authentication (email/password + JWT + anonymous mode)
✅ CLI commands for sessions, boards, repos, users
✅ Session conversation viewer with task breakdown
✅ Git repository and worktree management
✅ Multiplayer cursors and presence indicators (facepile, cursor swarm)
✅ Claude Agent SDK integration with live execution
✅ OpenAI Codex SDK integration (beta)
✅ Board zones for organizing sessions visually

**What's coming in Phase 3:**

🔄 MCP server UI integration and SDK hookup
🔄 Session forking UI and genealogy visualization
🔄 Concept and report management
🔄 Enhanced Codex integration (full permission system)

See [PROJECT.md](PROJECT.md) for detailed roadmap.

---

## Development

**Contributing:**

Contributions are welcome!

1. Read [context/concepts/core.md](context/concepts/core.md) for architecture
2. Read [CLAUDE.md](CLAUDE.md) for development workflow
3. Check [PROJECT.md](PROJECT.md) for current priorities

**Code standards:**

- TypeScript strict mode with branded types
- Repository pattern for database access
- Drizzle ORM for schema and queries
- oclif conventions for CLI commands
- Ant Design tokens for UI styling

**Running tests:**

```bash
cd packages/core && pnpm test
cd apps/agor-ui && pnpm test
```

**Storybook (component development):**

```bash
cd apps/agor-ui
pnpm storybook  # http://localhost:6006
```

---

## Roadmap

### Phase 3: Orchestration (Q1 2025)

- MCP server integration and Agent SDK hookup
- Session forking UI (try alternative approaches)
- Genealogy visualization (parent/child/fork relationships)
- Social collaboration (facepile, cursors, presence)

### Phase 4: Distribution (Q2-Q4 2025)

- npm package: `npm install -g agor`
- Auto-start daemon lifecycle management
- Desktop app (Tauri) with native installers

### Phase 5: Cloud & Teams (2026)

- PostgreSQL backend for cloud hosting
- OAuth providers (GitHub, Google)
- Organizations and RBAC
- Multi-agent support (Cursor, Codex, Gemini)

See [PROJECT.md](PROJECT.md) for complete roadmap.

---

## Documentation

**Getting Started:**

- [CLAUDE.md](CLAUDE.md) - Complete developer guide
- [PROJECT.md](PROJECT.md) - Implementation roadmap

**Architecture:**

- [context/concepts/core.md](context/concepts/core.md) - Core primitives and vision
- [context/concepts/models.md](context/concepts/models.md) - Data models
- [context/concepts/architecture.md](context/concepts/architecture.md) - System design
- [context/concepts/design.md](context/concepts/design.md) - UI/UX guidelines

**Real-Time Collaboration:**

- [context/concepts/multiplayer.md](context/concepts/multiplayer.md) - Multiplayer features
- [context/concepts/auth.md](context/concepts/auth.md) - Authentication & authorization
- [context/concepts/websockets.md](context/concepts/websockets.md) - WebSocket sync

**Future Explorations:**

- [context/explorations/single-package.md](context/explorations/single-package.md) - Distribution strategy
- [context/explorations/mcp-integration.md](context/explorations/mcp-integration.md) - MCP server design
- [context/explorations/subtask-orchestration.md](context/explorations/subtask-orchestration.md) - Multi-agent coordination

---

## Troubleshooting

**Port conflicts:**

```bash
lsof -ti:3030 | xargs kill -9  # Kill daemon
lsof -ti:5173 | xargs kill -9  # Kill UI
```

**Database issues:**

```bash
pnpm agor init --force  # Reinitialize database
```

**Daemon not responding:**

```bash
curl http://localhost:3030/health  # Check health
cd apps/agor-daemon && pnpm dev    # Restart daemon
```

---

---

## Links

**GitHub:** [mistercrunch/agor](https://github.com/mistercrunch/agor)
**Issues:** [github.com/mistercrunch/agor/issues](https://github.com/mistercrunch/agor/issues)
**Discussions:** [github.com/mistercrunch/agor/discussions](https://github.com/mistercrunch/agor/discussions)

---

_Built by developers, for developers._
