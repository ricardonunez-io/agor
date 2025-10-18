# Core Concepts

Related: [[architecture]], [[design]]

## What Is Agor?

**Agor is an agent orchestrator** - the platform layer that sits above all agentic coding tools, providing one UI to manage all agents.

**Pronunciation:** "AY-gore"

**Tagline:**

> **Next-gen agent orchestration for AI-assisted development.**
> The multiplayer, spatial layer that connects Claude Code, Codex, Gemini, and any agentic coding tool into one unified workspace.

## The Vision

A platform for **real-time, multiplayer agentic development**.
Visualize, coordinate, and automate your AI workflows across tools.
Agor turns every AI session into a composable, inspectable, and reusable building block.

Build the orchestration layer for AI-assisted development. Instead of competing with agentic coding tools (Claude Code, Cursor, Codex, Gemini), Agor provides the coordination and visibility layer above them all.

### The Core Insight

> **Context engineering isn't about prompt templates—it's about managing sessions, tasks, and concepts as first-class composable primitives stored in a session tree.**

### What Makes Agor Different

- **Agent Orchestration Layer** - Integrates with Claude Code, Codex, and soon Gemini, via an extensible SDK. Centralized MCP configuration—connect once, use across all tools.
- **Multiplayer Spatial Canvas** - Real-time collaboration with cursor broadcasting and facepiles. Sessions live on a dynamic board—cluster by project, phase, or purpose.
- **Context-Aware Development** - Manage deliberate context via `context/` folder of markdown files. Dynamically load modular context blocks per session.
- **Native Session Forking & Subtask Forcing** - Fork any session to explore alternatives. Spawn subtasks with fresh context windows. Full introspection and genealogy tracking.
- **Zone Triggers — Workflows Made Spatial** - Define zones on your board that trigger templated prompts when sessions are dropped. Build kanban-style flows or custom pipelines.
- **Git Worktree Management** - Every session maps to an isolated git worktree—no branch conflicts. Run A/B tests between agents on the same repo.
- **Real-Time Strategy for AI Teams** - Coordinate agentic work like a multiplayer RTS. Watch teammates or agents move across tasks live.

## The Five Primitives

Everything in Agor is built from five fundamental primitives:

### 1. Session - The Universal Container

**Everything is a session.** A session represents an active conversation with an agentic coding tool.

```python
Session:
  session_id: str
  agent: str                    # "claude-code", "cursor", "codex", "gemini"
  git_ref: str                  # Git SHA at session start
  worktree_path: str | None     # Optional isolated workspace
  concepts: list[str]           # Loaded context modules
  tasks: list[str]              # Ordered task IDs

  # Genealogy
  forked_from_session_id: str | None    # Divergent path
  parent_session_id: str | None         # Spawned subtask
```

**Two Relationship Types:**

- **Fork** - Divergent exploration, inherits full history

  ```
  Session A: "Try REST API"
  └─ Session B (fork): "Try GraphQL instead"
  ```

- **Spawn** - New context window, delegated subtask
  ```
  Session A: "Build auth system"
  └─ Session C (spawn): "Design DB schema"
  ```

### 2. Task - User Prompts as Checkpoints

**Every user prompt creates a task.** Tasks are contiguous message ranges within a session.

```python
Task:
  task_id: str
  session_id: str
  description: str              # User's prompt/goal
  message_range: [int, int]     # [start, end] indices
  git_sha: str                  # "a4f2e91" or "a4f2e91-dirty"
  model: str                    # Can change mid-session
  report_template: str | None   # Post-task report type
  status: "created" | "running" | "completed" | "failed"
```

**Git State Tracking:**

```
Task 1: "Implement auth"
├─ Start: a4f2e91 (clean)
├─ Agent makes changes → a4f2e91-dirty
└─ Complete: b3e4d12
```

### 3. Report - Structured Learning Capture

**Post-task hooks generate reports.** After each task completes, Agor automatically extracts learnings using customizable templates.

**Example Templates:**

- `task-summary.md` - Generic fallback
- `bug-fix.md` - Root cause analysis
- `feature.yaml` - Structured feature documentation
- `research.md` - Investigation findings

**Generation Process:**

1. Task completes
2. Agor forks session ephemerally
3. Adds report generation prompt with template
4. Agent produces structured report
5. Report saved, ephemeral session discarded

### 4. Worktree - Isolated Git Workspaces

**Agor can manage git worktrees** for session isolation (optional but powerful).

```
Main worktree: ~/my-project (main branch)
Session A → ~/my-project-auth (feature/auth)
Session B → ~/my-project-graphql (feature/graphql)
```

**Benefits:**

- Parallel sessions don't interfere
- Clean separation of experimental work
- Agents work in isolation
- Easy cleanup (delete worktree = delete experiment)

### 5. Concept - Modular Context Nuggets

**Concepts are self-referencing knowledge modules** stored as Markdown files.

```
context/
├── auth.md
├── security.md
├── database.md
├── api-design.md
└── testing.md
```

**Features:**

- Wiki-style cross-references: `[[security]]`, `[[database]]`
- Composable (load only what's needed)
- Version-controlled evolution
- Team-shared knowledge base

**Loading Concepts:**

```bash
# Explicit loading
agor session start --concepts auth,security,api-design

# Recursive loading (follows references)
agor session start --concepts auth --recursive

# Dynamic task-level loading
agor task start --add-concepts database
```

## The Session Tree

**The session tree is Agor's fundamental artifact** - a complete, versioned record of all agentic coding sessions in your project.

### What It Stores

- **All sessions** - Every conversation with every agent
- **Complete genealogy** - Fork and spawn relationships
- **Git integration** - Which sessions produced which code
- **Task history** - Granular checkpoint of every user prompt
- **Reports** - Structured learnings extracted from each task
- **Concepts** - Modular context library used across sessions

### Why It Matters

**Observable:**

- Visualize entire tree of explorations
- See which paths succeeded, which failed
- Understand decision points and branches

**Interactive:**

- Manage multiple sessions in parallel
- Fork any session at any task
- Navigate between related sessions

**Shareable:**

- Push/pull like git (federated)
- Learn from others' successful patterns

**Versioned:**

- Track evolution over time
- Audit trail of AI-assisted development

### Session Tree As Git's Companion

```
Your Project:
├── .git/          # Code repository (git)
│   └── Your code's version history
│
└── .agor/         # Session tree (agor)
    ├── sessions/  # Conversation history
    ├── concepts/  # Context library
    └── Metadata linking sessions ↔ code
```

**Git tracks code. Agor tracks the conversations that produced the code.**

## How The Primitives Compose

### Example: Building Authentication Feature

**Phase 1: Main Session**

```bash
agor session start \
  --agent claude-code \
  --concepts auth,security,api-design \
  --worktree feature-auth
```

- Session A created with context loaded
- Worktree `../my-project-auth` created
- Task 1: Design JWT flow → Report generated
- Task 2: Implement endpoints → Report generated

**Phase 2: Fork for Alternative**

```bash
agor session fork <session-a> --from-task 1
```

- Session B created (forked from design phase)
- Task 3: Implement OAuth instead → Different approach, same context

**Phase 3: Spawn for Subtask**

```bash
agor session spawn <session-a> \
  --agent gemini \
  --concepts database,security
```

- Session C created (child of A)
- Task 4: Design user table → Focused DB work, no API context

**Result: Session Tree**

```
Session A (Claude Code, feature-auth worktree)
│ Concepts: [auth, security, api-design]
│
├─ Task 1: "Design JWT auth" ✓
├─ Task 2: "Implement JWT" ✓
│
├─ Session B (fork from Task 1)
│   └─ Task 3: "Implement OAuth" ✓
│
└─ Session C (spawn from Task 2, Gemini)
    └─ Task 4: "Design user table" ✓
```

## Key Design Principles

1. **Everything Is A Session** - Universal abstraction across all agents
2. **Tasks Are Checkpoints** - Granular, forkable, reportable
3. **Reports Are First-Class** - Automatic knowledge capture
4. **Worktrees Enable Parallelism** - Session isolation, no conflicts
5. **Concepts Are Modular** - Composable context, not monolithic files

## Product Philosophy & Roadmap

**Current Phase: Core Platform Complete** ✅

- ✅ Real-time collaboration (cursor broadcasting, facepiles, presence)
- ✅ Spatial canvas with zones and session pinning
- ✅ Multi-agent support (Claude Code, Codex SDKs, Gemini in progress)
- ✅ User authentication and board management
- ✅ **MCP integration** – settings UI, session-level selection, Claude SDK hookup
- ✅ **Zone triggers** – drop sessions on zones to launch templated workflows
- ✅ **Git worktree management** – visual labels, isolated workspaces per session

**Near-Term Roadmap:**

- 🔄 **Gemini SDK Integration** – complete the agent trio (in progress)
- 🔄 **Session Forking UI** – interactive genealogy visualization
- 🧾 **Reports** – automated summaries after each task
- 📚 **Concept Management** – structured context system UI

**Future Vision:**

- 🌍 **Federated Boards** – share, remix, and learn from others
- 🤖 **Cross-Agent Orchestration** – hybrid Claude–Codex–Gemini workflows
- 📊 **Knowledge Maps** – visualize all AI interactions across projects
- 🎯 **Advanced Zone Triggers** – conditional workflows, multi-step pipelines

---

For deeper dives, see:

- [[architecture]] - System design and storage structure
- [[design]] - UI/UX principles and component patterns
- `primitives/` - Detailed explorations of each primitive (future)
