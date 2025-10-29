/**
 * Migration: Add onboarding_completed column to users table
 *
 * Adds onboarding_completed boolean column to track if user has completed onboarding.
 * Safe to run multiple times (column is added only if it doesn't exist).
 */

import { createDatabase } from '../index';

const DB_PATH = process.env.AGOR_DB_PATH || 'file:~/.agor/agor.db';

async function migrate() {
  console.log('📦 Connecting to database:', DB_PATH);
  const db = createDatabase({ url: DB_PATH });

  console.log('🔄 Running migration: Add onboarding_completed column...');

  try {
    // Check if column already exists
    const tableInfo = (await db.all(`PRAGMA table_info(users)`)) as Array<{ name: string }>;
    const columnExists = tableInfo.some((col) => col.name === 'onboarding_completed');

    if (columnExists) {
      console.log('✅ Column onboarding_completed already exists, skipping...');
    } else {
      // Add onboarding_completed column with default value 0 (false)
      await db.run(`
        ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0
      `);
      console.log('✅ Added onboarding_completed column to users table');
    }

    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Column added:');
    console.log('  - users.onboarding_completed (INTEGER, default: 0)');
    console.log('');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
