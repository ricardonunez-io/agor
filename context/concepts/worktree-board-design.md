# Worktree-on-Board Design

**Status:** Design Specification
**Date:** 2025-10-23
**Context:** Shift from session-centric to worktree-centric board layout

**Related:**

- [[board-objects]] - Zone system and board layout primitives
- [[models]] - Worktree and Session data models
- [[design]] - General UI/UX principles

---

## Problem Statement

Agor's boards currently display **Sessions** as the primary unit of organization. However, as worktrees become more central to the architecture (git isolation, GH issue/PR tracking, environments), there's a compelling case to pivot boards to display **Worktrees** instead.

**Key Tension:** Zone triggers were designed for sessions. When you drag a worktree (which contains a tree of sessions) into a zone, which session receives the trigger?

## Current Architecture Recap

### Session-Centric Model

- **Board:** Collection of sessions positioned in 2D space
- **Session:** Single conversation thread with agent
- **Genealogy:** Sessions can fork/spawn creating trees
- **Zones:** Trigger templated prompts on sessions when dropped
- **Worktrees:** Git isolation units (one worktree → many sessions)

### Session Genealogy

```
session-abc (parent)
├─ session-def (fork: explore alternative)
└─┬ session-ghi (spawn: subtask)
  └─ session-jkl (spawn: nested subtask)
```

Sessions can have complex genealogy trees but are displayed as individual cards on boards.

## Proposed Architecture: Worktree-Centric Model

### New Mental Model

| Concept       | New Role                           | Analogy                            |
| ------------- | ---------------------------------- | ---------------------------------- |
| **Board**     | Portfolio of active work           | Kanban board                       |
| **Worktree**  | Project/effort unit                | Ticket/Story/PR                    |
| **Zone**      | Workflow stage/trigger             | Column (Todo, In Progress, Review) |
| **Session**   | Conversation thread within project | Comment thread on ticket           |
| **Genealogy** | Session tree within worktree       | Conversation history/branches      |

### WorktreeCard Concept

Instead of displaying individual sessions, boards show **WorktreeCards** with:

**Primary Information:**

- Worktree name (e.g., `feature/user-auth`, `fix-issue-123`)
- Branch reference
- GH issue link (if attached)
- GH PR link (if attached)
- Environment badge (if configured)

**Session Tree Preview:**

- Compact visualization of session genealogy
- Active session count
- Latest activity timestamp
- Visual status indicators (in-progress, completed, failed)

**Example Card:**

```
┌─────────────────────────────────────┐
│ 🌿 feature/user-auth                │
│ #123 🔗 PR #456                      │
│ 🔧 staging                           │
│                                      │
│ Sessions (3):                        │
│ ├─ Initial implementation ✓         │
│ └─┬ Fix OAuth flow ⟳                │
│   └─ Try PKCE approach ✗            │
│                                      │
│ Last active: 5 minutes ago          │
└─────────────────────────────────────┘
```

### Interaction Model

**Click session in tree:** Opens SessionDrawer for that session
**Click card header:** Expands full session tree view
**Drag card:** Move worktree between zones
**Drop onto zone:** **← THIS IS THE PROBLEM**

## Design Solution

### Zone Configuration

Each zone has a **binary trigger behavior** setting:

**Zone Settings Panel:**

```
Zone: "Ready for Review"

Trigger Behavior:
○ Always Create New Session
● Show Session Picker (default)

Template Variables Available:
• {{ worktree.name }}
• {{ worktree.branch_name }}
• {{ worktree.issue_url }}
• {{ worktree.pull_request_url }}
• {{ worktree.environment.name }}

Trigger Template:
┌─────────────────────────────────────┐
│ Review this PR:                     │
│ {{ worktree.pull_request_url }}     │
│                                     │
│ Original issue:                     │
│ {{ worktree.issue_url }}            │
│                                     │
│ Please check for:                   │
│ - Code quality                      │
│ - Test coverage                     │
│ - Documentation                     │
└─────────────────────────────────────┘
```

---

### Zone Trigger Flow

#### Scenario 1: "Always Create New Session" Mode

1. User drops worktree onto zone
2. New session created immediately (root level in worktree)
3. Trigger template applied as first user message
4. Session starts executing

**Use Case:** Zones like "Start QA", "Begin Code Review" where you always want fresh context.

---

#### Scenario 2: "Show Session Picker" Mode

**Step 1: Drop Worktree onto Zone**

Visual feedback:

- Worktree card animates to zone
- Zone highlights
- ZoneTriggerModal opens

---

**Step 2: ZoneTriggerModal - Session Selection**

Modal shows session tree with smart default pre-selected:

```
┌─────────────────────────────────────────────────┐
│ Apply "Review PR" trigger                       │
│ feature/user-auth                                │
│                                                  │
│ Select session:                                 │
│                                                  │
│ ○ → New Session                                 │
│                                                  │
│ Session Tree:                                   │
│ ├─ ○ Initial implementation ✓                   │
│ │     45 messages, completed 2 hours ago        │
│ │                                                │
│ └─┬ ● Fix OAuth flow ⟳ (SMART DEFAULT)          │
│   │   23 messages, active 5 min ago             │
│   │                                              │
│   └─ ○ Try PKCE approach ✗                      │
│       12 messages, failed 30 min ago            │
│                                                  │
│                    [Cancel]  [Next →]           │
└─────────────────────────────────────────────────┘
```

**Smart Default Logic:**

```typescript
function getSmartDefault(worktree: Worktree): SessionID | 'new' {
  const sessions = worktree.sessions;

  // No sessions → "New Session"
  if (sessions.length === 0) return 'new';

  const activeSessions = sessions.filter(s => s.status === 'in_progress' || s.status === 'active');

  // All completed → "New Session"
  if (activeSessions.length === 0) return 'new';

  // One or more active → most recently updated
  const mostRecent = activeSessions.sort(
    (a, b) => b.updated_at.getTime() - a.updated_at.getTime()
  )[0];

  return mostRecent.session_id;
}
```

---

**Step 3: ZoneTriggerModal - Action Selection**

After user selects a session (or keeps smart default), modal transitions to action selection:

```
┌─────────────────────────────────────────────────┐
│ Apply "Review PR" trigger to:                   │
│ Fix OAuth flow (session 0199b856)               │
│                                                  │
│ How should the trigger be applied?              │
│                                                  │
│ ● Prompt (continue conversation)                │
│   Add trigger as new user message               │
│                                                  │
│ ○ Fork (create alternative path)                │
│   Create sibling session at decision point      │
│                                                  │
│ ○ Spawn (create subtask)                        │
│   Create child session for focused work         │
│                                                  │
│ Template Preview:                                │
│ ┌─────────────────────────────────────────────┐ │
│ │ Review this PR:                             │ │
│ │ https://github.com/org/repo/pull/456        │ │
│ │ ...                                         │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│                    [Cancel]  [Apply Trigger]    │
└─────────────────────────────────────────────────┘
```

**If "New Session" was selected in Step 2:**

```
┌─────────────────────────────────────────────────┐
│ Apply "Review PR" trigger                       │
│ New session in feature/user-auth                │
│                                                  │
│ Template Preview:                                │
│ ┌─────────────────────────────────────────────┐ │
│ │ Review this PR:                             │ │
│ │ https://github.com/org/repo/pull/456        │ │
│ │                                             │ │
│ │ Original issue:                             │ │
│ │ https://github.com/org/repo/issues/123      │ │
│ │ ...                                         │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│         [Cancel]  [Create Session & Apply]      │
└─────────────────────────────────────────────────┘
```

---

**Action Semantics:**

| Action          | Result                             | New Session? | Genealogy              |
| --------------- | ---------------------------------- | ------------ | ---------------------- |
| **Prompt**      | Continues existing session         | No           | -                      |
| **Fork**        | Creates sibling at current message | Yes          | Same parent as source  |
| **Spawn**       | Creates child session              | Yes          | Child of source        |
| **New Session** | Fresh root session                 | Yes          | Root level in worktree |

---

## WorktreeCard Design

### Card Layout

WorktreeCards display on the board as the primary unit of organization, replacing SessionCards.

**Collapsed State (Default):**

```
┌────────────────────────────────────────────────┐
│ 🌿 feature/user-auth              [edit] [···] │
├────────────────────────────────────────────────┤
│ #123  PR #456  🔧 staging  ⟳ 3 active         │
├────────────────────────────────────────────────┤
│ ▸ Sessions (5)                                 │
│   Last active: 5 minutes ago                   │
└────────────────────────────────────────────────┘
```

**Expanded State (After Clicking "▸ Sessions"):**

```
┌────────────────────────────────────────────────┐
│ 🌿 feature/user-auth              [edit] [···] │
├────────────────────────────────────────────────┤
│ #123  PR #456  🔧 staging  ⟳ 3 active         │
├────────────────────────────────────────────────┤
│ ▾ Sessions (5)                                 │
│   ├─ Initial implementation ✓                  │
│   │   45 msgs • 2 hours ago                    │
│   │                                             │
│   └─┬ Fix OAuth flow ⟳                         │
│     │ 23 msgs • 5 min ago                      │
│     │                                           │
│     └─ Try PKCE approach ✗                     │
│         12 msgs • 30 min ago                   │
│                                                 │
│   + Create new session                         │
└────────────────────────────────────────────────┘
```

---

### Pill Components

All pills displayed in header row (below worktree name):

| Pill             | Display          | Condition                          |
| ---------------- | ---------------- | ---------------------------------- |
| **Issue**        | `#123`           | `worktree.issue_url` exists        |
| **Pull Request** | `PR #456`        | `worktree.pull_request_url` exists |
| **Environment**  | `🔧 staging`     | `worktree.environment` exists      |
| **Status**       | `⟳ 3 active`     | Active session count > 0           |
| **Status**       | `✓ All complete` | All sessions completed             |
| **Status**       | `✗ Has failures` | Any session failed                 |

**Pill Click Behavior:**

- `#123` → Opens issue URL in new tab
- `PR #456` → Opens PR URL in new tab
- `🔧 staging` → Shows environment details tooltip
- Status pills → Non-interactive (informational)

---

### Session Tree Interaction

**Click session row:** Opens SessionDrawer for that session

**Click [edit] button:** Opens WorktreeModal for editing:

- Worktree name
- Link/unlink GH issue/PR
- Environment selection
- Delete worktree

**Click [···] menu:** Context menu:

- Archive worktree
- Create new session
- Clone worktree
- Export session tree

**Click "+ Create new session":** Creates root-level session in worktree

---

### Tree Depth Handling

**Current Design:** Show all tree depth (no limit for now)

**Future Consideration:** If genealogy exceeds ~10 levels:

- Collapse subtrees beyond depth 3
- Add "Show N more sessions..." expansion links
- Virtualized scrolling for large trees

But start simple - render full tree and adapt based on real usage patterns.

---

## Edge Cases & Considerations

### 1. Orphaned Sessions

**Problem:** Session exists but no longer tied to worktree (worktree deleted)

**Solution:**

- Sessions maintain `worktree_id` (nullable)
- Orphaned sessions could show in special "Unassigned" area
- Or filter them out from main board

### 2. Multi-Worktree Sessions

**Problem:** Can a session span multiple worktrees?

**Answer:** No. Session belongs to one worktree (1:1 relationship).

- If user wants to work across worktrees → fork session

### 3. Worktree Without Git

**Problem:** User creates worktree not tied to git repo

**Solution:**

- Worktree becomes pure container (no git context)
- Still useful for organizing sessions
- No branch/PR metadata shown

### 4. GH Issue/PR Linking

**Problem:** How to attach/detach issues/PRs from worktrees?

**UX:**

- WorktreeCard header has "🔗 Link Issue/PR" button
- Dialog to search/paste GH URL
- Can unlink anytime
- PRs auto-linked when worktree created from PR branch

### 5. Completed Worktrees

**Problem:** PR merged, what happens to worktree card?

**Solution:** Show "✓ Merged" badge, keep in place until manually archived

- Badge updates in real-time via GH webhook (future)
- User can archive via [···] menu
- Archived worktrees move to "Archive" board view

### 6. Forking Across Worktrees

**Problem:** Can you fork session into different worktree?

**Solution (Phase 1):** Not supported initially - fork stays within same worktree

**Future Exploration:** "Try this approach in clean worktree"

- Fork session → create new worktree with copy of state
- Advanced feature, defer until after core UX is validated

---

## Template Variable Expansion

Zone triggers should have access to worktree-level context:

### Available Variables

**Worktree Context:**

```typescript
{
  worktree: {
    id: string;
    name: string;
    branch_name: string;
    git_ref: string;
    base_sha: string;
    current_sha: string;
    issue_url?: string;
    pull_request_url?: string;
    environment?: {
      name: string;
      variables: Record<string, string>;
    };
  }
}
```

**Session Context (if continuing):**

```typescript
{
  session: {
    id: string;
    description: string;
    status: string;
    message_count: number;
    last_message_at: string;
  }
}
```

### Example Templates

**1. PR Review Trigger**

```
Review this pull request:
{{ worktree.pull_request_url }}

Context from issue:
{{ worktree.issue_url }}

Please analyze:
- Code quality and best practices
- Test coverage
- Documentation completeness
- Security implications
```

**2. QA Plan Trigger**

```
Create a QA test plan for:

Branch: {{ worktree.branch_name }}
PR: {{ worktree.pull_request_url }}
Environment: {{ worktree.environment.name }}

Include:
- Manual test scenarios
- Automated test coverage analysis
- Edge cases to verify
```

**3. Continue Work Trigger**

```
Continuing session: {{ session.description }}

Previous context:
- {{ session.message_count }} messages
- Last active: {{ session.last_message_at }}

Next steps:
[User adds specifics here]
```

---

## Design Summary

### Core UX Pattern

**Zone Drop Behavior:**

1. **Zone Setting: "Always Create New Session"**
   - Drop worktree → instantly creates new root session with trigger applied
   - Fast, predictable, no modal

2. **Zone Setting: "Show Session Picker"** (default)
   - Drop worktree → opens ZoneTriggerModal
   - **Step 1:** Select session (smart default pre-selected)
   - **Step 2:** Choose action: Prompt / Fork / Spawn
   - Apply trigger to selected target

**Smart Default Logic:**

- No sessions or all completed → "New Session"
- One or more active → most recently updated session
- Action defaults to "Prompt" (continue conversation)

---

### Key Design Decisions

| Decision                     | Rationale                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| **Worktree-centric boards**  | Aligns with "portfolio of projects" mental model               |
| **Binary zone setting**      | Simplicity over flexibility - covers 90% of use cases          |
| **Two-step modal**           | Session selection → Action selection (clear, not overwhelming) |
| **Smart defaults**           | Pre-select most likely choice, user can override               |
| **All pills visible**        | Rich context at a glance (issue, PR, environment, status)      |
| **Collapsible session tree** | Compact by default, expand on demand                           |
| **No tree depth limit (v1)** | Start simple, adapt to real usage                              |

---

### Key Benefits

- ✓ **Reduces board clutter:** One card per project vs. many session cards
- ✓ **Natural GH integration:** Issues/PRs attached to worktrees, not sessions
- ✓ **Preserves genealogy:** Session trees live within worktree context
- ✓ **Flexible workflows:** Zone setting adapts to different use cases
- ✓ **Fast common cases:** Smart defaults + binary mode covers most scenarios
- ✓ **Clear mental model:** Worktree = ticket/project, Session = conversation thread

---

### Implementation Roadmap

**Phase 1: Data Model**

- Add `issue_url`, `pull_request_url` to `worktrees` table
- Add session tree query utilities (`getSessionTree(worktree_id)`)
- Add zone setting field: `trigger_behavior: 'always_new' | 'show_picker'`

**Phase 2: WorktreeCard Component**

- Collapsed/expanded states
- Pill components (issue, PR, environment, status)
- Session tree rendering
- Click handlers (session → drawer, edit → modal)

**Phase 3: ZoneTriggerModal**

- Session selection step with tree view
- Action selection step (Prompt/Fork/Spawn)
- Template preview rendering
- Smart default logic

**Phase 4: Zone Settings**

- Trigger behavior toggle
- Template editor with variable hints
- Template preview

**Phase 5: Board Refactor**

- Replace SessionCard with WorktreeCard
- Update drag-and-drop handlers
- Migration script (boards → worktree layout)
- Minimap update

**Phase 6: Polish**

- Animations (modal transitions, card expand/collapse)
- Keyboard shortcuts (Esc to cancel, Enter to confirm)
- Loading states during session creation
- Error handling (template expansion failures, etc.)

---

### Success Metrics

- **Board density:** 50-70% fewer cards for same work (worktrees vs sessions)
- **Modal speed:** < 2 sec average time to apply trigger
- **Smart default accuracy:** > 80% users don't change pre-selected option
- **User comprehension:** Clear understanding of worktree vs session roles (survey)

---

_This design spec defines the worktree-centric board architecture for Agor. All options have been resolved. Ready for implementation._
