/**
 * Scheduler Service
 *
 * Manages cron-based scheduling for worktrees. Evaluates enabled schedules, spawns sessions, and enforces retention policies.
 *
 * **Architecture:**
 * - Runs on a configurable tick interval (default 30s)
 * - Evaluates all enabled schedules on each tick
 * - Spawns sessions when current time matches/exceeds next_run_at
 * - Updates schedule metadata (last_triggered_at, next_run_at)
 * - Enforces retention policy (deletes old scheduled sessions)
 *
 * **Smart Recovery:**
 * - If scheduler is down for extended period, only schedules LATEST missed run (no backfill)
 * - Grace period: 2 minutes (schedules within 2min of current time are considered "on time")
 *
 * **Deduplication:**
 * - Uses scheduled_run_at (rounded to minute) as unique run identifier
 * - Checks for existing session with same scheduled_run_at before spawning
 *
 * **Template Rendering:**
 * - Uses Handlebars to render prompt templates with worktree/board context
 * - Available context: {{ worktree.* }}, {{ board.* }}, {{ schedule.* }}
 */

import type { Database } from '@agor/core/db';
import type { PermissionMode, Session, Worktree, WorktreeScheduleConfig } from '@agor/core/types';
import { SessionStatus } from '@agor/core/types';
import { getNextRunTime, roundToMinute } from '@agor/core/utils/cron';
import Handlebars from 'handlebars';
import type { Application } from '../declarations';

export interface SchedulerConfig {
  /** Tick interval in milliseconds (default: 30000 = 30s) */
  tickInterval?: number;
  /** Grace period for missed runs in milliseconds (default: 120000 = 2min) */
  gracePeriod?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

export class SchedulerService {
  private db: Database;
  private app: Application;
  private config: Required<SchedulerConfig>;
  private intervalHandle?: NodeJS.Timeout;
  private isRunning = false;

  constructor(db: Database, app: Application, config: SchedulerConfig = {}) {
    this.db = db;
    this.app = app;
    this.config = {
      tickInterval: config.tickInterval ?? 30000, // 30 seconds
      gracePeriod: config.gracePeriod ?? 120000, // 2 minutes
      debug: config.debug ?? false,
    };
  }

  /**
   * Start the scheduler tick loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('⚠️  Scheduler already running');
      return;
    }

    console.log(`🔄 Starting scheduler (tick interval: ${this.config.tickInterval}ms)`);
    this.isRunning = true;

    // Run first tick immediately
    this.tick().catch(error => {
      console.error('❌ Scheduler tick failed:', error);
    });

    // Schedule recurring ticks
    this.intervalHandle = setInterval(() => {
      this.tick().catch(error => {
        console.error('❌ Scheduler tick failed:', error);
      });
    }, this.config.tickInterval);
  }

  /**
   * Stop the scheduler tick loop
   */
  stop(): void {
    if (!this.isRunning) {
      console.warn('⚠️  Scheduler not running');
      return;
    }

    console.log('🛑 Stopping scheduler');
    this.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Execute one scheduler tick
   *
   * 1. Fetch all enabled schedules (schedule_enabled = true)
   * 2. For each schedule:
   *    - Check if next_run_at <= now (+ grace period)
   *    - Check deduplication (no existing session with same scheduled_run_at)
   *    - Spawn session with rendered prompt
   *    - Update schedule metadata (last_triggered_at, next_run_at)
   *    - Enforce retention policy
   */
  private async tick(): Promise<void> {
    const now = Date.now();

    if (this.config.debug) {
      console.log(`⏰ Scheduler tick at ${new Date(now).toISOString()}`);
    }

    try {
      // 1. Fetch enabled schedules
      const enabledWorktrees = await this.getEnabledSchedules();

      if (this.config.debug) {
        console.log(`   Found ${enabledWorktrees.length} enabled schedules`);
      }

      // 2. Process each schedule
      for (const worktree of enabledWorktrees) {
        try {
          await this.processSchedule(worktree, now);
        } catch (error) {
          console.error(
            `❌ Failed to process schedule for worktree ${worktree.worktree_id}:`,
            error
          );
          // Continue processing other schedules
        }
      }
    } catch (error) {
      console.error('❌ Scheduler tick failed:', error);
      throw error;
    }
  }

  /**
   * Fetch all worktrees with enabled schedules
   */
  private async getEnabledSchedules(): Promise<Worktree[]> {
    const worktreesService = this.app.service('worktrees');
    const result = await worktreesService.find({
      query: {
        schedule_enabled: true,
        $limit: 1000, // Safety limit
      },
      paginate: false,
    });

    return Array.isArray(result) ? result : [];
  }

  /**
   * Process a single schedule
   *
   * Checks if schedule is due, spawns session if needed, updates metadata
   */
  private async processSchedule(worktree: Worktree, now: number): Promise<void> {
    if (!worktree.schedule_next_run_at) {
      if (this.config.debug) {
        console.log(`   ⏭️  Skipping ${worktree.name}: no next_run_at`);
      }
      return;
    }

    // Check if schedule is due (within grace period)
    const timeSinceScheduled = now - worktree.schedule_next_run_at;
    const isDue = timeSinceScheduled >= 0 && timeSinceScheduled < this.config.gracePeriod;

    if (!isDue) {
      if (this.config.debug) {
        const timeUntilRun = worktree.schedule_next_run_at - now;
        const minutes = Math.floor(timeUntilRun / 60000);
        console.log(`   ⏳ ${worktree.name}: ${minutes}m until next run`);
      }
      return;
    }

    // Schedule is due - spawn session
    if (this.config.debug) {
      console.log(`   ✅ ${worktree.name}: Schedule is due, spawning session...`);
    }

    await this.spawnScheduledSession(worktree, now);
  }

  /**
   * Spawn a scheduled session for a worktree
   *
   * 1. Check deduplication (no existing session with same scheduled_run_at)
   * 2. Render prompt template with Handlebars
   * 3. Create session with schedule metadata
   * 4. Update worktree schedule metadata (last_triggered_at, next_run_at)
   * 5. Enforce retention policy
   */
  private async spawnScheduledSession(worktree: Worktree, now: number): Promise<void> {
    if (!worktree.schedule || !worktree.schedule_cron) {
      console.error(`❌ Worktree ${worktree.worktree_id} missing schedule config`);
      return;
    }

    const schedule = worktree.schedule;
    const scheduledRunAt = worktree.schedule_next_run_at!;

    // 1. Check deduplication
    const sessionsService = this.app.service('sessions');
    const existingSessions = await sessionsService.find({
      query: {
        worktree_id: worktree.worktree_id,
        scheduled_run_at: scheduledRunAt,
        $limit: 1,
      },
      paginate: false,
    });

    if (Array.isArray(existingSessions) && existingSessions.length > 0) {
      console.log(
        `⏭️  Skipping ${worktree.name}: session already exists for run ${new Date(scheduledRunAt).toISOString()}`
      );
      // Still update next_run_at to prevent repeated checks
      await this.updateScheduleMetadata(worktree, scheduledRunAt, now);
      return;
    }

    // 2. Render prompt template
    const renderedPrompt = this.renderPrompt(schedule.prompt_template, worktree);

    // 3. Get current run index (count of all scheduled sessions for this worktree)
    const allScheduledSessions = await sessionsService.find({
      query: {
        worktree_id: worktree.worktree_id,
        scheduled_from_worktree: true,
      },
      paginate: false,
    });
    const runIndex = Array.isArray(allScheduledSessions) ? allScheduledSessions.length + 1 : 1;

    // 4. Create session with schedule metadata
    const session: Partial<Session> = {
      worktree_id: worktree.worktree_id,
      agentic_tool: schedule.agentic_tool,
      status: SessionStatus.IDLE,
      created_by: worktree.created_by,
      scheduled_run_at: scheduledRunAt,
      scheduled_from_worktree: true,
      title: `Scheduled: ${worktree.name}`,
      contextFiles: schedule.context_files ?? [],
      permission_config: schedule.permission_mode
        ? { mode: schedule.permission_mode as PermissionMode }
        : undefined,
      model_config:
        schedule.model_config?.mode === 'custom' && schedule.model_config.model
          ? {
              mode: 'exact',
              model: schedule.model_config.model,
              updated_at: new Date(now).toISOString(),
            }
          : undefined,
      custom_context: {
        scheduled_run: {
          rendered_prompt: renderedPrompt,
          run_index: runIndex,
          schedule_config_snapshot: {
            cron: worktree.schedule_cron,
            timezone: schedule.timezone,
            retention: schedule.retention,
          },
        },
      },
    };

    try {
      const createdSession = await sessionsService.create(session);
      console.log(
        `✅ Spawned scheduled session ${createdSession.session_id} for ${worktree.name} (run #${runIndex})`
      );

      // TODO: Attach MCP servers if specified in schedule.mcp_server_ids
      // TODO: Send initial prompt to agent (not implemented in this phase)

      // 5. Update schedule metadata
      await this.updateScheduleMetadata(worktree, scheduledRunAt, now);

      // 6. Enforce retention policy
      await this.enforceRetentionPolicy(worktree);
    } catch (error) {
      console.error(`❌ Failed to spawn session for ${worktree.name}:`, error);
      throw error;
    }
  }

  /**
   * Render Handlebars prompt template with worktree/board context
   */
  private renderPrompt(template: string, worktree: Worktree): string {
    try {
      const compiledTemplate = Handlebars.compile(template);

      // Build context for template rendering
      const context = {
        worktree: {
          name: worktree.name,
          ref: worktree.ref,
          path: worktree.path,
          issue_url: worktree.issue_url,
          pull_request_url: worktree.pull_request_url,
          notes: worktree.notes,
          custom_context: worktree.custom_context,
        },
        // TODO: Add board context if needed (requires fetching board data)
        schedule: worktree.schedule,
      };

      return compiledTemplate(context);
    } catch (error) {
      console.error(`❌ Failed to render prompt template:`, error);
      // Fallback to raw template if rendering fails
      return template;
    }
  }

  /**
   * Update worktree schedule metadata after spawning session
   *
   * - last_triggered_at = scheduledRunAt (not current time!)
   * - next_run_at = next occurrence from cron expression
   */
  private async updateScheduleMetadata(
    worktree: Worktree,
    scheduledRunAt: number,
    now: number
  ): Promise<void> {
    if (!worktree.schedule_cron) {
      return;
    }

    try {
      // Compute next run time from cron expression
      const nextRunAt = getNextRunTime(worktree.schedule_cron, new Date(now));

      // Update worktree
      const worktreesService = this.app.service('worktrees');
      await worktreesService.patch(worktree.worktree_id, {
        schedule_last_triggered_at: scheduledRunAt, // Use scheduled time, not execution time
        schedule_next_run_at: nextRunAt,
      });

      if (this.config.debug) {
        console.log(`   📅 Updated schedule: next run at ${new Date(nextRunAt).toISOString()}`);
      }
    } catch (error) {
      console.error(`❌ Failed to update schedule metadata:`, error);
      throw error;
    }
  }

  /**
   * Enforce retention policy for scheduled sessions
   *
   * - retention = 0: Keep all sessions
   * - retention = N: Keep last N sessions, delete older ones
   */
  private async enforceRetentionPolicy(worktree: Worktree): Promise<void> {
    if (!worktree.schedule || worktree.schedule.retention === 0) {
      // retention = 0 means keep forever
      return;
    }

    const retention = worktree.schedule.retention;

    try {
      // Fetch all scheduled sessions for this worktree, ordered by scheduled_run_at DESC
      const sessionsService = this.app.service('sessions');
      const allSessions = await sessionsService.find({
        query: {
          worktree_id: worktree.worktree_id,
          scheduled_from_worktree: true,
          $sort: {
            scheduled_run_at: -1, // Newest first
          },
        },
        paginate: false,
      });

      if (!Array.isArray(allSessions)) {
        return;
      }

      // Keep first N sessions, delete the rest
      const sessionsToDelete = allSessions.slice(retention);

      if (sessionsToDelete.length > 0) {
        if (this.config.debug) {
          console.log(
            `   🗑️  Deleting ${sessionsToDelete.length} old sessions (retention: ${retention})`
          );
        }

        for (const session of sessionsToDelete) {
          await sessionsService.remove(session.session_id);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to enforce retention policy:`, error);
      // Don't throw - retention failure shouldn't block scheduling
    }
  }
}
