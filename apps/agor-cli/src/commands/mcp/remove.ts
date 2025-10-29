/**
 * Remove an MCP server
 */

import { createClient, isDaemonRunning } from '@agor/core/api';
import { getDaemonUrl } from '@agor/core/config';
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';

export default class McpRemove extends Command {
  static override description = 'Remove an MCP server';

  static override examples = [
    '<%= config.bin %> <%= command.id %> 0199b856',
    '<%= config.bin %> <%= command.id %> filesystem --force',
  ];

  static override args = {
    id: Args.string({
      description: 'MCP server ID or name',
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(McpRemove);

    // Check if daemon is running
    const daemonUrl = await getDaemonUrl();
    const running = await isDaemonRunning(daemonUrl);

    if (!running) {
      this.error(
        `Daemon not running. Start it with: ${chalk.cyan('cd apps/agor-daemon && pnpm dev')}`
      );
    }

    const client = createClient(daemonUrl);

    try {
      // Try to find the server first
      let serverId = args.id;

      // If it looks like a name (not a UUID), try to find by name
      if (!args.id.match(/^[0-9a-f]{8}/i)) {
        const result = await client.service('mcp-servers').find({
          query: { $limit: 100 },
        });
        const servers = Array.isArray(result) ? result : result.data;
        const server = servers.find((s: { name: string }) => s.name === args.id);

        if (!server) {
          this.log(chalk.red(`✗ MCP server not found: ${args.id}`));
          await this.cleanup(client);
          process.exit(1);
        }

        serverId = server.mcp_server_id;
      }

      // Confirm deletion unless --force is used
      if (!flags.force) {
        this.log('');
        this.log(chalk.yellow(`⚠️  This will permanently remove the MCP server: ${args.id}`));
        this.log('');

        // Simple confirmation (oclif doesn't have built-in prompts, so we skip for now)
        // In production, you'd use a prompt library like inquirer
        this.log(chalk.gray('Use --force to skip this confirmation'));
        this.log('');
        await this.cleanup(client);
        process.exit(1);
      }

      // Delete the server
      await client.service('mcp-servers').remove(serverId);

      this.log('');
      this.log(`${chalk.green('✓')} MCP server removed: ${args.id}`);
      this.log('');

      await this.cleanup(client);
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.log('');
      this.log(chalk.red('✗ Failed to remove MCP server'));
      this.log('');
      this.log(chalk.dim(message));
      this.log('');

      await this.cleanup(client);
      process.exit(1);
    }
  }

  private async cleanup(client: import('@agor/core/api').AgorClient): Promise<void> {
    await new Promise<void>((resolve) => {
      client.io.once('disconnect', () => resolve());
      client.io.close();
      setTimeout(() => resolve(), 1000);
    });
  }
}
