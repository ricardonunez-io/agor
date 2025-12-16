/**
 * `agor worktree ssh <worktree-id>` - SSH into a worktree shell pod
 *
 * Connects to a shell pod via SSH using auto-generated keys.
 * Keys are stored in ~/.agor/ssh/agor-key and registered with the daemon on first use.
 *
 * Requirements:
 * - User must be logged in
 * - Daemon must be in pod mode (not daemon mode)
 * - Shell pod must be started for the worktree
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRestClient, isDaemonRunning } from '@agor/core/api';
import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { BaseCommand } from '../../base-command';
import { loadToken } from '../../lib/auth';

const SSH_DIR = join(homedir(), '.agor', 'ssh');
const PRIVATE_KEY_PATH = join(SSH_DIR, 'agor-key');
const PUBLIC_KEY_PATH = join(SSH_DIR, 'agor-key.pub');

export default class WorktreeSsh extends BaseCommand {
  static description = 'SSH into a worktree shell pod';

  static examples = [
    '<%= config.bin %> <%= command.id %> abc123',
    '<%= config.bin %> <%= command.id %> 01933e4a-b2c1-7890-a456-789012345678',
    '<%= config.bin %> <%= command.id %> abc123 --port 2222',
    '<%= config.bin %> <%= command.id %> abc123 --url https://agor.example.com',
  ];

  static flags = {
    url: Flags.string({
      char: 'u',
      description: 'Daemon URL (overrides config)',
      required: false,
    }),
    port: Flags.integer({
      char: 'p',
      description: 'SSH port to connect to (uses NodePort by default)',
      required: false,
    }),
    host: Flags.string({
      char: 'H',
      description: 'SSH host to connect to (uses cluster node by default)',
      required: false,
    }),
    'generate-key': Flags.boolean({
      description: 'Force regenerate SSH key pair',
      default: false,
    }),
  };

  static args = {
    worktreeId: Args.string({
      description: 'Worktree ID (full UUID or short ID)',
      required: true,
    }),
  };

  /**
   * Generate SSH key pair if it doesn't exist
   */
  private async ensureSshKey(forceRegenerate = false): Promise<{ publicKey: string; privateKeyPath: string }> {
    // Create SSH directory if needed
    if (!existsSync(SSH_DIR)) {
      mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
    }

    // Check if key already exists
    if (!forceRegenerate && existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
      const publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();
      return { publicKey, privateKeyPath: PRIVATE_KEY_PATH };
    }

    // Generate new key pair using ssh-keygen
    this.log(chalk.dim('Generating SSH key pair...'));

    return new Promise((resolve, reject) => {
      const keygenArgs = [
        '-t', 'ed25519',
        '-f', PRIVATE_KEY_PATH,
        '-N', '', // No passphrase
        '-C', 'agor-cli',
      ];

      const keygen = spawn('ssh-keygen', keygenArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      keygen.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      keygen.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ssh-keygen failed with code ${code}: ${stderr}`));
          return;
        }

        // Read the generated public key
        const publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();

        this.log(chalk.green('  SSH key pair generated'));
        this.log(chalk.dim(`  Private key: ${PRIVATE_KEY_PATH}`));
        this.log(chalk.dim(`  Public key: ${PUBLIC_KEY_PATH}`));

        resolve({ publicKey, privateKeyPath: PRIVATE_KEY_PATH });
      });

      keygen.on('error', (err) => {
        reject(new Error(`Failed to run ssh-keygen: ${err.message}`));
      });
    });
  }

  /**
   * Register public key with the daemon
   */
  private async registerSshKey(
    client: Awaited<ReturnType<typeof this.connectToDaemon>>,
    publicKey: string,
    worktreeId: string
  ): Promise<{
    success: boolean;
    message: string;
    sshInfo?: { serviceName: string; nodePort: number | null };
  }> {
    // Use fetch to call the custom route directly since Feathers client doesn't support custom routes well
    const response = await fetch(`${this.daemonUrl}/terminals/ssh/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Get the access token from the authenticated client
        'Authorization': `Bearer ${(await client.get('authentication'))?.accessToken}`,
      },
      body: JSON.stringify({ publicKey, worktreeId }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
      throw new Error(errorBody.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<{
      success: boolean;
      message: string;
      sshInfo?: { serviceName: string; nodePort: number | null };
    }>;
  }

  /**
   * Get SSH connection info from daemon
   */
  private async getSshInfo(
    client: Awaited<ReturnType<typeof this.connectToDaemon>>,
    worktreeId: string
  ): Promise<{
    available: boolean;
    serviceName?: string;
    nodePort?: number | null;
    message?: string;
  }> {
    const response = await fetch(`${this.daemonUrl}/terminals/ssh/${worktreeId}/info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${(await client.get('authentication'))?.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
      throw new Error(errorBody.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<{
      available: boolean;
      serviceName?: string;
      nodePort?: number | null;
      message?: string;
    }>;
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(WorktreeSsh);

    // Use custom URL if provided, otherwise use default from config
    let client;
    if (flags.url) {
      // Custom URL provided - connect directly
      this.daemonUrl = flags.url;
      const running = await isDaemonRunning(flags.url);
      if (!running) {
        this.error(
          chalk.red(`✗ Daemon not reachable at ${flags.url}`) +
            '\n\n' +
            chalk.dim('Check that the URL is correct and the daemon is running.')
        );
      }
      client = await createRestClient(flags.url);

      // Load stored token and authenticate
      const storedAuth = await loadToken();
      if (storedAuth) {
        try {
          await client.authenticate({
            strategy: 'jwt',
            accessToken: storedAuth.accessToken,
          });
        } catch {
          this.error(
            chalk.red('✗ Authentication failed') +
              '\n\n' +
              chalk.dim('Your session may have expired. Please login again:') +
              '\n  ' +
              chalk.cyan('agor login')
          );
        }
      } else {
        this.error(
          chalk.red('✗ Not authenticated') +
            '\n\n' +
            chalk.dim('Please login first:') +
            '\n  ' +
            chalk.cyan('agor login')
        );
      }
    } else {
      // Use default daemon URL from config
      client = await this.connectToDaemon();
    }

    // Show which daemon we're connected to
    this.log(chalk.dim(`Connected to daemon at ${this.daemonUrl}`));

    try {
      // Ensure we have an SSH key
      const { publicKey, privateKeyPath } = await this.ensureSshKey(flags['generate-key']);

      // Get worktree info to get the user's unix_username
      const worktreesService = client.service('worktrees');
      let worktree;
      try {
        worktree = await worktreesService.get(args.worktreeId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.cleanupClient(client);
        this.error(`Worktree not found: ${args.worktreeId}\n${chalk.dim(`Error: ${errorMessage}`)}`);
        return; // TypeScript control flow - this.error() throws but TS doesn't know
      }

      this.log('');
      this.log(chalk.bold.cyan(`Connecting to worktree: ${worktree.name}`));
      this.log('');

      // Register SSH key with daemon (idempotent - won't duplicate if already registered)
      this.log(chalk.dim('Registering SSH key...'));
      const registerResult = await this.registerSshKey(client, publicKey, args.worktreeId);

      if (!registerResult.success) {
        await this.cleanupClient(client);
        this.error(registerResult.message);
      }

      this.log(chalk.green(`  ${registerResult.message}`));

      // Get SSH connection info
      let nodePort = flags.port;
      let sshHost = flags.host;

      if (!nodePort && registerResult.sshInfo?.nodePort) {
        nodePort = registerResult.sshInfo.nodePort;
      }

      if (!nodePort) {
        // Try to get SSH info from daemon
        const sshInfo = await this.getSshInfo(client, args.worktreeId);
        if (!sshInfo.available) {
          await this.cleanupClient(client);
          this.error(sshInfo.message || 'SSH not available for this worktree');
        }
        nodePort = sshInfo.nodePort || undefined;
      }

      if (!nodePort) {
        await this.cleanupClient(client);
        this.error('Could not determine SSH port. Please specify with --port');
      }

      // Default host is localhost (for local development/port-forward) or cluster node
      if (!sshHost) {
        // Try to detect if we're running inside the cluster or outside
        // For now, default to localhost (assumes port-forward or NodePort access)
        sshHost = 'localhost';
      }

      // Get the user's Unix username from their profile
      const usersService = client.service('users');
      const auth = await client.get('authentication');
      const userId = auth?.user?.user_id;

      if (!userId) {
        await this.cleanupClient(client);
        this.error('Could not determine user ID. Please ensure you are logged in.');
      }

      const user = await usersService.get(userId);
      const unixUsername = user?.unix_username;

      if (!unixUsername) {
        await this.cleanupClient(client);
        this.error('Your user account does not have a Unix username configured. Contact your administrator.');
      }

      this.log('');
      this.log(chalk.bold('SSH Connection:'));
      this.log(chalk.dim(`  User:     ${unixUsername}`));
      this.log(chalk.dim(`  Host:     ${sshHost}`));
      this.log(chalk.dim(`  Port:     ${nodePort}`));
      this.log(chalk.dim(`  Key:      ${privateKeyPath}`));
      this.log('');

      // Close the Feathers client before spawning SSH
      await this.cleanupClient(client);

      // Spawn SSH with the connection details
      this.log(chalk.cyan('Connecting via SSH...'));
      this.log('');

      const sshArgs = [
        '-i', privateKeyPath,
        '-p', nodePort.toString(),
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        `${unixUsername}@${sshHost}`,
      ];

      const ssh = spawn('ssh', sshArgs, {
        stdio: 'inherit', // Inherit stdin/stdout/stderr for interactive session
      });

      ssh.on('close', (code) => {
        process.exit(code || 0);
      });

      ssh.on('error', (err) => {
        this.error(`Failed to start SSH: ${err.message}`);
      });

    } catch (error) {
      await this.cleanupClient(client);
      this.error(
        `SSH connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
