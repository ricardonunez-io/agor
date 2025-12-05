/**
 * `agor user sync-unix` - Sync Unix users and groups with database
 *
 * Verifies that all users with unix_username in the database have corresponding
 * Unix system users, and that they belong to the correct worktree groups.
 *
 * Operations:
 * - Creates missing Unix users
 * - Adds users to worktree groups they own
 * - Reports discrepancies
 *
 * Requires sudo access for user/group management.
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { getConfigPath } from '@agor/core/config';
import { createDatabase, eq, select, users, worktreeOwners, worktrees } from '@agor/core/db';
import type { WorktreeID } from '@agor/core/types';
import {
  AGOR_USERS_GROUP,
  generateWorktreeGroupName,
  UnixGroupCommands,
  UnixUserCommands,
} from '@agor/core/unix';
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';

interface UserWithUnix {
  user_id: string;
  email: string;
  name: string | null;
  unix_username: string;
}

interface WorktreeOwnership {
  worktree_id: string;
  name: string;
  unix_group: string | null;
}

interface SyncResult {
  user: UserWithUnix;
  unixUserExists: boolean;
  unixUserCreated: boolean;
  groups: {
    expected: string[];
    actual: string[];
    added: string[];
    missing: string[];
  };
  errors: string[];
}

export default class UserSyncUnix extends Command {
  static override description =
    'Sync Unix users and groups with database. Creates missing users and fixes group memberships.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --verbose',
  ];

  static override flags = {
    'dry-run': Flags.boolean({
      char: 'n',
      description: 'Show what would be done without making changes',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed output',
      default: false,
    }),
    'create-users': Flags.boolean({
      description: 'Create missing Unix users (requires sudo)',
      default: true,
      allowNo: true,
    }),
    'sync-groups': Flags.boolean({
      description: 'Sync group memberships (requires sudo)',
      default: true,
      allowNo: true,
    }),
    'create-groups': Flags.boolean({
      description: 'Create missing worktree groups (requires sudo)',
      default: false,
    }),
  };

  /**
   * Check if a Unix user exists on the system
   */
  private userExists(username: string): boolean {
    try {
      execSync(UnixUserCommands.userExists(username), { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get groups a Unix user belongs to
   */
  private getUserGroups(username: string): string[] {
    try {
      const output = execSync(UnixUserCommands.getUserGroups(username), {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return output.trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Check if a Unix group exists
   */
  private groupExists(groupName: string): boolean {
    try {
      execSync(UnixGroupCommands.groupExists(groupName), { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a Unix user (requires sudo)
   */
  private createUser(username: string, dryRun: boolean): boolean {
    const cmd = `sudo ${UnixUserCommands.createUser(username)}`;
    if (dryRun) {
      this.log(chalk.gray(`  [dry-run] Would run: ${cmd}`));
      return true;
    }
    try {
      execSync(cmd, { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add user to a group (requires sudo)
   */
  private addUserToGroup(username: string, groupName: string, dryRun: boolean): boolean {
    const cmd = `sudo ${UnixGroupCommands.addUserToGroup(username, groupName)}`;
    if (dryRun) {
      this.log(chalk.gray(`  [dry-run] Would run: ${cmd}`));
      return true;
    }
    try {
      execSync(cmd, { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a Unix group (requires sudo)
   */
  private createGroup(groupName: string, dryRun: boolean): boolean {
    const cmd = `sudo ${UnixGroupCommands.createGroup(groupName)}`;
    if (dryRun) {
      this.log(chalk.gray(`  [dry-run] Would run: ${cmd}`));
      return true;
    }
    try {
      execSync(cmd, { stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(UserSyncUnix);
    const dryRun = flags['dry-run'];
    const verbose = flags.verbose;
    const createUsers = flags['create-users'];
    const syncGroups = flags['sync-groups'];
    const createGroups = flags['create-groups'];

    if (dryRun) {
      this.log(chalk.yellow('🔍 Dry run mode - no changes will be made\n'));
    }

    // Track groups created
    let groupsCreated = 0;

    try {
      // Connect to database
      let databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        const configPath = getConfigPath();
        const agorHome = join(configPath, '..');
        const dbPath = join(agorHome, 'agor.db');
        databaseUrl = `file:${dbPath}`;
      }

      const db = createDatabase({ url: databaseUrl });

      // Ensure agor_users group exists (global group for all managed users)
      this.log(chalk.cyan(`Checking ${AGOR_USERS_GROUP} group...\n`));
      if (!this.groupExists(AGOR_USERS_GROUP)) {
        this.log(chalk.yellow(`   → Creating ${AGOR_USERS_GROUP} group...`));
        if (this.createGroup(AGOR_USERS_GROUP, dryRun)) {
          groupsCreated++;
          this.log(chalk.green(`   ✓ Created ${AGOR_USERS_GROUP} group\n`));
        } else {
          this.log(chalk.red(`   ✗ Failed to create ${AGOR_USERS_GROUP} group\n`));
        }
      } else {
        this.log(chalk.green(`   ✓ ${AGOR_USERS_GROUP} group exists\n`));
      }

      // Get all users and filter for those with unix_username set
      const allUsers = (await select(db).from(users).all()) as UserWithUnix[];
      const validUsers = allUsers.filter((u) => u.unix_username);

      if (validUsers.length === 0) {
        this.log(chalk.yellow('No users with unix_username found in database'));
        this.log(chalk.gray('\nTo set a unix_username for a user:'));
        this.log(chalk.gray('  agor user update <email> --unix-username <username>'));
        return;
      }

      this.log(chalk.cyan(`Found ${validUsers.length} user(s) with unix_username\n`));

      const results: SyncResult[] = [];

      for (const user of validUsers) {
        const result: SyncResult = {
          user,
          unixUserExists: false,
          unixUserCreated: false,
          groups: {
            expected: [],
            actual: [],
            added: [],
            missing: [],
          },
          errors: [],
        };

        this.log(chalk.bold(`📋 ${user.email}`));
        this.log(chalk.gray(`   unix_username: ${user.unix_username}`));
        this.log(chalk.gray(`   user_id: ${user.user_id.substring(0, 8)}`));

        // Check if Unix user exists
        result.unixUserExists = this.userExists(user.unix_username);

        if (result.unixUserExists) {
          this.log(chalk.green(`   ✓ Unix user exists`));
        } else {
          this.log(chalk.red(`   ✗ Unix user does not exist`));

          if (createUsers) {
            this.log(chalk.yellow(`   → Creating Unix user...`));
            if (this.createUser(user.unix_username, dryRun)) {
              result.unixUserCreated = true;
              result.unixUserExists = true;
              this.log(chalk.green(`   ✓ Unix user created`));
            } else {
              result.errors.push('Failed to create Unix user');
              this.log(chalk.red(`   ✗ Failed to create Unix user`));
            }
          }
        }

        // Get current groups (only if user exists)
        if (result.unixUserExists || dryRun) {
          result.groups.actual = result.unixUserExists
            ? this.getUserGroups(user.unix_username)
            : [];

          if (verbose && result.groups.actual.length > 0) {
            this.log(chalk.gray(`   Current groups: ${result.groups.actual.join(', ')}`));
          }

          // Ensure user is in agor_users group
          if (syncGroups && !result.groups.actual.includes(AGOR_USERS_GROUP)) {
            this.log(chalk.yellow(`   → Adding to ${AGOR_USERS_GROUP}...`));
            if (this.addUserToGroup(user.unix_username, AGOR_USERS_GROUP, dryRun)) {
              result.groups.added.push(AGOR_USERS_GROUP);
              this.log(chalk.green(`   ✓ Added to ${AGOR_USERS_GROUP}`));
            } else {
              result.errors.push(`Failed to add to ${AGOR_USERS_GROUP}`);
              this.log(chalk.red(`   ✗ Failed to add to ${AGOR_USERS_GROUP}`));
            }
          }

          // Get worktrees owned by this user
          const ownerships = await select(db)
            .from(worktreeOwners)
            .innerJoin(worktrees, eq(worktreeOwners.worktree_id, worktrees.worktree_id))
            .where(eq(worktreeOwners.user_id, user.user_id))
            .all();

          const ownedWorktrees: WorktreeOwnership[] = ownerships.map(
            (row: {
              worktrees: { worktree_id: string; name: string; unix_group: string | null };
            }) => ({
              worktree_id: row.worktrees.worktree_id,
              name: row.worktrees.name,
              unix_group: row.worktrees.unix_group,
            })
          );

          if (verbose) {
            this.log(chalk.gray(`   Owns ${ownedWorktrees.length} worktree(s)`));
          }

          // Build expected groups from owned worktrees
          for (const wt of ownedWorktrees) {
            // Use existing unix_group or generate from worktree_id
            const expectedGroup =
              wt.unix_group || generateWorktreeGroupName(wt.worktree_id as WorktreeID);
            result.groups.expected.push(expectedGroup);

            const isInGroup = result.groups.actual.includes(expectedGroup);
            const groupExistsOnSystem = this.groupExists(expectedGroup);

            if (verbose) {
              this.log(
                chalk.gray(
                  `   Worktree "${wt.name}" → group ${expectedGroup} ` +
                    `(exists: ${groupExistsOnSystem ? 'yes' : 'no'}, member: ${isInGroup ? 'yes' : 'no'})`
                )
              );
            }

            if (!isInGroup && syncGroups) {
              let groupReady = groupExistsOnSystem;

              // Create group if it doesn't exist and --create-groups is set
              if (!groupExistsOnSystem) {
                if (createGroups) {
                  this.log(chalk.yellow(`   → Creating group ${expectedGroup}...`));
                  if (this.createGroup(expectedGroup, dryRun)) {
                    groupsCreated++;
                    groupReady = true;
                    this.log(chalk.green(`   ✓ Created group ${expectedGroup}`));
                  } else {
                    result.errors.push(`Failed to create group ${expectedGroup}`);
                    this.log(chalk.red(`   ✗ Failed to create group ${expectedGroup}`));
                  }
                } else {
                  result.groups.missing.push(expectedGroup);
                  if (verbose) {
                    this.log(
                      chalk.yellow(
                        `   ⚠ Group ${expectedGroup} does not exist (use --create-groups to create)`
                      )
                    );
                  }
                }
              }

              // Add user to group if it exists/was created
              if (groupReady) {
                this.log(chalk.yellow(`   → Adding to group ${expectedGroup}...`));
                if (this.addUserToGroup(user.unix_username, expectedGroup, dryRun)) {
                  result.groups.added.push(expectedGroup);
                  this.log(chalk.green(`   ✓ Added to ${expectedGroup}`));
                } else {
                  result.errors.push(`Failed to add to group ${expectedGroup}`);
                  this.log(chalk.red(`   ✗ Failed to add to ${expectedGroup}`));
                }
              }
            }
          }
        }

        results.push(result);
        this.log('');
      }

      // Summary
      this.log(chalk.bold('━━━ Summary ━━━\n'));

      const usersCreated = results.filter((r) => r.unixUserCreated).length;
      const groupsAdded = results.reduce((acc, r) => acc + r.groups.added.length, 0);
      const groupsMissing = results.reduce((acc, r) => acc + r.groups.missing.length, 0);
      const errors = results.reduce((acc, r) => acc + r.errors.length, 0);

      this.log(`Users checked:     ${validUsers.length}`);
      this.log(`Users created:     ${usersCreated}${dryRun ? ' (dry-run)' : ''}`);
      this.log(`Groups created:    ${groupsCreated}${dryRun ? ' (dry-run)' : ''}`);
      this.log(`Memberships added: ${groupsAdded}${dryRun ? ' (dry-run)' : ''}`);

      if (groupsMissing > 0) {
        this.log(
          chalk.yellow(`Groups missing:    ${groupsMissing} (use --create-groups to create)`)
        );
      }

      if (errors > 0) {
        this.log(chalk.red(`Errors:            ${errors}`));
      }

      if (dryRun && (usersCreated > 0 || groupsAdded > 0 || groupsCreated > 0)) {
        this.log(chalk.yellow('\nRun without --dry-run to apply changes'));
      }

      process.exit(errors > 0 ? 1 : 0);
    } catch (error) {
      this.log(chalk.red('\n✗ Sync failed'));
      if (error instanceof Error) {
        this.log(chalk.red(`  ${error.message}`));
      }
      process.exit(1);
    }
  }
}
