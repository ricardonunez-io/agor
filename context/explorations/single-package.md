# Single-Package Distribution

**Status:** Critical Path for Launch
**Target:** Phase 4 (Q2 2025)
**Date:** January 2025

---

## Problem Statement

Currently, Agor requires:

- Git clone of the monorepo
- pnpm installation
- Manual daemon + UI startup in separate terminals
- Development-mode commands (`pnpm agor ...`)

**This is fine for contributors but poor UX for end users.**

---

## Goal

Provide a single npm package that bundles CLI, daemon, and UI:

```bash
npm install -g agor
agor init              # Setup + auto-start daemon
agor                   # Opens UI in browser
```

**One package, zero configuration, instant start.**

---

## Recommended Approach: Bundled CLI + Daemon + UI

**Architecture:**

```
agor (npm package)
├── bin/agor.js           # CLI entry point
├── daemon/
│   └── index.js          # Bundled daemon (esbuild)
└── ui/
    └── dist/             # Pre-built React app
```

**User Experience:**

```bash
npm install -g agor
agor init                 # Creates ~/.agor/, starts daemon
agor                      # Opens browser → http://localhost:3030
agor session list         # CLI commands (daemon auto-starts)
```

**Key Features:**

- ✅ Single package installation
- ✅ Auto-start daemon on first CLI command
- ✅ UI served from daemon at localhost:3030
- ✅ Smart daemon lifecycle (auto-restart after idle timeout)
- ✅ Works offline (local SQLite database)

---

## Implementation Details

### Package Structure

```
agor/
├── packages/agor/            # Meta-package for npm
│   ├── package.json
│   ├── bin/agor.js          # CLI entry point
│   ├── daemon/
│   │   └── index.js         # Bundled daemon (esbuild output)
│   └── ui/
│       └── dist/            # Pre-built React app
```

### Daemon Lifecycle Management

```bash
agor daemon start      # Start daemon in background
agor daemon stop       # Stop daemon gracefully
agor daemon status     # Check daemon health
agor daemon logs       # View daemon logs (~/.agor/logs/daemon.log)
agor daemon restart    # Restart daemon
```

**Auto-Start Behavior:**

- All CLI commands check if daemon is running
- If not running, auto-start daemon as detached process
- Daemon auto-shuts down after 10 minutes of inactivity (configurable)
- Override with `agor daemon start --no-idle-timeout`

**Implementation:**

```typescript
// packages/agor-cli/src/utils/daemon-manager.ts
import { spawn } from 'child_process';
import { checkHealth } from './health';

export class DaemonManager {
  async ensureDaemonRunning(): Promise<void> {
    const isRunning = await checkHealth('http://localhost:3030/health');
    if (isRunning) return;

    console.log('Starting Agor daemon...');

    // Start daemon as detached child process
    const daemon = spawn('node', [path.join(__dirname, '../../daemon/index.js')], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AGOR_DAEMON: 'true' },
    });

    // Write logs to ~/.agor/logs/daemon.log
    const logStream = fs.createWriteStream(path.join(os.homedir(), '.agor/logs/daemon.log'), {
      flags: 'a',
    });
    daemon.stdout?.pipe(logStream);
    daemon.stderr?.pipe(logStream);

    daemon.unref();
    await this.waitForHealthy();
  }

  async waitForHealthy(timeout = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await checkHealth('http://localhost:3030/health')) return;
      await sleep(100);
    }
    throw new Error('Daemon failed to start');
  }
}
```

### Build & Bundle Process

**1. Bundle Daemon (esbuild):**

```bash
# Build daemon as single JS file
cd apps/agor-daemon
esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=../../packages/agor/daemon/index.js \
  --external:@agor/core \
  --minify
```

**2. Build UI (Vite):**

```bash
# Build React app
cd apps/agor-ui
pnpm build
cp -r dist ../../packages/agor/ui/
```

**3. Publish Meta-Package:**

```json
// packages/agor/package.json
{
  "name": "agor",
  "version": "1.0.0",
  "bin": {
    "agor": "./bin/agor.js"
  },
  "files": ["bin/", "daemon/", "ui/dist/"],
  "dependencies": {
    "@agor/core": "^1.0.0"
  }
}
```

```bash
cd packages/agor
npm publish
```

---

## Future: Desktop App (Phase 5)

**Goal:** Native application experience

1. Choose framework: **Tauri** (lighter than Electron)
2. Embed daemon as Tauri sidecar
3. Create native installers
4. Add system tray integration

```bash
brew install --cask agor  # macOS
winget install agor        # Windows
```

**Time:** 6-8 weeks

**Tauri vs Electron:**

| Feature            | Tauri     | Electron      |
| ------------------ | --------- | ------------- |
| Bundle size        | 10-20MB   | 100-200MB     |
| Memory usage       | ~50MB     | ~200MB        |
| Native integration | Excellent | Good          |
| Maturity           | Newer     | Battle-tested |
| Rust knowledge     | Required  | Not required  |

**Recommendation:** Tauri for size benefits (critical for CLI-like tool)

---

## UI Distribution Strategy

### Option A: UI Served by Daemon (Current)

**How it works:**

- Daemon serves compiled React app at `http://localhost:3030/ui`
- `agor ui open` opens browser to daemon URL
- UI bundled into daemon package

**Pros:**

- Single backend to manage
- UI always matches daemon version
- No CORS issues

**Cons:**

- Daemon package size increases (~2-5MB for UI bundle)
- Daemon must serve static files (performance overhead)

---

### Option B: Separate UI Package

**How it works:**

- UI published as separate `@agor/ui` npm package
- User runs `npx @agor/ui` to start UI dev server
- UI connects to daemon via WebSocket

**Pros:**

- Smaller daemon package
- UI can be updated independently
- Cleaner separation of concerns

**Cons:**

- Requires two processes (daemon + UI)
- CORS configuration needed
- Version mismatch potential

---

### Option C: Desktop App Only (No Browser UI)

**How it works:**

- No standalone browser UI
- Desktop app is the only UI
- CLI for power users, app for visual users

**Pros:**

- Single distribution channel
- Best UX (native app)

**Cons:**

- No web-based UI for remote access
- Requires desktop app development

---

### Recommended: Hybrid Approach

**Phase 4a-b:** Option A (UI served by daemon)
**Phase 4c:** Option C (Desktop app with embedded UI)

**Reasoning:**

- Early users (Phase 4a-b) are technical, okay with browser UI
- Desktop app (Phase 4c) provides native experience for end users
- Keep browser UI for teams that want to self-host Agor daemon

---

## Package Naming Strategy

### Option 1: Scoped Package (Recommended)

```bash
npm install -g @agor/cli      # CLI commands
npm install -g @agor/daemon   # Background daemon
npm install -g @agor/ui       # UI dev server (optional)
```

**Pros:**

- Clear ownership (@agor namespace)
- Easy to add more packages later
- Follows npm best practices

**Cons:**

- Longer command: `npx @agor/cli` vs `npx agor`

---

### Option 2: Unscoped Package

```bash
npm install -g agor           # Everything bundled
```

**Pros:**

- Simplest user experience
- Short command name

**Cons:**

- Namespace collision risk
- All-or-nothing (can't install just CLI)

---

### Recommended: Start Scoped, Alias to Unscoped

```bash
# Phase 4a: Scoped packages
npm install -g @agor/cli
npm install -g @agor/daemon

# Phase 4b: Unscoped alias that installs both
npm install -g agor  # Meta-package that installs @agor/cli + @agor/daemon
```

**Implementation:**

```json
// packages/agor/package.json (meta-package)
{
  "name": "agor",
  "version": "1.0.0",
  "description": "Agor CLI and daemon (meta-package)",
  "bin": {
    "agor": "./bin/agor.js"
  },
  "dependencies": {
    "@agor/cli": "^1.0.0",
    "@agor/daemon": "^1.0.0"
  }
}
```

---

## Daemon Lifecycle Management

### Option A: Manual Start/Stop

**User workflow:**

```bash
agor daemon start              # Start in background
agor daemon stop               # Stop daemon
agor daemon status             # Check status
agor daemon logs               # View logs
```

**Implementation:**

- Use pid files (`~/.agor/daemon.pid`)
- Spawn detached child process
- Log to `~/.agor/logs/daemon.log`

**Pros:**

- Explicit control
- No surprises (daemon doesn't auto-start)

**Cons:**

- Extra step for users
- Need to remember to start daemon

---

### Option B: Auto-Start (Recommended)

**User workflow:**

```bash
agor session list              # Auto-starts daemon if not running
```

**Implementation:**

```typescript
// Before every CLI command
async function ensureDaemon() {
  const isRunning = await checkHealth('http://localhost:3030/health');
  if (!isRunning) {
    console.log('Starting Agor daemon...');
    await daemonManager.start();
  }
}
```

**Pros:**

- Zero-friction user experience
- "It just works"

**Cons:**

- Daemon runs indefinitely (memory usage)
- Users may not realize daemon is running

**Mitigation:**

- Add `agor daemon status` to show daemon info
- Show daemon status in `agor config` output
- Implement idle timeout (stop after 1 hour of inactivity)

---

### Option C: On-Demand + Smart Shutdown (Best)

**User workflow:**

```bash
agor session list              # Auto-starts daemon, auto-stops after 10min idle
```

**Implementation:**

- CLI checks daemon health before each command
- Daemon tracks last activity timestamp
- Daemon auto-shuts down after idle period (configurable)
- CLI can override idle timeout: `agor daemon start --no-idle-timeout`

**Pros:**

- Best of both worlds (auto-start + clean shutdown)
- No manual management
- No wasted resources

**Cons:**

- More complex implementation
- Edge cases (what if daemon shuts down mid-command?)

**Recommended:** Implement Option C in Phase 4b

---

## Build & Release Workflow

### Monorepo Structure (Current)

```
agor/
├── apps/
│   ├── agor-cli/       # CLI package
│   ├── agor-daemon/    # Daemon package
│   └── agor-ui/        # UI package
└── packages/
    └── core/           # Shared @agor/core
```

### NPM Publishing Strategy

**Phase 4a: Scoped Packages**

```bash
# Publish core first
cd packages/core
pnpm build
pnpm publish --access public  # @agor/core

# Publish daemon
cd apps/agor-daemon
pnpm build
pnpm publish --access public  # @agor/daemon

# Publish CLI
cd apps/agor-cli
pnpm build
pnpm publish --access public  # @agor/cli
```

**Phase 4b: Meta-Package**

```bash
# After @agor/cli and @agor/daemon are published
cd packages/agor
pnpm publish --access public  # agor (depends on @agor/cli + @agor/daemon)
```

### Release Automation (Changesets)

Use [Changesets](https://github.com/changesets/changesets) for version management:

```bash
pnpm changeset         # Create changeset
pnpm changeset version # Bump versions
pnpm changeset publish # Publish to npm
```

**CI/CD (GitHub Actions):**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - run: pnpm changeset publish
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Installation Size Comparison

| Distribution       | Size   | Includes            | Installation Time |
| ------------------ | ------ | ------------------- | ----------------- |
| Git clone          | ~50MB  | Full source         | ~30s (pnpm)       |
| @agor/cli (npm)    | ~2MB   | CLI only            | ~5s               |
| @agor/daemon (npm) | ~10MB  | Daemon + core       | ~10s              |
| agor (npm bundled) | ~12MB  | CLI + daemon + core | ~15s              |
| Tauri desktop app  | ~15MB  | Everything + UI     | ~30s (download)   |
| Electron app       | ~150MB | Everything + UI     | ~2min (download)  |

**Recommendation:** Target <20MB for bundled npm package, <30MB for Tauri app

---

## Comparison with Similar Tools

### pm2 (Process Manager)

```bash
npm install -g pm2
pm2 start app.js
pm2 list
pm2 logs
```

**What we can learn:**

- Simple daemon management commands
- Automatic restart on failure
- Log aggregation (`pm2 logs`)
- Status dashboard (`pm2 monit`)

---

### Vercel CLI

```bash
npm install -g vercel
vercel login                   # First-time setup
vercel deploy                  # Auto-detects project
```

**What we can learn:**

- First-run experience (`vercel login` guides user)
- Auto-detection of project type
- Global config in `~/.vercel`
- Minimal commands, smart defaults

---

### Prisma CLI

```bash
npm install -g prisma
prisma init                    # Setup wizard
prisma migrate dev             # Auto-starts Prisma Studio
```

**What we can learn:**

- `init` command is guided wizard (interactive prompts)
- Commands can spawn GUI (Prisma Studio)
- Clear separation: CLI for operations, Studio for visualization

---

## Decision Matrix

| Criterion              | CLI-Only | Bundled CLI+Daemon | Desktop App |
| ---------------------- | -------- | ------------------ | ----------- |
| Time to implement      | 2 weeks  | 4 weeks            | 8 weeks     |
| User setup complexity  | Medium   | Low                | Lowest      |
| Package size           | 2MB      | 12MB               | 15-150MB    |
| Cross-platform support | ✅       | ✅                 | ✅          |
| Auto-update mechanism  | npm      | npm                | Native      |
| Daemon lifecycle       | Manual   | Auto               | Native      |
| UI integration         | ❌       | Browser            | Native      |
| Best for               | Phase 4a | Phase 4b           | Phase 4c    |

---

## Recommended Roadmap

### Phase 4a: Quick npm Release (Q2 2025)

**Goal:** Get Agor on npm ASAP for early adopters

**Deliverables:**

- [ ] Publish `@agor/core` to npm
- [ ] Publish `@agor/daemon` to npm
- [ ] Publish `@agor/cli` to npm
- [ ] Update README with npm install instructions
- [ ] Document daemon setup separately

**Timeline:** 1-2 weeks

---

### Phase 4b: Bundled Experience (Q3 2025)

**Goal:** Single-package installation

**Deliverables:**

- [ ] Bundle daemon into CLI package
- [ ] Implement auto-start daemon on CLI commands
- [ ] Add `agor daemon` lifecycle commands
- [ ] Publish `agor` meta-package
- [ ] Update README with simplified instructions

**Timeline:** 2-4 weeks

---

### Phase 4c: Desktop Application (Q4 2025)

**Goal:** Native app for end users

**Deliverables:**

- [ ] Choose framework (Tauri recommended)
- [ ] Embed daemon as sidecar
- [ ] Build native installers (macOS, Windows, Linux)
- [ ] Add system tray integration
- [ ] Publish to Homebrew, winget, apt

**Timeline:** 6-8 weeks

---

## Open Questions

1. **Daemon port:** Hardcode 3030 or make configurable?
   - **Recommendation:** Hardcode 3030, add `--port` override flag

2. **UI distribution:** Serve from daemon or separate package?
   - **Recommendation:** Serve from daemon in Phase 4a-b, native in Phase 4c

3. **Auto-update:** How to handle updates?
   - **Recommendation:** Use `npm update -g agor` in Phase 4a-b, native auto-update in Phase 4c

4. **Multi-user:** How to handle multiple users on same machine?
   - **Recommendation:** Per-user database (`~/.agor/`), daemon runs per-user

5. **Cloud sync:** When to enable cloud backend?
   - **Recommendation:** Phase 5 (V2), after desktop app is stable

---

## References

- [oclif plugins](https://oclif.io/docs/plugins)
- [Tauri](https://tauri.app/)
- [Electron Builder](https://www.electron.build/)
- [Changesets](https://github.com/changesets/changesets)
- [pm2](https://pm2.keymetrics.io/)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Prisma CLI](https://www.prisma.io/docs/reference/api-reference/command-reference)
