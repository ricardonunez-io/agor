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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { type Database, type WorktreeRepository, type UsersRepository, formatShortId } from '@agor/core/db';
import type { Application } from '@agor/core/feathers';
import { type AgorConfig, createUserProcessEnvironment } from '@agor/core/config';
import type { User, UserID, Worktree, WorktreeID } from '@agor/core/types';
import { deriveUnixUsername } from '../utils/container-user.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the packages directory for mounting into containers
 * This allows executor to run inside container with SDK access
 */
function findPackagesPath(): string | undefined {
  const possiblePaths = [
    path.join(__dirname, '../../../../packages'), // From apps/agor-daemon/src/services
    path.join(__dirname, '../../../../../packages'), // Fallback
  ];
  return possiblePaths.find((p) => existsSync(p));
}

/**
 * Build filtered environment variables for container execution
 * Only includes user-defined vars from DB + standard API keys from host
 */
function buildContainerEnvVars(env: Record<string, string>): Record<string, string> {
  const containerEnv: Record<string, string> = {};

  // User-defined vars from database (tracked in AGOR_USER_ENV_KEYS)
  const userDefinedKeys = (env.AGOR_USER_ENV_KEYS || '').split(',').filter(Boolean);
  for (const key of userDefinedKeys) {
    if (env[key]) containerEnv[key] = env[key];
  }

  // Standard API keys from host environment
  const apiKeyNames = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN'];
  for (const key of apiKeyNames) {
    if (env[key] && !containerEnv[key]) containerEnv[key] = env[key];
  }

  return containerEnv;
}

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
  appInternalPort?: number; // Port the app listens on inside container (from app_url)
  appExternalPort?: number; // Unique port exposed on host (calculated from unique_id)
}

/**
 * Result of container creation with dynamically assigned SSH port
 */
interface CreateContainerResult {
  containerName: string;
  sshPort: number; // Dynamically assigned by Docker
}

/**
 * Options for user creation inside container
 */
interface CreateUserOptions {
  containerName: string;
  unixUsername: string;
  unixUid?: number;
  unixGid?: number;
  envVars?: Record<string, string>; // User-specific env vars (API keys, etc.)
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  IMAGE: 'agor/workspace:latest',
  SSH_BASE_PORT: 2222,
  APP_BASE_PORT: 16000,
  RESTART_POLICY: 'unless-stopped' as const,
  WORKSPACE_PATH: '/workspace',
  REPO_PATH: '/repo',
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
   * @deprecated SSH ports are now dynamically assigned by Docker. Use worktree.ssh_port instead.
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
   * This is the unique port exposed on the host that maps to the app's internal port.
   * Uses calculated port (base_port + unique_id) - not dynamically assigned like SSH.
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
   * Get workspace mount path inside container
   */
  getWorkspacePath(): string {
    return this.config.execution?.containers?.workspace_path || DEFAULTS.WORKSPACE_PATH;
  }

  /**
   * Get repo mount path inside container
   */
  getRepoPath(): string {
    return this.config.execution?.containers?.repo_path || DEFAULTS.REPO_PATH;
  }

  /**
   * Generate container name from worktree ID
   */
  generateContainerName(worktreeId: WorktreeID): string {
    return `agor-wt-${formatShortId(worktreeId)}`;
  }

  /**
   * Create a container for a worktree
   *
   * Uses dynamic port assignment - Docker picks available ports automatically.
   * Returns the dynamically assigned SSH port so it can be stored in the worktree record.
   */
  async createContainer(options: CreateContainerOptions): Promise<CreateContainerResult> {
    const { worktreeId, worktreePath, repoPath, appInternalPort, appExternalPort } = options;
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
      // By mounting the repo at the repo mount path, git can follow the reference.
      // Container is fully isolated - no host agor access, tools installed in image.
      //
      // SSH PORT: Dynamic assignment (-p 0:22) - Docker picks available port
      // APP PORT: Static assignment - uses calculated port from worktree_unique_id
      const workspaceMount = this.getWorkspacePath();
      const repoMount = this.getRepoPath();

      const args = [
        'create',
        '--name', containerName,
        '--hostname', containerName,
        // Mount worktree at workspace path
        '-v', `${worktreePath}:${workspaceMount}:rw`,
        // Mount main repo for git operations (worktree's .git file references this)
        '-v', `${repoPath}:${repoMount}:rw`,
        // Mount packages for executor SDK access (executor runs inside container)
        ...(findPackagesPath() ? ['-v', `${findPackagesPath()}:/app/packages:ro`] : []),
        // Expose SSH port - Docker picks available port (dynamic)
        '-p', '0:22',
        // Expose app port if configured - uses calculated external port (static)
        ...(appInternalPort && appExternalPort ? ['-p', `${appExternalPort}:${appInternalPort}`] : []),
        // Restart policy
        '--restart', restartPolicy,
        // Use tini as init to properly reap zombie processes
        '--init',
        // Podman-in-Docker: Enable nested containers (for docker-compose via Podman)
        // These capabilities allow rootless Podman to create namespaces and cgroups
        '--privileged',
        // Allow container to reach host services (daemon) via host.docker.internal
        '--add-host=host.docker.internal:host-gateway',
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

      // Query the dynamically assigned SSH port
      // `docker port <container> <port>` returns: 0.0.0.0:32768
      const sshPortOutput = await this.runDocker(['port', containerName, '22']);
      const sshPort = this.parsePortOutput(sshPortOutput);

      console.log(`[Containers] Container ${containerName} created with SSH port ${sshPort}`);

      // Fix git worktree .git file to use container paths instead of host paths
      // The .git file in worktrees contains: gitdir: /host/path/.git/worktrees/<name>
      // We need to rewrite it to: gitdir: <repoMount>/.git/worktrees/<name>
      const worktreeName = path.basename(worktreePath);
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `echo "gitdir: ${repoMount}/.git/worktrees/${worktreeName}" > ${workspaceMount}/.git`,
      ]).catch((error) => {
        console.warn(`[Containers] Failed to fix .git file in ${containerName}:`, error);
      });
      console.log(`[Containers] Fixed .git file to point to ${repoMount}/.git/worktrees/${worktreeName}`);

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
      return { containerName, sshPort };
    } catch (error) {
      console.error(`[Containers] Failed to create container ${containerName}:`, error);
      throw error;
    }
  }

  /**
   * Parse Docker port output to extract port number
   * Input format: "0.0.0.0:32768" or "0.0.0.0:32768\n"
   */
  private parsePortOutput(output: string): number {
    const match = output.trim().match(/:(\d+)$/);
    if (!match) {
      throw new Error(`Failed to parse port from Docker output: ${output}`);
    }
    return parseInt(match[1], 10);
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
   * Returns the new dynamically assigned ports.
   */
  async recreateContainer(worktreeId: WorktreeID): Promise<CreateContainerResult> {
    const worktree = await this.worktreeRepo.findById(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    console.log(`[Containers] Recreating container for worktree ${worktreeId}`);

    // Destroy existing container (if any)
    await this.destroyContainer(worktreeId);

    // Get repo for repo path
    const repo = await (this.app.service('repos') as { get: (id: string) => Promise<{ local_path: string }> }).get(worktree.repo_id);

    // Extract app internal port: prefer health_check_url (where app actually listens), fall back to app_url
    let appInternalPort: number | undefined;
    let appExternalPort: number | undefined;
    const portSourceUrl = worktree.health_check_url || worktree.app_url;
    if (portSourceUrl) {
      try {
        const url = new URL(portSourceUrl);
        appInternalPort = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
        appExternalPort = this.calculateAppExternalPort(worktree.worktree_unique_id);
      } catch {
        // Invalid URL, skip port mapping
      }
    }

    // Create new container - SSH port is dynamic, app port uses calculated value
    const result = await this.createContainer({
      worktreeId,
      worktreePath: worktree.path,
      repoPath: repo.local_path,
      appInternalPort,
      appExternalPort,
    });

    // Update worktree record with new ports
    await this.worktreeRepo.update(worktreeId, {
      ssh_port: result.sshPort,
      container_name: result.containerName,
    });

    // Sync owners to container
    await this.syncWorktreeOwners(worktreeId);

    console.log(`[Containers] Container ${result.containerName} recreated for worktree ${worktreeId}`);
    return result;
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

      // Fix git worktree .git file after container restart
      // The .git file may have stale host paths if container was recreated
      const worktree = await this.worktreeRepo.findById(worktreeId);
      if (worktree?.path) {
        const worktreeName = path.basename(worktree.path);
        const workspaceMount = this.getWorkspacePath();
        const repoMount = this.getRepoPath();
        await this.dockerExec(containerName, [
          'sh',
          '-c',
          `echo "gitdir: ${repoMount}/.git/worktrees/${worktreeName}" > ${workspaceMount}/.git`,
        ]).catch((error) => {
          console.warn(`[Containers] Failed to fix .git file in ${containerName}:`, error);
        });
      }
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
    const { containerName, unixUsername, unixUid, unixGid, envVars } = options;

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

      // Set DOCKER_HOST in user's profile so docker-compose finds the Podman socket
      // Using .profile instead of .bashrc because bashrc isn't sourced for non-interactive SSH
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `echo 'export DOCKER_HOST=unix:///run/podman/podman.sock' >> /home/${unixUsername}/.profile`,
      ]).catch(() => {
        // profile might not exist or be writable
      });

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

      // Add user to docker group for Podman socket access (backup to ACL)
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `getent group docker && usermod -aG docker ${unixUsername} || true`,
      ]).catch(() => {
        // Group might not exist
      });

      // Add workspace and repo to git safe.directory for this user
      // Required because mounted volumes may have different ownership
      const workspaceMount = this.getWorkspacePath();
      const repoMount = this.getRepoPath();
      await this.dockerExec(containerName, [
        'su',
        '-',
        unixUsername,
        '-c',
        `git config --global --add safe.directory ${workspaceMount} && git config --global --add safe.directory ${repoMount}`,
      ]).catch((error) => {
        console.warn(`[Containers] Failed to set git safe.directory for ${unixUsername}:`, error);
      });

      // =========================================================================
      // SHARED AI SESSION SETUP
      //
      // Create shared directories for AI session data so all users on the
      // worktree can collaborate on the same AI sessions.
      // - /home/shared/<tool>/ is world-writable (shared session data)
      // - ~/.<tool> symlinks to it (tools use ~/.<tool> by default)
      //
      // Uses /home/shared/ because:
      // - Semantically clear as shared location
      // - Persists across container restarts
      // - Not in /workspace so won't pollute the git repo
      //
      // Supported tools:
      // - Claude Code: ~/.claude/
      // - Codex: ~/.codex/
      // - Gemini: ~/.gemini/
      // =========================================================================
      const userHome = `/home/${unixUsername}`;
      const sharedBase = '/home/shared';
      const sharedTools = ['claude', 'codex', 'gemini'];

      // Create base shared directory
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `mkdir -p ${sharedBase} && chmod 777 ${sharedBase}`,
      ]).catch(() => {});

      for (const tool of sharedTools) {
        const sharedDir = `${sharedBase}/${tool}`;

        // Create shared directory (world-writable)
        await this.dockerExec(containerName, [
          'sh',
          '-c',
          `mkdir -p ${sharedDir} && chmod 777 ${sharedDir}`,
        ]).catch(() => {
          // Directory might already exist
        });

        // Remove existing ~/.<tool> (if any) and create symlink to shared directory
        await this.dockerExec(containerName, [
          'sh',
          '-c',
          `rm -rf ${userHome}/.${tool} && ln -sf ${sharedDir} ${userHome}/.${tool} && chown -h ${unixUsername}:${unixUsername} ${userHome}/.${tool}`,
        ]).catch((error) => {
          console.warn(`[Containers] Failed to setup shared ${tool} directory for ${unixUsername}:`, error);
        });
      }

      // =========================================================================
      // USER-SPECIFIC ENVIRONMENT VARIABLES
      //
      // Write env vars to user's ~/.agor-env (sourced by ~/.profile)
      // This makes API keys available in SSH sessions and login shells.
      // =========================================================================
      if (envVars && Object.keys(envVars).length > 0) {
        const envFile = `${userHome}/.agor-env`;
        const exportLines = Object.entries(envVars)
          .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
          .join('\n');

        // Write env file
        await this.dockerExec(containerName, [
          'sh',
          '-c',
          `printf '%s\\n' '${exportLines.replace(/'/g, "'\\''")}' > ${envFile} && chown ${unixUsername}:${unixUsername} ${envFile} && chmod 600 ${envFile}`,
        ]).catch((error) => {
          console.warn(`[Containers] Failed to write env vars for ${unixUsername}:`, error);
        });

        // Add source line to .profile if not already present
        await this.dockerExec(containerName, [
          'sh',
          '-c',
          `grep -q 'source.*\\.agor-env' ${userHome}/.profile 2>/dev/null || echo '[ -f ~/.agor-env ] && source ~/.agor-env' >> ${userHome}/.profile`,
        ]).catch((error) => {
          console.warn(`[Containers] Failed to update .profile for ${unixUsername}:`, error);
        });

        console.log(`[Containers] Wrote ${Object.keys(envVars).length} env vars to ${envFile}`);
      }

      console.log(`[Containers] User ${unixUsername} created in ${containerName} (with shared session setup for ${sharedTools.join(', ')})`);
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
   * Setup SSH keys for a user in a container
   */
  async setupUserSSHKeys(
    containerName: string,
    unixUsername: string,
    sshPublicKeys: string | null | undefined
  ): Promise<void> {
    if (!sshPublicKeys) {
      console.log(`[Containers] No SSH keys configured for ${unixUsername}`);
      return;
    }

    const keys = sshPublicKeys
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.startsWith('ssh-'));

    if (keys.length === 0) {
      console.log(`[Containers] No valid SSH keys found for ${unixUsername}`);
      return;
    }

    console.log(`[Containers] Setting up ${keys.length} SSH key(s) for ${unixUsername}`);

    const userHome = `/home/${unixUsername}`;
    const sshDir = `${userHome}/.ssh`;

    try {
      // Create .ssh directory with correct permissions
      await this.dockerExec(containerName, ['mkdir', '-p', sshDir]);
      await this.dockerExec(containerName, ['chmod', '700', sshDir]);

      // Write authorized_keys file
      const authorizedKeysContent = keys.join('\n') + '\n';
      await this.dockerExec(containerName, [
        'sh',
        '-c',
        `printf '%s' '${authorizedKeysContent.replace(/'/g, "'\\''")}' > ${sshDir}/authorized_keys`,
      ]);

      // Set permissions
      await this.dockerExec(containerName, ['chmod', '600', `${sshDir}/authorized_keys`]);
      await this.dockerExec(containerName, ['chown', '-R', `${unixUsername}:${unixUsername}`, sshDir]);

      console.log(`[Containers] SSH keys configured for ${unixUsername}`);
    } catch (error) {
      console.error(`[Containers] Failed to setup SSH keys for ${unixUsername}:`, error);
    }
  }

  /**
   * Refresh SSH keys for a user in a worktree container
   * Called when user updates their SSH keys
   */
  async refreshUserSSHKeys(worktreeId: WorktreeID, userId: UserID): Promise<void> {
    const containerName = this.generateContainerName(worktreeId);

    // Check if container is running
    const running = await this.isContainerRunning(containerName);
    if (!running) {
      console.log(`[Containers] Container not running for worktree ${worktreeId}, skipping SSH refresh`);
      return;
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const unixUsername = user.unix_username || deriveUnixUsername(user.email);

    // Ensure user exists
    await this.createUserInContainer({
      containerName,
      unixUsername,
      unixUid: user.unix_uid,
      unixGid: user.unix_gid,
    });

    // Setup SSH keys
    await this.setupUserSSHKeys(containerName, unixUsername, user.ssh_public_keys);
  }

  /**
   * Get SSH connection info for a worktree
   * Also ensures user exists and SSH keys are set up
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

    const containerName = this.generateContainerName(worktreeId);

    // Ensure container is running
    const running = await this.isContainerRunning(containerName);
    if (!running) {
      throw new Error('Container is not running. Start the container first.');
    }

    // Query the actual SSH port from Docker (in case container was restarted)
    let port: number;
    try {
      const sshPortOutput = await this.runDocker(['port', containerName, '22']);
      port = this.parsePortOutput(sshPortOutput);

      // Update worktree record if port changed
      if (port !== worktree.ssh_port) {
        console.log(`[Containers] SSH port changed from ${worktree.ssh_port} to ${port}, updating record`);
        await this.worktreeRepo.update(worktreeId, { ssh_port: port });
      }
    } catch (error) {
      // Fall back to stored port if query fails
      if (worktree.ssh_port) {
        port = worktree.ssh_port;
      } else {
        throw new Error('SSH port not configured and could not query container');
      }
    }

    // Build user's env vars for SSH access
    const fullEnv = await createUserProcessEnvironment(userId, this.db);
    const envVars = buildContainerEnvVars(fullEnv);

    // Create user and setup SSH keys when SSH info is requested
    console.log(`[Containers] Setting up user ${username} for SSH access`);
    await this.createUserInContainer({
      containerName,
      unixUsername: username,
      unixUid: user.unix_uid,
      unixGid: user.unix_gid,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    });

    // Setup SSH keys (only if user has keys configured)
    if (user.ssh_public_keys && user.ssh_public_keys.length > 0) {
      await this.setupUserSSHKeys(containerName, username, user.ssh_public_keys);
    } else {
      console.warn(`[Containers] User ${username} has no SSH public keys configured`);
    }

    const host = this.getSSHHost();

    return {
      host,
      port,
      username,
      connection_string: `ssh ${username}@${host} -p ${port}`,
    };
  }

  /**
   * Sync all worktree owners to container users
   * Only runs when worktree_rbac is enabled (owners service must exist)
   */
  async syncWorktreeOwners(worktreeId: WorktreeID): Promise<void> {
    // Skip if RBAC is disabled - owners service won't exist
    if (!this.config.execution?.worktree_rbac) {
      return;
    }

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
