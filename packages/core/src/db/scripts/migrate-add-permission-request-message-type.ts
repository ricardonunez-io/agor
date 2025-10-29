/**
 * Migration: Add 'permission_request' type to messages table
 *
 * SQLite doesn't support ALTER TABLE to modify CHECK constraints,
 * so we need to recreate the table with the new constraint.
 */

import { createDatabase } from '../client';

const DB_PATH = process.env.AGOR_DB_PATH || 'file:~/.agor/agor.db';

async function migrate() {
  console.log(`📦 Connecting to database: ${DB_PATH}`);
  const db = createDatabase({ url: DB_PATH });

  console.log('🔄 Adding permission_request type to messages table...');

  // SQLite migration strategy: Create new table, copy data, swap tables
  await db.run(`
    -- Create new messages table with updated type enum
    CREATE TABLE messages_new (
      message_id TEXT(36) PRIMARY KEY,
      created_at INTEGER NOT NULL,
      session_id TEXT(36) NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      task_id TEXT(36) REFERENCES tasks(task_id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('user', 'assistant', 'system', 'file-history-snapshot', 'permission_request')),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      "index" INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      content_preview TEXT,
      data TEXT NOT NULL
    );
  `);

  console.log('  ✓ Created new messages table with updated constraint');

  await db.run(`
    -- Copy all data from old table to new table
    INSERT INTO messages_new SELECT * FROM messages;
  `);

  console.log('  ✓ Copied all message data');

  await db.run(`
    -- Drop old table
    DROP TABLE messages;
  `);

  console.log('  ✓ Dropped old messages table');

  await db.run(`
    -- Rename new table to messages
    ALTER TABLE messages_new RENAME TO messages;
  `);

  console.log('  ✓ Renamed new table to messages');

  // Recreate indexes
  await db.run(`CREATE INDEX messages_session_id_idx ON messages(session_id);`);
  await db.run(`CREATE INDEX messages_task_id_idx ON messages(task_id);`);
  await db.run(`CREATE INDEX messages_session_index_idx ON messages(session_id, "index");`);

  console.log('  ✓ Recreated indexes');

  console.log('✅ Migration complete!');
  console.log(
    '   Messages table now supports: user, assistant, system, file-history-snapshot, permission_request'
  );

  process.exit(0);
}

migrate().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
