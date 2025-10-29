/**
 * Migration: Add MCP tables
 *
 * Adds mcp_servers and session_mcp_servers tables to existing database.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import { createDatabase } from '../index';

const DB_PATH = process.env.AGOR_DB_PATH || 'file:~/.agor/agor.db';

async function migrate() {
  console.log('📦 Connecting to database:', DB_PATH);
  const db = createDatabase({ url: DB_PATH });

  console.log('🔄 Running migration: Add MCP tables...');

  try {
    // Create mcp_servers table
    await db.run(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        mcp_server_id TEXT PRIMARY KEY NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,

        -- Materialized columns for filtering/joins
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http', 'sse')),
        scope TEXT NOT NULL CHECK (scope IN ('global', 'team', 'repo', 'session')),
        enabled INTEGER NOT NULL DEFAULT 1,

        -- Scope foreign keys (materialized for indexes)
        owner_user_id TEXT,
        team_id TEXT,
        repo_id TEXT REFERENCES repos(repo_id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,

        -- Source tracking
        source TEXT NOT NULL CHECK (source IN ('user', 'imported', 'agor')),

        -- JSON blob for configuration and capabilities
        data TEXT NOT NULL
      )
    `);
    console.log('✅ Created mcp_servers table');

    // Create indexes for mcp_servers
    await db.run('CREATE INDEX IF NOT EXISTS idx_mcp_servers_scope ON mcp_servers(scope)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled)');
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_owner_user_id ON mcp_servers(owner_user_id)'
    );
    await db.run('CREATE INDEX IF NOT EXISTS idx_mcp_servers_team_id ON mcp_servers(team_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_mcp_servers_repo_id ON mcp_servers(repo_id)');
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_mcp_servers_session_id ON mcp_servers(session_id)'
    );
    console.log('✅ Created mcp_servers indexes');

    // Create session_mcp_servers junction table
    await db.run(`
      CREATE TABLE IF NOT EXISTS session_mcp_servers (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(mcp_server_id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL,

        PRIMARY KEY (session_id, mcp_server_id)
      )
    `);
    console.log('✅ Created session_mcp_servers table');

    // Create indexes for session_mcp_servers
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_session_mcp_servers_session_id ON session_mcp_servers(session_id)'
    );
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_session_mcp_servers_mcp_server_id ON session_mcp_servers(mcp_server_id)'
    );
    console.log('✅ Created session_mcp_servers indexes');

    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Tables added:');
    console.log('  - mcp_servers');
    console.log('  - session_mcp_servers');
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
