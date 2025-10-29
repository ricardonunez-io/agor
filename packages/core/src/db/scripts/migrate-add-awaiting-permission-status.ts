/**
 * Migration: Add 'awaiting_permission' status to tasks table
 *
 * SQLite doesn't support ALTER TABLE to modify CHECK constraints,
 * so we need to recreate the table with the new constraint.
 */

import { createDatabase } from '../client';

const DB_PATH = process.env.AGOR_DB_PATH || 'file:~/.agor/agor.db';

async function migrate() {
  console.log(`📦 Connecting to database: ${DB_PATH}`);
  const db = createDatabase({ url: DB_PATH });

  console.log('🔄 Adding awaiting_permission status to tasks table...');

  // SQLite migration strategy: Create new table, copy data, swap tables
  await db.run(`
    -- Create new tasks table with updated status enum
    CREATE TABLE tasks_new (
      task_id TEXT(36) PRIMARY KEY,
      session_id TEXT(36) NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('created', 'running', 'awaiting_permission', 'completed', 'failed')),
      created_by TEXT(36) NOT NULL DEFAULT 'anonymous',
      data TEXT NOT NULL
    );
  `);

  console.log('  ✓ Created new tasks table with updated constraint');

  await db.run(`
    -- Copy all data from old table to new table
    INSERT INTO tasks_new SELECT * FROM tasks;
  `);

  console.log('  ✓ Copied all task data');

  await db.run(`
    -- Drop old table
    DROP TABLE tasks;
  `);

  console.log('  ✓ Dropped old tasks table');

  await db.run(`
    -- Rename new table to tasks
    ALTER TABLE tasks_new RENAME TO tasks;
  `);

  console.log('  ✓ Renamed new table to tasks');

  // Recreate indexes
  await db.run(`CREATE INDEX tasks_session_idx ON tasks(session_id);`);
  await db.run(`CREATE INDEX tasks_status_idx ON tasks(status);`);
  await db.run(`CREATE INDEX tasks_created_idx ON tasks(created_at);`);

  console.log('  ✓ Recreated indexes');

  console.log('✅ Migration complete!');
  console.log(
    '   Tasks table now supports: created, running, awaiting_permission, completed, failed'
  );

  process.exit(0);
}

migrate().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
