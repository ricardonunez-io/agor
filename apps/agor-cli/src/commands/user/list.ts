/**
 * `agor user list` - List all users
 */

import { join } from 'node:path';
import { getConfigPath } from '@agor/core/config';
import { createDatabase, users } from '@agor/core/db';
import type { User } from '@agor/core/types';
import { Command } from '@oclif/core';
import chalk from 'chalk';
import Table from 'cli-table3';

export default class UserList extends Command {
  static description = 'List all users';

  static examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    try {
      // Get database path
      const configPath = getConfigPath();
      const agorHome = join(configPath, '..');
      const dbPath = join(agorHome, 'agor.db');

      // Connect to database
      const db = createDatabase({ url: `file:${dbPath}` });

      // Fetch users
      const rows = await db.select().from(users).all();

      if (rows.length === 0) {
        this.log(chalk.yellow('No users found'));
        this.log('');
        this.log(chalk.gray('Create a user with: agor user create-admin'));
        process.exit(0);
      }

      // Convert to User type
      const userList: User[] = rows.map((row) => {
        const data = row.data as { avatar?: string; preferences?: Record<string, unknown> };
        return {
          user_id: row.user_id as User['user_id'],
          email: row.email,
          name: row.name ?? undefined,
          role: row.role as User['role'],
          avatar: data.avatar,
          preferences: data.preferences,
          onboarding_completed: !!row.onboarding_completed,
          created_at: row.created_at,
          updated_at: row.updated_at ?? undefined,
        };
      });

      // Create table
      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Email'),
          chalk.cyan('Name'),
          chalk.cyan('Role'),
          chalk.cyan('Created'),
        ],
        style: {
          head: [],
          border: [],
        },
      });

      // Add rows
      for (const user of userList) {
        const shortId = user.user_id.substring(0, 8);
        const roleColor =
          user.role === 'owner'
            ? chalk.red
            : user.role === 'admin'
              ? chalk.yellow
              : user.role === 'member'
                ? chalk.green
                : chalk.gray;

        table.push([
          chalk.gray(shortId),
          user.email,
          user.name || chalk.gray('(not set)'),
          roleColor(user.role),
          new Date(user.created_at).toLocaleDateString(),
        ]);
      }

      this.log('');
      this.log(table.toString());
      this.log('');
      this.log(chalk.gray(`Total: ${userList.length} user${userList.length === 1 ? '' : 's'}`));

      process.exit(0);
    } catch (error) {
      this.log(chalk.red('✗ Failed to list users'));
      if (error instanceof Error) {
        this.log(chalk.red(`  ${error.message}`));
      }
      process.exit(1);
    }
  }
}
