/**
 * Terminals Service
 *
 * Manages Zellij-based terminal sessions via executor processes.
 * REQUIRES Zellij to be installed on the system.
 *
 * Features:
 * - Full terminal emulation (vim, nano, htop, etc.)
 * - Job control (Ctrl+C, Ctrl+Z)
 * - ANSI colors and escape codes
 * - Persistent sessions via Zellij (survive daemon restarts)
 * - One executor per user, one Zellij tab per worktree
 *
 * Architecture:
 * - Executor process owns PTY running `zellij attach`
 * - PTY I/O streams over Feathers channels: user/${userId}/terminal
 * - Zellij handles session/tab multiplexing
 * - xterm.js frontend for rendering
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createUserProcessEnvironment,
  loadConfig,
  resolveUserEnvironment,
} from '@agor/core/config';
import { type Database, formatShortId, UsersRepository, WorktreeRepository } from '@agor/core/db';
import type { Application } from '@agor/core/feathers';
import type { AuthenticatedParams, UserID, WorktreeID } from '@agor/core/types';
import {
  resolveUnixUserForImpersonation,
  type UnixUserMode,
  UnixUserNotFoundError,
  validateResolvedUnixUser,
} from '@agor/core/unix';
import { deriveUnixUsername } from '../utils/container-user.js';
import { extractPortFromUrl } from '../utils/container-utils.js';
import { generateSessionToken, spawnExecutorFireAndForget } from '../utils/spawn-executor.js';

interface CreateTerminalData {
  rows?: number;
  cols?: number;
  worktreeId?: WorktreeID; // Worktree context for Zellij integration
}

/**
 * Check if Zellij is installed
 */
function isZellijAvailable(): boolean {
  try {
    execSync('which zellij', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Module-level flag tracking if Zellij warning has been shown */
let zellijWarningShown = false;

/**
 * Write user environment variables to a shell script
 * This allows shells spawned in Zellij tabs to source the env vars
 *
 * @param userId - User ID for naming the file
 * @param env - Environment variables to export
 * @param chownTo - Optional Unix username to chown the file to (for impersonation)
 * @returns Path to the env file, or null on error
 */
function writeEnvFile(
  userId: UserID | undefined,
  env: Record<string, string>,
  chownTo?: string | null
): string | null {
  if (!userId) return null;

  try {
    const tmpDir = os.tmpdir();
    const envFile = path.join(tmpDir, `agor-env-${userId.substring(0, 8)}.sh`);

    // Build shell script to export env vars
    const exportLines = Object.entries(env)
      .filter(([key]) => {
        // Skip system/shell env vars that shouldn't be overridden
        const skipKeys = ['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'OLDPWD', 'TERM', 'COLORTERM'];
        return !skipKeys.includes(key);
      })
      .map(([key, value]) => {
        // Escape single quotes in value
        const escapedValue = value.replace(/'/g, "'\\''");
        return `export ${key}='${escapedValue}'`;
      });

    const scriptContent = `#!/bin/sh
# Agor user environment variables
# Auto-generated - do not edit manually
${exportLines.join('\n')}
`;

    // Write file with restrictive permissions initially
    fs.writeFileSync(envFile, scriptContent, { mode: 0o600 });

    // If we're impersonating a user, chown the file to them so they can read it
    // Without this, impersonated users can't source the env file (permission denied)
    if (chownTo) {
      try {
        // CRITICAL: Use -n flag to prevent password prompts that freeze the system
        // Also add timeout to prevent any hangs
        execSync(`sudo -n chown "${chownTo}" "${envFile}"`, { stdio: 'pipe', timeout: 2000 });
      } catch (chownError) {
        console.warn(`Failed to chown env file to ${chownTo}:`, chownError);
        // Continue anyway - file may still be readable in some configurations
      }
    }

    return envFile;
  } catch (error) {
    console.warn('Failed to write user env file:', error);
    return null;
  }
}

/**
 * Terminals service - manages Zellij sessions via executor
 *
 * Architecture:
 * - One executor per user (spawned when user opens first terminal)
 * - Executor owns a single PTY running `zellij attach`
 * - Zellij manages multiple tabs (one per worktree)
 * - PTY I/O streams over Feathers channel: user/${userId}/terminal
 */
export class TerminalsService {
  private app: Application;
  private db: Database;

  /** Whether Zellij is available on this system */
  private zellijAvailable: boolean;

  constructor(app: Application, db: Database) {
    this.app = app;
    this.db = db;

    // Check if Zellij is available - warn but don't fail
    this.zellijAvailable = isZellijAvailable();

    if (!this.zellijAvailable) {
      if (!zellijWarningShown) {
        console.warn(
          '\x1b[33m⚠️  Zellij is not installed or not available in PATH.\x1b[0m\n' +
            'Terminal functionality will be unavailable.\n' +
            'To enable terminals, install Zellij:\n' +
            '  - Ubuntu/Debian: curl -L https://github.com/zellij-org/zellij/releases/latest/download/zellij-x86_64-unknown-linux-musl.tar.gz | tar -xz -C /usr/local/bin\n' +
            '  - macOS: brew install zellij\n' +
            '  - See: https://zellij.dev/documentation/installation'
        );
        zellijWarningShown = true;
      }
    } else {
      console.log('\x1b[36m✅ Zellij detected\x1b[0m - persistent terminal sessions enabled');
    }
  }

  /**
   * Create a new terminal session
   *
   * Spawns an executor with Zellij for persistent terminal sessions.
   * One executor per user, one Zellij tab per worktree.
   */
  async create(
    data: CreateTerminalData,
    params?: AuthenticatedParams
  ): Promise<{
    userId: UserID;
    worktreeId?: WorktreeID;
    channel: string;
    sessionName: string;
    isNew: boolean;
    worktreeName?: string;
  }> {
    // Check if Zellij is available
    if (!this.zellijAvailable) {
      throw new Error(
        'Terminal functionality is unavailable: Zellij is not installed.\n' +
          'Please install Zellij to enable terminal support.'
      );
    }

    return this.createExecutorTerminal(
      {
        worktreeId: data.worktreeId,
        cols: data.cols,
        rows: data.rows,
      },
      params
    );
  }

  /**
   * Cleanup all terminals on shutdown
   */
  cleanup(): void {
    this.cleanupExecutorTerminals();
  }

  /**
   * Active executor processes per user+worktree
   * Key: `${userId}:${worktreeId}` - each worktree gets its own executor
   * This ensures container isolation works (each container has its own executor)
   */
  private executorTerminals: Map<
    string,
    {
      sessionName: string;
      startedAt: Date;
    }
  > = new Map();

  /**
   * Create or join an executor-based terminal session
   *
   * - Spawns one executor per user (not per terminal)
   * - Uses Feathers channels for I/O
   * - Returns immediately (fire-and-forget spawn)
   *
   * The browser should join the user's terminal channel to receive output.
   */
  private async createExecutorTerminal(
    data: {
      worktreeId?: WorktreeID;
      cols?: number;
      rows?: number;
    },
    params?: AuthenticatedParams
  ): Promise<{
    userId: UserID;
    worktreeId?: WorktreeID;
    channel: string;
    sessionName: string;
    isNew: boolean;
    worktreeName?: string;
  }> {
    const userId = params?.user?.user_id as UserID;
    if (!userId) {
      throw new Error('Authentication required for executor terminal');
    }

    // Key by user+worktree so each worktree gets its own executor (important for container isolation)
    const executorKey = `${userId}:${data.worktreeId || 'default'}`;

    // Check if this user+worktree already has an executor running
    const existing = this.executorTerminals.get(executorKey);
    if (existing) {
      // Request screen redraw after a short delay to let client join channel first
      setTimeout(() => {
        this.app.io?.to(`user/${userId}/terminal`).emit('terminal:redraw', {
          userId,
          worktreeId: data.worktreeId
        });
      }, 200);

      // Get worktree name for display
      let worktreeName: string | undefined;
      if (data.worktreeId) {
        const worktreeRepo = new WorktreeRepository(this.db);
        const worktree = await worktreeRepo.findById(data.worktreeId);
        worktreeName = worktree?.name;
      }

      return {
        userId,
        worktreeId: data.worktreeId,
        channel: `user/${userId}/terminal`,
        sessionName: existing.sessionName,
        isNew: false,
        worktreeName,
      };
    }

    // Resolve Unix user for impersonation
    const config = await loadConfig();
    const unixUserMode = config.execution?.unix_user_mode ?? 'simple';
    const executorUser = config.execution?.executor_unix_user;

    let impersonatedUser: string | null = null;
    let userUnixUid: number | undefined;
    let userSshPublicKeys: string | undefined;
    let containerUsername: string = 'developer'; // Default for container execution
    const usersRepo = new UsersRepository(this.db);
    try {
      const user = await usersRepo.findById(userId);
      if (user?.unix_username) {
        impersonatedUser = user.unix_username;
        containerUsername = user.unix_username;
      } else if (user?.email) {
        // Derive Unix username from Agor user email
        // e.g., jose.garcia@company.com → jose_garcia
        containerUsername = deriveUnixUsername(user.email);
      }
      if (user?.unix_uid) {
        userUnixUid = user.unix_uid;
      }
      if (user?.ssh_public_keys) {
        userSshPublicKeys = user.ssh_public_keys;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load user ${userId}:`, error);
    }

    const impersonationResult = resolveUnixUserForImpersonation({
      mode: unixUserMode as UnixUserMode,
      userUnixUsername: impersonatedUser,
      executorUnixUser: executorUser,
    });

    const finalUnixUser = impersonationResult.unixUser;

    // Validate Unix user exists
    try {
      validateResolvedUnixUser(unixUserMode as UnixUserMode, finalUnixUser);
    } catch (err) {
      if (err instanceof UnixUserNotFoundError) {
        throw new Error(`${(err as UnixUserNotFoundError).message}`);
      }
      throw err;
    }

    // Determine cwd, worktree info, and container status
    let cwd = os.homedir();
    let worktreeName: string | undefined;
    let containerName: string | undefined;
    let containerRunning = false;
    let containerIsolationEnabled = config.execution?.container_isolation === true;

    if (data.worktreeId) {
      const worktreeRepo = new WorktreeRepository(this.db);
      const worktree = await worktreeRepo.findById(data.worktreeId);
      if (worktree) {
        worktreeName = worktree.name;

        // Create container on-demand if container isolation is enabled
        const containersService = (this.app as any).worktreeContainersService;
        if (containerIsolationEnabled && containersService) {
          // Derive container name from worktree ID
          containerName = containersService.generateContainerName(worktree.worktree_id);

          // Check if container exists and is running
          containerRunning = await containersService.isContainerRunning(containerName);
          const containerExists = containerRunning || await containersService.containerExists(containerName);

          // Create container if it doesn't exist
          if (!containerExists) {
            console.log(`[Terminals] Creating container on-demand for worktree ${worktree.name}`);
            try {
              const repo = await this.app.service('repos').get(worktree.repo_id);
              // Internal port: prefer health_check_url (where app actually listens), fall back to app_url
              const appInternalPort = extractPortFromUrl(worktree.health_check_url) || extractPortFromUrl(worktree.app_url);
              const appExternalPort = appInternalPort
                ? containersService.calculateAppExternalPort(worktree.worktree_unique_id)
                : undefined;
              // Create container - SSH port is dynamic, app port uses calculated value
              const result = await containersService.createContainer({
                worktreeId: worktree.worktree_id,
                worktreePath: worktree.path,
                repoPath: repo.local_path,
                appInternalPort,
                appExternalPort,
              });
              // Store dynamically assigned SSH port in worktree record
              await this.app.service('worktrees').patch(worktree.worktree_id, {
                ssh_port: result.sshPort,
                container_name: result.containerName,
              });
              containerRunning = true;
            } catch (error) {
              console.error(`[Terminals] Failed to create container:`, error);
              // Continue without container - fall back to host execution
              containerName = undefined;
            }
          } else if (!containerRunning) {
            // Container exists but is stopped - start it
            try {
              await containersService.ensureContainerRunning(worktree.worktree_id);
              containerRunning = true;
            } catch (error) {
              console.error(`[Terminals] Failed to start container:`, error);
              containerName = undefined;
            }
          }
        }

        // For container execution, cwd is always /workspace inside the container
        if (containerIsolationEnabled && containerName && containerRunning) {
          cwd = '/workspace';
        } else if (finalUnixUser) {
          const symlinkPath = `/home/${finalUnixUser}/agor/worktrees/${worktree.name}`;
          cwd = fs.existsSync(symlinkPath) ? symlinkPath : worktree.path;
        } else {
          cwd = worktree.path;
        }
      }
    }

    // Ensure user exists in container before spawning terminal
    // Uses the centralized createUserInContainer() which sets up:
    // - User account with home directory
    // - Shared AI session directory (~/.claude -> /workspace/.agor/claude/)
    // - Podman socket access
    if (containerIsolationEnabled && containerName && containerRunning) {
      const containersService = (this.app as any).worktreeContainersService;
      const runtime = config.execution?.containers?.runtime || 'docker';
      const userStartTime = Date.now();
      console.log(`[Terminals] Ensuring user '${containerUsername}' exists in container ${containerName}`);
      try {
        await containersService?.createUserInContainer({
          containerName,
          unixUsername: containerUsername,
          unixUid: userUnixUid,
        });
        console.log(`[Terminals] User creation took ${Date.now() - userStartTime}ms`);

        // Setup SSH keys if user has them configured
        if (userSshPublicKeys) {
          const sshDir = `/home/${containerUsername}/.ssh`;
          const keys = userSshPublicKeys
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && line.startsWith('ssh-'));

          if (keys.length > 0) {
            console.log(`[Terminals] Setting up ${keys.length} SSH key(s) for ${containerUsername}`);
            try {
              // Create .ssh directory
              execSync(`${runtime} exec ${containerName} mkdir -p ${sshDir}`, { stdio: 'pipe', timeout: 5000 });
              execSync(`${runtime} exec ${containerName} chmod 700 ${sshDir}`, { stdio: 'pipe', timeout: 5000 });

              // Write each key using printf (more portable than echo -e)
              const authorizedKeysPath = `${sshDir}/authorized_keys`;
              // Clear the file first
              execSync(`${runtime} exec ${containerName} sh -c "true > ${authorizedKeysPath}"`, { stdio: 'pipe', timeout: 5000 });
              // Append each key
              for (const key of keys) {
                // Escape single quotes in the key
                const escapedKey = key.replace(/'/g, "'\\''");
                execSync(`${runtime} exec ${containerName} sh -c "printf '%s\\n' '${escapedKey}' >> ${authorizedKeysPath}"`, { stdio: 'pipe', timeout: 5000 });
              }

              // Set permissions
              execSync(`${runtime} exec ${containerName} chmod 600 ${authorizedKeysPath}`, { stdio: 'pipe', timeout: 5000 });
              execSync(`${runtime} exec ${containerName} chown -R ${containerUsername}:${containerUsername} ${sshDir}`, { stdio: 'pipe', timeout: 5000 });

              console.log(`[Terminals] SSH keys configured for ${containerUsername}`);
            } catch (sshError) {
              console.warn(`[Terminals] SSH key setup failed for ${containerUsername}:`, sshError);
            }
          }
        }
      } catch (error) {
        console.warn(`[Terminals] User creation failed after ${Date.now() - userStartTime}ms (may already exist)`);
      }
    }

    // Build Zellij session name - include worktreeId for isolation
    const userSessionSuffix = formatShortId(userId);
    const worktreeSessionSuffix = data.worktreeId ? formatShortId(data.worktreeId) : 'default';
    const sessionName = `agor-${userSessionSuffix}-${worktreeSessionSuffix}`;

    // Determine spawn options based on container isolation
    const useContainerExecution = containerIsolationEnabled && containerName;

    // Generate session token for executor
    // For container execution, use host.docker.internal to reach the host daemon
    const daemonPort = config.daemon?.port || 3030;
    const daemonUrl = useContainerExecution
      ? `http://host.docker.internal:${daemonPort}`
      : `http://localhost:${daemonPort}`;
    const sessionToken = generateSessionToken(this.app);

    // Get user environment and write env file for shell sourcing
    const userEnv = await resolveUserEnvironment(userId, this.db);
    const envFile = writeEnvFile(userId, userEnv, finalUnixUser);

    // Get executor process environment (includes system vars)
    const executorEnv = await createUserProcessEnvironment(userId, this.db);

    const spawnStartTime = Date.now();
    console.log(`[Terminals] Spawning executor: container=${containerName || 'none'}, daemonUrl=${daemonUrl}, cwd=${cwd}`);

    // Spawn executor with zellij.attach command
    spawnExecutorFireAndForget(
      {
        command: 'zellij.attach',
        sessionToken,
        daemonUrl,
        params: {
          userId,
          worktreeId: data.worktreeId, // For event filtering
          sessionName,
          cwd,
          tabName: worktreeName,
          cols: data.cols || 160,
          rows: data.rows || 40,
          envFile: useContainerExecution ? undefined : envFile, // Don't use envFile in container mode
        },
      },
      {
        logPrefix: `[TerminalsService.executor ${userId.slice(0, 8)}]`,
        asUser: useContainerExecution ? undefined : (finalUnixUser || undefined), // Don't use asUser in container mode
        env: executorEnv,
        // Container execution options (only when worktree has a running container)
        containerExecution: useContainerExecution
          ? {
              containerName: containerName!,
              // Prefer UID for permission matching (consistent with NFS)
              // Fall back to derived/configured username
              containerUid: userUnixUid,
              containerUser: userUnixUid ? undefined : containerUsername,
              containerCwd: cwd,
              runtime: config.execution?.containers?.runtime || 'docker',
            }
          : undefined,
        // Clean up map when executor exits (handles crashes too)
        onExit: () => this.handleExecutorExit(executorKey),
      }
    );

    // Track the executor by user+worktree
    this.executorTerminals.set(executorKey, {
      sessionName,
      startedAt: new Date(),
    });

    console.log(`[Terminals] Executor spawned in ${Date.now() - spawnStartTime}ms, returning response`);

    return {
      userId,
      worktreeId: data.worktreeId,
      channel: `user/${userId}/terminal`,
      sessionName,
      isNew: true,
      worktreeName,
    };
  }

  /**
   * Close executor terminal for a worktree
   */
  async closeExecutorTerminal(
    data: { worktreeId?: WorktreeID },
    params?: AuthenticatedParams
  ): Promise<{ closed: boolean }> {
    const userId = params?.user?.user_id as UserID;
    if (!userId) {
      throw new Error('Authentication required');
    }

    const executorKey = `${userId}:${data.worktreeId || 'default'}`;
    if (!this.executorTerminals.has(executorKey)) {
      return { closed: false };
    }

    this.executorTerminals.delete(executorKey);
    return { closed: true };
  }

  /**
   * Cleanup executor terminals (called on daemon shutdown)
   */
  private cleanupExecutorTerminals(): void {
    // Executors manage their own lifecycle via Zellij
    // Just clear our tracking
    this.executorTerminals.clear();
  }

  /**
   * Handle executor terminal exit (called from channel event)
   */
  handleExecutorExit(executorKey: string): void {
    this.executorTerminals.delete(executorKey);
    console.log(`[TerminalsService] Executor terminal exited: ${executorKey}`);
  }
}
