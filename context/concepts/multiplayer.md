# Multiplayer Collaboration

**Status:** Implemented (Phase 3a Complete)
**Related:** [auth.md](auth.md), [websockets.md](websockets.md)

---

## Overview

Agor supports real-time multiplayer collaboration, allowing multiple users to work together on the same board simultaneously. Users see each other's cursors, active presence, and all changes in real-time via WebSocket broadcasting.

---

## Implemented Features

### User Authentication & Attribution

See [auth.md](auth.md) for details:

- Email/password + JWT authentication
- Anonymous mode for local development
- User profiles with emoji avatars
- `created_by` tracking on all entities

### Real-Time Presence (Phase 3a)

**Facepile Component** (`apps/agor-ui/src/components/Facepile/`):

- Shows active users on board in navbar
- Emoji avatars with user initials
- Current user always shown first
- Optional click to pan to user's cursor

**Cursor Broadcasting** (`apps/agor-ui/src/hooks/useCursorTracking.ts`):

- Throttled cursor position emissions (100ms, ~10 updates/sec)
- React Flow coordinate transformation
- Automatic cursor cleanup on unmount
- `cursor-move`, `cursor-moved`, `cursor-left` WebSocket events

**Remote Cursor Rendering** (`apps/agor-ui/src/components/SessionCanvas/canvas/CursorNode.tsx`):

- SVG cursor pointer with emoji avatar + name label
- Inverse scaling for constant size regardless of zoom
- Visible in both main canvas and minimap (bright orange dots)
- Smooth position transitions (0.1s ease-out)

**Presence Management** (`apps/agor-ui/src/hooks/usePresence.ts`):

- Tracks active users and cursor positions via WebSocket
- Timestamp-based ordering prevents jitter from out-of-order events
- Automatic stale cursor cleanup (5-second timeout)
- Memoized Map to prevent unnecessary re-renders

### Real-Time Data Sync

**WebSocket Broadcasting** (`apps/agor-daemon/src/index.ts`):

- All CRUD operations broadcast to connected clients
- Session, task, message, board, repo updates
- Position changes sync immediately (optimistic UI)

**Configuration:**

```typescript
// Presence config (packages/core/src/types/presence.ts)
export const PRESENCE_CONFIG = {
  CURSOR_EMIT_THROTTLE_MS: 100, // Throttle cursor updates
  ACTIVE_USER_TIMEOUT_MS: 5 * 60 * 1000, // 5-min facepile timeout
  CURSOR_HIDE_TIMEOUT_MS: 5000, // 5-sec cursor hide timeout
};
```

---

## Architecture

### Cursor Coordinate System

**Flow Coordinates vs Screen Coordinates:**

- Chose React Flow coordinates for seamless integration
- `project()` function converts screen → flow coordinates
- Cursors move correctly with pan/zoom
- Dual rendering: main canvas (full cursor) + minimap (orange dots)

### Cursor Sync Protocol

```typescript
// Client → Server (throttled)
socket.emit('cursor-move', {
  board_id: string,
  position: { x: number, y: number }, // React Flow coordinates
});

// Server → All Clients (with user info)
socket.on('cursor-moved', {
  user: { user_id, name, emoji, color },
  position: { x: number, y: number },
  timestamp: number, // For ordering
});

// Client cleanup
socket.emit('cursor-left', { board_id: string });
```

### Conflict Resolution

**Current Strategy: Last-Write-Wins**

- Optimistic UI updates (local changes apply immediately)
- WebSocket broadcast propagates to all clients
- Simple and works well for current use cases

**Future: Operational Transformation (OT)**

- Needed for concurrent text edits (comments, annotations)
- Not required yet (no collaborative editing)

---

## User Experience

### Pair Programming Workflow

1. User A and User B join same board
2. Both see facepile in navbar showing who's active
3. User A drags Session 1 to top-left (both see move immediately)
4. User B's cursor appears as they navigate canvas
5. User A clicks User B's avatar → canvas pans to their cursor
6. Both users can drag sessions, open drawers, view conversations

### Visual Feedback

- **Facepile:** Active users with emoji avatars (top-right navbar)
- **Cursors:** Real-time cursor swarm showing where teammates are looking
- **Minimap:** Orange dots for remote cursors (easy to locate teammates)
- **Smooth animations:** 100ms transitions for cursor movement

---

## Future Enhancements (Phase 3b+)

See [../explorations/](../explorations/) for detailed designs:

### Collaborative Session Access (Phase 3b)

- Session locking (prevent concurrent agent runs)
- "User is viewing..." indicators on session cards
- Permissions model (board owner can invite collaborators)

### Typing Indicators (Phase 3b)

- "User is typing..." below prompt input
- Real-time indication when teammate is composing

### Comments & Annotations (Phase 3c)

- Comment threads on sessions/tasks
- @ mentions for notifications
- Attach comments to specific messages

### Activity Feed (Phase 3d)

- Timeline of all board actions
- Filter by user, action type, date range
- "User forked Session X" notifications

---

## Technical Decisions

**Why React Flow coordinates over screen coordinates?**

- Cursors rendered as React Flow nodes (consistent with sessions)
- Automatically handles pan/zoom transformations
- Works in both main canvas and minimap

**Why 100ms throttle for cursor updates?**

- Balance between smoothness and bandwidth
- 10 updates/second is perceptually smooth
- Prevents WebSocket spam with fast mouse movements

**Why timestamp-based ordering?**

- WebSocket messages can arrive out-of-order
- Receiving old position after newer one causes jitter
- Check `event.timestamp > lastKnownTimestamp` before updating

**Why cursor nodes instead of overlay layer?**

- Initial attempt used absolute-positioned overlay (had offset issues)
- React Flow nodes integrate perfectly with canvas
- Single rendering path (no sync issues between canvas/overlay)
- Works in minimap automatically

---

## References

- **Implementation:** `apps/agor-ui/src/components/Facepile/`, `apps/agor-ui/src/hooks/usePresence.ts`, `apps/agor-ui/src/hooks/useCursorTracking.ts`
- **Backend:** `apps/agor-daemon/src/index.ts` (cursor broadcasting via Socket.io)
- **Type System:** `packages/core/src/types/presence.ts`
- **Related Concepts:** [websockets.md](websockets.md), [auth.md](auth.md)
