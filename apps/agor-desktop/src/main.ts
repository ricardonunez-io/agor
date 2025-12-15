/**
 * Agor Desktop - Main Process
 *
 * Electron wrapper that connects to an Agor backend (local or remote).
 *
 * Architecture (inspired by VS Code):
 * - Main process manages lifecycle and configuration
 * - Optional local daemon runs as child process (like VS Code's extension host)
 * - UI renders in Chromium (like VS Code's workbench)
 * - Tray provides quick access (like VS Code's status bar)
 *
 * This app is a thin wrapper - all real functionality lives in the Agor daemon/UI.
 * The app simply provides:
 * - Native window with macOS traffic lights
 * - Optional local daemon management
 * - URL configuration for connecting to local or remote Agor instances
 *
 * Future work (see context/explorations/desktop-app.md):
 * - Settings panel for API keys, daemon port, theme
 * - Auto-update support
 * - Deep linking (agor:// protocol)
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeImage } from 'electron';
import { DaemonManager } from './main/daemon';
import { TrayManager } from './main/tray';

// Set app name (shows in menu bar, dock, etc.)
app.name = 'Agor';

// Keep references to prevent garbage collection
let daemon: DaemonManager;
let tray: TrayManager;
let mainWindow: BrowserWindow | null = null;

// Track quitting state for menu bar app behavior
let isQuitting = false;

// Configuration file (JSON for extensibility)
// Currently stores: { uiUrl?: string }
// Future: apiKey, daemonPort, theme, etc.
const configPath = path.join(app.getPath('userData'), 'config.json');

interface AppConfig {
  uiUrl?: string;
  // Future settings:
  // daemonPort?: number;
  // theme?: 'dark' | 'light' | 'system';
  // apiKey?: string;
}

/**
 * Load app configuration from disk
 */
function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data) as AppConfig;
    }
  } catch (error) {
    console.error('[Main] Failed to load config:', error);
  }
  return {};
}

/**
 * Save app configuration to disk
 */
function saveConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Main] Config saved:', config);
  } catch (error) {
    console.error('[Main] Failed to save config:', error);
  }
}

/**
 * Check if URL points to a remote server (not localhost)
 */
function isRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      !host.startsWith('192.168.') &&
      !host.startsWith('10.')
    );
  } catch {
    return false;
  }
}

/**
 * Get the UI URL from config or defaults
 *
 * Priority:
 * 1. Saved config (config.json)
 * 2. Environment variable (AGOR_UI_URL)
 * 3. Default based on packaged status
 */
function getUIUrl(): string {
  // Check for saved custom URL in config
  const config = loadConfig();
  if (config.uiUrl) {
    console.log('[Main] Using saved UI URL from config:', config.uiUrl);
    return config.uiUrl;
  }

  // Check for environment variable override
  if (process.env.AGOR_UI_URL) {
    return process.env.AGOR_UI_URL;
  }

  // In production, daemon serves the UI
  if (app.isPackaged) {
    return daemon?.getUrl() || 'http://localhost:3030';
  }

  // In development, use Vite dev server
  return 'http://localhost:5173';
}

/**
 * Save custom UI URL to config
 */
function saveUIUrl(url: string): void {
  const config = loadConfig();
  config.uiUrl = url;
  saveConfig(config);
}

/**
 * Show dialog to change UI URL
 */
async function promptChangeUrl(): Promise<void> {
  const currentUrl = getUIUrl();

  // Create a simple input dialog using BrowserWindow
  const inputWindow = new BrowserWindow({
    width: 500,
    height: 200,
    title: 'Change UI URL',
    backgroundColor: '#1a1a1a',
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Create a simple HTML form
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          background: #1a1a1a;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding: 20px;
          margin: 0;
        }
        h2 {
          margin-top: 0;
          font-size: 16px;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 10px;
          margin: 10px 0;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          color: #ffffff;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        }
        .buttons {
          display: flex;
          gap: 10px;
          margin-top: 20px;
          justify-content: flex-end;
        }
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        }
        .cancel {
          background: #3a3a3a;
          color: #ffffff;
        }
        .save {
          background: #0066ff;
          color: #ffffff;
        }
        button:hover {
          opacity: 0.9;
        }
      </style>
    </head>
    <body>
      <h2>Change UI URL</h2>
      <input type="text" id="url" value="${currentUrl}" placeholder="http://localhost:5173" />
      <div class="buttons">
        <button class="cancel" onclick="window.close()">Cancel</button>
        <button class="save" onclick="save()">Save & Reload</button>
      </div>
      <script>
        function save() {
          const url = document.getElementById('url').value;
          if (url) {
            // Send URL back to main process
            window.location = 'save://' + encodeURIComponent(url);
          }
        }
        document.getElementById('url').select();
        document.getElementById('url').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') save();
        });
      </script>
    </body>
    </html>
  `;

  inputWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Handle URL save
  inputWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('save://')) {
      event.preventDefault();
      const newUrl = decodeURIComponent(url.replace('save://', ''));
      saveUIUrl(newUrl);
      inputWindow.close();

      // Reload main window with new URL
      if (mainWindow) {
        mainWindow.loadURL(newUrl);
      }
    }
  });
}

/**
 * Create the main browser window (hidden by default, opened via tray)
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Agor',
    backgroundColor: '#141414',
    titleBarStyle: 'hiddenInset', // macOS native traffic lights with hidden title bar
    trafficLightPosition: { x: 10, y: 10 }, // Position traffic lights
    vibrancy: 'under-window', // Subtle blur effect behind window
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // No preload script needed - UI talks to daemon via REST/WebSocket
    },
    // Start hidden - user opens via tray
    show: false,
    // Menu bar app behavior
    skipTaskbar: false,
  });

  // Load the UI from daemon (which serves the UI at /)
  // In production, daemon serves the built UI
  // In development, we can point to localhost:5173 for Vite HMR
  const uiUrl = getUIUrl();

  console.log('[Main] Loading UI from:', uiUrl);
  mainWindow.loadURL(uiUrl);

  // Inject CSS to make title bar area draggable
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.insertCSS(`
      /* Make top header draggable like VS Code */
      .ant-layout-header,
      header,
      [class*="header"],
      [class*="Header"] {
        -webkit-app-region: drag;
        -webkit-user-select: none;
        user-select: none;
      }

      /* But keep buttons and interactive elements clickable */
      button,
      a,
      input,
      select,
      textarea,
      [role="button"],
      [class*="button"],
      [class*="Button"],
      .ant-btn,
      .ant-menu,
      .ant-dropdown,
      [contenteditable="true"] {
        -webkit-app-region: no-drag;
      }

      /* Add some padding for traffic lights on macOS */
      body {
        padding-top: env(titlebar-area-height, 0px);
      }
    `);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Don't quit app when window is closed (menu bar app behavior)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  console.log('[Main] Window created');
}

/**
 * Show the main window (create if doesn't exist)
 */
function showWindow(): void {
  if (!mainWindow) {
    createWindow();
  }

  mainWindow?.show();
  mainWindow?.focus();
}

/**
 * Application initialization
 */
async function initialize(): Promise<void> {
  console.log('[Main] Initializing Agor...');
  console.log('[Main] Platform:', process.platform);
  console.log('[Main] Packaged:', app.isPackaged);
  console.log('[Main] User data:', app.getPath('userData'));

  try {
    // Set dock icon and menu on macOS
    if (process.platform === 'darwin') {
      const iconPath = path.join(__dirname, '../resources/icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      app.dock.setIcon(icon);

      // Set proper application menu
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'Agor',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Change UI URL...',
              click: () => {
                promptChangeUrl();
              },
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' },
          ],
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    }

    // Initialize daemon manager
    daemon = new DaemonManager();

    // Create tray icon
    tray = new TrayManager(daemon);
    tray.create();

    // Register URL change callback
    tray.onChangeUrl(() => {
      promptChangeUrl();
    });

    // Check if we're connecting to a remote URL or local
    const uiUrl = getUIUrl();
    const isRemote = isRemoteUrl(uiUrl);

    if (isRemote) {
      // Remote URL - skip local daemon startup
      console.log('[Main] Remote URL configured - skipping local daemon startup');
      console.log('[Main] Will connect to:', uiUrl);
    } else {
      // Local URL - try to start daemon (it will detect if one is already running)
      console.log('[Main] Local URL configured - ensuring daemon is running...');
      console.log('[Main] Will connect to:', uiUrl);
      try {
        await daemon.start();
        console.log('[Main] Daemon started/connected successfully');
      } catch (daemonError) {
        console.error('[Main] Failed to start daemon:', daemonError);
        // In packaged mode without bundled daemon, show a helpful message
        if (app.isPackaged) {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Daemon Not Available',
            message: 'Could not start local Agor daemon.',
            detail:
              'The bundled daemon is not available in this build.\n\nWould you like to configure a remote Agor URL instead?',
            buttons: ['Configure URL', 'Quit'],
            defaultId: 0,
          });
          if (response === 0) {
            await promptChangeUrl();
          } else {
            app.quit();
            return;
          }
        } else {
          throw daemonError;
        }
      }
    }

    // Show window automatically in packaged mode (since there's no tray icon working yet)
    // or in development for easier testing
    if (app.isPackaged || !app.isPackaged) {
      console.log('[Main] Showing window');
      createWindow();
      mainWindow?.show();
    }

    console.log('[Main] Agor initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to initialize Agor:', error);
    // Show error dialog
    await dialog.showErrorBox(
      'Failed to Start Agor',
      `Could not initialize Agor:\n\n${error instanceof Error ? error.message : String(error)}\n\nPlease check the logs and try again.`
    );
    app.quit();
  }
}

/**
 * Shutdown sequence
 */
async function shutdown(): Promise<void> {
  console.log('[Main] Shutting down Agor...');

  try {
    // Stop daemon
    if (daemon) {
      await daemon.stop();
    }

    // Destroy tray
    if (tray) {
      tray.destroy();
    }

    console.log('[Main] Shutdown complete');
  } catch (error) {
    console.error('[Main] Error during shutdown:', error);
  }
}

// ============================================================================
// Electron App Lifecycle Events
// ============================================================================

/**
 * App is ready - initialize everything
 */
app.on('ready', async () => {
  console.log('[Main] App ready');
  await initialize();
});

/**
 * All windows closed
 * On macOS, apps typically stay open even when all windows are closed
 */
app.on('window-all-closed', () => {
  // Quit when all windows are closed (normal app behavior)
  console.log('[Main] All windows closed - quitting');
  app.quit();
});

/**
 * App is activated (macOS specific)
 * Usually when dock icon is clicked
 */
app.on('activate', () => {
  // Show window when dock icon is clicked
  if (daemon?.isRunning()) {
    showWindow();
  }
});

/**
 * App is about to quit
 */
app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    await shutdown();
    app.quit();
  }
});

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

// ============================================================================
// IPC Handlers (for future use)
// ============================================================================

// TODO: Add IPC handlers for renderer process communication
// Examples:
// - ipcMain.handle('daemon:status', () => daemon.getStatus())
// - ipcMain.handle('daemon:restart', async () => { await daemon.stop(); await daemon.start(); })
// - ipcMain.handle('app:show-window', () => showWindow())
