# State Broadcasting & Multi-Client Sync (Exploration)

Related: [[state-management]], [[agent-interface]], [[core]], [[architecture-api]]

**Status:** Exploration (FeathersJS decision made, see [[architecture-api]])
**Date:** January 2025
**Last Updated:** January 2025 (after FeathersJS architecture decision)

---

## Executive Summary

**Decision:** Use **FeathersJS** for unified real-time architecture across V1 (local) and V2 (cloud).

See [[architecture-api]] for full stack architecture. This document explores the multi-client sync challenges and how FeathersJS solves them.

---

## The Challenge

**Most complex architectural component of Agor:** How do we keep multiple UI instances in sync with live agent state changes?

### Scenarios

1. **Single user, multiple windows** (V1)
   - User opens Agor in 2 browser windows
   - Agent completes task in Session A
   - Both windows should update immediately

2. **Team collaboration** (V2 - Agor Cloud)
   - User A watches Session X while User B runs tasks
   - Changes stream in real-time
   - "Real-time strategy multiplayer for AI development"

3. **Agent → UI live updates** (Both V1 & V2)
   - Agent streams messages during task execution
   - UI updates incrementally (word-by-word streaming)
   - Status changes, tool calls, git state all broadcast

### Core Problem

**Traditional web app:** Server has authority, clients poll or subscribe

**Agor V1:** Desktop app, local DB, no server - how do windows sync?

**Agor V2:** Cloud-hosted, real-time multiplayer - full collaborative infrastructure

---

## Requirements

### Functional Requirements

1. **Real-time updates**
   - Latency: <100ms for local, <500ms for cloud
   - Changes propagate to all connected clients
   - No full page refresh needed

2. **Event types to broadcast**
   - Session created/updated/deleted
   - Task created/started/completed
   - Message streamed (incremental chunks)
   - Tool call started/completed
   - Git state changed
   - Board membership changed

3. **Offline tolerance** (V1)
   - Desktop app works offline
   - Multiple windows sync when both online
   - Graceful degradation if sync fails

4. **Conflict resolution** (V2)
   - Two users edit same session simultaneously
   - Deterministic merge strategy
   - No data loss

### Non-Functional Requirements

1. **Performance**
   - Scale to 100+ concurrent sessions (V2)
   - Handle high-frequency updates (streaming messages)
   - Low memory footprint per client

2. **Reliability**
   - Messages delivered at-least-once
   - No lost updates
   - Reconnection handling

3. **Security** (V2)
   - Only authorized users see session updates
   - Session-level permissions
   - Encrypted transport

---

## Architecture Options

### V1: Local Desktop App Sync

**Challenge:** No central server, multiple Electron/Tauri windows need to sync

#### Option 1: Shared Database (LibSQL File)

**Approach:**
- All windows connect to same `.agor/agor.db` file
- SQLite supports multiple readers, single writer
- Windows poll for changes or use file watch

**Pros:**
- Simple, no additional infrastructure
- Works offline by default

**Cons:**
- Polling is inefficient for real-time updates
- Write conflicts if multiple windows try to update
- No true push model

**Verdict:** Too slow for real-time feel

---

#### Option 2: IPC (Inter-Process Communication)

**Approach:**
- One "main" Agor process owns DB
- Additional windows connect via IPC (Electron/Tauri IPC)
- Main process broadcasts changes to all windows

**Pros:**
- True push model (no polling)
- Single DB writer (main process)
- Fast (in-memory IPC)

**Cons:**
- Requires process architecture (main + renderer)
- More complex than simple DB access

**Example (Electron):**
```typescript
// Main process
ipcMain.on('task:execute', async (event, taskId, prompt) => {
  const result = await executeTask(taskId, prompt);

  // Broadcast to ALL windows
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('task:completed', result);
  });
});

// Renderer process
ipcRenderer.on('task:completed', (event, result) => {
  // Update UI
  updateTaskInUI(result);
});
```

**Verdict:** ✅ Best for V1 local sync

---

#### Option 3: Local WebSocket Server

**Approach:**
- Agor desktop app runs local WebSocket server (e.g., `ws://localhost:9876`)
- All windows connect as WebSocket clients
- Server broadcasts state changes

**Pros:**
- Familiar WebSocket pattern
- Easy to extend to cloud later (just change URL)
- Works across browsers + desktop app

**Cons:**
- Need to manage server lifecycle
- Port conflicts possible
- Overkill for single-machine sync

**Verdict:** Viable, but IPC simpler for V1

---

### V2: Agor Cloud (Collaborative)

**Challenge:** Real-time multiplayer, potentially 100s of users

#### Option 1: WebSocket Server (Central Hub)

**Approach:**
- Cloud-hosted WebSocket server
- Clients connect, subscribe to session channels
- Server broadcasts updates to all subscribers

**Technology options:**
- **Socket.io** - Easy, auto-reconnect, fallbacks
- **Soketi** - Open-source Pusher alternative, Laravel ecosystem
- **Ably** - Managed real-time infrastructure (paid)
- **Supabase Realtime** - Postgres-based pub/sub
- **PartyKit** - Durable WebSocket rooms (Cloudflare Workers)

**Example (Socket.io):**
```typescript
// Server
io.on('connection', (socket) => {
  socket.on('subscribe:session', (sessionId) => {
    socket.join(`session:${sessionId}`);
  });

  // Broadcast task completion to session room
  io.to(`session:${sessionId}`).emit('task:completed', result);
});

// Client
socket.on('task:completed', (result) => {
  // Update UI
});
```

**Pros:**
- Battle-tested pattern
- Easy to understand
- Good library support

**Cons:**
- Server must scale (stateful connections)
- Connection management complexity
- Cost (each connection = resource)

**Verdict:** ✅ Standard approach for V2

---

#### Option 2: Server-Sent Events (SSE)

**Approach:**
- Server pushes updates via HTTP streaming
- Simpler than WebSocket (unidirectional)
- Client sends mutations via POST

**Pros:**
- Simpler than WebSocket (HTTP-based)
- Auto-reconnect in browser
- Works through proxies

**Cons:**
- Unidirectional (server → client only)
- Limited browser connections (6 per domain)
- Less efficient than WebSocket

**Verdict:** Viable for read-heavy scenarios, but WebSocket more flexible

---

#### Option 3: CRDT-Based Sync (Yjs, Automerge)

**Approach:**
- Use Conflict-free Replicated Data Types
- Each client has local copy of state
- Changes merge automatically without conflicts

**Technologies:**
- **Yjs** - CRDT framework, works with WebSocket/WebRTC
- **Automerge** - CRDT with time-travel
- **Electric SQL** - Postgres with local-first sync

**Pros:**
- Offline-first by design
- Automatic conflict resolution
- No central authority needed (can work P2P)

**Cons:**
- Complex mental model
- Not all data structures fit CRDT
- Larger bundle size

**Verdict:** Promising for true local-first, but overkill for V1/V2

---

## Chosen Architecture: FeathersJS

**See [[architecture-api]] for complete details.**

### Why FeathersJS?

**Unified approach for V1 (local) and V2 (cloud):**
- **Automatic real-time events** via Service hooks (`created`, `updated`, `patched`, `removed`)
- **WebSocket + Socket.io** built-in (with polling fallback)
- **Room/channel-based pub/sub** for session isolation
- **Same client code** for local daemon and cloud server
- **Works with Drizzle ORM** (custom adapter needed)

### V1: Local Feathers Daemon

```
┌─────────────────────────────┐
│ Agor Daemon (localhost:3030)│
│                             │
│  ├─ Feathers Server         │
│  ├─ Drizzle + LibSQL        │
│  └─ Agent Clients           │
└──────────┬──────────────────┘
           │ WebSocket (local)
     ┌─────┴─────┬──────────┐
     │           │          │
┌────▼────┐ ┌───▼───┐ ┌───▼───┐
│ Browser │ │Browser│ │Desktop│  (Feathers clients)
│ Window 1│ │Window2│ │  App  │
└─────────┘ └───────┘ └───────┘
```

**Key Features:**
- Local daemon auto-starts with first client
- All windows connect to `ws://localhost:3030`
- Feathers channels broadcast to all connected clients
- No IPC needed - pure WebSocket

**Example Flow:**
1. User creates task in Browser Window 1
2. Feathers client → POST `/tasks` → Feathers service
3. Service saves to DB via Drizzle
4. Service hook emits `task created` event
5. Feathers broadcasts to all clients via WebSocket channels
6. All connected windows receive event and update UI

**Implementation:**
```typescript
// Feathers Service (server)
class TasksService {
  async create(data, params) {
    const task = await db.insert(tasks).values(data).returning();
    // Feathers automatically emits 'created' event
    return task;
  }
}

// Feathers Channels (server)
app.service('tasks').publish('created', (data, context) => {
  // Broadcast to all clients watching this session
  return app.channel(`session:${data.session_id}`);
});

// React Hook (client)
function useTasks(sessionId) {
  const client = useFeathers();
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const tasksService = client.service('tasks');

    // Real-time listener
    tasksService.on('created', (task) => {
      if (task.session_id === sessionId) {
        setTasks((prev) => [...prev, task]);
      }
    });

    return () => tasksService.removeAllListeners();
  }, [sessionId]);

  return tasks;
}
```

---

### V2: Agor Cloud (Feathers + PostgreSQL/Turso)

```
┌────────────────────────────────────┐
│ Agor Cloud (cloud.agor.dev)       │
│                                    │
│  ├─ Feathers Server (scaled)      │
│  ├─ PostgreSQL / Turso             │
│  └─ Agent Workers (separate)      │
└──────────┬─────────────────────────┘
           │ WebSocket (wss://)
     ┌─────┴─────┬──────────┬─────────┐
     │           │          │         │
┌────▼────┐ ┌───▼───┐ ┌───▼───┐ ┌───▼────┐
│ User A  │ │User A │ │ User B│ │ User C │
│ Browser │ │Mobile │ │Browser│ │Browser │
└─────────┘ └───────┘ └───────┘ └────────┘
```

**Same Feathers architecture, different deployment:**
- Feathers server deployed to cloud (Fly.io, Railway, etc.)
- PostgreSQL or Turso for multi-tenant data
- Agent workers run as separate services
- Same React hooks work in cloud mode
- Authentication via JWT (Feathers built-in)

**Key Difference from V1:**
- **V1:** Local daemon (`ws://localhost:3030`), single user, LibSQL
- **V2:** Cloud server (`wss://cloud.agor.dev`), multi-user, PostgreSQL/Turso

**Same client code** - just change Feathers connection URL!

---

## Event Schema

### Event Types

```typescript
// Session events
type SessionEvent =
  | { type: 'session:created'; sessionId: string; session: Session }
  | { type: 'session:updated'; sessionId: string; updates: Partial<Session> }
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:status_changed'; sessionId: string; status: SessionStatus };

// Task events
type TaskEvent =
  | { type: 'task:created'; taskId: string; task: Task }
  | { type: 'task:started'; taskId: string }
  | { type: 'task:message'; taskId: string; message: Message }
  | { type: 'task:tool_call'; taskId: string; toolCall: ToolCall }
  | { type: 'task:completed'; taskId: string; result: TaskResult }
  | { type: 'task:failed'; taskId: string; error: Error };

// Board events
type BoardEvent =
  | { type: 'board:created'; boardId: string; board: Board }
  | { type: 'board:updated'; boardId: string; updates: Partial<Board> };

type AgorEvent = SessionEvent | TaskEvent | BoardEvent;
```

### Event Payload Structure

```typescript
interface EventPayload<T = unknown> {
  event: string;              // 'task:completed'
  data: T;                    // Event-specific data
  timestamp: number;          // Unix timestamp
  userId?: string;            // Who triggered (V2 only)
  sessionId?: string;         // Which session (for routing)
}
```

---

## Conflict Resolution

### V1: Optimistic Updates (Local)

**Strategy:** Last-write-wins (simple, desktop app has single user)

```typescript
// Window 1 updates session
await agorState.sessions.update(sessionId, { status: 'running' });

// Broadcast to other windows
ipc.send('session:updated', { sessionId, updates: { status: 'running' } });

// Other windows apply update
ipc.on('session:updated', ({ sessionId, updates }) => {
  localState.updateSession(sessionId, updates);
});
```

---

### V2: Operational Transforms (Collaborative)

**Challenge:** Two users edit same session simultaneously

**Example conflict:**
- User A: Renames session "Auth Work" at 10:00:00
- User B: Renames session "Login Feature" at 10:00:01
- Both updates arrive at server

**Resolution strategies:**

#### Option 1: Last-Write-Wins (Simple)
- Use timestamp, latest update wins
- **Cons:** User A's change lost

#### Option 2: Operational Transform (Google Docs style)
- Apply operations in deterministic order
- Transform conflicting operations
- **Cons:** Complex to implement

#### Option 3: CRDTs (Automerge/Yjs)
- Use CRDT data structures
- Automatic merge
- **Cons:** Not all data fits CRDT model

**Recommendation for V2:** Start with last-write-wins, upgrade to OT for critical fields if needed

---

## Open Source vs Proprietary Split

### V1: Fully Open Source

**Architecture:**
- Desktop app (Electron/Tauri)
- IPC-based sync (open source)
- Local LibSQL database
- Agent integrations (open source)

**Revenue:** None (free, open source)

---

### V2: Agor Cloud (Proprietary SaaS)

**Architecture:**
- **Open source:**
  - Frontend UI components (reusable)
  - Agent interface abstractions
  - Data models and types

- **Proprietary:**
  - WebSocket server infrastructure
  - Agent worker orchestration
  - Turso cloud sync logic
  - Multi-tenant session isolation
  - Auth/permissions layer
  - Usage analytics

**Revenue:**
- Free tier: 5 sessions, 1 user
- Pro: $20/mo - unlimited sessions, team collaboration
- Enterprise: Custom pricing, SSO, on-prem option

**Tagline:** *Real-time strategy multiplayer for AI development*

---

## Performance Considerations

### Message Throughput

**Scenario:** Streaming agent response (10 words/sec)
- 10 message chunks/sec/session
- 100 active sessions
- = 1,000 messages/sec to broadcast

**Optimization:**
- Batch messages (buffer 100ms)
- Compress payloads (gzip)
- Use binary protocol (MessagePack vs JSON)

### Connection Scaling (V2)

**Scenario:** 1,000 concurrent users
- Each user = 1 WebSocket connection
- Need horizontal scaling

**Options:**
- **Soketi:** Redis backend, multi-server
- **Ably:** Managed, handles scaling
- **PartyKit:** Cloudflare Workers, auto-scale

---

## Security & Permissions (V2 Only)

### Session-Level Access Control

```typescript
interface SessionPermissions {
  sessionId: string;
  owner: string;              // User ID
  collaborators: string[];    // Can view + edit
  viewers: string[];          // Can view only
  public: boolean;            // Anyone with link
}
```

### WebSocket Authentication

**Flow:**
1. User authenticates (JWT from API)
2. Client connects to WebSocket with token
3. Server validates token
4. Client subscribes to authorized sessions only

```typescript
// Client
const socket = io('wss://agor.cloud', {
  auth: { token: jwtToken }
});

// Server
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (isValidToken(token)) {
    socket.userId = getUserIdFromToken(token);
    next();
  } else {
    next(new Error('Unauthorized'));
  }
});

// Only allow subscribing to authorized sessions
socket.on('subscribe:session', async (sessionId) => {
  const hasAccess = await checkSessionAccess(socket.userId, sessionId);
  if (hasAccess) {
    socket.join(`session:${sessionId}`);
  }
});
```

---

## Implementation Roadmap

### Phase 1: V1 Local Sync (Desktop)

1. Implement IPC message bus (Electron/Tauri)
2. Define event schema
3. Connect agent events → main process → IPC broadcast
4. Test multi-window sync

**Milestone:** Multiple windows stay in sync locally

---

### Phase 2: V2 Cloud Architecture Design

1. Choose WebSocket technology (Soketi vs Ably vs PartyKit)
2. Design room subscription model
3. Define API endpoints for session mutations
4. Plan agent worker architecture

**Milestone:** Architecture document ready

---

### Phase 3: V2 WebSocket Server

1. Deploy WebSocket server
2. Implement room-based broadcasting
3. Add authentication layer
4. Connect to Turso cloud database

**Milestone:** Real-time updates working in cloud

---

### Phase 4: Conflict Resolution

1. Implement optimistic updates on client
2. Add server-side conflict detection
3. Choose resolution strategy (last-write-wins vs OT)
4. Test edge cases

**Milestone:** Multi-user editing works without data loss

---

## Open Questions

### 1. Desktop App Architecture
**Question:** Electron vs Tauri for V1?

**Considerations:**
- Electron: Mature, good IPC, larger bundle
- Tauri: Smaller bundle, Rust backend, less mature

**Current thinking:** Start with Electron (familiarity), consider Tauri later

---

### 2. WebSocket Technology (V2)
**Question:** Self-hosted (Soketi) vs managed (Ably)?

**Considerations:**
- Self-hosted: More control, cheaper at scale
- Managed: Easier to start, handles scaling

**Current thinking:** Start with Soketi (open source), upgrade to Ably if scaling issues

---

### 3. State Ownership
**Question:** Can multiple users edit same session simultaneously?

**Options:**
- **Single editor**: Lock session when in use (like Google Docs "Editing" mode)
- **Multi-edit**: Allow conflicts, resolve with OT/CRDT
- **Hybrid**: Owner can edit, others can view + comment

**Current thinking:** Hybrid for V2 (owner edits, others spectate)

---

### 4. Offline Mode (V2)
**Question:** Should cloud version work offline?

**Considerations:**
- Pro: Better UX, works on planes
- Con: Complex sync logic, potential conflicts

**Current thinking:** V2 requires connection (simpler), V1 is offline-capable

---

## Advanced Collaboration Features (V2 - Agor Cloud)

**Vision:** Real-time strategy multiplayer for AI development - seeing other players in action

### The Multiplayer Experience

**Imagine:**
- You're watching a session canvas with 5 active sessions
- 3 teammates are working simultaneously
- You see their cursors moving across the canvas
- A session card flashes as User B creates a new task
- Task status changes animate in real-time
- Navbar shows facepile of 4 active users
- Activity log streams: "Alice forked Session A", "Bob completed Task 12"

**This is the RTS multiplayer vision for Agor Cloud.**

---

### Inspiration: Figma & Miro

**Figma's collaboration excellence:**
- **Smooth cursor movements** - 60fps, interpolated, never jumpy
- **User color coding** - Each user has persistent color across cursors, selections, comments
- **Selection highlighting** - See what others are selecting in real-time (translucent overlay)
- **Commenting presence** - See who's typing a comment before they post
- **Follow mode** - Click user avatar to follow their viewport
- **Minimal latency** - Sub-100ms updates feel instant
- **Unobtrusive UI** - Cursors fade when idle, don't block work

**Miro's multiplayer features:**
- **Cursor trails** - Brief trail effect shows cursor movement direction
- **Viewport indicators** - Mini-map shows where other users are viewing
- **Bring to me / Go to user** - Quick navigation to teammate's location
- **Voting & reactions** - Emoji reactions on objects
- **Live editing indicators** - Border pulses when someone edits object
- **Activity feed** - Right sidebar streams all actions
- **Undo/redo visibility** - See when teammates undo (prevents conflicts)

**Key learnings to apply:**
1. **Performance first** - Smooth animations > fancy features
2. **Contextual presence** - Show cursors + what they're hovering/editing
3. **User color consistency** - One color per user across all presence indicators
4. **Viewport awareness** - Let users jump to each other's view
5. **Subtle notifications** - Flashes/highlights, not popups
6. **Graceful degradation** - Works with cursors hidden or network issues

---

### Feature Breakdown

#### 1. Presence & Cursors

**Cursor Broadcasting:**
```typescript
interface UserCursor {
  userId: string;
  userName: string;
  color: string;              // Unique user color
  position: {
    x: number;
    y: number;
    viewportId: string;       // Which view (canvas, drawer, etc.)
  };
  pointer?: {
    sessionId?: string;       // Hovering over session
    taskId?: string;          // Hovering over task
  };
  lastUpdate: number;
}

// High-frequency events (throttled to 60fps)
type CursorEvent = {
  type: 'presence:cursor_move';
  userId: string;
  position: UserCursor['position'];
};
```

**Cursor Rendering:**
- SVG cursor with user's color
- Name label follows cursor
- Fade out after 3s of inactivity
- Smooth interpolation (not jumpy)

**Throttling strategy:**
- Client: Send cursor updates max 60fps (16ms throttle)
- Server: Broadcast cursor updates max 30fps to other clients
- Use requestAnimationFrame for smooth rendering

---

#### 2. Action Highlights & Flashing

**Visual Feedback for Actions:**

When a user takes an action, broadcast it with visual effect:

```typescript
interface ActionHighlight {
  actionId: string;
  userId: string;
  targetType: 'session' | 'task' | 'board';
  targetId: string;
  actionType: 'created' | 'updated' | 'deleted' | 'status_change';
  timestamp: number;
}

// Example: User creates new task
{
  type: 'action:highlight',
  actionId: 'action-123',
  userId: 'user-alice',
  targetType: 'task',
  targetId: 'task-456',
  actionType: 'created',
}
```

**UI Effects:**
- **Pulse animation** on affected card (2s fade)
- **Border flash** in user's color
- **Slide-in notification** (optional, non-intrusive)

**Implementation:**
```typescript
// React component
const SessionCard = ({ session, actionHighlights }) => {
  const highlight = actionHighlights.find(h => h.targetId === session.id);

  return (
    <Card
      className={highlight ? 'animate-pulse-user-color' : ''}
      style={{
        '--user-color': highlight?.userColor,
        animation: highlight ? 'pulse 2s ease-out' : 'none'
      }}
    >
      {/* ... */}
    </Card>
  );
};
```

---

#### 3. Facepile (Active Users)

**Navbar Component:**
```typescript
interface ActiveUser {
  userId: string;
  userName: string;
  avatarUrl?: string;
  color: string;
  status: 'active' | 'idle' | 'away';
  currentView?: string;       // Which session they're viewing
  lastActivity: number;
}

// Example UI
<Facepile users={activeUsers} max={5}>
  {activeUsers.slice(0, 5).map(user => (
    <Avatar
      key={user.userId}
      src={user.avatarUrl}
      style={{ borderColor: user.color }}
      tooltip={`${user.userName} - ${user.currentView || 'browsing'}`}
      status={user.status}
    />
  ))}
  {activeUsers.length > 5 && (
    <Avatar>+{activeUsers.length - 5}</Avatar>
  )}
</Facepile>
```

**Presence Updates:**
```typescript
type PresenceEvent =
  | { type: 'presence:joined'; user: ActiveUser }
  | { type: 'presence:left'; userId: string }
  | { type: 'presence:status_change'; userId: string; status: UserStatus }
  | { type: 'presence:view_change'; userId: string; view: string };

// Client sends presence updates
socket.emit('presence:view_change', {
  userId: currentUser.id,
  view: `session:${currentSessionId}`
});

// Server broadcasts to room
io.to('workspace:abc').emit('presence:view_change', {
  userId: 'user-alice',
  view: 'session:xyz'
});
```

---

#### 4. Activity Log / History View

**Action Stream Component:**

Timeline of all user actions in current workspace/board:

```typescript
interface ActivityLogEntry {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  action: Action;
  timestamp: number;
  metadata?: {
    sessionName?: string;
    taskDescription?: string;
  };
}

type Action =
  | { type: 'session.created'; sessionId: string; name: string }
  | { type: 'session.forked'; fromSessionId: string; newSessionId: string }
  | { type: 'task.executed'; taskId: string; prompt: string }
  | { type: 'task.completed'; taskId: string }
  | { type: 'board.created'; boardId: string; name: string };
```

**UI Layout:**
```
┌─────────────────────────────────────────┐
│ Activity Log                      [X]   │
├─────────────────────────────────────────┤
│ 🟢 Alice forked "Auth Work"             │
│    → Created "Try OAuth 2.0"            │
│    2 minutes ago                         │
├─────────────────────────────────────────┤
│ 🔵 Bob completed Task #12               │
│    "Implement JWT endpoints"            │
│    5 minutes ago                         │
├─────────────────────────────────────────┤
│ 🟡 Charlie created Session              │
│    "Design user schema"                 │
│    10 minutes ago                        │
└─────────────────────────────────────────┘
```

**Features:**
- Real-time stream (new entries slide in from top)
- Filter by user (click facepile avatar)
- Filter by action type (sessions, tasks, boards)
- Jump to entity (click entry → focus session/task)
- Infinite scroll (load older history)

---

### Event Model: Two Channels

**Critical separation:** High-frequency presence events vs low-frequency action events

#### Channel 1: Presence (High-Frequency)

**Events:**
- Cursor movements (60fps → throttled to 30fps)
- Viewport changes (user scrolls canvas)
- Typing indicators (user typing in input)

**Characteristics:**
- **Ephemeral** (not persisted to DB)
- **High volume** (1000s/sec with many users)
- **Tolerant to loss** (dropped cursor frame is fine)
- **Separate WebSocket channel** or use UDP if possible

**Implementation:**
```typescript
// Separate WebSocket namespace for presence
const presenceSocket = io('/presence', {
  transports: ['websocket'],
  upgrade: false
});

presenceSocket.on('cursor:batch', (cursors: UserCursor[]) => {
  // Update all cursors in one batch (efficient)
  updateCursorsInUI(cursors);
});

// Throttled cursor send
const sendCursor = throttle((position) => {
  presenceSocket.emit('cursor:move', position);
}, 16); // 60fps
```

---

#### Channel 2: Actions (Low-Frequency)

**Events:**
- Session created/forked/deleted
- Task executed/completed
- Board changes
- User joined/left

**Characteristics:**
- **Persistent** (saved to DB)
- **Low volume** (10s-100s/sec)
- **Reliable delivery required** (cannot lose)
- **Main WebSocket channel** with acknowledgments

**Implementation:**
```typescript
// Main data channel (reliable)
const dataSocket = io('/data', {
  transports: ['websocket', 'polling'], // Fallback to polling
});

dataSocket.emit('task:create', { sessionId, prompt }, (ack) => {
  if (ack.success) {
    console.log('Task created:', ack.taskId);
  }
});

dataSocket.on('task:created', (event) => {
  // Reliable delivery, update UI + DB
  addTaskToState(event.task);
  highlightAction(event);
  addToActivityLog(event);
});
```

---

### Performance Optimizations

#### 1. Cursor Batching

**Problem:** 10 users × 60fps = 600 cursor updates/sec

**Solution:** Batch cursor updates

```typescript
// Server-side batching
const cursorBuffer: Map<string, UserCursor> = new Map();

setInterval(() => {
  if (cursorBuffer.size > 0) {
    io.to('workspace:abc').emit('cursor:batch', Array.from(cursorBuffer.values()));
    cursorBuffer.clear();
  }
}, 33); // 30fps batching

socket.on('cursor:move', (cursor) => {
  cursorBuffer.set(cursor.userId, cursor);
});
```

---

#### 2. Viewport Culling

**Problem:** Don't need to render cursors outside viewport

**Solution:** Only send cursors in visible area

```typescript
// Client sends viewport bounds
socket.emit('presence:viewport', {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  zoom: 1.0
});

// Server only broadcasts cursors in overlapping viewports
const visibleCursors = allCursors.filter(cursor =>
  isInViewport(cursor.position, clientViewport)
);
```

---

#### 3. Action Deduplication

**Problem:** Same action broadcast to all clients, causes duplicate DB writes

**Solution:** Optimistic updates + server authority

```typescript
// Client optimistically updates UI
const optimisticTaskId = `temp-${Date.now()}`;
addTaskToUI({ id: optimisticTaskId, ...task });

// Send to server
socket.emit('task:create', task, (ack) => {
  // Replace optimistic with real ID
  replaceTaskInUI(optimisticTaskId, ack.taskId);
});

// Ignore broadcast if it's your own action
socket.on('task:created', (event) => {
  if (event.userId !== currentUser.id) {
    addTaskToUI(event.task);
  }
});
```

---

### UI Components for Collaboration

#### 1. UserCursor Component

```typescript
const UserCursor: React.FC<{ cursor: UserCursor }> = ({ cursor }) => {
  return (
    <div
      className="absolute pointer-events-none z-50 transition-transform duration-100"
      style={{
        left: cursor.position.x,
        top: cursor.position.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path
          d="M5 3l14 9-6 1.5L9 20z"
          fill={cursor.color}
          stroke="white"
          strokeWidth="1"
        />
      </svg>
      <div
        className="ml-6 mt-1 px-2 py-1 rounded text-xs text-white whitespace-nowrap"
        style={{ backgroundColor: cursor.color }}
      >
        {cursor.userName}
      </div>
    </div>
  );
};
```

---

#### 2. ActionHighlight Component

```typescript
const useActionHighlight = (targetId: string) => {
  const [highlight, setHighlight] = useState<ActionHighlight | null>(null);

  useEffect(() => {
    const handler = (action: ActionHighlight) => {
      if (action.targetId === targetId) {
        setHighlight(action);
        setTimeout(() => setHighlight(null), 2000); // Clear after 2s
      }
    };

    messageBus.on('action:highlight', handler);
    return () => messageBus.off('action:highlight', handler);
  }, [targetId]);

  return highlight;
};

// Usage in SessionCard
const SessionCard = ({ session }) => {
  const highlight = useActionHighlight(session.id);

  return (
    <Card
      className={highlight ? styles.highlight : ''}
      style={{
        '--highlight-color': highlight?.userColor || 'transparent',
      }}
    >
      {/* ... */}
    </Card>
  );
};

// CSS
.highlight {
  animation: pulse-border 2s ease-out;
}

@keyframes pulse-border {
  0%, 100% { box-shadow: 0 0 0 0 var(--highlight-color); }
  50% { box-shadow: 0 0 0 4px var(--highlight-color); }
}
```

---

#### 3. ActivityLog Component

```typescript
const ActivityLog: React.FC = () => {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);

  useEffect(() => {
    messageBus.on('activity:new', (entry: ActivityLogEntry) => {
      setEntries(prev => [entry, ...prev]); // Prepend (newest first)
    });
  }, []);

  return (
    <Drawer title="Activity Log" placement="right" width={400}>
      <Timeline>
        {entries.map(entry => (
          <Timeline.Item
            key={entry.id}
            color={entry.userColor}
            label={formatRelativeTime(entry.timestamp)}
          >
            <Text strong style={{ color: entry.userColor }}>
              {entry.userName}
            </Text>{' '}
            {formatAction(entry.action)}
          </Timeline.Item>
        ))}
      </Timeline>
    </Drawer>
  );
};
```

---

### Data Flow Summary

**Full event flow for collaborative action:**

```
User A creates task
    ↓
Client A: Optimistic UI update
    ↓
Client A → Server: { type: 'task:create', data: {...} }
    ↓
Server: Validate & persist to DB
    ↓
Server → All clients in room: { type: 'task:created', task: {...}, userId: 'A' }
    ↓
Client B,C,D: Update UI
Client B,C,D: Flash highlight on new task
Client B,C,D: Add to activity log
    ↓
Client A: Replace optimistic with confirmed (if different ID)
```

**Presence event flow:**

```
User A moves cursor
    ↓
Client A: Throttle (16ms)
    ↓
Client A → Presence Server: { type: 'cursor:move', position: {x, y} }
    ↓
Presence Server: Buffer cursor (batching)
    ↓
Every 33ms: Broadcast batched cursors to all clients
    ↓
Client B,C,D: Interpolate cursor positions (smooth animation)
```

---

### Open Questions

#### 1. Cursor Interpolation
**Question:** How to make cursors move smoothly despite 30fps updates?

**Options:**
- Linear interpolation between updates
- Cubic bezier easing
- Predict position based on velocity

**Current thinking:** Linear interpolation sufficient for MVP

---

#### 2. Action Log Persistence
**Question:** How long to keep activity log entries?

**Options:**
- Last 100 entries (ring buffer)
- Last 24 hours
- Persist all to DB, paginate

**Current thinking:** Last 100 entries in memory, full history in DB (load on demand)

---

#### 3. Presence Timeout
**Question:** When to mark user as "away" vs "offline"?

**Options:**
- Away: No cursor movement for 5 minutes
- Offline: WebSocket disconnect
- Idle: No actions for 10 minutes

**Current thinking:** Away after 5min idle, offline on disconnect

---

#### 4. Cursor Visibility Toggle
**Question:** Should users be able to hide others' cursors?

**Consideration:** Too many cursors = distracting

**Current thinking:** Yes, add "Hide cursors" toggle in settings

---

## Next Steps

1. **Prototype V1 IPC sync** - Validate multi-window works
2. **Research Soketi** - Test WebSocket server locally
3. **Define event schema** - Standardize all broadcast events
4. **Explore PartyKit** - Alternative architecture (serverless WebSocket)

Once V1 is validated, crystallize local sync into `concepts/architecture.md`.
Once V2 architecture is decided, create separate `agor-cloud.md` exploration.

---

## Related Explorations

- **state-management.md** - Where events persist
- **agent-interface.md** - Where events originate
- **agor-cloud.md** (future) - Full V2 cloud architecture
