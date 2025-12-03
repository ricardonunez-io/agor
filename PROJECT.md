# PROJECT.md - Agor Mac Application Distribution

**Goal:** Package Agor as a standalone native Mac application (.app bundle) that wraps the existing daemon + UI code without major rewrites.

---

## Overview

Transform Agor from a CLI-first tool (`npm install -g agor-live`) into a native macOS application that:

1. **Bundles all dependencies** (Node.js runtime, daemon, UI)
2. **Runs as a menu bar app** with tray icon for daemon control
3. **Opens UI in default browser** or embedded WebView
4. **Handles lifecycle** (start/stop daemon, auto-launch on login)
5. **Maintains existing architecture** (FeathersJS daemon + React UI)

---

## Architecture Options

### Option A: Electron Wrapper (Recommended)

**Pros:**
- Native cross-platform support (Mac, Windows, Linux)
- Embedded Chromium for UI (no browser dependency)
- Rich native API access (menu bar, notifications, auto-updater)
- Mature ecosystem (Electron Forge, Electron Builder)
- Can bundle Node.js runtime + daemon easily

**Cons:**
- Larger bundle size (~150MB+)
- Chromium overhead

**Structure:**
```
Agor.app/
├── Contents/
│   ├── MacOS/Agor              # Electron main process
│   ├── Resources/
│   │   ├── daemon/             # Bundled daemon (compiled)
│   │   ├── ui/                 # Bundled UI (static build)
│   │   └── node_modules/       # Node.js embedded
│   └── Info.plist
```

**Implementation:**
- Use `electron-builder` or `electron-forge` for packaging
- Main process manages daemon lifecycle (spawn child process)
- Renderer process loads UI (either local file:// or http://localhost:3030)
- Menu bar tray icon for daemon control
- Auto-updater via Electron's built-in updater

---

### Option B: Tauri Wrapper (Lightweight Alternative)

**Pros:**
- Much smaller bundle size (~10-20MB)
- Uses system WebView (WKWebView on Mac)
- Rust-based, modern, secure
- Native Mac integration (menu bar, notifications)

**Cons:**
- Requires Rust toolchain for builds
- Less mature than Electron
- Need to carefully handle Node.js daemon spawning

**Structure:**
```
Agor.app/
├── Contents/
│   ├── MacOS/Agor              # Tauri native binary
│   ├── Resources/
│   │   ├── daemon/             # Bundled daemon
│   │   └── ui/                 # Bundled UI
│   └── Info.plist
```

---

### Option C: Native Menu Bar App (Swift/Obj-C + Node Daemon)

**Pros:**
- Truly native Mac experience
- Smallest footprint
- Best system integration

**Cons:**
- Mac-only (no cross-platform)
- Requires Swift/Obj-C knowledge
- More complex Node.js daemon integration

---

## Recommended Approach: **Option A (Electron)**

**This is exactly how VS Code and Atom work!**

Both VS Code and Atom are Electron apps that:
- Bundle their backend (Node.js) with frontend (Chromium)
- Spawn Node.js processes for language servers, extensions, etc.
- Use Electron's IPC for main ↔ renderer communication
- Provide native menu bars, tray icons, and system integration
- Auto-update seamlessly via `electron-updater`

**VS Code Architecture Parallel:**
```
VS Code.app                          →  Agor.app
├── Electron main process            →  ├── Electron main process
├── Extension host (Node.js)         →  ├── Daemon (Node.js)
└── Renderer (React/Chromium)        →  └── UI (React/Chromium)
```

Electron provides the best balance of:
- **Developer experience** (familiar JS/TS ecosystem)
- **Proven at scale** (VS Code has 15M+ users, Atom pioneered the model)
- **Cross-platform potential** (can expand to Windows/Linux later)
- **Rich feature set** (menu bar, auto-updater, native APIs)
- **Minimal code changes** (wraps existing daemon + UI)

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

#### 1.1 Set Up Electron Structure

```bash
# Create new app package
pnpm create electron-app@latest apps/agor-desktop --template=typescript-webpack
```

**Directory structure:**
```
apps/agor-desktop/
├── src/
│   ├── main/               # Electron main process
│   │   ├── main.ts         # Entry point
│   │   ├── daemon.ts       # Daemon lifecycle manager
│   │   ├── tray.ts         # Menu bar tray icon
│   │   └── updater.ts      # Auto-updater
│   ├── preload/            # Preload scripts
│   │   └── preload.ts      # Bridge between main/renderer
│   └── renderer/           # Points to bundled UI
├── resources/              # Static resources
│   ├── icon.icns           # Mac app icon
│   └── tray-icon.png       # Tray icon
└── forge.config.ts         # Electron Forge config
```

#### 1.2 Daemon Lifecycle Management

**Create `src/main/daemon.ts`:**
```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';

export class DaemonManager {
  private process?: ChildProcess;
  private daemonPath: string;

  constructor() {
    // In development: use local daemon
    // In production: use bundled daemon
    this.daemonPath = app.isPackaged
      ? path.join(process.resourcesPath, 'daemon', 'dist', 'index.js')
      : path.join(__dirname, '../../agor-daemon/dist/index.js');
  }

  async start(): Promise<void> {
    // Spawn daemon process
    this.process = spawn('node', [this.daemonPath], {
      env: {
        ...process.env,
        PORT: '3030',
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
    });

    // Wait for daemon to be ready
    await this.waitForHealthy();
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
  }

  private async waitForHealthy(): Promise<void> {
    // Poll http://localhost:3030/health
    // Retry up to 30 seconds
  }

  isRunning(): boolean {
    return !!this.process && !this.process.killed;
  }
}
```

#### 1.3 Menu Bar Tray Icon

**Create `src/main/tray.ts`:**
```typescript
import { Tray, Menu, app } from 'electron';
import path from 'path';
import { DaemonManager } from './daemon';

export function createTray(daemon: DaemonManager): Tray {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  const tray = new Tray(iconPath);

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: daemon.isRunning() ? 'Stop Daemon' : 'Start Daemon',
        click: async () => {
          if (daemon.isRunning()) {
            await daemon.stop();
          } else {
            await daemon.start();
          }
          updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Open Agor',
        click: () => {
          // Open http://localhost:3030 in default browser
          require('electron').shell.openExternal('http://localhost:3030');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(daemon.isRunning() ? 'Agor (Running)' : 'Agor (Stopped)');
  };

  updateMenu();
  return tray;
}
```

#### 1.4 Main Process Entry Point

**Create `src/main/main.ts`:**
```typescript
import { app, BrowserWindow } from 'electron';
import { DaemonManager } from './daemon';
import { createTray } from './tray';

let daemon: DaemonManager;
let tray: Tray;
let mainWindow: BrowserWindow | null = null;

app.on('ready', async () => {
  // Start daemon
  daemon = new DaemonManager();
  await daemon.start();

  // Create tray icon
  tray = createTray(daemon);

  // Create main window (hidden by default, opened via tray)
  createWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // Start hidden
  });

  // Load UI (daemon serves UI at http://localhost:3030)
  mainWindow.loadURL('http://localhost:3030');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', (e: Event) => {
  // Don't quit app when all windows closed (menu bar app behavior)
  e.preventDefault();
});

app.on('before-quit', async () => {
  // Stop daemon before quitting
  if (daemon) {
    await daemon.stop();
  }
});
```

---

### Phase 2: Packaging & Distribution (Week 3)

#### 2.1 Configure Electron Builder

**Create `forge.config.ts`:**
```typescript
import { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Agor',
    icon: './resources/icon',
    extraResource: [
      // Bundle compiled daemon
      '../agor-daemon/dist',
      // Bundle UI build
      '../agor-ui/dist',
    ],
    osxSign: {
      identity: 'Developer ID Application: Your Name',
      hardenedRuntime: true,
      entitlements: 'entitlements.plist',
      'entitlements-inherit': 'entitlements.plist',
    },
    osxNotarize: {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID!,
      appleIdPassword: process.env.APPLE_ID_PASSWORD!,
      teamId: process.env.APPLE_TEAM_ID!,
    },
  },
  makers: [
    new MakerDMG({
      format: 'ULFO', // Compressed
      icon: './resources/icon.icns',
      background: './resources/dmg-background.png',
    }),
    new MakerZIP({}, ['darwin']),
  ],
};

export default config;
```

#### 2.2 Build Script

**Add to `apps/agor-desktop/package.json`:**
```json
{
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "publish": "electron-forge publish",
    "prebuild": "pnpm --filter @agor/daemon build && pnpm --filter agor-ui build"
  }
}
```

#### 2.3 Code Signing & Notarization

**Requirements:**
- Apple Developer account ($99/year)
- Developer ID Application certificate
- App-specific password for notarization

**Create `entitlements.plist`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

**Sign and notarize:**
```bash
# Build
pnpm --filter @agor/desktop make

# Sign
codesign --deep --force --verify --verbose --sign "Developer ID Application: Your Name" "out/Agor-darwin-x64/Agor.app"

# Notarize
xcrun notarytool submit "out/make/zip/darwin/x64/Agor-darwin-x64-0.1.0.zip" \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID" \
  --wait

# Staple
xcrun stapler staple "out/Agor-darwin-x64/Agor.app"
```

---

### Phase 3: Auto-Updater (Week 4)

#### 3.1 Implement Auto-Update

**Use `electron-updater`:**
```typescript
// src/main/updater.ts
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

export function setupAutoUpdater() {
  autoUpdater.logger = log;

  // Check for updates on startup
  autoUpdater.checkForUpdatesAndNotify();

  // Check every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 6 * 60 * 60 * 1000);
}
```

#### 3.2 GitHub Releases Integration

**Add to `forge.config.ts`:**
```typescript
publishers: [
  {
    name: '@electron-forge/publisher-github',
    config: {
      repository: {
        owner: 'preset-io',
        name: 'agor',
      },
      prerelease: false,
    },
  },
],
```

**Publish new release:**
```bash
pnpm --filter @agor/desktop publish
```

---

### Phase 4: Enhanced Features (Week 5+)

#### 4.1 Native Notifications

```typescript
import { Notification } from 'electron';

new Notification({
  title: 'Agor',
  body: 'Session completed successfully!',
  icon: './resources/icon.png',
}).show();
```

#### 4.2 Deep Links

**Register `agor://` protocol:**
```typescript
// In main.ts
app.setAsDefaultProtocolClient('agor');

app.on('open-url', (event, url) => {
  // Handle agor://session/abc123
  event.preventDefault();
  const sessionId = url.replace('agor://session/', '');
  // Open session in UI
});
```

#### 4.3 System Tray Status

Update tray icon based on daemon state:
```typescript
tray.setImage(daemon.isRunning()
  ? './resources/tray-icon-active.png'
  : './resources/tray-icon-inactive.png'
);
```

---

## Development Workflow

### Local Development

```bash
# Terminal 1: Run daemon in dev mode
cd apps/agor-daemon && pnpm dev

# Terminal 2: Run Electron app (points to local daemon)
cd apps/agor-desktop && pnpm start
```

### Production Build

```bash
# 1. Build daemon + UI
pnpm build

# 2. Package Electron app
cd apps/agor-desktop && pnpm make

# Output: out/make/dmg/darwin/x64/Agor-0.1.0.dmg
```

---

## Distribution Strategy

### 1. GitHub Releases (Primary)

- Automatically create releases via CI/CD
- Upload signed `.dmg` files
- Auto-updater fetches from GitHub releases

### 2. Homebrew Cask (Secondary)

```bash
brew install --cask agor
```

**Create `Casks/agor.rb`:**
```ruby
cask "agor" do
  version "0.1.0"
  sha256 "..."

  url "https://github.com/preset-io/agor/releases/download/v#{version}/Agor-#{version}.dmg"
  name "Agor"
  desc "AI agent orchestration platform"
  homepage "https://agor.live"

  app "Agor.app"
end
```

### 3. Direct Download (Tertiary)

Host `.dmg` on agor.live for direct downloads.

---

## Security Considerations

### 1. Daemon Isolation

- Daemon runs as separate Node.js process
- Communicate via REST API (localhost only)
- No elevated privileges required

### 2. Code Signing

- Sign all binaries with Developer ID
- Notarize app for Gatekeeper approval
- Hardened runtime enabled

### 3. Auto-Update Security

- Updates fetched over HTTPS
- Signature verification via `electron-updater`
- Rollback mechanism for failed updates

---

## Migration Path for Existing Users

### Current: CLI-based (`npm install -g agor-live`)

```bash
# Old workflow
agor daemon start
agor open
```

### New: Mac App

```bash
# Option 1: Keep CLI available
npm install -g agor-live  # Still works

# Option 2: Use Mac app
open -a Agor  # Daemon auto-starts
```

**Backward compatibility:**
- Mac app reads from `~/.agor/` (same as CLI)
- Existing databases, configs, worktrees work as-is
- CLI and Mac app can coexist (daemon port conflict handled gracefully)

---

## Testing Plan

### Manual Testing

- [ ] App launches and daemon starts
- [ ] Tray icon shows correct status
- [ ] UI loads in browser/WebView
- [ ] Stop/Start daemon from tray
- [ ] Auto-launch on login works
- [ ] Auto-updater fetches and installs updates
- [ ] Code signing verified (no Gatekeeper warnings)

### Automated Testing

```bash
# Use Spectron for Electron app testing
pnpm --filter @agor/desktop test
```

---

## Timeline & Milestones

| Week | Milestone | Deliverable |
|------|-----------|-------------|
| 1-2 | Phase 1: Foundation | Working Electron app (dev mode) |
| 3 | Phase 2: Packaging | Signed `.dmg` file |
| 4 | Phase 3: Auto-Updater | GitHub releases integration |
| 5+ | Phase 4: Enhancements | Notifications, deep links |

---

## Open Questions

1. **UI Delivery**: Should we embed UI in app or serve from daemon?
   - **Option A**: Bundle UI static files in app, serve via `file://`
   - **Option B**: Let daemon serve UI at `http://localhost:3030` (current approach)
   - **Recommendation**: Option B (less duplication, easier updates)

2. **Window Management**: Always show window or keep in menu bar?
   - **Recommendation**: Menu bar by default, window on demand

3. **Multi-User Support**: Handle multiple Mac users on same machine?
   - **Recommendation**: Each user gets their own `~/.agor/`

4. **Zellij Bundling**: Bundle Zellij binary or require user install?
   - **Recommendation**: Bundle for convenience, detect system install

---

## Success Criteria

- ✅ One-click install (drag Agor.app to /Applications)
- ✅ No terminal required to start/stop daemon
- ✅ Auto-updates work seamlessly
- ✅ Existing CLI users can migrate without data loss
- ✅ <50MB app bundle size (without Node.js runtime)
- ✅ No Gatekeeper warnings on first launch

---

## Resources

- **Electron Forge**: https://www.electronforge.io/
- **Electron Builder**: https://www.electron.build/
- **electron-updater**: https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater
- **Code Signing Guide**: https://www.electronjs.org/docs/latest/tutorial/code-signing
- **Notarization Guide**: https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide

---

## Next Steps

1. Create `apps/agor-desktop` package with Electron Forge
2. Implement `DaemonManager` for lifecycle control
3. Create tray icon and menu
4. Test packaging and signing
5. Set up CI/CD for automated releases
