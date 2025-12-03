/**
 * Menu Bar Tray Icon
 *
 * Provides system tray integration like VS Code's status bar icon:
 * - Shows daemon running status
 * - Quick actions (start/stop, open UI)
 * - App settings and quit
 */

import path from 'node:path';
import { app, Menu, nativeImage, shell, Tray } from 'electron';
import type { DaemonManager, DaemonStatus } from './daemon';

export class TrayManager {
  private tray?: Tray;
  private daemon: DaemonManager;
  private iconPath: string;
  private onChangeUrlCallback?: () => void;

  constructor(daemon: DaemonManager) {
    this.daemon = daemon;

    // Use PNG for now, will create proper icon assets later
    this.iconPath = path.join(__dirname, '../../resources/tray-icon.png');

    // Listen to daemon status changes to update tray
    daemon.onStatusChange((status) => {
      this.updateTray(status);
    });
  }

  /**
   * Register callback for URL change requests
   */
  onChangeUrl(callback: () => void): void {
    this.onChangeUrlCallback = callback;
  }

  /**
   * Create and show the tray icon
   */
  create(): void {
    try {
      // Create tray icon (will use template image on Mac for proper dark mode support)
      const icon = nativeImage.createFromPath(this.iconPath);

      if (process.platform === 'darwin') {
        // On macOS, use template image for automatic dark mode support
        // Icon should be 16x16 or 32x32 with @2x retina version
        icon.setTemplateImage(true);
      }

      this.tray = new Tray(icon);
      this.tray.setToolTip('Agor');

      // Build initial menu
      this.updateTray(this.daemon.getStatus());

      console.log('[TrayManager] Tray created');
    } catch (error) {
      console.error('[TrayManager] Failed to create tray:', error);
      // Don't throw - app can still work without tray
    }
  }

  /**
   * Update tray icon and menu based on daemon status
   */
  private updateTray(status: DaemonStatus): void {
    if (!this.tray) {
      return;
    }

    // Update tooltip
    const tooltip = status.running ? `Agor (Running on port ${status.port})` : 'Agor (Stopped)';
    this.tray.setToolTip(tooltip);

    // Build context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: status.running ? '● Daemon Running' : '○ Daemon Stopped',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: status.running ? 'Stop Daemon' : 'Start Daemon',
        click: async () => {
          if (status.running) {
            await this.daemon.stop();
          } else {
            try {
              await this.daemon.start();
            } catch (error) {
              console.error('[TrayManager] Failed to start daemon:', error);
              // TODO: Show error dialog
            }
          }
        },
      },
      {
        label: 'Restart Daemon',
        enabled: status.running,
        click: async () => {
          await this.daemon.stop();
          try {
            await this.daemon.start();
          } catch (error) {
            console.error('[TrayManager] Failed to restart daemon:', error);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Open Agor',
        enabled: status.running,
        click: () => {
          // Open in default browser
          shell.openExternal(this.daemon.getUrl());
        },
      },
      {
        label: 'Open in Browser',
        enabled: status.running,
        submenu: [
          {
            label: 'Default Browser',
            click: () => {
              shell.openExternal(this.daemon.getUrl());
            },
          },
          {
            label: 'Copy URL',
            click: () => {
              const { clipboard } = require('electron');
              clipboard.writeText(this.daemon.getUrl());
            },
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Change UI URL...',
        click: () => {
          if (this.onChangeUrlCallback) {
            this.onChangeUrlCallback();
          }
        },
      },
      {
        label: 'Settings',
        click: () => {
          // TODO: Open settings window
          console.log('[TrayManager] Settings not implemented yet');
        },
      },
      {
        label: 'View Logs',
        click: () => {
          // Open logs directory
          const logsPath = path.join(app.getPath('home'), '.agor');
          shell.openPath(logsPath);
        },
      },
      { type: 'separator' },
      {
        label: `About Agor`,
        click: () => {
          shell.openExternal('https://agor.live');
        },
      },
      {
        label: 'Check for Updates...',
        click: () => {
          // TODO: Implement auto-updater check
          console.log('[TrayManager] Update check not implemented yet');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Agor',
        click: () => {
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Destroy the tray icon
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = undefined;
    }
  }
}
