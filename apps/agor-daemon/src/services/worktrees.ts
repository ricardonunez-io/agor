/**
 * Worktrees Service
 *
 * Provides REST + WebSocket API for worktree management.
 * Uses DrizzleService adapter with WorktreeRepository.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { type AgorConfig, createUserProcessEnvironment, ENVIRONMENT, PAGINATION } from '@agor/core/config';
import { type Database, WorktreeRepository, UsersRepository } from '@agor/core/db';
import type { Application } from '@agor/core/feathers';
import type {
  AuthenticatedParams,
  BoardID,
  QueryParams,
  Repo,
  UserID,
  UUID,
  Worktree,
  WorktreeID,
} from '@agor/core/types';
import { getNextRunTime, validateCron } from '@agor/core/utils/cron';
import { DrizzleService } from '../adapters/drizzle';
import { extractPortFromUrl } from '../utils/container-utils.js';
import { getDaemonUrl, spawnExecutor } from '../utils/spawn-executor.js';

/**
 * Build log file path for a worktree
 */
function getBuildLogPath(worktreePath: string): string {
  return join(worktreePath, '.agor', 'build.log');
}

/**
 * Run a command and capture output to a log file
 * Output is also streamed to console for daemon visibility
 */
async function runCommandWithLogs(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
  label: string; // e.g., "start", "stop", "nuke"
}): Promise<void> {
  const { command, cwd, env, logPath, label } = options;

  // Ensure .agor directory exists
  await mkdir(dirname(logPath), { recursive: true });

  // Open log file for appending
  const logStream = createWriteStream(logPath, { flags: 'a' });

  // Write header
  const header = `\n=== ${label.toUpperCase()} ===\nCommand: ${command}\nCWD: ${cwd}\nStarted: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;
  logStream.write(header);
  console.log(header.trim());

  return new Promise<void>((resolve, reject) => {
    const childProcess = spawn(command, {
      cwd,
      shell: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Pipe stdout to log file and console
    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      logStream.write(text);
      process.stdout.write(text);
    });

    // Pipe stderr to log file and console
    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      logStream.write(text);
      process.stderr.write(text);
    });

    childProcess.on('exit', (code) => {
      const footer = `\n${'='.repeat(50)}\nExit code: ${code}\nFinished: ${new Date().toISOString()}\n`;
      logStream.write(footer);
      logStream.end();
      console.log(footer.trim());

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} command exited with code ${code}`));
      }
    });

    childProcess.on('error', (error) => {
      const errorMsg = `\n${'='.repeat(50)}\nError: ${error.message}\n`;
      logStream.write(errorMsg);
      logStream.end();
      reject(error);
    });
  });
}

/**
 * Worktree service params
 */
export type WorktreeParams = QueryParams<{
  repo_id?: UUID;
  name?: string;
  ref?: string;
  deleteFromFilesystem?: boolean;
}>;

/**
 * Process tracking for environment management
 */
interface ManagedProcess {
  process: ChildProcess;
  pid: number;
  worktreeId: WorktreeID;
  startedAt: Date;
  logPath: string;
}

/**
 * Extended worktrees service with custom methods
 */
export class WorktreesService extends DrizzleService<Worktree, Partial<Worktree>, WorktreeParams> {
  private worktreeRepo: WorktreeRepository;
  private db: Database;
  private app: Application;
  private config: AgorConfig;
  private processes = new Map<WorktreeID, ManagedProcess>();
  // Cache board-objects service reference (lazy-loaded to avoid circular deps)
  private boardObjectsService?: {
    findByWorktreeId: (worktreeId: WorktreeID) => Promise<unknown>;
    create: (data: unknown) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };

  constructor(db: Database, app: Application, config: AgorConfig) {
    const worktreeRepo = new WorktreeRepository(db);
    super(worktreeRepo, {
      id: 'worktree_id',
      resourceType: 'Worktree',
      paginate: {
        default: PAGINATION.DEFAULT_LIMIT,
        max: PAGINATION.MAX_LIMIT,
      },
    });

    this.worktreeRepo = worktreeRepo;
    this.db = db;
    this.app = app;
    this.config = config;
  }

  /**
   * Get board-objects service (lazy-loaded to prevent circular dependencies)
   * FIX: Cache service reference instead of calling this.app.service() repeatedly
   */
  private getBoardObjectsService() {
    if (!this.boardObjectsService) {
      this.boardObjectsService = this.app.service('board-objects') as unknown as {
        findByWorktreeId: (worktreeId: WorktreeID) => Promise<unknown>;
        create: (data: unknown) => Promise<unknown>;
        remove: (id: string) => Promise<unknown>;
      };
    }
    return this.boardObjectsService;
  }

  /**
   * Transform worktree for container isolation:
   * - ssh_host: add SSH host from config
   * - ssh_port: already stored in DB (dynamically assigned when container created)
   * - app_url: transform to use external host and calculated port
   */
  private transformForContainerIsolation(worktree: Worktree): Worktree {
    const containerIsolationEnabled = this.config.execution?.container_isolation === true;
    const containersService = (this.app as any).worktreeContainersService;

    if (!containerIsolationEnabled || !containersService) {
      return worktree;
    }

    let transformed = { ...worktree };

    // Add SSH host from config (port is already stored in DB from container creation)
    if (worktree.ssh_port) {
      transformed.ssh_host = containersService.getSSHHost();
    }

    // Transform app_url if present (uses calculated port from worktree_unique_id)
    if (worktree.app_url) {
      const internalPort = extractPortFromUrl(worktree.app_url);
      if (internalPort) {
        const externalPort = containersService.calculateAppExternalPort(worktree.worktree_unique_id);
        const externalHost = containersService.getAppHost();

        // Parse and rebuild URL with external host and port
        try {
          const url = new URL(worktree.app_url);
          url.hostname = externalHost;
          url.port = String(externalPort);
          transformed.app_url = url.toString();
        } catch {
          // Fallback: simple string replacement
          transformed.app_url = worktree.app_url
            .replace(/localhost|127\.0\.0\.1/, externalHost)
            .replace(`:${internalPort}`, `:${externalPort}`);
        }
      }
    }

    return transformed;
  }

  /**
   * Override get to transform app_url with external port
   */
  async get(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await super.get(id, params);
    return this.transformForContainerIsolation(worktree);
  }

  /**
   * Override patch to handle board_objects when board_id changes and schedule validation
   */
  async patch(id: WorktreeID, data: Partial<Worktree>, params?: WorktreeParams): Promise<Worktree> {
    // Get current worktree to check if board_id is changing
    const currentWorktree = await this.get(id, params);
    const oldBoardId = currentWorktree.board_id;
    const boardIdProvided = Object.hasOwn(data, 'board_id');
    const newBoardId = data.board_id;

    // ===== SCHEDULER VALIDATION =====

    // Validate cron expression if schedule_cron is being updated
    if (data.schedule_cron !== undefined && data.schedule_cron !== null) {
      try {
        validateCron(data.schedule_cron);
      } catch (error) {
        throw new Error(
          `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Compute next_run_at if cron is valid
      try {
        const nextRunAt = getNextRunTime(data.schedule_cron);
        data.schedule_next_run_at = nextRunAt;
      } catch (error) {
        console.error('Failed to compute next_run_at:', error);
        // Don't fail the patch if next_run_at computation fails
        // Scheduler will handle it on next tick
      }
    }

    // If schedule_enabled is being set to true, ensure schedule config exists
    if (data.schedule_enabled === true && !currentWorktree.schedule && !data.schedule) {
      throw new Error(
        'Cannot enable schedule without schedule configuration. Please provide schedule config in data.schedule.'
      );
    }

    // If schedule_enabled is being set to false, clear next_run_at
    if (data.schedule_enabled === false) {
      data.schedule_next_run_at = undefined;
    }

    // Call parent patch, but suppress its emit so we can emit transformed data
    const originalEmit = this.emit;
    this.emit = undefined;
    const updatedWorktree = (await super.patch(id, data, params)) as Worktree;
    this.emit = originalEmit;

    // Transform and emit the result with correct external URLs
    const transformedWorktree = this.transformForContainerIsolation(updatedWorktree);
    this.emit?.('patched', transformedWorktree, params);

    // Handle board_objects changes if board_id changed
    if (!boardIdProvided) {
      return transformedWorktree;
    }

    if (oldBoardId !== newBoardId) {
      const boardObjectsService = this.getBoardObjectsService();

      try {
        // First, check if a board_object already exists
        const existingObject = (await boardObjectsService.findByWorktreeId(id)) as {
          object_id: string;
        } | null;

        if (existingObject) {
          // Board object exists - delete it first
          await boardObjectsService.remove(existingObject.object_id);
        }

        // Now create new board_object if board_id is set
        if (newBoardId) {
          await boardObjectsService.create({
            board_id: newBoardId,
            worktree_id: id,
            position: { x: 100, y: 100 }, // Default position
          });
        }
      } catch (error) {
        console.error(
          `❌ Failed to manage board_objects for worktree ${id}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Don't throw - allow worktree patch to succeed even if board_object management fails
      }
    }

    return transformedWorktree;
  }

  /**
   * Override find to support repo_id filter and transform app_url with external port
   */
  async find(params?: WorktreeParams) {
    const { repo_id } = params?.query || {};

    // If repo_id filter is provided, use repository method
    if (repo_id) {
      const worktrees = await this.worktreeRepo.findAll({ repo_id });
      const transformedWorktrees = worktrees.map((w) => this.transformForContainerIsolation(w));

      // Return with pagination if enabled
      if (this.paginate) {
        return {
          total: transformedWorktrees.length,
          limit: params?.query?.$limit || this.paginate.default || 50,
          skip: params?.query?.$skip || 0,
          data: transformedWorktrees,
        };
      }

      return transformedWorktrees;
    }

    // Otherwise, use default find and transform results
    const result = await super.find(params);

    if (Array.isArray(result)) {
      return result.map((w) => this.transformForContainerIsolation(w));
    }

    return {
      ...result,
      data: result.data.map((w) => this.transformForContainerIsolation(w)),
    };
  }

  /**
   * Override remove to support filesystem deletion
   *
   * Delegates filesystem removal to executor for Unix isolation.
   */
  async remove(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const { deleteFromFilesystem } = params?.query || {};

    // Get worktree details before deletion
    const worktree = await this.get(id, params);

    // Remove from database FIRST for instant UI feedback
    // CASCADE will clean up related comments automatically
    const result = await super.remove(id, params);

    // Then remove from filesystem via executor (fire-and-forget)
    // Executor handles its own logging and error reporting via Feathers
    if (deleteFromFilesystem) {
      console.log(`🗑️  Spawning executor to remove worktree from filesystem: ${worktree.path}`);

      // Generate session token for executor authentication
      const userId = (params as AuthenticatedParams | undefined)?.user?.user_id as
        | UserID
        | undefined;
      const appWithToken = this.app as unknown as {
        sessionTokenService?: import('../services/session-token-service').SessionTokenService;
      };

      // Generate token and spawn executor (fire-and-forget)
      appWithToken.sessionTokenService
        ?.generateToken('worktree-remove', userId || 'anonymous')
        .then((sessionToken) => {
          spawnExecutor(
            {
              command: 'git.worktree.remove',
              sessionToken,
              daemonUrl: getDaemonUrl(),
              params: {
                worktreeId: worktree.worktree_id,
                worktreePath: worktree.path,
                deleteDbRecord: false, // Already deleted above
              },
            },
            {
              logPrefix: `[WorktreesService.remove ${worktree.name}]`,
            }
          );
        })
        .catch((error) => {
          console.error(
            `⚠️  Failed to generate session token for worktree removal:`,
            error instanceof Error ? error.message : String(error)
          );
        });
    }

    return result as Worktree;
  }

  /**
   * Custom method: Archive or delete worktree with filesystem options
   *
   * This method implements the archive/delete modal functionality.
   * Supports both soft delete (archive) and hard delete, with granular filesystem control.
   *
   * @param id - Worktree ID
   * @param options - Archive/delete configuration
   * @param params - Query params
   */
  async archiveOrDelete(
    id: WorktreeID,
    options: {
      metadataAction: 'archive' | 'delete';
      filesystemAction: 'preserved' | 'cleaned' | 'deleted';
    },
    params?: WorktreeParams
  ): Promise<Worktree | { deleted: true; worktree_id: WorktreeID }> {
    const { metadataAction, filesystemAction } = options;
    const worktree = await this.get(id, params);
    const currentUserId = 'anonymous' as UUID; // TODO: Get from auth context

    // Stop environment if running
    if (worktree.environment_instance?.status === 'running') {
      console.log(`⚠️  Stopping environment for worktree ${worktree.name} before ${metadataAction}`);
      try {
        await this.stopEnvironment(id, params);
      } catch (error) {
        console.warn(
          `Failed to stop environment, continuing with ${metadataAction}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Perform filesystem action via executor (fire-and-forget)
    // Executor handles its own logging and error reporting via Feathers
    // Using executor ensures proper Unix isolation for file operations
    const userId = (params as AuthenticatedParams | undefined)?.user?.user_id as UserID | undefined;
    const appWithToken = this.app as unknown as {
      sessionTokenService?: import('../services/session-token-service').SessionTokenService;
    };

    if (filesystemAction === 'cleaned') {
      console.log(`🧹 Spawning executor to clean worktree filesystem: ${worktree.path}`);
      appWithToken.sessionTokenService
        ?.generateToken('worktree-clean', userId || 'anonymous')
        .then((sessionToken) => {
          spawnExecutor(
            {
              command: 'git.worktree.clean',
              sessionToken,
              daemonUrl: getDaemonUrl(),
              params: {
                worktreePath: worktree.path,
              },
            },
            {
              logPrefix: `[WorktreesService.clean ${worktree.name}]`,
            }
          );
        })
        .catch((error) => {
          console.error(
            `⚠️  Failed to generate session token for worktree cleaning:`,
            error instanceof Error ? error.message : String(error)
          );
        });
    } else if (filesystemAction === 'deleted') {
      console.log(`🗑️  Spawning executor to delete worktree from filesystem: ${worktree.path}`);
      appWithToken.sessionTokenService
        ?.generateToken('worktree-delete', userId || 'anonymous')
        .then((sessionToken) => {
          spawnExecutor(
            {
              command: 'git.worktree.remove',
              sessionToken,
              daemonUrl: getDaemonUrl(),
              params: {
                worktreeId: worktree.worktree_id,
                worktreePath: worktree.path,
                deleteDbRecord: false, // Daemon handles DB deletion separately
              },
            },
            {
              logPrefix: `[WorktreesService.delete ${worktree.name}]`,
            }
          );
        })
        .catch((error) => {
          console.error(
            `⚠️  Failed to generate session token for worktree deletion:`,
            error instanceof Error ? error.message : String(error)
          );
        });
    }

    // Metadata action: archive or delete
    if (metadataAction === 'archive') {
      // Archive: Soft delete worktree and cascade to sessions
      console.log(`📦 Archiving worktree: ${worktree.name} (filesystem: ${filesystemAction})`);

      // Update worktree
      const archivedWorktree = await this.patch(
        id,
        {
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: currentUserId,
          filesystem_status: filesystemAction,
          board_id: undefined, // Remove from board
          updated_at: new Date().toISOString(),
        },
        params
      );

      // Archive all sessions in this worktree
      const sessionsService = this.app.service('sessions');
      const sessionsResult = await sessionsService.find({
        ...params,
        query: { worktree_id: id, $limit: 1000 },
        paginate: false,
      });
      const sessions = Array.isArray(sessionsResult) ? sessionsResult : sessionsResult.data;

      for (const session of sessions) {
        await sessionsService.patch(
          session.session_id,
          {
            archived: true,
            archived_reason: 'worktree_archived',
          },
          params
        );
      }

      console.log(`✅ Archived worktree ${worktree.name} and ${sessions.length} session(s)`);
      return archivedWorktree as Worktree;
    } else {
      // Delete: Hard delete (CASCADE will remove sessions, messages, tasks)
      console.log(`🗑️  Permanently deleting worktree: ${worktree.name}`);

      await this.remove(id, params);

      console.log(`✅ Permanently deleted worktree ${worktree.name}`);
      return { deleted: true, worktree_id: id };
    }
  }

  /**
   * Custom method: Unarchive a worktree
   */
  async unarchive(
    id: WorktreeID,
    options?: { boardId?: BoardID },
    params?: WorktreeParams
  ): Promise<Worktree> {
    const worktree = await this.get(id, params);

    if (!worktree.archived) {
      throw new Error(`Worktree ${worktree.name} is not archived`);
    }

    console.log(`📦 Unarchiving worktree: ${worktree.name}`);

    // Update worktree - clear archive metadata
    const unarchivedWorktree = await this.patch(
      id,
      {
        archived: false,
        archived_at: undefined,
        archived_by: undefined,
        filesystem_status: undefined,
        board_id: options?.boardId, // Optionally restore to board
        updated_at: new Date().toISOString(),
      },
      params
    );

    // Unarchive all sessions that were archived due to worktree archival
    const sessionsService = this.app.service('sessions');
    const sessionsResult = await sessionsService.find({
      ...params,
      query: {
        worktree_id: id,
        archived: true,
        archived_reason: 'worktree_archived',
        $limit: 1000,
      },
      paginate: false,
    });
    const sessions = Array.isArray(sessionsResult) ? sessionsResult : sessionsResult.data;

    for (const session of sessions) {
      await sessionsService.patch(
        session.session_id,
        {
          archived: false,
          archived_reason: undefined,
        },
        params
      );
    }

    console.log(`✅ Unarchived worktree ${worktree.name} and ${sessions.length} session(s)`);
    return unarchivedWorktree as Worktree;
  }

  /**
   * Custom method: Find worktree by repo_id and name
   */
  async findByRepoAndName(
    repoId: UUID,
    name: string,
    _params?: WorktreeParams
  ): Promise<Worktree | null> {
    return this.worktreeRepo.findByRepoAndName(repoId, name);
  }

  /**
   * Custom method: Add worktree to board
   *
   * Phase 0: Sets board_id on worktree
   * Phase 1: Will also create board_object entry for positioning
   */
  async addToBoard(id: WorktreeID, boardId: UUID, params?: WorktreeParams): Promise<Worktree> {
    // Set worktree.board_id
    const worktree = await this.patch(
      id,
      {
        board_id: boardId,
        updated_at: new Date().toISOString(),
      },
      params
    );

    // TODO (Phase 1): Create board_object entry for positioning
    // await this.app.service('board-objects').create({
    //   board_id: boardId,
    //   object_type: 'worktree',
    //   worktree_id: id,
    //   position: { x: 100, y: 100 }, // Default position
    // });

    return worktree as Worktree;
  }

  /**
   * Custom method: Remove worktree from board
   *
   * Phase 0: Clears board_id on worktree
   * Phase 1: Will also remove board_object entry
   */
  async removeFromBoard(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    // Clear worktree.board_id
    const worktree = await this.patch(
      id,
      {
        board_id: undefined,
        updated_at: new Date().toISOString(),
      },
      params
    );

    // TODO (Phase 1): Remove board_object entry
    // const objects = await this.app.service('board-objects').find({
    //   query: { worktree_id: id },
    // });
    // for (const obj of objects.data) {
    //   await this.app.service('board-objects').remove(obj.object_id);
    // }

    return worktree as Worktree;
  }

  /**
   * Custom method: Update environment status
   */
  async updateEnvironment(
    id: WorktreeID,
    environmentUpdate: Partial<Worktree['environment_instance']>,
    params?: WorktreeParams
  ): Promise<Worktree> {
    const existing = await this.get(id, params);

    const updatedEnvironment = {
      ...existing.environment_instance,
      ...environmentUpdate,
    } as Worktree['environment_instance'];

    // Check if environment state actually changed (ignoring timestamp-only updates)
    // For health checks, we only care about status and message changes, not timestamp
    const oldState = { ...existing.environment_instance };
    const newState = { ...updatedEnvironment };

    // Remove timestamps for comparison - create new objects without timestamp
    if (oldState?.last_health_check) {
      const { timestamp, ...healthCheck } = oldState.last_health_check;
      oldState.last_health_check = healthCheck as typeof oldState.last_health_check;
    }
    if (newState?.last_health_check) {
      const { timestamp, ...healthCheck } = newState.last_health_check;
      newState.last_health_check = healthCheck as typeof newState.last_health_check;
    }

    const hasChanged = JSON.stringify(oldState) !== JSON.stringify(newState);

    // Only emit WebSocket event if state changed
    if (!hasChanged) {
      return existing;
    }

    const worktree = await this.patch(
      id,
      {
        environment_instance: updatedEnvironment,
        updated_at: new Date().toISOString(),
      },
      params
    );

    return worktree as Worktree;
  }

  /**
   * Custom method: Start environment
   */
  async startEnvironment(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.get(id, params);

    // Validate static start command exists
    if (!worktree.start_command) {
      throw new Error('No start command configured for this worktree');
    }

    // Check if already running
    if (worktree.environment_instance?.status === 'running') {
      throw new Error('Environment is already running');
    }

    // Check container isolation
    const containersService = (this.app as any).worktreeContainersService;
    const containerIsolationEnabled = this.config.execution?.container_isolation === true;
    let containerName: string | undefined;
    let containerRunning = false;

    if (containerIsolationEnabled && containersService) {
      // Derive container name from worktree ID
      containerName = containersService.generateContainerName(worktree.worktree_id);

      // Check if container exists and is running
      containerRunning = await containersService.isContainerRunning(containerName);
      const containerExists = containerRunning || await containersService.containerExists(containerName);

      // Create container if it doesn't exist
      if (!containerExists) {
        console.log(`[Worktrees] Creating container on-demand for worktree ${worktree.name}`);
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
          await this.patch(worktree.worktree_id, {
            ssh_port: result.sshPort,
            container_name: result.containerName,
          }, params);
          containerRunning = true;
        } catch (error) {
          console.error(`[Worktrees] Failed to create container:`, error);
          // Continue without container - environment will run on host
          containerName = undefined;
        }
      } else if (!containerRunning) {
        // Container exists but is stopped - start it
        try {
          await containersService.ensureContainerRunning(worktree.worktree_id);
          containerRunning = true;
        } catch (error) {
          console.error(`[Worktrees] Failed to start container:`, error);
          containerName = undefined;
        }
      }
    }

    // Set status to 'starting'
    await this.updateEnvironment(
      id,
      {
        status: 'starting',
        last_health_check: undefined,
      },
      params
    );

    // Use static start_command (initialized from template at worktree creation)
    // Already validated above that start_command exists
    const command = worktree.start_command!;

    // Write to build log
    const buildLogPath = getBuildLogPath(worktree.path);
    await mkdir(dirname(buildLogPath), { recursive: true });
    const buildLogStream = createWriteStream(buildLogPath, { flags: 'a' });
    const logHeader = `\n=== START ===\nCommand: ${command}\nCWD: ${worktree.path}\nStarted: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;
    buildLogStream.write(logHeader);

    try {
      console.log(`🚀 Starting environment for worktree ${worktree.name}: ${command}`);

      // Create daemon log directory (for process tracking)
      const logPath = join(
        homedir(),
        '.agor',
        'logs',
        'worktrees',
        worktree.worktree_id,
        'environment.log'
      );
      await mkdir(dirname(logPath), { recursive: true });

      // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
      const env = await createUserProcessEnvironment(worktree.created_by, this.db);

      // Execute command and wait for it to complete
      // The command should start services and return (e.g., docker-compose up -d)
      // If container isolation is enabled, run inside the worktree's container
      const useContainerExecution = containerName && containerRunning;
      const runtime = this.config.execution?.containers?.runtime || 'docker';

      // Get user's UID for container execution
      let containerUid: number | undefined;
      if (useContainerExecution && worktree.created_by) {
        try {
          const usersRepo = new UsersRepository(this.db);
          const user = await usersRepo.findById(worktree.created_by);
          containerUid = user?.unix_uid;
        } catch (error) {
          console.warn(`[Worktrees] Failed to get user UID for container execution:`, error);
        }
      }

      await new Promise<void>((resolve, reject) => {
        let childProcess;

        if (useContainerExecution) {
          // Run command inside the worktree container
          // Podman socket is started at container boot, DOCKER_HOST is set via ENV
          // Run as root inside container - container is isolated so this is safe
          // This ensures Podman containers are visible to all users (same namespace)
          console.log(`[Worktrees] Running start command inside container ${containerName}`);
          const dockerArgs = [
            'exec',
            '-w', '/workspace',
            containerName!,
            'sh', '-c', command,
          ];
          childProcess = spawn(runtime, dockerArgs, {
            stdio: ['ignore', 'pipe', 'pipe'] as const,
            env, // Pass environment (used by docker client, not passed into container)
          });
        } else {
          // Run command on host
          childProcess = spawn(command, {
            cwd: worktree.path,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'] as const,
            env,
          });
        }

        // Pipe stdout to build log and console
        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          buildLogStream.write(text);
          process.stdout.write(text);
        });

        // Pipe stderr to build log and console
        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          buildLogStream.write(text);
          process.stderr.write(text);
        });

        childProcess.on('exit', (code: number | null) => {
          const footer = `\n${'='.repeat(50)}\nExit code: ${code}\nFinished: ${new Date().toISOString()}\n`;
          buildLogStream.write(footer);
          buildLogStream.end();

          if (code === 0) {
            console.log(`✅ Start command completed successfully for ${worktree.name}`);
            resolve();
          } else {
            reject(new Error(`Start command exited with code ${code}`));
          }
        });

        childProcess.on('error', (error) => {
          const errorMsg = `\n${'='.repeat(50)}\nError: ${error.message}\nFinished: ${new Date().toISOString()}\n`;
          buildLogStream.write(errorMsg);
          buildLogStream.end();
          reject(error);
        });
      });

      // Use static app_url (initialized from template at worktree creation)
      // When container isolation is enabled, rewrite URL to use external port
      let access_urls: Array<{ name: string; url: string }> | undefined;
      if (worktree.app_url) {
        let appUrl = worktree.app_url;

        // Rewrite URL with external host and port when using container isolation
        if (useContainerExecution && containersService) {
          const internalPort = extractPortFromUrl(worktree.app_url);
          if (internalPort) {
            const externalPort = containersService.calculateAppExternalPort(worktree.worktree_unique_id);
            const externalHost = containersService.getAppHost();

            // Parse and rebuild URL with external host and port
            try {
              const url = new URL(worktree.app_url);
              url.hostname = externalHost;
              url.port = String(externalPort);
              appUrl = url.toString();
            } catch {
              // Fallback: simple string replacement
              appUrl = worktree.app_url
                .replace(/localhost|127\.0\.0\.1/, externalHost)
                .replace(`:${internalPort}`, `:${externalPort}`);
            }
          }
        }

        access_urls = [{ name: 'App', url: appUrl }];
      }

      // Keep status as 'starting' - let health checks transition to 'running'
      // The first successful health check will transition from 'starting' → 'running'
      // This prevents premature "healthy" status before app is truly ready
      return await this.updateEnvironment(
        id,
        {
          // Don't change status - keep as 'starting' until first successful health check
          access_urls,
        },
        params
      );
    } catch (error) {
      // Update status to 'error'
      await this.updateEnvironment(
        id,
        {
          status: 'error',
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        params
      );

      throw error;
    }
  }

  /**
   * Custom method: Stop environment
   */
  async stopEnvironment(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.get(id, params);

    // Set status to 'stopping'
    await this.updateEnvironment(
      id,
      {
        status: 'stopping',
      },
      params
    );

    try {
      // Check if we have a static stop command
      if (worktree.stop_command) {
        // Use static stop_command (initialized from template at worktree creation)
        const command = worktree.stop_command;

        console.log(`🛑 Stopping environment for worktree ${worktree.name}: ${command}`);

        // Write to build log
        const buildLogPath = getBuildLogPath(worktree.path);
        await mkdir(dirname(buildLogPath), { recursive: true });
        const buildLogStream = createWriteStream(buildLogPath, { flags: 'a' });
        const logHeader = `\n=== STOP ===\nCommand: ${command}\nCWD: ${worktree.path}\nStarted: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;
        buildLogStream.write(logHeader);

        // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
        const env = await createUserProcessEnvironment(worktree.created_by, this.db);

        // Check container isolation
        const containersService = (this.app as any).worktreeContainersService;
        const containerIsolationEnabled = this.config.execution?.container_isolation === true;
        let containerName: string | undefined;
        let containerRunning = false;

        if (containerIsolationEnabled && containersService) {
          containerName = containersService.generateContainerName(worktree.worktree_id);
          containerRunning = await containersService.isContainerRunning(containerName);
        }

        const useContainerExecution = containerName && containerRunning;
        const runtime = this.config.execution?.containers?.runtime || 'docker';

        // Get user's UID for container execution
        let containerUid: number | undefined;
        if (useContainerExecution && worktree.created_by) {
          try {
            const usersRepo = new UsersRepository(this.db);
            const user = await usersRepo.findById(worktree.created_by);
            containerUid = user?.unix_uid;
          } catch (error) {
            console.warn(`[Worktrees] Failed to get user UID for container execution:`, error);
          }
        }

        // Execute down command
        await new Promise<void>((resolve, reject) => {
          let stopProcess;

          if (useContainerExecution) {
            // Run command inside the worktree container
            // Podman socket is started at container boot, DOCKER_HOST is set via ENV
            // Run as root inside container - container is isolated so this is safe
            console.log(`[Worktrees] Running stop command inside container ${containerName}`);
            const dockerArgs = [
              'exec',
              '-w', '/workspace',
              containerName!,
              'sh', '-c', command,
            ];
            stopProcess = spawn(runtime, dockerArgs, {
              stdio: ['ignore', 'pipe', 'pipe'],
              env,
            });
          } else {
            // Run command on host
            stopProcess = spawn(command, {
              cwd: worktree.path,
              shell: true,
              stdio: ['ignore', 'pipe', 'pipe'],
              env,
            });
          }

          // Pipe stdout to build log and console
          stopProcess.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            buildLogStream.write(text);
            process.stdout.write(text);
          });

          // Pipe stderr to build log and console
          stopProcess.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            buildLogStream.write(text);
            process.stderr.write(text);
          });

          stopProcess.on('exit', (code) => {
            const footer = `\n${'='.repeat(50)}\nExit code: ${code}\nFinished: ${new Date().toISOString()}\n`;
            buildLogStream.write(footer);
            buildLogStream.end();

            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Down command exited with code ${code}`));
            }
          });

          stopProcess.on('error', (error) => {
            const errorMsg = `\n${'='.repeat(50)}\nError: ${error.message}\nFinished: ${new Date().toISOString()}\n`;
            buildLogStream.write(errorMsg);
            buildLogStream.end();
            reject(error);
          });
        });
      } else {
        // No down command - kill the managed process if we have it
        const managedProcess = this.processes.get(id);
        if (managedProcess) {
          managedProcess.process.kill('SIGTERM');
          this.processes.delete(id);
        } else if (worktree.environment_instance?.process?.pid) {
          // Try to kill by PID stored in database
          try {
            process.kill(worktree.environment_instance.process.pid, 'SIGTERM');
          } catch (error) {
            console.warn(
              `Failed to kill process ${worktree.environment_instance.process.pid}: ${error}`
            );
          }
        }
      }

      // Update status to 'stopped'
      return await this.updateEnvironment(
        id,
        {
          status: 'stopped',
          process: undefined,
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unknown',
            message: 'Environment stopped',
          },
        },
        params
      );
    } catch (error) {
      // Update status to 'error'
      await this.updateEnvironment(
        id,
        {
          status: 'error',
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        params
      );

      throw error;
    }
  }

  /**
   * Custom method: Restart environment
   */
  async restartEnvironment(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.get(id, params);

    // Stop if running
    if (worktree.environment_instance?.status === 'running') {
      await this.stopEnvironment(id, params);

      // Wait a bit for processes to clean up
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Start
    return await this.startEnvironment(id, params);
  }

  /**
   * Custom method: Nuke environment (destructive operation)
   */
  async nukeEnvironment(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.get(id, params);

    // Require nuke_command to be configured
    if (!worktree.nuke_command) {
      throw new Error('No nuke_command configured for this worktree');
    }

    // Set status to 'stopping' (reuse stopping state for nuke)
    await this.updateEnvironment(
      id,
      {
        status: 'stopping',
      },
      params
    );

    try {
      const command = worktree.nuke_command;

      console.log(`💣 NUKING environment for worktree ${worktree.name}: ${command}`);
      console.warn('⚠️  This is a destructive operation!');

      // Write to build log
      const buildLogPath = getBuildLogPath(worktree.path);
      await mkdir(dirname(buildLogPath), { recursive: true });
      const buildLogStream = createWriteStream(buildLogPath, { flags: 'a' });
      const logHeader = `\n=== NUKE ===\nCommand: ${command}\nCWD: ${worktree.path}\nStarted: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;
      buildLogStream.write(logHeader);

      // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
      const env = await createUserProcessEnvironment(worktree.created_by, this.db);

      // Execute nuke command
      await new Promise<void>((resolve, reject) => {
        const nukeProcess = spawn(command, {
          cwd: worktree.path,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env, // Pass clean environment without Agor-internal variables
        });

        // Pipe stdout to build log and console
        nukeProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          buildLogStream.write(text);
          process.stdout.write(text);
        });

        // Pipe stderr to build log and console
        nukeProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          buildLogStream.write(text);
          process.stderr.write(text);
        });

        nukeProcess.on('exit', (code) => {
          const footer = `\n${'='.repeat(50)}\nExit code: ${code}\nFinished: ${new Date().toISOString()}\n`;
          buildLogStream.write(footer);
          buildLogStream.end();

          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Nuke command exited with code ${code}`));
          }
        });

        nukeProcess.on('error', (error) => {
          const errorMsg = `\n${'='.repeat(50)}\nError: ${error.message}\nFinished: ${new Date().toISOString()}\n`;
          buildLogStream.write(errorMsg);
          buildLogStream.end();
          reject(error);
        });
      });

      // Clean up any managed process references
      const managedProcess = this.processes.get(id);
      if (managedProcess) {
        this.processes.delete(id);
      }

      // Update status to 'stopped' with clear nuke message
      return await this.updateEnvironment(
        id,
        {
          status: 'stopped',
          process: undefined,
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unknown',
            message: 'Environment nuked - all data and volumes destroyed',
          },
        },
        params
      );
    } catch (error) {
      // Update status to 'error'
      await this.updateEnvironment(
        id,
        {
          status: 'error',
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unhealthy',
            message: error instanceof Error ? error.message : 'Unknown error during nuke',
          },
        },
        params
      );

      throw error;
    }
  }

  /**
   * Custom method: Check health
   */
  async checkHealth(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.get(id, params);
    const _repo = (await this.app.service('repos').get(worktree.repo_id, params)) as Repo;

    // Only check health for 'running' or 'starting' status
    const currentStatus = worktree.environment_instance?.status;
    if (currentStatus !== 'running' && currentStatus !== 'starting') {
      return worktree;
    }

    // Check if we have a health check URL (static field, not template)
    if (!worktree.health_check_url) {
      // No health check configured - stay in 'starting' forever (manual intervention required)
      // Don't auto-transition to 'running' without health check confirmation
      const managedProcess = this.processes.get(id);
      const isProcessAlive = managedProcess?.process && !managedProcess.process.killed;

      return await this.updateEnvironment(
        id,
        {
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: isProcessAlive ? 'healthy' : 'unknown',
            message: isProcessAlive ? 'Process running' : 'No health check configured',
          },
        },
        params
      );
    }

    // Use static health_check_url (initialized from template at worktree creation)
    const healthUrl = worktree.health_check_url;

    // Track previous health status to detect changes
    const previousHealthStatus = worktree.environment_instance?.last_health_check?.status;

    try {
      let isHealthy: boolean;
      let statusMessage: string;

      // Check if worktree has a running container - health checks must run inside container
      // because Podman networks are isolated from the host
      const containersService = (this.app as any).worktreeContainersService;
      const containerIsolationEnabled = this.config.execution?.container_isolation === true;
      let containerName: string | undefined;
      let containerRunning = false;

      if (containerIsolationEnabled && containersService) {
        containerName = containersService.generateContainerName(worktree.worktree_id);
        containerRunning = await containersService.isContainerRunning(containerName);
      }

      if (containerName && containerRunning) {
        // Use docker exec to run curl inside the container
        const runtime = this.config.execution?.containers?.runtime || 'docker';
        const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
          const timeoutMs = ENVIRONMENT.HEALTH_CHECK_TIMEOUT_MS;
          const curlProcess = spawn(runtime, [
            'exec',
            containerName!,
            'curl',
            '-sf',
            '--max-time', String(Math.floor(timeoutMs / 1000)),
            '-o', '/dev/null',
            '-w', '%{http_code}',
            healthUrl,
          ]);

          let stdout = '';
          let stderr = '';
          const timeout = setTimeout(() => {
            curlProcess.kill();
            resolve({ ok: false, message: 'Timeout' });
          }, timeoutMs + 1000);

          curlProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
          curlProcess.stderr?.on('data', (data) => { stderr += data.toString(); });

          curlProcess.on('close', (code) => {
            clearTimeout(timeout);
            const httpCode = parseInt(stdout.trim(), 10);
            if (code === 0 && httpCode >= 200 && httpCode < 400) {
              resolve({ ok: true, message: `HTTP ${httpCode}` });
            } else {
              resolve({ ok: false, message: httpCode ? `HTTP ${httpCode}` : (stderr.trim() || `Exit code ${code}`) });
            }
          });

          curlProcess.on('error', (err) => {
            clearTimeout(timeout);
            resolve({ ok: false, message: err.message });
          });
        });

        isHealthy = result.ok;
        statusMessage = result.message;
      } else {
        // No container - perform health check directly from host
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ENVIRONMENT.HEALTH_CHECK_TIMEOUT_MS);

        const response = await fetch(healthUrl, {
          signal: controller.signal,
          method: 'GET',
        });

        clearTimeout(timeout);
        isHealthy = response.ok;
        statusMessage = `HTTP ${response.status}${!response.ok ? ' ' + response.statusText : ''}`;
      }

      const newHealthStatus = isHealthy ? 'healthy' : 'unhealthy';

      // Only log if health status changed
      if (previousHealthStatus !== newHealthStatus) {
        console.log(
          `🏥 Health status changed for ${worktree.name}: ${previousHealthStatus || 'unknown'} → ${newHealthStatus} (${statusMessage})`
        );
      }

      // If health check succeeds and we're in 'starting' state, transition to 'running'
      const shouldTransitionToRunning = isHealthy && currentStatus === 'starting';

      if (shouldTransitionToRunning) {
        console.log(
          `✅ First successful health check for ${worktree.name} - transitioning to 'running'`
        );
      }

      return await this.updateEnvironment(
        id,
        {
          status: shouldTransitionToRunning ? 'running' : currentStatus,
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: newHealthStatus,
            message: statusMessage,
          },
        },
        params
      );
    } catch (error) {
      // Health check failed
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? 'Timeout'
            : error.message
          : 'Unknown error';

      // During 'starting' state, don't mark as unhealthy - keep retrying
      // Only mark as unhealthy when transitioning from healthy->unhealthy in 'running' state
      if (currentStatus === 'starting') {
        // Don't update health check during startup - wait for first success
        // This prevents the UI from showing unhealthy state while environment is still starting
        return worktree;
      }

      const newHealthStatus = 'unhealthy';

      // Only log if health status changed or if this is an error
      if (previousHealthStatus !== newHealthStatus) {
        console.log(
          `🏥 Health status changed for ${worktree.name}: ${previousHealthStatus || 'unknown'} → ${newHealthStatus} (${message})`
        );
      }

      return await this.updateEnvironment(
        id,
        {
          last_health_check: {
            timestamp: new Date().toISOString(),
            status: 'unhealthy',
            message,
          },
        },
        params
      );
    }
  }

  /**
   * Custom method: Get environment logs
   */
  async getLogs(
    id: WorktreeID,
    params?: WorktreeParams
  ): Promise<{
    logs: string;
    timestamp: string;
    error?: string;
    truncated?: boolean;
  }> {
    const worktree = await this.get(id, params);

    // Check if static logs command is configured
    if (!worktree.logs_command) {
      return {
        logs: '',
        timestamp: new Date().toISOString(),
        error: 'No logs command configured',
      };
    }

    try {
      // Use static logs_command (initialized from template at worktree creation)
      const command = worktree.logs_command;

      console.log(`📋 Fetching logs for worktree ${worktree.name}: ${command}`);

      // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
      const env = await createUserProcessEnvironment(worktree.created_by, this.db);

      // Check if container isolation is enabled
      // Note: worktreeContainersService is stored directly on app object (not via app.set)
      const containersService = (this.app as any).worktreeContainersService as
        | import('./worktree-containers.js').WorktreeContainersService
        | undefined;
      let containerName: string | undefined;
      let containerRunning = false;

      console.log(`[Worktrees] getLogs: containersService exists=${!!containersService}, isEnabled=${containersService?.isEnabled()}`);

      if (containersService?.isEnabled()) {
        containerName = containersService.generateContainerName(worktree.worktree_id);
        containerRunning = await containersService.isContainerRunning(containerName);
        console.log(`[Worktrees] getLogs: containerName=${containerName}, running=${containerRunning}`);
      }

      const useContainerExecution = containerName && containerRunning;
      console.log(`[Worktrees] getLogs: useContainerExecution=${useContainerExecution}`);
      const runtime = this.config.execution?.containers?.runtime || 'docker';

      // Execute command with timeout and output limits
      const result = await new Promise<{
        stdout: string;
        stderr: string;
        truncated: boolean;
      }>((resolve, reject) => {
        let childProcess;

        if (useContainerExecution) {
          // Run logs command inside the worktree container
          console.log(`[Worktrees] Running logs command inside container ${containerName}`);
          const dockerArgs = [
            'exec',
            '-w', '/workspace',
            containerName!,
            'sh', '-c', command,
          ];
          childProcess = spawn(runtime, dockerArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
          });
        } else {
          // Run command on host
          childProcess = spawn(command, {
            cwd: worktree.path,
            shell: true,
            env, // Pass clean environment without Agor-internal variables
          });
        }

        let stdout = '';
        let stderr = '';
        let truncated = false;

        // Set timeout
        const timeout = setTimeout(() => {
          childProcess.kill('SIGTERM');
          reject(new Error(`Logs command timed out after ${ENVIRONMENT.LOGS_TIMEOUT_MS / 1000}s`));
        }, ENVIRONMENT.LOGS_TIMEOUT_MS);

        // Capture stdout with size limit
        childProcess.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          if (stdout.length + chunk.length <= ENVIRONMENT.LOGS_MAX_BYTES) {
            stdout += chunk;
          } else {
            // Truncate to max bytes
            stdout += chunk.substring(0, ENVIRONMENT.LOGS_MAX_BYTES - stdout.length);
            truncated = true;
            childProcess.kill('SIGTERM');
          }
        });

        // Capture stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        childProcess.on('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 || stdout.length > 0) {
            resolve({ stdout, stderr, truncated });
          } else {
            reject(new Error(stderr || `Logs command exited with code ${code}`));
          }
        });

        childProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Process output: split into lines and keep last N lines
      const allLines = result.stdout.split('\n');
      let finalLines = allLines;
      let wasTruncatedByLines = false;

      if (allLines.length > ENVIRONMENT.LOGS_MAX_LINES) {
        finalLines = allLines.slice(-ENVIRONMENT.LOGS_MAX_LINES);
        wasTruncatedByLines = true;
      }

      const logs = finalLines.join('\n');
      const truncated = result.truncated || wasTruncatedByLines;

      console.log(
        `✅ Fetched ${allLines.length} lines (${logs.length} bytes) for ${worktree.name}${truncated ? ' [truncated]' : ''}`
      );

      return {
        logs,
        timestamp: new Date().toISOString(),
        truncated,
      };
    } catch (error) {
      console.error(
        `❌ Failed to fetch logs for ${worktree.name}:`,
        error instanceof Error ? error.message : String(error)
      );

      return {
        logs: '',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get build logs (start/stop/nuke command output)
   */
  async getBuildLogs(
    id: WorktreeID,
    params?: WorktreeParams
  ): Promise<{
    logs: string;
    exists: boolean;
    path: string;
  }> {
    const worktree = await this.get(id, params);
    const logPath = getBuildLogPath(worktree.path);

    if (!existsSync(logPath)) {
      return {
        logs: '',
        exists: false,
        path: logPath,
      };
    }

    try {
      const content = await readFile(logPath, 'utf-8');
      return {
        logs: content,
        exists: true,
        path: logPath,
      };
    } catch (error) {
      return {
        logs: `Error reading build logs: ${error instanceof Error ? error.message : String(error)}`,
        exists: true,
        path: logPath,
      };
    }
  }
}

/**
 * Service factory function
 */
export function createWorktreesService(db: Database, app: Application, config: AgorConfig): WorktreesService {
  return new WorktreesService(db, app, config);
}
