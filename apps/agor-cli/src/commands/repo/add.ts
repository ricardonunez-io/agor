/**
 * `agor repo add <url>` - Clone a repository for use with Agor
 *
 * Clones the repo to ~/.agor/repos/<name> and registers it with the daemon.
 */

import { createClient, isDaemonRunning } from '@agor/core/api';
import { extractSlugFromUrl, getDaemonUrl, isValidSlug } from '@agor/core/config';
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';

export default class RepoAdd extends Command {
  static description = 'Clone and register a Git repository';

  static examples = [
    '<%= config.bin %> <%= command.id %> git@github.com:apache/superset.git',
    '<%= config.bin %> <%= command.id %> https://github.com/facebook/react.git',
    '<%= config.bin %> <%= command.id %> https://github.com/apache/superset.git --slug my-org/custom-name',
  ];

  static args = {
    url: Args.string({
      description: 'Git repository URL (SSH or HTTPS)',
      required: true,
    }),
  };

  static flags = {
    slug: Flags.string({
      char: 's',
      description: 'Custom slug (org/name) for the repository (auto-extracted if not provided)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RepoAdd);

    // Check if daemon is running
    const daemonUrl = await getDaemonUrl();
    const running = await isDaemonRunning(daemonUrl);

    if (!running) {
      this.error(
        `Daemon not running. Start it with: ${chalk.cyan('cd apps/agor-daemon && pnpm dev')}`
      );
    }

    try {
      // Extract slug from URL or use custom slug
      let slug = flags.slug;

      if (!slug) {
        // Auto-extract slug from URL (e.g., github.com/apache/superset -> apache/superset)
        slug = extractSlugFromUrl(args.url);
        this.log('');
        this.log(chalk.dim(`Auto-detected slug: ${chalk.cyan(slug)}`));
      }

      // Validate slug format
      if (!isValidSlug(slug)) {
        this.error(
          `Invalid slug format: ${slug}\n` +
            `Slug must be in format "org/name" (e.g., "apache/superset")\n` +
            `Use --slug to specify a custom slug.`
        );
      }

      this.log('');
      this.log(chalk.bold(`Cloning ${chalk.cyan(slug)}...`));
      this.log(chalk.dim(`URL: ${args.url}`));
      this.log('');

      // Call daemon API to clone repo
      const client = createClient(daemonUrl);

      const repo = await client.service('repos').clone({
        url: args.url,
        name: slug,
      });

      this.log(`${chalk.green('✓')} Repository cloned and registered`);
      this.log(chalk.dim(`  Path: ${repo.local_path}`));
      this.log(chalk.dim(`  Default branch: ${repo.default_branch}`));
      this.log('');
      this.log(chalk.bold('Repository Details:'));
      this.log(`  ${chalk.cyan('ID')}: ${repo.repo_id}`);
      this.log(`  ${chalk.cyan('Name')}: ${repo.name}`);
      this.log(`  ${chalk.cyan('Path')}: ${repo.local_path}`);
      this.log(`  ${chalk.cyan('Default Branch')}: ${repo.default_branch}`);
      this.log('');

      // Close socket and wait for it to close
      await new Promise<void>((resolve) => {
        client.io.once('disconnect', () => resolve());
        client.io.close();
        setTimeout(() => resolve(), 1000); // Fallback timeout
      });
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.log('');

      // Check for common errors and provide friendly messages
      if (message.includes('already exists')) {
        this.log(chalk.red('✗ Repository already exists'));
        this.log('');
        this.log(`Use ${chalk.cyan('agor repo list')} to see registered repos.`);
        this.log('');
        process.exit(1);
      } else if (message.includes('Permission denied')) {
        this.log(chalk.red('✗ Permission denied'));
        this.log('');
        this.log('Make sure you have SSH keys configured or use HTTPS URL.');
        this.log('');
        process.exit(1);
      } else if (message.includes('Could not resolve host')) {
        this.log(chalk.red('✗ Network error'));
        this.log('');
        this.log('Check your internet connection and try again.');
        this.log('');
        process.exit(1);
      }

      // Generic error
      this.log(chalk.red('✗ Failed to add repository'));
      this.log('');
      this.log(chalk.dim(message));
      this.log('');
      process.exit(1);
    }
  }
}
