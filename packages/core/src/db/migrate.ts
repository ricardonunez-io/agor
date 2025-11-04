/**
 * Database Migration Runner
 *
 * Uses Drizzle's built-in migration system to automatically apply schema changes.
 *
 * **How it works:**
 * - Migrations are auto-generated from schema.ts using `pnpm db:generate`
 * - Migration SQL files live in drizzle/ folder
 * - Drizzle tracks applied migrations in __drizzle_migrations table
 * - Each migration runs in a transaction (auto-rollback on failure)
 *
 * **Developer workflow:**
 * 1. Edit schema.ts to make schema changes
 * 2. Run `pnpm db:generate` to create migration SQL
 * 3. Review generated SQL in drizzle/XXXX.sql
 * 4. Commit migration to git
 * 5. Daemon auto-applies on startup
 *
 * **Single source of truth:** packages/core/src/db/schema.ts
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcryptjs from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { Database } from './client';
import { boards, users } from './schema';

/**
 * Error thrown when migration fails
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Check if migrations tracking table exists
 */
async function hasMigrationsTable(db: Database): Promise<boolean> {
  try {
    const result = await db.run(sql`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='__drizzle_migrations'
    `);
    return result.rows.length > 0;
  } catch (error) {
    throw new MigrationError(
      `Failed to check migrations table: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Bootstrap existing databases to use Drizzle migrations
 *
 * For databases created before the migration system:
 * - Creates __drizzle_migrations table
 * - Marks baseline migration as applied
 * - Allows future migrations to run normally
 *
 * Safe to run multiple times (idempotent).
 */
async function bootstrapMigrations(db: Database): Promise<void> {
  try {
    console.log('🔧 Bootstrapping migration tracking...');

    const hasTable = await hasMigrationsTable(db);
    if (hasTable) {
      console.log('✅ Already bootstrapped (migrations table exists)');
      return;
    }

    // Create migrations table (Drizzle's schema)
    await db.run(sql`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Mark baseline migration as applied
    // This hash comes from drizzle/meta/_journal.json: "tag": "0000_pretty_mac_gargan"
    const baselineHash = '0000_pretty_mac_gargan';
    await db.run(sql`
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES (${baselineHash}, ${Date.now()})
    `);

    console.log('✅ Bootstrap complete!');
    console.log('   Baseline migration marked as applied');
    console.log('   Future migrations will run normally');
  } catch (error) {
    throw new MigrationError(
      `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Run all pending database migrations
 *
 * Uses Drizzle's built-in migration system:
 * - Reads SQL files from drizzle/ folder
 * - Tracks applied migrations in __drizzle_migrations table
 * - Runs migrations in transaction (auto-rollback on failure)
 *
 * Safe to call multiple times - only runs pending migrations.
 *
 * For existing databases (created before migration system):
 * - Automatically bootstraps migration tracking
 * - Marks baseline migration as applied
 */
export async function runMigrations(db: Database): Promise<void> {
  try {
    console.log('Running database migrations...');

    // Resolve migrations folder path relative to this file
    // In production (dist): dist/core/db/migrate.js -> dist/core/drizzle (go up 1 level)
    // In dev (tsx): packages/core/src/db/migrate.ts -> packages/core/drizzle (go up 2 levels from src/db/)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const isProduction = __dirname.includes('/dist/');
    const migrationsFolder = join(__dirname, isProduction ? '..' : '../..', 'drizzle');

    // Drizzle handles everything:
    // 1. Creates __drizzle_migrations table if needed
    // 2. Checks which migrations are pending
    // 3. Runs them in order within transaction
    // 4. Updates tracking table
    await migrate(db, { migrationsFolder });

    console.log('✅ Migrations complete');
  } catch (error) {
    throw new MigrationError(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * DEPRECATED: Use runMigrations() instead
 *
 * Kept for backwards compatibility during transition.
 * Will be removed in future version.
 */
export async function initializeDatabase(db: Database): Promise<void> {
  console.warn('⚠️  initializeDatabase() is deprecated. Use runMigrations() instead.');
  await runMigrations(db);
}

/**
 * Seed initial data (default board only)
 *
 * Note: Does NOT create a default admin user.
 * Admin users must be created explicitly via `agor user create-admin` or during `agor init`
 */
export async function seedInitialData(db: Database): Promise<void> {
  try {
    const { generateId } = await import('../lib/ids');
    const now = Date.now();

    // 1. Check if default board exists (by slug to avoid duplicates)
    const existingBoard = await db.select().from(boards).where(eq(boards.slug, 'default')).get();

    if (!existingBoard) {
      // Create default board
      const boardId = generateId();

      await db.run(sql`
        INSERT INTO boards (board_id, name, slug, created_at, updated_at, created_by, data)
        VALUES (
          ${boardId},
          ${'Main Board'},
          ${'default'},
          ${now},
          ${now},
          ${'anonymous'},
          ${JSON.stringify({
            description: 'Main board for all sessions',
            sessions: [],
            color: '#1677ff',
            icon: '⭐',
          })}
        )
      `);

      console.log('✅ Main Board created');
    }
  } catch (error) {
    throw new MigrationError(
      `Failed to seed initial data: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}
