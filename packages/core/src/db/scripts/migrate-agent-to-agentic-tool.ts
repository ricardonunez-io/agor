/**
 * Migration: Rename agent → agentic_tool
 *
 * Updates sessions table to use agentic_tool terminology:
 * - Renames `agent` column to `agentic_tool`
 * - Updates JSON data fields: agent_version → agentic_tool_version, agent_session_id → sdk_session_id
 * - Drops and recreates index with new name
 *
 * This is a breaking change but acceptable pre-1.0.
 * Safe to run - backs up data before modifying.
 */

import { sql } from 'drizzle-orm';
import { createDatabase } from '../index';

const DB_PATH = process.env.AGOR_DB_PATH || 'file:~/.agor/agor.db';

async function migrate() {
  console.log('📦 Connecting to database:', DB_PATH);
  const db = createDatabase({ url: DB_PATH });

  console.log('🔄 Running migration: Rename agent → agentic_tool...');
  console.log('');

  try {
    // Step 1: Rename the materialized column (SQLite doesn't support ALTER COLUMN, so we use ALTER TABLE RENAME)
    console.log('1️⃣  Renaming agent column to agentic_tool...');
    await db.run('ALTER TABLE sessions RENAME COLUMN agent TO agentic_tool');
    console.log('✅ Renamed sessions.agent → sessions.agentic_tool');

    // Step 2: Drop old index and create new one
    console.log('');
    console.log('2️⃣  Updating indexes...');
    await db.run('DROP INDEX IF EXISTS sessions_agent_idx');
    await db.run('CREATE INDEX sessions_agentic_tool_idx ON sessions(agentic_tool)');
    console.log('✅ Recreated index: sessions_agentic_tool_idx');

    // Step 3: Update JSON data fields (agent_version → agentic_tool_version, agent_session_id → sdk_session_id)
    console.log('');
    console.log('3️⃣  Updating JSON data fields...');

    // Get all sessions
    const sessions = (await db.all('SELECT session_id, data FROM sessions')) as Array<{
      session_id: string;
      data: string;
    }>;
    console.log(`   Found ${sessions.length} sessions to update`);

    let updated = 0;
    for (const session of sessions) {
      const data = JSON.parse(session.data) as Record<string, unknown>;
      let modified = false;

      // Rename agent_version → agentic_tool_version
      if ('agent_version' in data) {
        data.agentic_tool_version = data.agent_version;
        delete data.agent_version;
        modified = true;
      }

      // Rename agent_session_id → sdk_session_id
      if ('agent_session_id' in data) {
        data.sdk_session_id = data.agent_session_id;
        delete data.agent_session_id;
        modified = true;
      }

      if (modified) {
        await db.run(
          sql.raw(
            `UPDATE sessions SET data = '${JSON.stringify(data).replace(/'/g, "''")}' WHERE session_id = '${session.session_id}'`
          )
        );
        updated++;
      }
    }

    console.log(`✅ Updated ${updated} session data blobs`);

    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Changes applied:');
    console.log('  - sessions.agent → sessions.agentic_tool (column renamed)');
    console.log('  - data.agent_version → data.agentic_tool_version');
    console.log('  - data.agent_session_id → data.sdk_session_id');
    console.log('  - Index renamed: sessions_agentic_tool_idx');
    console.log('');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('');
    console.error('If you see "no such column: agent", the migration was already applied.');
    console.error('If you see other errors, you may need to restore from backup.');
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
