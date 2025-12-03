/**
 * Agor Desktop - Main Process
 *
 * Electron main process that orchestrates the Agor daemon and UI.
 * Inspired by VS Code's architecture:
 * - Main process manages lifecycle
 * - Daemon runs as child process (like VS Code's extension host)
 * - UI renders in Chromium (like VS Code's workbench)
 * - Tray provides quick access (like VS Code's status bar)
 */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { DaemonManager } from './main/daemon';
import { TrayManager } from './main/tray';

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Keep references to prevent garbage collection
let daemon: DaemonManager;
let tray: TrayManager;
let mainWindow: BrowserWindow | null = null;

// Track quitting state for menu bar app behavior
let isQuitting = false;

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
    backgroundColor: '#1a1a1a',
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
  const uiUrl = app.isPackaged
    ? daemon.getUrl() // Production: daemon serves UI
    : process.env.AGOR_UI_URL || 'http://localhost:5173'; // Dev: Vite dev server

  mainWindow.loadURL(uiUrl);

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

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
    // Initialize daemon manager
    daemon = new DaemonManager();

    // Create tray icon
    tray = new TrayManager(daemon);
    tray.create();

    // Start daemon
    console.log('[Main] Starting daemon...');
    await daemon.start();
    console.log('[Main] Daemon started successfully');

    // Don't create window automatically - user opens via tray
    // But show window in development for easier testing
    if (!app.isPackaged) {
      console.log('[Main] Development mode - showing window automatically');
      createWindow();
    }

    console.log('[Main] Agor initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to initialize Agor:', error);
    // Show error dialog
    const { dialog } = require('electron');
    await dialog.showErrorBox(
      'Failed to Start Agor',
      `Could not start the Agor daemon:\n\n${error instanceof Error ? error.message : String(error)}\n\nPlease check the logs and try again.`
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
  // Don't quit - this is a menu bar app
  console.log('[Main] All windows closed (not quitting)');
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
