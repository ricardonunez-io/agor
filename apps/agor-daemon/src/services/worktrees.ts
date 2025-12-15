/**
 * Worktrees Service
 *
 * Provides REST + WebSocket API for worktree management.
 * Uses DrizzleService adapter with WorktreeRepository.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createUserProcessEnvironment, ENVIRONMENT, PAGINATION } from '@agor/core/config';
import { type Database, WorktreeRepository } from '@agor/core/db';
import type { Application } from '@agor/core/feathers';
import { cleanWorktree, removeWorktree } from '@agor/core/git';
import {
  getAppServiceName,
  getDockerHost,
  getPodManager,
  type PodManager,
} from '@agor/core/kubernetes';
import type { BoardID, QueryParams, Repo, UUID, Worktree, WorktreeID } from '@agor/core/types';
import { getNextRunTime, validateCron } from '@agor/core/utils/cron';
import { DrizzleService } from '../adapters/drizzle';

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

  // Open log file for writing (overwrite previous)
  const logStream = createWriteStream(logPath, { flags: 'w' });

  // Write header
  const header = `=== ${label.toUpperCase()} ===\nCommand: ${command}\nCWD: ${cwd}\nStarted: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;
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
  private processes = new Map<WorktreeID, ManagedProcess>();
  // Cache board-objects service reference (lazy-loaded to avoid circular deps)
  private boardObjectsService?: {
    findByWorktreeId: (worktreeId: WorktreeID) => Promise<unknown>;
    create: (data: unknown) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };

  constructor(db: Database, app: Application) {
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
  }

  /**
   * Get PodManager if pod mode is enabled (uses singleton)
   */
  private getPodManager(): PodManager | null {
    try {
      const pm = getPodManager();
      return pm.isEnabled() ? pm : null;
    } catch {
      return null;
    }
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

    // Call parent patch
    const updatedWorktree = (await super.patch(id, data, params)) as Worktree;

    // Handle board_objects changes if board_id changed
    if (!boardIdProvided) {
      return updatedWorktree;
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

    return updatedWorktree;
  }

  /**
   * Override find to support repo_id filter
   */
  async find(params?: WorktreeParams) {
    const { repo_id } = params?.query || {};

    // If repo_id filter is provided, use repository method
    if (repo_id) {
      const worktrees = await this.worktreeRepo.findAll({ repo_id });

      // Return with pagination if enabled
      if (this.paginate) {
        return {
          total: worktrees.length,
          limit: params?.query?.$limit || this.paginate.default || 50,
          skip: params?.query?.$skip || 0,
          data: worktrees,
        };
      }

      return worktrees;
    }

    // Otherwise, use default find
    return super.find(params);
  }

  /**
   * Override remove to support filesystem deletion and pod cleanup
   */
  async remove(id: WorktreeID, params?: WorktreeParams): Promise<Worktree> {
    const { deleteFromFilesystem } = params?.query || {};

    // Get worktree details before deletion
    const worktree = await this.get(id, params);

    // Remove from database FIRST for instant UI feedback
    // CASCADE will clean up related comments automatically
    const result = await super.remove(id, params);

    // Clean up Kubernetes pods/deployments for this worktree (async, non-blocking)
    this.cleanupWorktreePods(id).catch((error) => {
      console.warn(
        `⚠️  Failed to cleanup pods for worktree ${id}:`,
        error instanceof Error ? error.message : String(error)
      );
    });

    // Then remove from filesystem (slower operation, happens in background)
    if (deleteFromFilesystem) {
      // Note: We don't await this - it happens asynchronously after DB deletion
      const repo = (await this.app.service('repos').get(worktree.repo_id, params)) as Repo;
      console.log(`🗑️  Removing worktree from filesystem: ${worktree.path}`);
      removeWorktree(repo.local_path, worktree.path)
        .then(() => {
          console.log(`✅ Worktree removed from filesystem successfully`);
        })
        .catch((error) => {
          console.error(
            `⚠️  Failed to remove worktree from filesystem:`,
            error instanceof Error ? error.message : String(error)
          );
        });
    }

    return result as Worktree;
  }

  /**
   * Clean up all Kubernetes pods/deployments associated with a worktree
   */
  private async cleanupWorktreePods(worktreeId: WorktreeID): Promise<void> {
    try {
      const podManager = getPodManager();
      if (!podManager.isEnabled()) return;

      console.log(`🧹 Cleaning up pods for worktree ${worktreeId.substring(0, 8)}`);

      // Delete Podman deployment and service
      await podManager.deletePodmanPod(worktreeId);

      // Delete Ingress and app Service (if created)
      await podManager.deleteWorktreeIngress(worktreeId);

      // List and delete all shell pods for this worktree (for all users)
      const shellPods = await podManager.listShellPods();
      for (const pod of shellPods) {
        if (pod.worktreeId === worktreeId && pod.userId) {
          await podManager.deleteShellPod(worktreeId, pod.userId);
        }
      }

      console.log(`✅ Pods cleaned up for worktree ${worktreeId.substring(0, 8)}`);
    } catch (error) {
      // Log but don't fail - this is best-effort cleanup
      console.error(
        `Failed to cleanup pods for worktree ${worktreeId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
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

    // Clean up Kubernetes ingress and app service (if in pod mode)
    const podManager = this.getPodManager();
    if (podManager) {
      try {
        await podManager.deleteWorktreeIngress(id);
        console.log(`🗑️  Deleted ingress and app service for ${worktree.name}`);
      } catch (error) {
        console.warn(
          `Failed to delete ingress/service:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Perform filesystem action first (before DB changes)
    let filesRemoved = 0;
    if (filesystemAction === 'cleaned') {
      console.log(`🧹 Cleaning worktree filesystem: ${worktree.path}`);
      try {
        const result = await cleanWorktree(worktree.path);
        filesRemoved = result.filesRemoved;
        console.log(`✅ Cleaned ${filesRemoved} files from ${worktree.name}`);
      } catch (error) {
        console.error(
          `⚠️  Failed to clean worktree:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with archive/delete even if clean fails
      }
    } else if (filesystemAction === 'deleted') {
      console.log(`🗑️  Deleting worktree from filesystem: ${worktree.path}`);
      try {
        const repo = (await this.app.service('repos').get(worktree.repo_id, params)) as Repo;
        await removeWorktree(repo.local_path, worktree.path);
        console.log(`✅ Deleted worktree from filesystem: ${worktree.name}`);
      } catch (error) {
        console.error(
          `⚠️  Failed to delete worktree:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with archive/delete even if filesystem deletion fails
      }
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

    // Set status to 'starting'
    await this.updateEnvironment(
      id,
      {
        status: 'starting',
        last_health_check: undefined,
      },
      params
    );

    try {
      // Use static start_command (initialized from template at worktree creation)
      const command = worktree.start_command;

      console.log(`🚀 Starting environment for worktree ${worktree.name}: ${command}`);

      // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
      const env = await createUserProcessEnvironment(worktree.created_by, this.db);

      const podManager = this.getPodManager();
      const logPath = getBuildLogPath(worktree.path);

      // Build environment with DOCKER_HOST if in pod mode
      let execEnv = env;
      if (podManager) {
        // Pod mode: ensure podman pod exists, then use DOCKER_HOST to communicate with it
        console.log(`[Pod Mode] Ensuring Podman pod exists for worktree ${worktree.worktree_id}`);
        await podManager.ensurePodmanPod(worktree.worktree_id, worktree.path);

        const dockerHost = getDockerHost(worktree.worktree_id, podManager.getConfig().namespace);
        execEnv = {
          ...env,
          DOCKER_HOST: dockerHost,
          DOCKER_BUILDKIT: '0',
          COMPOSE_DOCKER_CLI_BUILD: '0',
        };
        console.log(`[Pod Mode] DOCKER_HOST=${dockerHost}`);
      }

      // Run command and capture output to build.log
      await runCommandWithLogs({
        command,
        cwd: worktree.path,
        env: execEnv,
        logPath,
        label: 'start',
      });

      // Use static app_url (initialized from template at worktree creation)
      // If app_url is a port number or localhost URL, create an Ingress for it
      let access_urls: Array<{ name: string; url: string }> | undefined;
      if (worktree.app_url && podManager) {
        // Match: "8000" or "http://localhost:8000" or "http://127.0.0.1:8000"
        const portOnlyMatch = worktree.app_url.match(/^(\d+)$/);
        const localhostMatch = worktree.app_url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        const port = portOnlyMatch?.[1] || localhostMatch?.[1];

        if (port) {
          // Create Ingress for the port
          const portNum = parseInt(port, 10);
          try {
            const ingressUrl = await podManager.createWorktreeIngress(
              worktree.worktree_id,
              worktree.name,
              portNum
            );
            access_urls = [{ name: 'App', url: ingressUrl }];
            console.log(`✅ Created Ingress for ${worktree.name}: ${ingressUrl}`);
          } catch (error) {
            console.error(
              `⚠️ Failed to create Ingress for ${worktree.name}:`,
              error instanceof Error ? error.message : String(error)
            );
            // Fall back to port-only URL so user can at least see intended port
            access_urls = [{ name: 'App', url: `http://localhost:${portNum}` }];
          }
        } else {
          // app_url is a full URL (not localhost) - use as-is
          access_urls = [{ name: 'App', url: worktree.app_url }];
        }
      } else if (worktree.app_url) {
        // No podManager (daemon mode) - convert port to localhost URL if needed
        const portOnlyMatch = worktree.app_url.match(/^(\d+)$/);
        if (portOnlyMatch) {
          access_urls = [{ name: 'App', url: `http://localhost:${portOnlyMatch[1]}` }];
        } else {
          access_urls = [{ name: 'App', url: worktree.app_url }];
        }
      }

      // Determine final status:
      // - If health_check_url is configured, stay 'starting' and let health checks transition to 'running'
      // - If no health check, transition directly to 'running' (start command succeeded)
      const finalStatus = worktree.health_check_url ? undefined : 'running';

      if (!worktree.health_check_url) {
        console.log(`✅ No health check configured - transitioning directly to 'running'`);
      }

      return await this.updateEnvironment(
        id,
        {
          status: finalStatus,
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
        const command = worktree.stop_command;
        console.log(`🛑 Stopping environment for worktree ${worktree.name}: ${command}`);

        // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
        const env = await createUserProcessEnvironment(worktree.created_by, this.db);

        const podManager = this.getPodManager();
        const logPath = getBuildLogPath(worktree.path);

        // Build environment with DOCKER_HOST if in pod mode
        const execEnv = podManager
          ? {
              ...env,
              DOCKER_HOST: getDockerHost(worktree.worktree_id, podManager.getConfig().namespace),
              DOCKER_BUILDKIT: '0',
              COMPOSE_DOCKER_CLI_BUILD: '0',
            }
          : env;

        if (podManager) {
          console.log(`[Pod Mode] DOCKER_HOST=${execEnv.DOCKER_HOST}`);
        }

        // Run command and capture output to build.log
        await runCommandWithLogs({
          command,
          cwd: worktree.path,
          env: execEnv,
          logPath,
          label: 'stop',
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

      // Clean up Ingress if it was created for this worktree
      const podManager = this.getPodManager();
      if (podManager && worktree.app_url?.match(/^\d+$/)) {
        try {
          await podManager.deleteWorktreeIngress(worktree.worktree_id);
          console.log(`✅ Deleted Ingress for ${worktree.name}`);
        } catch (error) {
          console.warn(
            `⚠️ Failed to delete Ingress for ${worktree.name}:`,
            error instanceof Error ? error.message : String(error)
          );
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

      // Create clean environment for user process (filters Agor-internal vars like NODE_ENV)
      const env = await createUserProcessEnvironment(worktree.created_by, this.db);

      const podManager = this.getPodManager();
      const logPath = getBuildLogPath(worktree.path);

      // Build environment with DOCKER_HOST if in pod mode
      const execEnv = podManager
        ? {
            ...env,
            DOCKER_HOST: getDockerHost(worktree.worktree_id, podManager.getConfig().namespace),
            DOCKER_BUILDKIT: '0',
            COMPOSE_DOCKER_CLI_BUILD: '0',
          }
        : env;

      if (podManager) {
        console.log(`[Pod Mode] DOCKER_HOST=${execEnv.DOCKER_HOST}`);
      }

      // Run command and capture output to build.log
      await runCommandWithLogs({
        command,
        cwd: worktree.path,
        env: execEnv,
        logPath,
        label: 'nuke',
      });

      // Clean up any managed process references
      const managedProcess = this.processes.get(id);
      if (managedProcess) {
        this.processes.delete(id);
      }

      // Clean up Kubernetes ingress and app service (if in pod mode)
      if (podManager) {
        try {
          await podManager.deleteWorktreeIngress(id);
          console.log(`🗑️  Deleted ingress and app service for ${worktree.name}`);
        } catch (error) {
          console.warn(
            `Failed to delete ingress/service:`,
            error instanceof Error ? error.message : String(error)
          );
        }
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
    // In pod mode, convert localhost URLs to internal service URL
    let healthUrl = worktree.health_check_url;
    const podManager = this.getPodManager();
    if (podManager && healthUrl) {
      const localhostMatch = healthUrl.match(/^(https?):\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$/);
      if (localhostMatch) {
        const [, protocol, port, path = ''] = localhostMatch;
        const appServiceName = getAppServiceName(worktree.worktree_id);
        // Use internal service URL instead of localhost
        healthUrl = `${protocol}://${appServiceName}.${podManager.getConfig().namespace}.svc:${port}${path}`;
        console.log(`[Health] Converted localhost URL to internal service: ${healthUrl}`);
      }
    }

    // Track previous health status to detect changes
    const previousHealthStatus = worktree.environment_instance?.last_health_check?.status;

    try {
      // Perform HTTP health check with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ENVIRONMENT.HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(healthUrl, {
        signal: controller.signal,
        method: 'GET',
      });

      clearTimeout(timeout);

      const isHealthy = response.ok;
      const newHealthStatus = isHealthy ? 'healthy' : 'unhealthy';

      // Only log if health status changed
      if (previousHealthStatus !== newHealthStatus) {
        console.log(
          `🏥 Health status changed for ${worktree.name}: ${previousHealthStatus || 'unknown'} → ${newHealthStatus} (HTTP ${response.status})`
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
            message: isHealthy
              ? `HTTP ${response.status}`
              : `HTTP ${response.status} ${response.statusText}`,
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
   * Custom method: Get build logs
   * Returns the output from the last start/stop/nuke command
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

      const podManager = this.getPodManager();
      // Set DOCKER_HOST if in pod mode, also disable BuildKit for cgroup compatibility
      const podEnv = podManager
        ? {
            ...env,
            DOCKER_HOST: getDockerHost(worktree.worktree_id, podManager.getConfig().namespace),
            DOCKER_BUILDKIT: '0',
            COMPOSE_DOCKER_CLI_BUILD: '0',
          }
        : env;

      if (podManager) {
        console.log(`[Pod Mode] DOCKER_HOST=${podEnv.DOCKER_HOST}`);
      }

      // Execute command - docker CLI will talk to podman pod via DOCKER_HOST if set
      const result = await new Promise<{
        stdout: string;
        stderr: string;
        truncated: boolean;
      }>((resolve, reject) => {
        const childProcess = spawn(command, {
          cwd: worktree.path,
          shell: true,
          env: podEnv,
        });

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
}

/**
 * Service factory function
 */
export function createWorktreesService(db: Database, app: Application): WorktreesService {
  return new WorktreesService(db, app);
}
