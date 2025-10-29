/**
 * Show details for an MCP server
 */

import { createClient } from '@agor/core/api';
import type { MCPServer } from '@agor/core/types';
import { Args, Command } from '@oclif/core';
import chalk from 'chalk';

export default class McpShow extends Command {
  static override description = 'Show MCP server details';

  static override examples = [
    '<%= config.bin %> <%= command.id %> 0199b856',
    '<%= config.bin %> <%= command.id %> filesystem',
  ];

  static override args = {
    id: Args.string({
      description: 'MCP server ID or name',
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(McpShow);
    const client = createClient();

    try {
      // Try to fetch by ID first
      let server: MCPServer | null = null;

      try {
        server = (await client.service('mcp-servers').get(args.id)) as MCPServer;
      } catch {
        // If not found by ID, try to find by name
        const result = await client.service('mcp-servers').find({
          query: { $limit: 1 },
        });
        const servers = (Array.isArray(result) ? result : result.data) as MCPServer[];
        server = servers.find((s) => s.name === args.id) || null;
      }

      if (!server) {
        this.log(chalk.red(`✗ MCP server not found: ${args.id}`));
        await this.cleanup(client);
        process.exit(1);
      }

      // Display server details
      this.log('');
      this.log(chalk.bold(chalk.cyan('MCP Server Details')));
      this.log('');
      this.log(`${chalk.cyan('ID')}: ${server.mcp_server_id}`);
      this.log(`${chalk.cyan('Short ID')}: ${String(server.mcp_server_id).substring(0, 8)}`);
      this.log(`${chalk.cyan('Name')}: ${server.name}`);

      if (server.display_name) {
        this.log(`${chalk.cyan('Display Name')}: ${server.display_name}`);
      }

      if (server.description) {
        this.log(`${chalk.cyan('Description')}: ${server.description}`);
      }

      this.log('');
      this.log(chalk.bold('Configuration'));
      this.log(`${chalk.cyan('Transport')}: ${server.transport}`);
      this.log(`${chalk.cyan('Scope')}: ${server.scope}`);
      this.log(`${chalk.cyan('Source')}: ${server.source}`);
      this.log(
        `${chalk.cyan('Enabled')}: ${server.enabled ? chalk.green('✓ Yes') : chalk.gray('✗ No')}`
      );

      if (server.command) {
        this.log(`${chalk.cyan('Command')}: ${server.command}`);
      }

      if (server.args && server.args.length > 0) {
        this.log(`${chalk.cyan('Arguments')}:`);
        for (const arg of server.args) {
          this.log(`  - ${arg}`);
        }
      }

      if (server.url) {
        this.log(`${chalk.cyan('URL')}: ${server.url}`);
      }

      if (server.env && Object.keys(server.env).length > 0) {
        this.log(`${chalk.cyan('Environment Variables')}:`);
        for (const [key, value] of Object.entries(server.env)) {
          this.log(`  ${key}=${value}`);
        }
      }

      // Show capabilities if available
      if (server.tools || server.resources || server.prompts) {
        this.log('');
        this.log(chalk.bold('Capabilities'));

        if (server.tools && server.tools.length > 0) {
          this.log(`${chalk.cyan('Tools')}: ${server.tools.length}`);
          for (const tool of server.tools.slice(0, 5)) {
            this.log(`  - ${tool.name}: ${tool.description}`);
          }
          if (server.tools.length > 5) {
            this.log(chalk.gray(`  ... and ${server.tools.length - 5} more`));
          }
        }

        if (server.resources && server.resources.length > 0) {
          this.log(`${chalk.cyan('Resources')}: ${server.resources.length}`);
          for (const resource of server.resources.slice(0, 5)) {
            this.log(`  - ${resource.name} (${resource.uri})`);
          }
          if (server.resources.length > 5) {
            this.log(chalk.gray(`  ... and ${server.resources.length - 5} more`));
          }
        }

        if (server.prompts && server.prompts.length > 0) {
          this.log(`${chalk.cyan('Prompts')}: ${server.prompts.length}`);
          for (const prompt of server.prompts.slice(0, 5)) {
            this.log(`  - /${prompt.name}: ${prompt.description}`);
          }
          if (server.prompts.length > 5) {
            this.log(chalk.gray(`  ... and ${server.prompts.length - 5} more`));
          }
        }
      }

      this.log('');
      this.log(chalk.gray(`Created: ${new Date(server.created_at).toLocaleString()}`));
      if (server.updated_at) {
        this.log(chalk.gray(`Updated: ${new Date(server.updated_at).toLocaleString()}`));
      }
      this.log('');
    } catch (error) {
      this.log(chalk.red('✗ Failed to fetch MCP server'));
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
