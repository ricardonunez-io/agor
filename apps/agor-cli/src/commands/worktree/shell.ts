/**
 * `agor worktree shell <worktree-id>` - Open interactive shell in a worktree
 *
 * Connects to a shell pod via the daemon's WebSocket terminal proxy.
 * Works for both local daemon mode and remote k8s pod mode.
 *
 * Requirements:
 * - User must be logged in (agor login --url <daemon-url>)
 * - Daemon must be running
 */

import { createClient } from '@agor/core/api';
import { getDaemonUrl } from '@agor/core/config';
import { Args, Command } from '@oclif/core';
import chalk from 'chalk';
import { loadToken } from '../../lib/auth';

// Check if ID looks like a full UUID (36 chars with dashes)
function isFullUuid(id: string): boolean {
  return id.length === 36 && id.includes('-');
}

export default class WorktreeShell extends Command {
  static description = 'Open interactive shell in a worktree';

  static examples = [
    '<%= config.bin %> <%= command.id %> abc123',
    '<%= config.bin %> <%= command.id %> 01933e4a-b2c1-7890-a456-789012345678',
  ];

  static args = {
    worktreeId: Args.string({
      description: 'Worktree ID (full UUID or short ID)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(WorktreeShell);

    // Get daemon URL and stored auth
    const storedAuth = await loadToken();
    const daemonUrl = storedAuth?.daemonUrl || await getDaemonUrl();

    // Create Socket.io client (required for real-time terminal events)
    const client = createClient(daemonUrl, true, {
      verbose: true,
      reconnectionAttempts: 3,
    });

    // Wait for socket connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Cannot connect to daemon at ${daemonUrl}`));
      }, 10000);

      client.io.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.io.on('connect_error', (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed: ${err.message}`));
      });
    });

    // Authenticate with stored JWT token
    if (storedAuth?.accessToken) {
      try {
        await client.authenticate({
          strategy: 'jwt',
          accessToken: storedAuth.accessToken,
        });
      } catch {
        client.io.close();
        this.error(
          chalk.red('✗ Authentication failed') +
            '\n\n' +
            chalk.dim('Your session has expired. Please login again:') +
            '\n  ' +
            chalk.cyan('agor login')
        );
      }
    } else {
      client.io.close();
      this.error(
        chalk.red('✗ Not logged in') +
          '\n\n' +
          chalk.dim('Please login first:') +
          '\n  ' +
          chalk.cyan('agor login')
      );
    }

    this.log(chalk.dim(`Connected to daemon at ${daemonUrl}`));

    try {
      // Get worktree info - supports both full UUID and short ID
      const worktreesService = client.service('worktrees');
      let worktree: { worktree_id: string; name: string } | undefined;
      try {
        if (isFullUuid(args.worktreeId)) {
          // Full UUID - use get() directly
          worktree = await worktreesService.get(args.worktreeId) as { worktree_id: string; name: string };
        } else {
          // Short ID - fetch worktrees and filter by prefix
          const result = await worktreesService.find({
            query: { $limit: 1000 },
          }) as { data: { worktree_id: string; name: string }[] };

          const shortId = args.worktreeId.toLowerCase();
          const matches = result.data.filter(w =>
            w.worktree_id.toLowerCase().startsWith(shortId)
          );

          if (matches.length === 0) {
            throw new Error('No worktree found matching this ID');
          }
          if (matches.length > 1) {
            throw new Error(`Ambiguous ID - multiple worktrees match: ${matches.map(w => w.worktree_id.substring(0, 8)).join(', ')}`);
          }
          worktree = matches[0];
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        client.io.close();
        this.error(`Worktree not found: ${args.worktreeId}\n${chalk.dim(`Error: ${errorMessage}`)}`);
      }

      this.log(chalk.bold.cyan(`Opening shell in worktree: ${worktree.name}`));
      this.log('');

      // Create terminal session
      const terminalsService = client.service('terminals');

      let terminalResult: { terminalId: string; cwd: string };
      try {
        terminalResult = await terminalsService.create({
          worktreeId: worktree.worktree_id,
        }) as { terminalId: string; cwd: string };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        client.io.close();
        this.error(`Failed to create terminal: ${errorMessage}`);
        return;
      }

      const { terminalId } = terminalResult;
      this.log(chalk.dim(`Terminal session: ${terminalId}`));
      this.log(chalk.dim('Press Ctrl+D to exit'));
      this.log('');

      // Set up raw mode for stdin
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Handle terminal output
      terminalsService.on('data', (event: unknown) => {
        const { terminalId: tid, data } = event as { terminalId: string; data: string };
        if (tid === terminalId) {
          process.stdout.write(data);
        }
      });

      // Handle terminal exit
      terminalsService.on('exit', async (event: unknown) => {
        const { terminalId: tid, exitCode } = event as { terminalId: string; exitCode: number };
        if (tid === terminalId) {
          this.log('');
          this.log(chalk.dim(`Shell exited with code ${exitCode}`));

          // Restore terminal
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }

          client.io.close();
          process.exit(exitCode);
        }
      });

      // Forward stdin to terminal
      process.stdin.on('data', (data: Buffer) => {
        terminalsService.patch(terminalId, { input: data.toString() }).catch((err: Error) => {
          console.error('Failed to send input:', err.message);
        });
      });

      // Handle Ctrl+C gracefully
      process.on('SIGINT', async () => {
        // Send Ctrl+C to terminal instead of exiting
        terminalsService.patch(terminalId, { input: '\x03' }).catch(() => {});
      });

      // Handle terminal resize
      const sendResize = () => {
        const { columns, rows } = process.stdout;
        if (columns && rows) {
          terminalsService.patch(terminalId, {
            resize: { cols: columns, rows }
          }).catch(() => {});
        }
      };

      // Send initial size
      sendResize();

      // Handle resize events
      process.stdout.on('resize', sendResize);

      // Keep process running
      await new Promise(() => {});

    } catch (error) {
      // Restore terminal on error
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      client.io.close();
      this.error(
        `Shell connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
