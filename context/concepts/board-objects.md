# Board Objects - Session Pinning & Zone Triggers

**Status:** ✅ Implemented
**Related:** [models.md](./models.md), [architecture.md](./architecture.md), [design.md](./design.md), [frontend-guidelines.md](./frontend-guidelines.md)

---

## Overview

This document describes the **parent-child locking** feature for board objects, which allows sessions to be pinned to zones so they move together as a group. It also covers **zone triggers** with **Handlebars template support** for dynamic prompt generation.

### What's Implemented ✅

**Board Objects Foundation:**

- ✅ **Zone Rectangles** - Resizable colored regions with labels and colors
- ✅ **Real-time Sync** - WebSocket broadcasting via daemon service hooks
- ✅ **Atomic Updates** - Backend methods for CRUD operations
- ✅ **Drag-to-draw zones** - Tool in SessionCanvas with keyboard shortcuts (Z, E, Esc, Delete)
- ✅ **Storage** - `board.objects` JSON dictionary in database, `board.layout` for session positions

**Parent-Child Locking (Session Pinning):**

- ✅ **Drop-to-pin** - Sessions automatically pin to zones when dropped inside
- ✅ **Pin indicator** - Pin icon replaces drag handle when session is pinned
- ✅ **Unpin button** - Click pin icon to unpin from zone
- ✅ **Coordinate conversion** - Automatic relative ↔ absolute position conversion
- ✅ **Zone movement** - Pinned sessions move with their parent zone (React Flow native)
- ✅ **Visual feedback** - Pinned sessions show 1px zone-colored border

**Zone Triggers with Handlebars:**

- ✅ **Trigger types** - Prompt, Task, Subtask (unified `/sessions/:id/prompt` endpoint)
- ✅ **Handlebars templates** - Dynamic prompt generation from session data
- ✅ **Session context** - Access `issue_url`, `pull_request_url`, `description`, and custom context
- ✅ **Custom context** - User-defined JSON fields accessible via `{{ session.context.* }}`
- ✅ **Trigger confirmation** - Modal prompts before executing trigger
- ✅ **Template rendering** - Graceful fallback if template fails
- ✅ **Session Settings UI** - Modal for editing issue URLs, PR URLs, and custom context JSON
- ✅ **Zone Config UI** - Modal for configuring triggers with Handlebars help text

---

## Goal: Pin Sessions to Zones

Allow sessions to be pinned to zones so they move together as a group. React Flow provides native support via the `parentId` property.

### How It Works (React Flow Built-in Feature)

```typescript
// Session pinned to zone
const node = {
  id: sessionId,
  type: 'sessionNode',
  position: { x: 100, y: 100 },  // Position RELATIVE to parent zone
  parentId: 'zone-123',           // Pinned to this zone
  extent: 'parent',                // Optional: can't drag outside zone bounds
  data: { ... },
};
```

**Key behaviors:**

- When zone moves, all pinned sessions move automatically (React Flow handles this)
- Sessions maintain their relative position within the zone
- `extent: "parent"` constrains sessions to stay within zone bounds (optional)
- `expandParent: true` makes zone grow if session dragged to edge (optional)

**Coordinate system:**

- **Unpinned sessions**: Use absolute canvas coordinates
- **Pinned sessions**: Use coordinates relative to zone's top-left corner
- **Conversion required**: When pinning/unpinning, convert between absolute ↔ relative

---

## User Interface Design

### Drop Detection (Automatic Pinning)

When a session is dropped into a zone:

1. In `handleNodeDragStop` (SessionCanvas.tsx), check if session overlaps with zone using `reactFlowInstance.getIntersectingNodes()`
2. If session center is inside zone bounds, automatically set `parentId`
3. Show visual feedback (pin icon appears in session card header)
4. Convert absolute position → relative position

### Pin Icon Toggle

**Location:** Session card header (replaces drag handle when pinned)

**Icon:** `PushpinOutlined` / `PushpinFilled` from `@ant-design/icons`

**Behavior:**

- When **unpinned**: Show drag handle button as normal
- When **pinned**: Replace drag handle with pin icon (filled)
- Click pin icon → unpins session (removes `parentId`, converts position back to absolute coordinates)

**Tooltip:** "Pinned to {zone.label}" (or "Unpin from zone" on hover)

**Session Card Changes:**

```typescript
// In SessionCard component (apps/agor-ui/src/components/SessionCard/SessionCard.tsx)
{isPinned ? (
  <Button
    type="text"
    size="small"
    icon={<PushpinFilled />}
    onClick={handleUnpin}
    title={`Pinned to ${zoneName} (click to unpin)`}
  />
) : (
  <Button
    type="text"
    size="small"
    icon={<DragOutlined />}
    className="drag-handle"
    title="Drag to move"
  />
)}
```

---

## Data Storage

Extend `board.layout` to store `parentId`:

```typescript
// In packages/core/src/types/board.ts
layout?: {
  [sessionId: string]: {
    x: number;        // Absolute coordinates when unpinned, relative when pinned
    y: number;
    parentId?: string;  // Zone ID if pinned, undefined if unpinned
  }
}
```

**No schema migration needed** - `layout` is already a JSON blob in `boards.data`.

---

## Implementation Guide

### 1. Pinning Logic (SessionCanvas.tsx)

**File:** `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx`

**Where:** Modify existing `handleNodeDragStop` callback (currently at line ~431)

```typescript
const handleNodeDragStop: NodeDragHandler = useCallback(
  async (_event, node) => {
    if (!board || !client) return;

    // EXISTING CODE: Track final position locally
    localPositionsRef.current[node.id] = {
      x: node.position.x,
      y: node.position.y,
    };

    // NEW: Handle session pinning/unpinning
    if (node.type === 'sessionNode') {
      // Check if session dropped inside a zone
      const intersections = reactFlowInstanceRef.current?.getIntersectingNodes(node) || [];
      const zone = intersections.find(n => n.type === 'zone');

      const currentParentId = board.layout?.[node.id]?.parentId;

      if (zone && !currentParentId) {
        // Pin to zone: convert absolute position to relative
        const relativeX = node.position.x - zone.position.x;
        const relativeY = node.position.y - zone.position.y;

        await client.service('boards').patch(board.board_id, {
          layout: {
            ...board.layout,
            [node.id]: { x: relativeX, y: relativeY, parentId: zone.id },
          },
        });

        console.log(`✓ Pinned session ${node.id} to zone ${zone.id}`);
        return; // Early return - position already saved
      } else if (!zone && currentParentId) {
        // Dragged outside zone: auto-unpin and convert to absolute position
        const parentZone = nodes.find(n => n.id === currentParentId);
        const absoluteX = parentZone ? node.position.x + parentZone.position.x : node.position.x;
        const absoluteY = parentZone ? node.position.y + parentZone.position.y : node.position.y;

        await client.service('boards').patch(board.board_id, {
          layout: {
            ...board.layout,
            [node.id]: { x: absoluteX, y: absoluteY, parentId: undefined },
          },
        });

        console.log(`✓ Unpinned session ${node.id}`);
        return; // Early return - position already saved
      }
    }

    // EXISTING CODE: Accumulate position updates for debounced persistence
    pendingLayoutUpdatesRef.current[node.id] = {
      x: node.position.x,
      y: node.position.y,
    };

    // ... rest of existing debouncing logic ...
  },
  [board, client, nodes, batchUpdateObjectPositions]
);
```

### 2. Node Construction with parentId

**File:** `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx`

**Where:** Modify `initialNodes` useMemo (currently at line ~138)

```typescript
const initialNodes: Node[] = useMemo(() => {
  // ... existing auto-layout logic ...

  // Convert to React Flow nodes
  return sessions.map(session => {
    const storedPosition = board?.layout?.[session.session_id];
    const autoPosition = nodeMap.get(session.session_id) || { x: 0, y: 0 };
    const position = storedPosition || autoPosition;

    // NEW: Extract parentId and zone name
    const parentId = storedPosition?.parentId;
    const zoneName = parentId ? board?.objects?.[parentId]?.label : undefined;

    return {
      id: session.session_id,
      type: 'sessionNode',
      position,
      parentId, // NEW: Set parent if pinned
      extent: parentId ? 'parent' : undefined, // NEW: Optional - constrain to zone
      draggable: true,
      data: {
        session,
        tasks: tasks[session.session_id] || [],
        users,
        currentUserId,
        onTaskClick,
        onSessionClick: () => onSessionClick?.(session.session_id),
        onDelete: onSessionDelete,
        onOpenSettings,
        compact: false,
        // NEW: Pass pinning state to SessionCard
        isPinned: !!parentId,
        zoneName,
        onUnpin: () => handleUnpin(session.session_id), // NEW: Unpin callback
      },
    };
  });
}, [
  board?.layout,
  board?.objects,
  sessions,
  tasks,
  users,
  currentUserId,
  onSessionClick,
  onTaskClick,
  onSessionDelete,
  onOpenSettings,
]);
```

### 3. Unpin Handler

**File:** `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx`

**Where:** Add new callback near other handlers

```typescript
// NEW: Unpin handler (called when user clicks pin icon in SessionCard)
const handleUnpin = useCallback(
  async (sessionId: string) => {
    if (!board || !client) return;

    const node = nodes.find(n => n.id === sessionId);
    const layout = board.layout?.[sessionId];
    if (!node || !layout?.parentId) return;

    // Convert relative position to absolute
    const parentZone = nodes.find(n => n.id === layout.parentId);
    const absoluteX = parentZone ? node.position.x + parentZone.position.x : node.position.x;
    const absoluteY = parentZone ? node.position.y + parentZone.position.y : node.position.y;

    await client.service('boards').patch(board.board_id, {
      layout: {
        ...board.layout,
        [sessionId]: { x: absoluteX, y: absoluteY, parentId: undefined },
      },
    });

    console.log(`✓ Unpinned session ${sessionId}`);
  },
  [nodes, board, client]
);
```

### 4. SessionCard Pin Icon

**File:** `apps/agor-ui/src/components/SessionCard/SessionCard.tsx`

**Where:** Modify the drag handle section in the card header

**Current code** (approximately line ~60-70):

```typescript
<Button
  type="text"
  size="small"
  icon={<DragOutlined />}
  className="drag-handle"
  title="Drag to move"
/>
```

**Replace with:**

```typescript
{isPinned ? (
  <Button
    type="text"
    size="small"
    icon={<PushpinFilled />}
    onClick={(e) => {
      e.stopPropagation(); // Prevent drawer from opening
      onUnpin?.();
    }}
    title={`Pinned to ${zoneName} (click to unpin)`}
    style={{ color: token.colorPrimary }}
  />
) : (
  <Button
    type="text"
    size="small"
    icon={<DragOutlined />}
    className="drag-handle"
    title="Drag to move"
  />
)}
```

**Add to SessionCard props:**

```typescript
interface SessionCardProps {
  // ... existing props ...
  isPinned?: boolean;
  zoneName?: string;
  onUnpin?: () => void;
}
```

**Import:**

```typescript
import { PushpinFilled, DragOutlined } from '@ant-design/icons';
```

---

## Visual Feedback

**Pinned sessions:**

- Show `PushpinFilled` icon instead of drag handle
- Icon color: `token.colorPrimary` (blue)
- Tooltip shows zone name

**Optional enhancements:**

- Add subtle border color change when pinned
- Show zone label in session card subtitle
- Animate pin/unpin transition

---

## Testing Checklist

1. **Drop session into zone** → Should auto-pin with pin icon visible
2. **Drag pinned zone** → Pinned sessions move with it (relative positions preserved)
3. **Click pin icon** → Session unpins, icon changes back to drag handle
4. **Drag pinned session outside zone** → Auto-unpins (optional behavior)
5. **Reload page** → Pinned state persists (from database)
6. **Multi-user sync** → Other users see pinned sessions move with zone in real-time

---

## Edge Cases

1. **Zone deleted while sessions pinned** → Need to auto-unpin orphaned sessions (add logic to zone delete handler)
2. **Session moved to different board** → Clear `parentId` from old board layout
3. **Zone resized with pinned sessions** → Sessions maintain relative positions (React Flow handles this)
4. **Pinned session dragged slightly** → Should stay pinned (only unpin if dragged outside zone bounds)

---

## Effort Estimate

**Total: ~2-3 hours**

- Drop detection logic: 30 min
- Coordinate conversion (relative ↔ absolute): 45 min
- Pin icon UI in SessionCard: 30 min
- Unpin handler + data flow: 30 min
- Testing & edge cases: 45 min

---

## Zone Triggers with Handlebars Templates

**Status:** ✅ Implemented

**Goal:** Trigger actions when a session is dropped into a zone, with dynamic prompt generation using Handlebars templates.

### Trigger Types

Three trigger types are supported (all use the unified `/sessions/:id/prompt` endpoint):

1. **Prompt** - Send a message to the session
2. **Task** - Create a new task (same as prompt)
3. **Subtask** - Create a subtask (prefixes prompt with `[Subtask]`)

### Handlebars Template Support

Zone trigger prompts support Handlebars syntax for dynamic content:

**Available Context:**

```typescript
{
  session: {
    description: string; // Session title/description
    issue_url: string; // GitHub issue URL
    pull_request_url: string; // Pull request URL
    context: Record<string, any>; // User-defined custom fields
  }
}
```

**Example Templates:**

```handlebars
Review the code and comment on {{session.issue_url}}
```

```handlebars
Create a subtask for {{session.description}} - Sprint {{session.context.sprintNumber}}
```

```handlebars
Add tests for PR {{session.pull_request_url}} (Team: {{session.context.teamName}})
```

### Custom Context

Users can define custom JSON context in Session Settings:

**UI:** Session Settings Modal → Custom Context (JSON)

**Example:**

```json
{
  "teamName": "Backend",
  "sprintNumber": 42,
  "priority": "high"
}
```

**Access in templates:**

```handlebars
{{session.context.teamName}}
{{session.context.sprintNumber}}
{{session.context.priority}}
```

### Implementation Details

**Type System:**

```typescript
// packages/core/src/types/board.ts
interface ZoneTrigger {
  type: 'prompt' | 'task' | 'subtask';
  text: string; // Handlebars template
}

interface ZoneBoardObject {
  type: 'zone';
  // ... other fields ...
  trigger?: ZoneTrigger;
}

// packages/core/src/types/session.ts
interface Session {
  // ... other fields ...
  issue_url?: string;
  pull_request_url?: string;
  custom_context?: Record<string, unknown>;
}
```

**Template Rendering:**

Location: `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx:1023-1084`

```typescript
import Handlebars from 'handlebars';

// Build context from session data
const context = {
  session: {
    description: session.description || '',
    issue_url: session.issue_url || '',
    pull_request_url: session.pull_request_url || '',
    context: session.custom_context || {},
  },
};

// Render template
const template = Handlebars.compile(trigger.text);
const renderedPrompt = template(context);
```

**Error Handling:**

- Invalid templates fall back to raw text (no error shown to user)
- Invalid JSON in custom context is rejected in Session Settings with validation error
- Missing context fields render as empty strings (Handlebars default behavior)

### UI Components

**Zone Configuration:**

- `ZoneConfigModal.tsx` - Configure zone triggers with Handlebars help text
- Shows available variables with examples
- Real-time validation for trigger text

**Session Settings:**

- `SessionSettingsModal.tsx` - Edit custom context JSON
- JSON validation with error messages
- Monospace font for better readability
- Help text explains Handlebars template usage

**Trigger Confirmation:**

- Modal appears when session dropped into zone with trigger
- Shows zone name, trigger type, and rendered prompt
- User can execute or skip trigger
- Session is pinned regardless of trigger execution choice

---

## Future Enhancements

### Board-Level Custom Context

**Idea:** Extend custom context to boards for board-wide metadata accessible in triggers.

**Use Case:**

```json
// Board settings
{
  "team": "Backend Team",
  "sprint": 42,
  "deadline": "2025-03-15"
}
```

**Template Access:**

```handlebars
{{board.context.team}}
- Sprint
{{board.context.sprint}}
(Due:
{{board.context.deadline}})
{{session.description}}
for
{{session.context.feature}}
```

**Benefits:**

- Shared context across all sessions on a board
- Board-level metadata (team, sprint, project info)
- Less repetition in session custom context
- Hierarchical context: board → session → zone trigger

**Implementation:**

1. Add `custom_context?: Record<string, unknown>` to `Board` type
2. Add Board Settings modal with custom context JSON field
3. Extend Handlebars context to include `board: { context: board.custom_context }`
4. Update ZoneConfigModal help text to show board context examples

**Effort:** ~2-3 hours

---

## References

- **React Flow Parent-Child Nodes:** https://reactflow.dev/examples/nodes/sub-flows
- **React Flow Collision Detection:** https://reactflow.dev/examples/interaction/collision-detection
- **Handlebars Documentation:** https://handlebarsjs.com/
- **Current Implementation:**
  - Zone node: `apps/agor-ui/src/components/SessionCanvas/canvas/BoardObjectNodes.tsx`
  - Session canvas: `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx`
  - Board repository: `packages/core/src/db/repositories/boards.ts`
  - Daemon hooks: `apps/agor-daemon/src/index.ts:310-344`
  - Zone trigger rendering: `apps/agor-ui/src/components/SessionCanvas/SessionCanvas.tsx:1023-1084`
