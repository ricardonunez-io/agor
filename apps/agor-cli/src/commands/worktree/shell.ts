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

import { Args } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command';

export default class WorktreeShell extends BaseCommand {
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

    // Connect to daemon (uses stored URL from login)
    const client = await this.connectToDaemon();

    this.log(chalk.dim(`Connected to daemon at ${this.daemonUrl}`));

    try {
      // Get worktree info
      const worktreesService = client.service('worktrees');
      let worktree;
      try {
        worktree = await worktreesService.get(args.worktreeId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.cleanupClient(client);
        this.error(`Worktree not found: ${args.worktreeId}\n${chalk.dim(`Error: ${errorMessage}`)}`);
        return;
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
        await this.cleanupClient(client);
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

          await this.cleanupClient(client);
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
      await this.cleanupClient(client);
      this.error(
        `Shell connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
