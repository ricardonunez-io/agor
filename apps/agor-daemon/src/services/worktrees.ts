/**
 * Worktrees Service
 *
 * Provides REST + WebSocket API for worktree management.
 * Uses DrizzleService adapter with WorktreeRepository.
 */

import { type Database, WorktreeRepository } from '@agor/core/db';
import type { QueryParams, UUID, Worktree, WorktreeID } from '@agor/core/types';
import { DrizzleService } from '../adapters/drizzle';

/**
 * Worktree service params
 */
export type WorktreeParams = QueryParams<{
  repo_id?: UUID;
  name?: string;
  ref?: string;
}>;

/**
 * Extended worktrees service with custom methods
 */
export class WorktreesService extends DrizzleService<Worktree, Partial<Worktree>, WorktreeParams> {
  private worktreeRepo: WorktreeRepository;

  constructor(db: Database) {
    const worktreeRepo = new WorktreeRepository(db);
    super(worktreeRepo, {
      id: 'worktree_id',
      paginate: {
        default: 50,
        max: 100,
      },
    });

    this.worktreeRepo = worktreeRepo;
  }

  /**
   * Override find to support repo_id filter
   */
  async _find(params?: WorktreeParams) {
    const { repo_id } = params?.query || {};

    // If repo_id filter is provided, use repository method
    if (repo_id) {
      const worktrees = await this.worktreeRepo.findAll({ repo_id });
      return {
        total: worktrees.length,
        limit: params?.query?.$limit || 50,
        skip: params?.query?.$skip || 0,
        data: worktrees,
      };
    }

    // Otherwise, use default find
    return super._find(params);
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
   * Custom method: Add session to worktree
   */
  async addSession(id: WorktreeID, sessionId: UUID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.worktreeRepo.addSession(id, sessionId);

    // Emit WebSocket event
    this.emit('patched', worktree, params);

    return worktree;
  }

  /**
   * Custom method: Remove session from worktree
   */
  async removeSession(id: WorktreeID, sessionId: UUID, params?: WorktreeParams): Promise<Worktree> {
    const worktree = await this.worktreeRepo.removeSession(id, sessionId);

    // Emit WebSocket event
    this.emit('patched', worktree, params);

    return worktree;
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
    };

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
}

/**
 * Service factory function
 */
export function createWorktreesService(db: Database): WorktreesService {
  return new WorktreesService(db);
}
