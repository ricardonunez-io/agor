/**
 * Worktree Containers Service
 *
 * Manages Docker container lifecycle for worktree isolation.
 * Each worktree gets its own container with:
 * - Isolated filesystem (worktree mounted at /workspace)
 * - Podman for docker-compose environments
 * - SSH access with GitHub key sync
 * - User accounts matching worktree owners
 *
 * @see context/explorations/isolated-terminal-containers.md
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { type Database, type WorktreeRepository, type UsersRepository, formatShortId } from '@agor/core/db';
import type { Application } from '@agor/core/feathers';
import type { AgorConfig } from '@agor/core/config';
import type { User, UserID, Worktree, WorktreeID } from '@agor/core/types';

/**
 * Container status
 */
export type ContainerStatus = 'creating' | 'running' | 'stopped' | 'removing' | 'error';

/**
 * SSH connection info returned by the API
 */
export interface SSHConnectionInfo {
  host: string;
  port: number;
  username: string;
  connection_string: string;
}

/**
 * Options for container creation
 */
interface CreateContainerOptions {
  worktreeId: WorktreeID;
  worktreePath: string;
  repoPath: string;
  sshPort: number;
}

/**
 * Options for user creation inside container
 */
interface CreateUserOptions {
  containerName: string;
  unixUsername: string;
  unixUid?: number;
  unixGid?: number;
  githubUsername?: string;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  IMAGE: 'agor/workspace:latest',
  SSH_BASE_PORT: 2222,
  RESTART_POLICY: 'unless-stopped' as const,
};

/**
 * WorktreeContainersService
 *
 * Manages Docker container lifecycle for worktrees.
 */
export class WorktreeContainersService {
  private db: Database;
  private app: Application;
  private config: AgorConfig;
  private worktreeRepo: WorktreeRepository;
  private userRepo: UsersRepository;

  constructor(
    db: Database,
    app: Application,
    config: AgorConfig,
    worktreeRepo: WorktreeRepository,
    userRepo: UsersRepository
  ) {
    this.db = db;
    this.app = app;
    this.config = config;
    this.worktreeRepo = worktreeRepo;
    this.userRepo = userRepo;
  }

  /**
   * Check if container isolation is enabled
   */
  isEnabled(): boolean {
    return this.config.execution?.container_isolation === true;
  }

  /**
   * Get container image from config
   */
  private getImage(): string {
    return this.config.execution?.containers?.image || DEFAULTS.IMAGE;
  }

  /**
   * Get SSH base port from config
   */
  private getSSHBasePort(): number {
    return this.config.execution?.ssh?.base_port || DEFAULTS.SSH_BASE_PORT;
  }

  /**
   * Get SSH host for connection strings
   */
  private getSSHHost(): string {
    return this.config.execution?.ssh?.host || this.config.daemon?.host || 'localhost';
  }

  /**
   * Calculate SSH port for a worktree
   */
  calculateSSHPort(worktreeUniqueId: number): number {
    return this.getSSHBasePort() + worktreeUniqueId;
  }

  /**
   * Generate container name from worktree ID
   */
  generateContainerName(worktreeId: WorktreeID): string {
    return `agor-wt-${formatShortId(worktreeId)}`;
  }

  /**
   * Create a container for a worktree
   */
  async createContainer(options: CreateContainerOptions): Promise<string> {
    const { worktreeId, worktreePath, repoPath, sshPort } = options;
    const containerName = this.generateContainerName(worktreeId);
    const image = this.getImage();
    const restartPolicy = this.config.execution?.containers?.restart_policy || DEFAULTS.RESTART_POLICY;

    console.log(`[Containers] Creating container ${containerName} for worktree ${worktreeId}`);

    try {
      // Build docker create command
      // Note: We mount the entire repo dir to support git operations.
      // Git worktrees have a .git file pointing to the main repo's .git/worktrees/<name>
      // By mounting the repo at /repo, git can follow the reference.
      // Container is fully isolated - no host agor access, tools installed in image.
      const args = [
        'create',
        '--name', containerName,
        '--hostname', containerName,
        // Mount worktree at /workspace
        '-v', `${worktreePath}:/workspace:rw`,
        // Mount main repo for git operations (worktree's .git file references this)
        '-v', `${repoPath}:/repo:rw`,
        // Expose SSH port
        '-p', `${sshPort}:22`,
        // Restart policy
        '--restart', restartPolicy,
        // Podman-in-Docker: Enable nested containers (for docker-compose via Podman)
        // These capabilities allow rootless Podman to create namespaces and cgroups
        '--privileged',
        // Labels for identification
        '--label', `agor.worktree_id=${worktreeId}`,
        '--label', 'agor.managed=true',
        // Resource limits (if configured)
        ...(this.config.execution?.containers?.resources?.memory
          ? ['--memory', this.config.execution.containers.resources.memory]
          : []),
        ...(this.config.execution?.containers?.resources?.cpus
          ? ['--cpus', this.config.execution.containers.resources.cpus]
          : []),
        // Extra volumes (if configured)
        ...(this.config.execution?.containers?.extra_volumes?.flatMap((v: { source: string; target: string; mode?: string }) => [
          '-v',
          `${v.source}:${v.target}:${v.mode || 'rw'}`,
        ]) || []),
        // Image
        image,
      ];

      await this.runDocker(args);

      // Start the container
      await this.runDocker(['start', containerName]);

      console.log(`[Containers] Container ${containerName} created and started`);
      return containerName;
    } catch (error) {
      console.error(`[Containers] Failed to create container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Destroy a container
   */
  async destroyContainer(worktreeId: WorktreeID): Promise<void> {
    const containerName = this.generateContainerName(worktreeId);

    // Check if container exists
    const isRunning = await this.isContainerRunning(containerName);
    const exists = isRunning || await this.containerExists(containerName);

    if (!exists) {
      console.log(`[Containers] No container ${containerName} for worktree ${worktreeId}`);
      return;
    }

    console.log(`[Containers] Destroying container ${containerName}`);

    try {
      // Stop the container (with timeout)
      await this.runDocker(['stop', '-t', '30', containerName]).catch(() => {
        // Container might already be stopped
      });

      // Remove the container
      await this.runDocker(['rm', '-f', containerName]);

      console.log(`[Containers] Container ${containerName} destroyed`);
    } catch (error) {
      console.error(`[Containers] Failed to destroy container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Check if a container exists (regardless of status)
   */
  async containerExists(containerName: string): Promise<boolean> {
    try {
      await this.runDocker(['inspect', containerName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure container is running (start if stopped)
   */
  async ensureContainerRunning(worktreeId: WorktreeID): Promise<string> {
    const containerName = this.generateContainerName(worktreeId);

    // Check if container exists
    const exists = await this.containerExists(containerName);
    if (!exists) {
      throw new Error(`No container ${containerName} for worktree ${worktreeId}`);
    }

    // Check if container is running
    const isRunning = await this.isContainerRunning(containerName);

    if (!isRunning) {
      console.log(`[Containers] Starting stopped container ${containerName}`);
      await this.runDocker(['start', containerName]);
    }

    return containerName;
  }

  /**
   * Check if a container is running
   */
  async isContainerRunning(containerName: string): Promise<boolean> {
    try {
      const result = await this.runDocker([
        'inspect',
        '-f',
        '{{.State.Running}}',
        containerName,
      ]);
      return result.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Create a user inside a container
   */
  async createUserInContainer(options: CreateUserOptions): Promise<void> {
    const { containerName, unixUsername, unixUid, unixGid, githubUsername } = options;

    console.log(`[Containers] Creating user ${unixUsername} in container ${containerName}`);

    try {
      // Create group if GID specified
      if (unixGid) {
        await this.dockerExec(containerName, [
          'groupadd',
          '-g',
          String(unixGid),
          unixUsername,
        ]).catch(() => {
          // Group might already exist
        });
      }

      // Create user with matching UID/GID
      const useraddArgs = [
        'useradd',
        '-m', // Create home directory
        '-s', '/bin/bash', // Default shell
      ];

      if (unixUid) {
        useraddArgs.push('-u', String(unixUid));
      }

      if (unixGid) {
        useraddArgs.push('-g', String(unixGid));
      }

      useraddArgs.push(unixUsername);

      await this.dockerExec(containerName, useraddArgs).catch(() => {
        // User might already exist
      });

      // Create agor directory structure in user's home
      await this.dockerExec(containerName, [
        'mkdir',
        '-p',
        `/home/${unixUsername}/agor/worktrees`,
      ]);

      // Symlink workspace
      await this.dockerExec(containerName, [
        'ln',
        '-sf',
        '/workspace',
        `/home/${unixUsername}/agor/worktrees/current`,
      ]);

      // Set ownership
      await this.dockerExec(containerName, [
        'chown',
        '-R',
        `${unixUsername}:${unixUsername}`,
        `/home/${unixUsername}`,
      ]);

      // Setup SSH keys if GitHub username is available
      if (githubUsername) {
        await this.setupUserSSHKeys(containerName, unixUsername, githubUsername);
      }

      console.log(`[Containers] User ${unixUsername} created in ${containerName}`);
    } catch (error) {
      console.error(`[Containers] Failed to create user ${unixUsername} in ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Remove a user from a container
   */
  async removeUserFromContainer(containerName: string, unixUsername: string): Promise<void> {
    console.log(`[Containers] Removing user ${unixUsername} from container ${containerName}`);

    try {
      await this.dockerExec(containerName, ['userdel', unixUsername]).catch(() => {
        // User might not exist
      });
    } catch (error) {
      console.error(`[Containers] Failed to remove user ${unixUsername} from ${containerName}:`, error);
    }
  }

  /**
   * Fetch SSH public keys from GitHub
   */
  async fetchGitHubSSHKeys(githubUsername: string): Promise<string[]> {
    try {
      const response = await fetch(`https://github.com/${githubUsername}.keys`);

      if (!response.ok) {
        console.warn(`[Containers] Failed to fetch SSH keys for ${githubUsername}: ${response.status}`);
        return [];
      }

      const keys = await response.text();
      return keys
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (error) {
      console.error(`[Containers] Error fetching SSH keys for ${githubUsername}:`, error);
      return [];
    }
  }

  /**
   * Setup SSH keys for a user in a container
   */
  async setupUserSSHKeys(
    containerName: string,
    unixUsername: string,
    githubUsername: string
  ): Promise<void> {
    const keys = await this.fetchGitHubSSHKeys(githubUsername);

    if (keys.length === 0) {
      console.log(`[Containers] No SSH keys found for ${githubUsername}`);
      return;
    }

    const sshDir = `/home/${unixUsername}/.ssh`;
    const authorizedKeysPath = `${sshDir}/authorized_keys`;

    console.log(`[Containers] Setting up ${keys.length} SSH keys for ${unixUsername} from GitHub (${githubUsername})`);

    try {
      // Create .ssh directory
      await this.dockerExec(containerName, ['mkdir', '-p', sshDir]);

      // Write authorized_keys (escape content properly)
      const authorizedKeysContent = keys.join('\n') + '\n';
      await this.dockerExec(containerName, [
        'bash',
        '-c',
        `cat > ${authorizedKeysPath} << 'AGOR_SSH_KEYS_EOF'
${authorizedKeysContent}
AGOR_SSH_KEYS_EOF`,
      ]);

      // Set correct permissions
      await this.dockerExec(containerName, ['chmod', '700', sshDir]);
      await this.dockerExec(containerName, ['chmod', '600', authorizedKeysPath]);
      await this.dockerExec(containerName, [
        'chown',
        '-R',
        `${unixUsername}:${unixUsername}`,
        sshDir,
      ]);

      console.log(`[Containers] SSH keys configured for ${unixUsername}`);
    } catch (error) {
      console.error(`[Containers] Failed to setup SSH keys for ${unixUsername}:`, error);
    }
  }

  /**
   * Refresh SSH keys for a user (re-fetch from GitHub)
   */
  async refreshUserSSHKeys(
    worktreeId: WorktreeID,
    userId: UserID
  ): Promise<void> {
    const containerName = this.generateContainerName(worktreeId);
    const user = await this.userRepo.findById(userId);

    // Check if container is running
    const isRunning = await this.isContainerRunning(containerName);
    if (!isRunning) {
      throw new Error('Worktree container not running');
    }

    if (!user?.unix_username || !user.github_username) {
      throw new Error('User does not have unix_username or github_username configured');
    }

    await this.setupUserSSHKeys(
      containerName,
      user.unix_username,
      user.github_username
    );
  }

  /**
   * Get SSH connection info for a worktree
   */
  async getSSHConnectionInfo(
    worktreeId: WorktreeID,
    userId: UserID
  ): Promise<SSHConnectionInfo> {
    const worktree = await this.worktreeRepo.findById(worktreeId);
    const user = await this.userRepo.findById(userId);

    if (!worktree) {
      throw new Error('Worktree not found');
    }

    if (!user?.unix_username) {
      throw new Error('User does not have unix_username configured');
    }

    const host = this.getSSHHost();
    const port = this.calculateSSHPort(worktree.worktree_unique_id);
    const username = user.unix_username;

    return {
      host,
      port,
      username,
      connection_string: `ssh ${username}@${host} -p ${port}`,
    };
  }

  /**
   * Sync all worktree owners to container users
   */
  async syncWorktreeOwners(worktreeId: WorktreeID): Promise<void> {
    const containerName = this.generateContainerName(worktreeId);

    // Check if container exists
    const exists = await this.containerExists(containerName);
    if (!exists) {
      console.log(`[Containers] No container for worktree ${worktreeId}, skipping owner sync`);
      return;
    }

    // Get worktree owners via the owners service
    try {
      const ownersService = this.app.service(`worktrees/${worktreeId}/owners`) as {
        find: () => Promise<Array<{ user_id: UserID }>>;
      };

      const owners = await ownersService.find();

      for (const owner of owners) {
        const user = await this.userRepo.findById(owner.user_id);

        if (user?.unix_username) {
          await this.createUserInContainer({
            containerName,
            unixUsername: user.unix_username,
            unixUid: user.unix_uid,
            unixGid: user.unix_gid,
            githubUsername: user.github_username,
          });
        }
      }
    } catch (error) {
      console.warn(`[Containers] Failed to sync owners for worktree ${worktreeId}:`, error);
    }
  }

  /**
   * Execute a command inside a container
   */
  private async dockerExec(containerName: string, command: string[]): Promise<string> {
    return this.runDocker(['exec', containerName, ...command]);
  }

  /**
   * Run a docker command
   */
  private runDocker(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const runtime = this.config.execution?.containers?.runtime || 'docker';
      const proc = spawn(runtime, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Docker command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }
}

/**
 * Create and configure the WorktreeContainersService
 */
export function createWorktreeContainersService(
  db: Database,
  app: Application,
  config: AgorConfig,
  worktreeRepo: WorktreeRepository,
  userRepo: UsersRepository
): WorktreeContainersService {
  return new WorktreeContainersService(db, app, config, worktreeRepo, userRepo);
}
