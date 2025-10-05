# State Management Architecture (Exploration)

Related: [[models]], [[architecture]], [[architecture-api]], [[state-broadcasting]]

**Status:** Exploration (Drizzle + Feathers decision made)
**Date:** January 2025
**Last Updated:** January 2025 (after Feathers architecture decision)

---

## Executive Summary

**Chosen Stack:**
- **ORM:** Drizzle ORM (type-safe, lightweight, schema-driven)
- **Database:** LibSQL (V1 local) / PostgreSQL (V2 cloud)
- **API Layer:** FeathersJS (REST + WebSocket, built on Drizzle)

See [[architecture-api]] for complete architecture and [[state-broadcasting]] for real-time sync.

This document focuses on the **persistence layer** (Drizzle + database schema).

---

## The Challenge

Agor needs a state management layer that:
- Abstracts storage implementation (local → cloud migration path)
- Handles CRUD operations for Sessions, Tasks, Boards
- Supports complex queries (session trees, genealogy traversal)
- Maintains relationships (Session → Tasks, Board → Sessions)
- Enables transactions (create session + initial task atomically)
- Avoids migration hell (schema evolution without constant migrations)

### Current State

The UI prototype uses in-memory mock data. The real application needs persistent storage with:
- **V1 (local)**: Desktop app, local database
- **V2 (cloud)**: Sync to cloud, collaborative features
- **Export/Import**: Share session trees via files

---

## Alternatives Considered

### 1. Raw LibSQL Client
**Approach:** Use `@libsql/client` directly, write SQL queries manually

**Pros:**
- Zero abstraction, full control
- Tiny bundle size (~2kb)
- No ORM learning curve

**Cons:**
- Manual JSON stringify/parse for all data fields
- Type safety is manual (casting row types)
- No query builder helpers
- More boilerplate code

**Verdict:** Too low-level for rapid development

---

### 2. Kysely Query Builder
**Approach:** Type-safe SQL query builder

**Pros:**
- Lightweight (~5kb)
- Type-safe query construction
- No schema definition needed (just TypeScript interfaces)
- LibSQL dialect available (`@libsql/kysely-libsql`)

**Cons:**
- Manual JSON handling (stringify/parse)
- No built-in migrations (need `kysely-ctl` or custom)
- More DIY than Drizzle

**Verdict:** Good middle ground, but Drizzle offers better DX

---

### 3. Object Store (RxDB/PouchDB)
**Approach:** Document-based storage with built-in sync

**Pros:**
- Document-based (matches JSON structure)
- Built-in sync to cloud (PouchDB → CouchDB)
- Offline-first by design
- Observable queries (reactive UI)

**Cons:**
- Less suited for relational data (Session → Tasks relationships)
- Complex genealogy queries harder than SQL
- Larger bundle size
- Overkill for V1 (local-only)

**Verdict:** Better for pure document stores, not relational session trees

---

## Recommended Approach: Drizzle ORM + LibSQL

### Why Drizzle?

**1. Type-Safe with Zero Runtime Overhead**
- Full TypeScript inference from schema to queries
- JSON columns get typed with `.$type<T>()`
- Compile-time validation of queries

**2. Automatic JSON Handling**
- No manual `JSON.parse()` / `JSON.stringify()`
- Define JSON column type once, Drizzle handles serialization

**3. Migration-Free Workflow**
- Define schema for types (not necessarily for migrations)
- JSON-heavy schema means most changes are TypeScript-only
- Only materialize columns you filter/sort by

**4. LibSQL First-Class Support**
- Works with local SQLite files (`file:./agor.db`)
- Works with Turso cloud (`libsql://your-db.turso.io`)
- Same code, just change connection URL for V1 → V2

**5. Relational Query Helpers**
- Built-in helpers for Session → Tasks joins
- Can still drop to raw SQL when needed

---

### Why LibSQL?

**1. Local → Cloud Path**
- V1: Embedded SQLite file (`.agor/agor.db`)
- V2: Turso cloud endpoint (same Drizzle code)
- No code rewrite needed

**2. Portability**
- SQLite file is portable (single file database)
- Can export SQL dumps for sharing
- Can export to JSON for git-friendly session trees

**3. Performance**
- Better than filesystem for complex queries (genealogy, search)
- Indexed queries for session filtering
- Transactions for atomic operations

---

## Architecture

### Repository Pattern

**Abstract interfaces define what the app needs:**

```typescript
interface ISessionRepository {
  create(session: Session): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  findByBoard(boardId: string): Promise<Session[]>;
  findByStatus(status: SessionStatus): Promise<Session[]>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
  delete(id: string): Promise<void>;

  // Genealogy queries
  findChildren(sessionId: string): Promise<Session[]>;
  findAncestors(sessionId: string): Promise<Session[]>;
}

interface ITaskRepository {
  create(task: Task): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findBySession(sessionId: string): Promise<Task[]>;
  update(id: string, updates: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;
}

interface IBoardRepository {
  create(board: Board): Promise<Board>;
  findAll(): Promise<Board[]>;
  findById(id: string): Promise<Board | null>;
  update(id: string, updates: Partial<Board>): Promise<Board>;
  delete(id: string): Promise<void>;
}
```

**State container (dependency injection):**

```typescript
class AgorState {
  constructor(
    public sessions: ISessionRepository,
    public tasks: ITaskRepository,
    public boards: IBoardRepository
  ) {}
}

// Factory picks implementation
function createAgorState(config: AgorConfig): AgorState {
  const db = createDrizzleClient(config.dbPath);
  return new AgorState(
    new DrizzleSessionRepository(db),
    new DrizzleTaskRepository(db),
    new DrizzleBoardRepository(db)
  );
}
```

---

## JSON-Heavy Schema Strategy

### The Anti-Migration Philosophy

**Problem:** Traditional ORMs require migrations for every schema change. This is painful.

**Solution:** Put 95% of data in JSON columns. Schema evolution happens via TypeScript type updates.

### Minimal Materialized Columns

**Only create columns for what you filter/sort/index:**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  status TEXT NOT NULL,  -- Filter by status frequently
  data TEXT NOT NULL     -- JSON blob with everything else
);

CREATE INDEX sessions_status_idx ON sessions(status);
CREATE INDEX sessions_created_idx ON sessions(created_at);
```

**Everything else goes in JSON:**
- `agent` (rarely filter by this alone)
- `description`
- `git_state`
- `genealogy`
- `concepts`
- `tasks` (task IDs list)
- `message_count`
- `tool_use_count`

### ID Management with UUIDv7

**All entities use UUIDv7 for primary keys:**

- **Format:** `01933e4a-7b89-7c35-a8f3-9d2e1c4b5a6f` (36 chars)
- **Time-ordered:** First 48 bits = Unix timestamp (ms)
- **Globally unique:** 2^122 possible values
- **B-tree friendly:** Sequential IDs improve index performance

**Short ID Display:**

- Store full UUID in database
- Display 8-char prefix to users (`01933e4a`)
- Git-style collision resolution (expand to 12+ chars when ambiguous)
- Efficient prefix matching via `LIKE 'prefix%'` on indexed TEXT column

**See:** `context/concepts/id-management.md` for complete details.

```typescript
import { generateId } from '@/lib/ids';

// Generate UUIDv7 at application level
const sessionId = generateId();
// => "01933e4a-7b89-7c35-a8f3-9d2e1c4b5a6f"

// SQLite doesn't have built-in UUID generation,
// so we use Drizzle's $defaultFn()
```

---

### Drizzle Schema Definition

```typescript
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { generateId } from '@/lib/ids';

export const sessions = sqliteTable('sessions', {
  // Materialized columns (queryable, indexed)
  session_id: text('session_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }),
  status: text('status', {
    enum: ['idle', 'running', 'completed', 'failed']
  }).notNull(),

  // JSON blob (flexible schema)
  data: text('data', { mode: 'json' }).$type<{
    agent: 'claude-code' | 'cursor' | 'codex' | 'gemini';
    agent_version?: string;
    description?: string;
    git_state: {
      ref: string;
      base_sha: string;
      current_sha: string;
    };
    worktree?: {
      path: string;
      managed_by_agor: boolean;
    };
    genealogy: {
      forked_from_session_id?: string;
      fork_point_task_id?: string;
      parent_session_id?: string;
      spawn_point_task_id?: string;
      children: string[];
    };
    concepts: string[];
    tasks: string[];
    message_count: number;
    tool_use_count: number;
  }>().notNull(),
}, (table) => ({
  statusIdx: index('status_idx').on(table.status),
  createdIdx: index('created_idx').on(table.created_at),
}));

export const tasks = sqliteTable('tasks', {
  task_id: text('task_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  session_id: text('session_id', { length: 36 })
    .notNull()
    .references(() => sessions.session_id, { onDelete: 'cascade' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  status: text('status', {
    enum: ['created', 'running', 'completed', 'failed']
  }).notNull(),

  data: text('data', { mode: 'json' }).$type<{
    description: string;
    full_prompt: string;
    message_range: {
      start_index: number;
      end_index: number;
      start_timestamp: string;
      end_timestamp?: string;
    };
    git_state: {
      sha_at_start: string;
      sha_at_end?: string;
      commit_message?: string;
    };
    model: string;
    tool_use_count: number;
    report?: {
      template: string;
      path: string;
      generated_at: string;
    };
  }>().notNull(),
}, (table) => ({
  sessionIdx: index('task_session_idx').on(table.session_id),
  statusIdx: index('task_status_idx').on(table.status),
}));

export const boards = sqliteTable('boards', {
  board_id: text('board_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),

  data: text('data', { mode: 'json' }).$type<{
    name: string;
    description?: string;
    sessions: string[];  // UUIDs
    color?: string;
    icon?: string;
  }>().notNull(),
});
```

### Schema Evolution (Migration-Free)

**Adding a new field?** Just update the TypeScript type:

```typescript
// Before
data: text('data', { mode: 'json' }).$type<{
  agent: string;
  git_state: GitState;
}>().notNull(),

// After (no migration needed!)
data: text('data', { mode: 'json' }).$type<{
  agent: string;
  git_state: GitState;
  worktree_config?: WorktreeConfig;  // NEW FIELD
}>().notNull(),
```

Old sessions without `worktree_config`? TypeScript handles it (optional field).

**Promoting a field to column** (only if you need to filter/sort by it):

```sql
-- Rare case: Need to filter by agent frequently
ALTER TABLE sessions ADD COLUMN agent TEXT;
UPDATE sessions SET agent = json_extract(data, '$.agent');
CREATE INDEX agent_idx ON sessions(agent);
```

---

### Short ID Resolution & Indexing

**CLI/UI users input short IDs (8 chars), database stores full UUIDs (36 chars).**

**Efficient Prefix Matching:**

```typescript
// User input: "01933e4a"
// Query pattern: "01933e4a%"

const sessions = await db
  .select()
  .from(sessionsTable)
  .where(sql`session_id LIKE ${shortIdPrefix + '%'}`)
  .all();

if (sessions.length === 1) {
  return sessions[0];
} else if (sessions.length > 1) {
  throw new Error('Ambiguous ID - use longer prefix');
} else {
  throw new Error('Session not found');
}
```

**B-tree Index Performance:**

- Primary key on `session_id` automatically creates B-tree index
- `LIKE 'prefix%'` queries use index for seek (O(log n))
- Matches are typically 1-10 entities (fast scan)
- No additional indexes needed for short ID resolution

**Alternative: Range Query (slightly faster):**

```typescript
// Convert "01933e4a" to range
// Start: "01933e4a"
// End:   "01933e4b" (increment last char)

const sessions = await db
  .select()
  .from(sessionsTable)
  .where(
    and(
      gte(sessionsTable.session_id, '01933e4a'),
      lt(sessionsTable.session_id, '01933e4b')
    )
  )
  .all();
```

**See:** `src/lib/ids.ts` for resolution utilities.

---

## Implementation Roadmap

### Phase 1: Setup & Core Repository

**1. Install dependencies**
```bash
npm install @libsql/client drizzle-orm
npm install -D drizzle-kit
```

**2. Create setup script** (`scripts/setup-db.ts`)
- One-time database initialization
- Creates tables with minimal columns
- Runs on first launch or via `npm run db:setup`

**3. Define Drizzle schema** (`src/db/schema.ts`)
- Schema definitions for type inference
- No migrations (just TypeScript types for JSON blobs)

**4. Implement repositories** (`src/repositories/`)
- `DrizzleSessionRepository`
- `DrizzleTaskRepository`
- `DrizzleBoardRepository`

**5. Create state factory** (`src/db/state.ts`)
- `createAgorState(config)` function
- Initializes Drizzle client + repositories

### Phase 2: UI Integration

**1. Replace mock data with repository calls**
- Update `App.tsx` to use `AgorState` instance
- Load sessions/tasks/boards from DB on mount

**2. Add state mutations**
- Create session handler → `state.sessions.create()`
- Update session status → `state.sessions.update()`
- Delete session → `state.sessions.delete()`

**3. Add optimistic updates** (optional)
- Update UI immediately, sync to DB async
- Rollback on error

### Phase 3: Export/Import

**1. Export to JSON**
- `agor export` command
- Writes sessions to `.agor/sessions/*.json` (git-friendly)

**2. Import from JSON**
- `agor import` command
- Reads JSON files, inserts into DB

**3. SQL dump export**
- `sqlite3 .agor/agor.db .dump > session-tree.sql`
- Portable, shareable

---

## V1 → V2 Migration Path

### V1: Local Desktop App

```typescript
import { createClient } from '@libsql/client';

const client = createClient({
  url: 'file:./.agor/agor.db'
});
```

### V2: Cloud Sync (Turso)

```typescript
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,

  // Optional: Embedded replica for offline-first
  syncUrl: process.env.TURSO_DATABASE_URL,
});
```

**Same Drizzle code, just different connection config.**

---

## Open Questions

1. **When to promote fields from JSON to columns?**
   - Current thinking: Only when filtering/sorting frequently
   - Need to monitor query patterns in V1

2. **Transaction management for complex operations?**
   - Example: Create session + initial task atomically
   - Drizzle supports transactions: `db.transaction(async (tx) => { ... })`

3. **Export format preference?**
   - JSON files (git-friendly, human-readable)
   - SQL dumps (portable, includes schema)
   - Both? JSON for sharing, SQL for backup?

4. **Filesystem fallback needed?**
   - Current thinking: No, ship with LibSQL from V1
   - Export to JSON is sufficient for portability

---

## Next Steps

1. **Validate approach with prototype** - Build minimal working example
2. **Define repository interfaces** - Finalize method signatures
3. **Create setup script** - One-time DB initialization
4. **Implement first repository** - `DrizzleSessionRepository` as proof of concept
5. **Integrate with UI** - Replace mock data in App.tsx

Once validated, crystallize into `context/concepts/architecture.md`.

---

## References

- Drizzle ORM: https://orm.drizzle.team/
- LibSQL: https://github.com/tursodatabase/libsql
- Turso (LibSQL cloud): https://turso.tech/
