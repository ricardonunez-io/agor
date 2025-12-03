# Agor Desktop

Native Mac application for Agor - AI Agent Orchestration Platform.

Built with Electron, following the same architecture as VS Code:
- **Main process**: Manages daemon lifecycle and system integration
- **Daemon process**: Node.js backend (FeathersJS + WebSocket)
- **Renderer process**: React UI (served by daemon)

## Development

```bash
# Build TypeScript
pnpm build

# Start in development mode (requires daemon and UI to be running)
pnpm dev

# Package for distribution
pnpm make
```

## Architecture

```
Agor.app
├── Main Process (Electron)
│   ├── Spawns daemon as child process
│   ├── Creates menu bar tray icon
│   └── Opens UI window (loads from daemon)
│
├── Daemon Process (Node.js)
│   ├── FeathersJS REST + WebSocket API
│   ├── Manages sessions, worktrees, MCP servers
│   └── Serves UI static files
│
└── Renderer Process (Chromium)
    └── React UI with Ant Design
```

## Development Workflow

1. **Terminal 1**: Run daemon
   ```bash
   cd apps/agor-daemon && pnpm dev
   ```

2. **Terminal 2**: Run UI dev server (optional, for HMR)
   ```bash
   cd apps/agor-ui && pnpm dev
   ```

3. **Terminal 3**: Run Electron app
   ```bash
   cd apps/agor-desktop && pnpm dev
   ```

The Electron app will:
- Detect that daemon is already running (health check fails on spawn)
- Create tray icon with controls
- Open window to UI (localhost:5173 in dev, or daemon-served in prod)

## Distribution

See `PROJECT.md` for full packaging and distribution instructions.
