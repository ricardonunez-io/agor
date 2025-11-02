/**
 * Worktree Repository
 *
 * Type-safe CRUD operations for worktrees with short ID support.
 */

import type { UUID, Worktree, WorktreeID } from '@agor/core/types';
import { eq, like, sql } from 'drizzle-orm';
import { formatShortId, generateId } from '../../lib/ids';
import type { Database } from '../client';
import { type WorktreeInsert, type WorktreeRow, worktrees } from '../schema';
import { AmbiguousIdError, type BaseRepository, EntityNotFoundError } from './base';

/**
 * Worktree repository implementation
 */
export class WorktreeRepository implements BaseRepository<Worktree, Partial<Worktree>> {
  constructor(private db: Database) {}

  /**
   * Convert database row to Worktree type
   */
  private rowToWorktree(row: WorktreeRow): Worktree {
    return {
      worktree_id: row.worktree_id as WorktreeID,
      repo_id: row.repo_id as UUID,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: row.updated_at
        ? new Date(row.updated_at).toISOString()
        : new Date(row.created_at).toISOString(),
      created_by: row.created_by as UUID,
      name: row.name,
      ref: row.ref,
      worktree_unique_id: row.worktree_unique_id,
      board_id: (row.board_id as UUID | null) ?? undefined, // Top-level column
      schedule_enabled: row.schedule_enabled ?? false,
      schedule_cron: row.schedule_cron ?? undefined,
      schedule_last_triggered_at: row.schedule_last_triggered_at ?? undefined,
      schedule_next_run_at: row.schedule_next_run_at ?? undefined,
      ...row.data,
    };
  }

  /**
   * Convert Worktree to database insert format
   */
  private worktreeToInsert(worktree: Partial<Worktree>): WorktreeInsert {
    const now = Date.now();
    const worktreeId = worktree.worktree_id ?? (generateId() as WorktreeID);

    return {
      worktree_id: worktreeId,
      repo_id: worktree.repo_id!,
      created_at: worktree.created_at ? new Date(worktree.created_at) : new Date(now),
      updated_at: new Date(now),
      created_by: worktree.created_by ?? 'anonymous',
      name: worktree.name!,
      ref: worktree.ref!,
      worktree_unique_id: worktree.worktree_unique_id!, // Required field
      // Explicitly convert undefined to null for Drizzle (undefined values are ignored in set())
      board_id: worktree.board_id === undefined ? null : worktree.board_id || null,
      schedule_enabled: worktree.schedule_enabled ?? false,
      schedule_cron: worktree.schedule_cron ?? null,
      schedule_last_triggered_at: worktree.schedule_last_triggered_at ?? null,
      schedule_next_run_at: worktree.schedule_next_run_at ?? null,
      data: {
        path: worktree.path!,
        base_ref: worktree.base_ref,
        base_sha: worktree.base_sha,
        last_commit_sha: worktree.last_commit_sha,
        tracking_branch: worktree.tracking_branch,
        new_branch: worktree.new_branch ?? false,
        issue_url: worktree.issue_url,
        pull_request_url: worktree.pull_request_url,
        notes: worktree.notes,
        environment_instance: worktree.environment_instance,
        last_used: worktree.last_used ?? new Date(now).toISOString(),
        custom_context: worktree.custom_context,
        schedule: worktree.schedule,
      },
    };
  }

  /**
   * Create a new worktree
   */
  async create(worktree: Partial<Worktree>): Promise<Worktree> {
    const insert = this.worktreeToInsert(worktree);
    const [row] = await this.db.insert(worktrees).values(insert).returning();
    return this.rowToWorktree(row);
  }

  /**
   * Find worktree by exact ID or short ID prefix
   */
  async findById(id: string): Promise<Worktree | null> {
    // Exact match (full UUID)
    if (id.length === 36 && id.includes('-')) {
      const [row] = await this.db
        .select()
        .from(worktrees)
        .where(eq(worktrees.worktree_id, id))
        .limit(1);
      return row ? this.rowToWorktree(row) : null;
    }

    // Short ID match (prefix) - just use the id directly as a prefix since it's already short
    const prefix = id.replace(/-/g, '').toLowerCase();
    const matches = await this.db
      .select()
      .from(worktrees)
      .where(like(worktrees.worktree_id, `${prefix}%`))
      .limit(2); // Fetch 2 to detect ambiguity

    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new AmbiguousIdError(
        'Worktree',
        prefix,
        matches.map(m => formatShortId(m.worktree_id as UUID))
      );
    }

    return this.rowToWorktree(matches[0]);
  }

  /**
   * Find all worktrees (with optional filters)
   */
  async findAll(filter?: { repo_id?: UUID }): Promise<Worktree[]> {
    if (filter?.repo_id) {
      const rows = await this.db
        .select()
        .from(worktrees)
        .where(eq(worktrees.repo_id, filter.repo_id));
      return rows.map(row => this.rowToWorktree(row));
    }

    const rows = await this.db.select().from(worktrees);
    return rows.map(row => this.rowToWorktree(row));
  }

  /**
   * Update worktree by ID
   */
  async update(id: string, updates: Partial<Worktree>): Promise<Worktree> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new EntityNotFoundError('Worktree', id);
    }

    const merged: Partial<Worktree> = {
      ...existing,
      ...updates,
      worktree_id: existing.worktree_id,
      repo_id: existing.repo_id,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };

    const insert = this.worktreeToInsert(merged);

    const [row] = await this.db
      .update(worktrees)
      .set(insert)
      .where(eq(worktrees.worktree_id, existing.worktree_id))
      .returning();

    return this.rowToWorktree(row);
  }

  /**
   * Delete worktree by ID
   */
  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new EntityNotFoundError('Worktree', id);
    }

    await this.db.delete(worktrees).where(eq(worktrees.worktree_id, existing.worktree_id));
  }

  /**
   * Find worktree by repo_id and name
   */
  async findByRepoAndName(repoId: UUID, name: string): Promise<Worktree | null> {
    const [row] = await this.db
      .select()
      .from(worktrees)
      .where(sql`${worktrees.repo_id} = ${repoId} AND ${worktrees.name} = ${name}`)
      .limit(1);

    return row ? this.rowToWorktree(row) : null;
  }
}
