/**
 * Daemon Lifecycle Manager
 *
 * Similar to VS Code's extension host, this manages the Agor daemon process:
 * - Spawns the Node.js daemon as a child process
 * - Monitors health via HTTP polling
 * - Handles graceful shutdown
 * - Provides status updates to the main process
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import * as http from 'http';

export interface DaemonStatus {
  running: boolean;
  port: number;
  pid?: number;
  error?: string;
}

export class DaemonManager {
  private process?: ChildProcess;
  private daemonPath: string;
  private readonly port: number = 3030;
  private readonly healthCheckInterval = 5000; // 5 seconds
  private healthCheckTimer?: NodeJS.Timeout;
  private statusCallback?: (status: DaemonStatus) => void;

  constructor() {
    // In development: use local daemon
    // In production: use bundled daemon
    if (app.isPackaged) {
      this.daemonPath = path.join(process.resourcesPath, 'daemon', 'dist', 'index.js');
    } else {
      // Development mode: point to local daemon
      this.daemonPath = path.join(__dirname, '../../../agor-daemon/src/index.ts');
    }

    console.log('[DaemonManager] Daemon path:', this.daemonPath);
  }

  /**
   * Register callback for status updates
   */
  onStatusChange(callback: (status: DaemonStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Start the daemon process
   */
  async start(): Promise<void> {
    if (this.process) {
      console.log('[DaemonManager] Daemon already running');
      return;
    }

    console.log('[DaemonManager] Starting daemon...');

    try {
      // In development, use tsx to run TypeScript directly
      // In production, use node to run compiled JavaScript
      const runtime = app.isPackaged ? 'node' : 'tsx';
      const args = [this.daemonPath];

      this.process = spawn(runtime, args, {
        env: {
          ...process.env,
          PORT: String(this.port),
          NODE_ENV: app.isPackaged ? 'production' : 'development',
          // Inherit PATH to find tsx in development
          PATH: process.env.PATH,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      // Log daemon output
      this.process.stdout?.on('data', (data) => {
        console.log(`[Daemon] ${data.toString().trim()}`);
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[Daemon Error] ${data.toString().trim()}`);
      });

      this.process.on('error', (error) => {
        console.error('[DaemonManager] Process error:', error);
        this.notifyStatus({
          running: false,
          port: this.port,
          error: error.message,
        });
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[DaemonManager] Process exited (code: ${code}, signal: ${signal})`);
        this.process = undefined;
        this.stopHealthCheck();
        this.notifyStatus({
          running: false,
          port: this.port,
        });
      });

      // Wait for daemon to be ready
      await this.waitForHealthy(30000); // 30 second timeout

      // Start periodic health checks
      this.startHealthCheck();

      console.log('[DaemonManager] Daemon started successfully');
      this.notifyStatus({
        running: true,
        port: this.port,
        pid: this.process.pid,
      });
    } catch (error) {
      console.error('[DaemonManager] Failed to start daemon:', error);
      this.process = undefined;
      throw error;
    }
  }

  /**
   * Stop the daemon process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      console.log('[DaemonManager] No daemon process to stop');
      return;
    }

    console.log('[DaemonManager] Stopping daemon...');

    this.stopHealthCheck();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[DaemonManager] Daemon did not exit gracefully, forcing kill');
        this.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process!.once('exit', () => {
        clearTimeout(timeout);
        console.log('[DaemonManager] Daemon stopped');
        this.process = undefined;
        this.notifyStatus({
          running: false,
          port: this.port,
        });
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      this.process!.kill('SIGTERM');
    });
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return !!this.process && !this.process.killed;
  }

  /**
   * Get current daemon status
   */
  getStatus(): DaemonStatus {
    return {
      running: this.isRunning(),
      port: this.port,
      pid: this.process?.pid,
    };
  }

  /**
   * Get daemon URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Wait for daemon to become healthy (respond to health checks)
   */
  private async waitForHealthy(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500; // Check every 500ms

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await this.checkHealth();
      if (healthy) {
        return;
      }

      // Check if process died
      if (!this.process || this.process.killed) {
        throw new Error('Daemon process died during startup');
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Daemon did not become healthy within ${timeoutMs}ms`);
  }

  /**
   * Perform health check via HTTP
   */
  private async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${this.port}/health`, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckTimer = setInterval(async () => {
      const healthy = await this.checkHealth();
      if (!healthy && this.isRunning()) {
        console.warn('[DaemonManager] Health check failed but process still running');
      } else if (!healthy) {
        console.error('[DaemonManager] Health check failed and process is dead');
        this.stopHealthCheck();
        this.notifyStatus({
          running: false,
          port: this.port,
          error: 'Daemon became unhealthy',
        });
      }
    }, this.healthCheckInterval);
  }

  /**
   * Stop health checks
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Notify status change to callback
   */
  private notifyStatus(status: DaemonStatus): void {
    if (this.statusCallback) {
      this.statusCallback(status);
    }
  }
}
