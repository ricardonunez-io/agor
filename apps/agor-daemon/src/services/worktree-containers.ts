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
import { deriveUnixUsername } from '../utils/container-user.js';

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
  appInternalPort?: number; // Port the app listens on inside container (from app_url)
  appExternalPort?: number; // Unique port exposed on host (calculated from unique_id)
}

/**
 * Options for user creation inside container
 */
interface CreateUserOptions {
  containerName: string;
  unixUsername: string;
  unixUid?: number;
  unixGid?: number;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  IMAGE: 'agor/workspace:latest',
  SSH_BASE_PORT: 2222,
  APP_BASE_PORT: 16000,
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
  getSSHHost(): string {
    return this.config.execution?.ssh?.host || this.config.daemon?.host || 'localhost';
  }

  /**
   * Calculate SSH port for a worktree
   */
  calculateSSHPort(worktreeUniqueId: number): number {
    return this.getSSHBasePort() + worktreeUniqueId;
  }

  /**
   * Get app base port from config
   */
  private getAppBasePort(): number {
    return this.config.execution?.app?.base_port || DEFAULTS.APP_BASE_PORT;
  }

  /**
   * Calculate external app port for a worktree
   * This is the unique port exposed on the host that maps to the app's internal port
   */
  calculateAppExternalPort(worktreeUniqueId: number): number {
    return this.getAppBasePort() + worktreeUniqueId;
  }

  /**
   * Get app host for external URLs (public IP or hostname)
   */
  getAppHost(): string {
    return this.config.execution?.app?.host || this.config.daemon?.host || 'localhost';
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
    const { worktreeId, worktreePath, repoPath, sshPort, appInternalPort, appExternalPort } = options;
    const containerName = this.generateContainerName(worktreeId);
    const image = this.getImage();
    const restartPolicy = this.config.execution?.containers?.restart_policy || DEFAULTS.RESTART_POLICY;

    console.log(`[Containers] Creating container ${containerName} for worktree ${worktreeId}`);
    if (appInternalPort && appExternalPort) {
      console.log(`[Containers] Exposing app port ${appExternalPort} -> ${appInternalPort}`);
    }

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
        // Expose app port: external (unique per worktree) -> internal (app's actual port)
        ...(appInternalPort && appExternalPort ? ['-p', `${appExternalPort}:${appInternalPort}`] : []),
        // Restart policy
        '--restart', restartPolicy,
        // Use tini as init to properly reap zombie processes
        '--init',
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

      // Fix the docker wrapper script to not use sudo (socket is world-writable)
      // Using single-quoted heredoc so $ signs are preserved literally in the script
      // Key: podman needs --url to query the system socket, not user storage
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `cat > /usr/local/bin/docker << 'DOCKERWRAPPER'
#!/bin/bash
export DOCKER_HOST=unix:///run/podman/podman.sock
if [ "$1" = "compose" ]; then
  shift
  exec /usr/local/bin/docker-compose "$@"
else
  exec /usr/bin/podman --url unix:///run/podman/podman.sock "$@"
fi
DOCKERWRAPPER`,
      ]).catch((error) => {
        console.warn(`[Containers] Failed to fix docker wrapper in ${containerName}:`, error);
      });

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
   * Recreate a container (destroy and create fresh)
   * This is useful when container state becomes corrupted or needs a clean slate.
   */
  async recreateContainer(worktreeId: WorktreeID): Promise<string> {
    const worktree = await this.worktreeRepo.findById(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    console.log(`[Containers] Recreating container for worktree ${worktreeId}`);

    // Destroy existing container (if any)
    await this.destroyContainer(worktreeId);

    // Get repo for repo path
    const repo = await (this.app.service('repos') as { get: (id: string) => Promise<{ local_path: string }> }).get(worktree.repo_id);

    // Calculate ports
    const sshPort = this.calculateSSHPort(worktree.worktree_unique_id);
    const appUrl = worktree.app_url;
    let appInternalPort: number | undefined;
    let appExternalPort: number | undefined;

    if (appUrl) {
      try {
        const url = new URL(appUrl);
        appInternalPort = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
        appExternalPort = this.calculateAppExternalPort(worktree.worktree_unique_id);
      } catch {
        // Invalid URL, skip port mapping
      }
    }

    // Create new container
    const containerName = await this.createContainer({
      worktreeId,
      worktreePath: worktree.path,
      repoPath: repo.local_path,
      sshPort,
      appInternalPort,
      appExternalPort,
    });

    // Sync owners to container
    await this.syncWorktreeOwners(worktreeId);

    console.log(`[Containers] Container ${containerName} recreated for worktree ${worktreeId}`);
    return containerName;
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
   * Note: SSH keys are set up separately when terminal is created
   */
  async createUserInContainer(options: CreateUserOptions): Promise<void> {
    const { containerName, unixUsername, unixUid, unixGid } = options;

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

      // Set DOCKER_HOST in user's profile so docker-compose finds the Podman socket
      // Using .profile instead of .bashrc because bashrc isn't sourced for non-interactive SSH
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `echo 'export DOCKER_HOST=unix:///run/podman/podman.sock' >> /home/${unixUsername}/.profile`,
      ]).catch(() => {
        // profile might not exist or be writable
      });

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

      // Grant user access to Podman socket via ACL (allows docker-compose without sudo)
      await this.dockerExec(containerName, [
        'setfacl',
        '-m',
        `u:${unixUsername}:rw`,
        '/run/podman/podman.sock',
      ]).catch((error) => {
        // ACL might not be available or socket might not exist yet
        console.warn(`[Containers] Failed to set ACL for ${unixUsername} on podman socket:`, error);
      });

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

    if (!user) {
      throw new Error('User not found');
    }

    // Use explicit unix_username or derive from email
    const username = user.unix_username || deriveUnixUsername(user.email);

    const host = this.getSSHHost();
    const port = this.calculateSSHPort(worktree.worktree_unique_id);

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

        if (user) {
          // Use explicit unix_username or derive from email
          const unixUsername = user.unix_username || deriveUnixUsername(user.email);
          await this.createUserInContainer({
            containerName,
            unixUsername,
            unixUid: user.unix_uid,
            unixGid: user.unix_gid,
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
