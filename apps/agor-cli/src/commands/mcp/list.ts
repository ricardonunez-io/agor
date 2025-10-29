/**
 * List all MCP servers
 */

import { createClient } from '@agor/core/api';
import type { MCPServer } from '@agor/core/types';
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import Table from 'cli-table3';

export default class McpList extends Command {
  static override description = 'List all MCP servers';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --scope global',
    '<%= config.bin %> <%= command.id %> --enabled',
  ];

  static override flags = {
    scope: Flags.string({
      char: 's',
      description: 'Filter by scope (global, team, repo, session)',
      options: ['global', 'team', 'repo', 'session'],
    }),
    transport: Flags.string({
      char: 't',
      description: 'Filter by transport (stdio, http, sse)',
      options: ['stdio', 'http', 'sse'],
    }),
    enabled: Flags.boolean({
      char: 'e',
      description: 'Show only enabled servers',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(McpList);
    const client = createClient();

    try {
      // Build query params
      const query: Record<string, string | boolean> = {};
      if (flags.scope) query.scope = flags.scope;
      if (flags.transport) query.transport = flags.transport;
      if (flags.enabled) query.enabled = true;

      // Fetch MCP servers
      const result = await client.service('mcp-servers').find({ query });
      const servers = (Array.isArray(result) ? result : result.data) as MCPServer[];

      if (servers.length === 0) {
        this.log(chalk.yellow('No MCP servers found.'));
        await this.cleanup(client);
        return;
      }

      // Create table
      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Name'),
          chalk.cyan('Transport'),
          chalk.cyan('Scope'),
          chalk.cyan('Enabled'),
          chalk.cyan('Source'),
        ],
        colWidths: [12, 20, 12, 12, 10, 12],
        wordWrap: true,
      });

      // Add rows
      for (const server of servers) {
        table.push([
          String(server.mcp_server_id).substring(0, 8),
          server.display_name || server.name,
          server.transport,
          server.scope,
          server.enabled ? chalk.green('✓') : chalk.gray('✗'),
          server.source,
        ]);
      }

      this.log(table.toString());
      this.log(chalk.gray(`\nTotal: ${servers.length} server(s)`));
    } catch (error) {
      this.log(chalk.red('✗ Failed to fetch MCP servers'));
      if (error instanceof Error) {
        this.log(chalk.red(error.message));
      }
      await this.cleanup(client);
      process.exit(1);
    }

    await this.cleanup(client);
  }

  private async cleanup(client: import('@agor/core/api').AgorClient): Promise<void> {
    await new Promise<void>((resolve) => {
      client.io.once('disconnect', () => resolve());
      client.io.close();
      setTimeout(() => resolve(), 1000);
    });
  }
}
