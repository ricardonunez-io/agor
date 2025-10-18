<img src="https://github.com/user-attachments/assets/e34f3d25-71dd-4084-8f3e-4f1c73381c66" alt="Agor Logo" width="320" />

# Agor

**Next-gen agent orchestration for AI-assisted development.**

_The multiplayer, spatial layer that connects Claude Code, Codex, Gemini, and any agentic coding tool into one unified workspace._

---

A platform for **real-time, multiplayer agentic development**.  
Visualize, coordinate, and automate your AI workflows across tools.  
Agor turns every AI session into a composable, inspectable, and reusable building block.

---

---

## 🖼️ GIFs and Screenshots

> _Visual storytelling matters._  
> These examples illustrate Agor’s core workflows and user experience.  
> Replace the placeholders below with real GIFs or screenshots once captured.

---

### 🎯 **1. Board View Overview**

**Purpose:** Show Agor’s multiplayer spatial canvas.

**Suggested clip:**

- Start zoomed out on a complex board.
- Display multiple colored **zones** labeled (e.g., Analyze / Develop / Review / Deploy).
- Animate **3–4 cursors** moving simultaneously — teammates or agents “swarming” the board.
- Demonstrate **zooming in/out**, **panning**, and **zone creation**.
- Optional overlay: “Real-time multiplayer. Context-aware. Spatial orchestration.”

**Placeholder:**  
![Board View Overview](docs/media/board-overview.gif)

---

### 💬 **2. Conversation Overview**

**Purpose:** Highlight the session interaction UX.

**Suggested clip:**

- Scroll through a conversation thread between user and agent.
- Expand/collapse message groups, show tool output diffs and permission prompts.
- Hover to reveal **tooltips**, **copy-to-clipboard** buttons, and visual **write diffs**.
- End with an elegant “task complete” transition.

**Placeholder:**  
![Conversation Overview](docs/media/conversation-overview.gif)

---

### ⚡ **3. Session Creation Overview**

**Purpose:** Demonstrate how users start and configure new sessions.

**Suggested clip:**

- Open “New Session” modal.
- Select an **agentic tool** (Claude Code, Codex, Gemini).
- Assign an **MCP server** from a dropdown.
- Configure **permissions**, **context modules**, and **git worktree**.
- Click “Create Session” → see it appear on the board instantly.

**Placeholder:**  
![Session Creation Overview](docs/media/session-creation.gif)

---

### 🛠️ **4. Admin / Settings Overview**

**Purpose:** Show the system configuration interface.

**Suggested clip:**

- Navigate through tabs for **Tools**, **Git Worktrees**, **Users**, and **MCP Settings**.
- Animate toggling settings, editing configuration fields, and saving changes.
- Optionally display how global settings propagate instantly to connected clients.

**Placeholder:**  
![Admin Settings Overview](docs/media/settings-overview.gif)

---

### 🧩 **5. Optional Extras**

Additional visuals to consider:

- **Report generation flow** – showing agent summarization after task completion.
- **Zone trigger in action** – dropping a session onto a zone to auto-launch a workflow.
- **Git worktree visualization** – mini-map linking sessions to repo branches.

**Placeholder:**  
![Extras](docs/media/extras.gif)

---

---

## 🚀 What Makes Agor Different

### 🧩 **Agent Orchestration Layer**

- Integrates with **Claude Code**, **Codex**, and soon **Gemini**, via an extensible SDK.
- Centralized **MCP configuration** — connect once, use across all tools.
- Swap or parallelize agents with one command; easily hand off work when one model stalls.

### 🌐 **Multiplayer Spatial Canvas**

- Real-time collaboration with **cursor broadcasting** and **facepiles**.
- Sessions live on a **dynamic board** — cluster by project, phase, or purpose.
- Visualize your full session tree: forks, spawns, subtasks, and outcomes.

### 🧠 **Context-Aware Development**

- Manage deliberate context via `context/` folder of markdown files.
- Dynamically load modular context blocks per session.
- Keep every agent’s worldview focused and version-controlled.

### 🔀 **Native Session Forking & Subtask Forcing**

- **Fork** any session to explore alternative approaches, preserving full ancestry.
- **Spawn** a subtask: Agor automatically creates a new session with a fresh context window.
- Subtasks are introspectable, reusable, and linked in the session genealogy.

### ⚙️ **Zone Triggers — Workflows Made Spatial**

- Define **zones** on your board that trigger templated prompts when sessions are dropped.
- Build **kanban-style flows** or custom pipelines: analyze → develop → review → deploy.
- Combine with context templates to automate arbitrarily complex workflows.

### 🌳 **Git Worktree Management, Simplified**

- Every session maps to an isolated **git worktree** — no branch conflicts.
- Run A/B tests between agents: same repo, different worktrees, different models.
- Track which agent produced which code — a full audit trail between commits and conversations.

### 🕹️ **Real-Time Strategy for AI Teams**

- Coordinate agentic work like a multiplayer RTS.
- Watch teammates or agents move across tasks live.
- Cluster sessions, delegate, pivot, and iterate together.

---

## 💡 What You Can Build

- **Collaborative AI development boards** shared by teams.
- **A/B testing frameworks** comparing agent outputs across tools.
- **Custom “zone-triggered” automation flows**, from idea to deployment.
- **Knowledge maps** of all AI interactions across projects.
- **Cross-agent orchestration** for hybrid Claude–Codex–Gemini workflows.

---

## 🧱 Key Features

| Capability                   | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| **Agent SDKs**               | Unified API for Claude Code, Codex, Gemini (and others). |
| **Session Tree**             | Tracks forks, spawns, and context evolution visually.    |
| **Multiplayer Canvas**       | Real-time presence, drag-and-drop organization.          |
| **Zone Triggers**            | User-defined prompt automations.                         |
| **Git Worktrees**            | Parallel branches per session.                           |
| **Context Modules**          | Markdown-based, composable context system.               |
| **MCP Hub**                  | Centralized MCP configuration and sharing.               |
| **Reports (Coming Soon)**    | Automatic agent-generated task summaries.                |
| **Federated Mode (Planned)** | Cross-tool, cross-org session federation.                |

---

## 🛠️ Quick Start

```bash
git clone https://github.com/mistercrunch/agor
cd agor
pnpm install
pnpm agor init
```

**Run the stack:**

```bash
# Daemon (REST + WebSocket)
cd apps/agor-daemon && pnpm dev  # :3030

# UI (React + Vite)
cd apps/agor-ui && pnpm dev      # :5173
```

Import a Claude Code session and visualize it instantly:

```bash
pnpm agor session load-claude <session-id>
```

---

## 🧩 Stack Overview

| Layer        | Tech                                         |
| ------------ | -------------------------------------------- |
| **Backend**  | FeathersJS, Drizzle ORM, LibSQL              |
| **Frontend** | React 18, TypeScript, Ant Design, React Flow |
| **CLI**      | oclif, chalk, cli-table3                     |
| **Realtime** | WebSocket broadcasting via Socket.io         |

---

## 🧭 Roadmap Highlights

**✅ Shipped:**

- **Zone Triggers** – drop sessions on zones to launch templated workflows
- **MCP Integration** – settings UI, session-level selection, working with Claude SDK
- **Git Worktrees** – visual labels, isolated workspaces per session
- **Multiplayer** – real-time cursors, facepiles, presence indicators

**🔄 In Progress:**

- **Gemini Integration** – completing the agent trio

**📋 Coming Soon:**

- **Session Forking UI** – interactive genealogy visualization
- **Reports** – automated summaries after each task
- **Concept Management** – structured context system
- **Federated Boards** – share, remix, and learn from others

---

## 🤝 Contributing

- TypeScript strict mode and branded types (`SessionID`, `TaskID`, etc.)
- Repository pattern + Drizzle ORM for schema management
- Ant Design token-based UI theming
- Read [CLAUDE.md](CLAUDE.md) for dev workflow and [PROJECT.md](PROJECT.md) for roadmap.

---

## 🌟 Learn More

- **Website:** coming soon
- **Docs:** [CLAUDE.md](CLAUDE.md)
- **Discussions:** [github.com/mistercrunch/agor/discussions](https://github.com/mistercrunch/agor/discussions)
- **Follow:** [@mistercrunch](https://github.com/mistercrunch)

---

> “git tracks code, Agor tracks the conversations that produced it.”
