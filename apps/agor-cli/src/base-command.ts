/**
 * Base Command - Shared logic for all Agor CLI commands
 *
 * Reduces boilerplate by providing common functionality like daemon connection checking.
 */

import type { AgorClient } from '@agor/core/api';
import { createRestClient } from '@agor/core/api';
import { getDaemonUrl } from '@agor/core/config';
import { Command } from '@oclif/core';
import chalk from 'chalk';
import { loadToken } from './lib/auth';

/**
 * Base command with daemon connection utilities
 */
export abstract class BaseCommand extends Command {
  protected daemonUrl: string | null = null;

  /**
   * Connect to daemon (checks if running first)
   *
   * Uses stored daemon URL from login if available, otherwise falls back to config.
   *
   * @returns Feathers client instance
   */
  protected async connectToDaemon(): Promise<AgorClient> {
    // Check if we have a stored auth with custom daemon URL
    const storedAuth = await loadToken();

    // Get daemon URL: prefer stored URL from login, then config
    const isCustomUrl = !!storedAuth?.daemonUrl;
    this.daemonUrl = storedAuth?.daemonUrl || await getDaemonUrl();

    // Check if daemon is running (use longer timeout for custom URLs - .local domains need more time)
    const timeout = isCustomUrl ? 10000 : 1000;
    let running = false;
    try {
      const response = await fetch(`${this.daemonUrl}/health`, { signal: AbortSignal.timeout(timeout) });
      running = response.ok;
    } catch {
      running = false;
    }

    if (!running) {
      this.log(
        chalk.red(`✗ Cannot connect to daemon at ${this.daemonUrl}`) +
          '\n\n' +
          chalk.dim('Check that the URL is correct and the daemon is running.') +
          (isCustomUrl ? '' : '\n\n' + chalk.bold('To start the daemon:') + '\n  ' + chalk.cyan('cd apps/agor-daemon && pnpm dev'))
      );
      this.exit(1);
    }

    // Create REST-only client (prevents hanging processes)
    const client = await createRestClient(this.daemonUrl);

    // Use already-loaded stored auth (from URL check above)
    if (storedAuth) {
      try {
        // Authenticate with stored JWT token
        await client.authenticate({
          strategy: 'jwt',
          accessToken: storedAuth.accessToken,
        });
      } catch (_error) {
        // Token invalid or expired - clear it and show login prompt
        const { clearToken } = await import('./lib/auth');
        await clearToken();
        this.error(
          chalk.red('✗ Authentication failed') +
            '\n\n' +
            chalk.dim('Your session has expired or is invalid.') +
            '\n' +
            chalk.dim('Please login again:') +
            '\n  ' +
            chalk.cyan('agor login')
        );
      }
    } else {
      // No stored token - check if daemon allows anonymous access
      try {
        const response = await fetch(`${this.daemonUrl}/health`);
        const health = (await response.json()) as { auth?: { requireAuth?: boolean } };
        if (health.auth?.requireAuth) {
          // Daemon requires authentication
          this.error(
            chalk.red('✗ Not authenticated') +
              '\n\n' +
              chalk.dim('This Agor instance requires authentication.') +
              '\n' +
              chalk.dim('Please login:') +
              '\n  ' +
              chalk.cyan('agor login')
          );
        }
        // Try to authenticate with anonymous strategy
        try {
          await client.authenticate({ strategy: 'anonymous' });
        } catch (_authError) {
          // Anonymous auth also failed - give up
          this.error(
            chalk.red('✗ Authentication failed') +
              '\n\n' +
              chalk.dim('Please login:') +
              '\n  ' +
              chalk.cyan('agor login')
          );
        }
      } catch (_error) {
        // If we can't check auth status, try anonymous anyway
        try {
          await client.authenticate({ strategy: 'anonymous' });
        } catch {
          this.error(
            chalk.red('✗ Not authenticated') +
              '\n\n' +
              chalk.dim('Please login to use the Agor CLI:') +
              '\n  ' +
              chalk.cyan('agor login')
          );
        }
      }
    }

    return client;
  }

  /**
   * Cleanup client connection
   *
   * Ensures socket is properly closed to prevent hanging processes
   */
  protected async cleanupClient(client: AgorClient): Promise<void> {
    // Disable reconnection before closing to prevent new connection attempts
    client.io.io.opts.reconnection = false;

    // Remove all event listeners to prevent them from keeping process alive
    client.io.removeAllListeners();

    // Close the socket connection
    client.io.close();

    // Give a brief moment for cleanup, then force exit
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
