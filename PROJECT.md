# Launch Checklist

Simple todo list for launch preparation.

## Must-Do for Launch

### Core Features

- [ ] Troubleshoot Claude session edge cases (unclear/incomplete results)

### Documentation

- [ ] Complete getting started guide with screenshots/videos

### Distribution

- [ ] Fix codespaces setup for Agor repo
- [ ] Publish `@agor/core` to npm
- [ ] Publish `@agor/daemon` to npm
- [ ] Publish `@agor/cli` to npm
- [ ] Bundle daemon into CLI for simplified install
- [ ] Auto-start daemon on CLI commands
- [ ] Add `agor daemon` lifecycle commands (start/stop/status/logs)

---

## Nice-to-Have for Launch

### UX Polish

- [ ] Token count & cost tracking ($ per task/session)
- [ ] Worktree CLI commands (`agor worktree list/create/delete`)

## Consider for Launch

- [ ] Write/Edit tool with file diffs and syntax highlighting
- [ ] Concepts as first-class primitives (CRUD in UI/CLI)
- [ ] Reports as first-class primitives (CRUD in UI/CLI)
- [ ] `@`-triggered autocomplete for sessions/repos/concepts
- [ ] add system prompt to Codex/Gemini for self-awareness

## Post-Launch (Future)

See [context/explorations/](context/explorations/) for detailed designs:

- **CLI session sync** - Keep local CLI sessions in sync with Agor for seamless solo-to-collab handoff
- enhance around SDK advanced features, try to meet CLI parity as much as possible (support Claude Agents, slash commands, etc)
- Cloud deployment (PostgreSQL, Turso/Supabase, hosted version)
- Terminal persistence across restarts (?)
- Capture context metadata from SDKS
