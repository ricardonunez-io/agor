# Init Experience & Authentication Flow

**Status:** Planning
**Created:** 2025-10-18
**Priority:** High (launch blocker for good UX)

---

## Problem Statement

Users need a smooth onboarding experience that:

1. Sets up Agor (database, config, etc.)
2. Checks authentication status for all agentic tools
3. Guides users to configure API keys where needed
4. Handles both fresh installs and existing CLI users

**Key Questions:**

- Should `agor init` prompt for API keys?
- How do we detect existing auth from native CLIs?
- How do we handle auth sharing between CLI and SDK?
- What's the UX when a tool isn't authenticated?

---

## Current State

### What `agor init` Does Now

```bash
agor init
# Creates ~/.agor/agor.db
# Creates default board
# That's it - no auth handling
```

### How Auth Works Today

**Claude Code:**

- Native CLI: `~/.claude/config` (JSON with API key)
- SDK: Uses `ANTHROPIC_API_KEY` env var OR native config
- **Shared:** SDK can read native CLI config ✅

**Codex:**

- Native CLI: `~/.codex/config.toml`
- SDK: Uses `OPENAI_API_KEY` env var OR native config
- **Shared:** SDK can read native CLI config ✅

**Gemini:**

- Native CLI: `~/.gemini/config` (needs verification)
- SDK: Uses `GOOGLE_API_KEY` env var OR native config
- **Unknown:** Need to verify SDK can read native config

### Current Config System

```bash
agor config set credentials.ANTHROPIC_API_KEY sk-ant-...
agor config set credentials.OPENAI_API_KEY sk-...
agor config set credentials.GOOGLE_API_KEY ...
```

Stored in: `~/.agor/config.json`

---

## Design Principles

1. **Don't break existing workflows** - Users with native CLIs already set up should "just work"
2. **Progressive disclosure** - Only ask for auth when creating a session with that tool
3. **Clear feedback** - Show which tools are ready, which need setup
4. **Centralized auth check** - Single source of truth for "is tool X authenticated?"
5. **Avoid duplication** - Prefer native CLI configs over storing keys in Agor

---

## Proposed Solution

### 1. AgenticTool Interface Extension

Add `authCheck()` to the ITool interface:

```typescript
interface ITool {
  name: string;
  version: string;

  // NEW: Cheap auth check (no API call, just config check)
  authCheck(): Promise<AuthCheckResult>;

  // Existing methods
  startSession(params: StartSessionParams): Promise<SessionHandle>;
  // ...
}

type AuthCheckResult =
  | { authenticated: true; source: 'native-cli' | 'agor-config' | 'env-var' }
  | { authenticated: false; reason: string; setupInstructions: string };
```

**Implementation Examples:**

```typescript
// ClaudeTool.authCheck()
async authCheck(): Promise<AuthCheckResult> {
  // 1. Check native CLI config
  const nativeConfig = await readClaudeConfig(); // ~/.claude/config
  if (nativeConfig?.apiKey) {
    return { authenticated: true, source: 'native-cli' };
  }

  // 2. Check env var
  if (process.env.ANTHROPIC_API_KEY) {
    return { authenticated: true, source: 'env-var' };
  }

  // 3. Check Agor config
  const agorKey = await getConfigValue('credentials.ANTHROPIC_API_KEY');
  if (agorKey) {
    return { authenticated: true, source: 'agor-config' };
  }

  // 4. Not authenticated
  return {
    authenticated: false,
    reason: 'No API key found',
    setupInstructions: [
      'Option 1: Use native CLI: claude login',
      'Option 2: Set env var: export ANTHROPIC_API_KEY=sk-ant-...',
      'Option 3: Use Agor config: agor config set credentials.ANTHROPIC_API_KEY sk-ant-...'
    ].join('\n')
  };
}
```

**Key Benefits:**

- No API calls (cheap to run)
- Checks all sources in priority order
- Returns actionable setup instructions
- Can run during init, session creation, settings UI

---

### 2. Enhanced `agor init` Flow

**Interactive Mode:**

```bash
$ agor init

✓ Created database at ~/.agor/agor.db
✓ Created default board

Checking agentic tool authentication...

  Claude Code    ✓ Authenticated (via ~/.claude/config)
  Codex          ✓ Authenticated (via env var OPENAI_API_KEY)
  Gemini         ✗ Not authenticated

? Configure Gemini now? (Y/n) y
? Enter Google API key: [input obscured]
✓ Saved to ~/.agor/config.json

All set! Run 'agor session start' to begin.
```

**Non-Interactive Mode:**

```bash
$ agor init --no-interactive

✓ Created database at ~/.agor/agor.db
✓ Created default board

⚠ Some tools are not authenticated. Run 'agor config check' to see status.
```

**Silent Mode:**

```bash
$ agor init --silent
# Just creates DB and board, no output
```

---

### 3. New CLI Command: `agor config check`

Shows authentication status for all tools:

```bash
$ agor config check

Agentic Tool Authentication Status:

  Tool          Status              Source
  ────────────  ──────────────────  ───────────────────
  Claude Code   ✓ Authenticated     ~/.claude/config
  Codex         ✓ Authenticated     $OPENAI_API_KEY
  Gemini        ✗ Not configured    -

To configure Gemini:
  1. Use native CLI: gemini auth login
  2. Set env var:    export GOOGLE_API_KEY=...
  3. Use Agor:       agor config set credentials.GOOGLE_API_KEY ...

For more info: agor config --help
```

---

### 4. UI: Tool Availability in New Session Modal

**When creating a session, show tool status:**

```
┌─ New Session ────────────────────────────────┐
│                                               │
│  Select Agentic Tool                          │
│                                               │
│  ○ Claude Code          ✓ Ready               │
│  ○ Codex                ✓ Ready               │
│  ○ Gemini               🔒 Auth Required       │
│                                               │
│  [Configure Gemini →]                         │
│                                               │
│  ...                                          │
└───────────────────────────────────────────────┘
```

**Tooltip on "Auth Required" badge:**

```
Gemini is not authenticated.

To configure:
• Native CLI: gemini auth login
• Agor config: agor config set credentials.GOOGLE_API_KEY ...

After configuring, refresh this modal.
```

**Alternative: Inline Auth Setup**

If user selects unauthenticated tool:

```
┌─ Configure Gemini ────────────────────────────┐
│                                               │
│  Gemini requires authentication.              │
│                                               │
│  ○ I've already configured via gemini CLI     │
│     → Agor will use ~/.gemini/config          │
│                                               │
│  ○ Enter API key now                          │
│     ┌─────────────────────────────────────┐  │
│     │ [Google API Key]                     │  │
│     └─────────────────────────────────────┘  │
│     ☑ Save to Agor config                   │
│                                               │
│  [Cancel]  [Continue]                         │
└───────────────────────────────────────────────┘
```

---

### 5. Settings Modal: Authentication Tab

Add new tab to Settings modal:

**"Authentication" Tab:**

```
┌─ Settings: Authentication ────────────────────────────────┐
│                                                            │
│  Agentic Tool Credentials                                  │
│                                                            │
│  Tool          Status              Action                  │
│  ────────────  ──────────────────  ─────────────────────  │
│  Claude Code   ✓ ~/.claude/config  [Test Connection]      │
│  Codex         ✓ $OPENAI_API_KEY   [Test Connection]      │
│  Gemini        ✗ Not configured     [Configure]            │
│                                                            │
│  ────────────────────────────────────────────────────────  │
│                                                            │
│  How Authentication Works:                                 │
│                                                            │
│  Agor checks for API keys in this order:                   │
│  1. Native CLI config (~/.claude/config, etc.)             │
│  2. Environment variables (ANTHROPIC_API_KEY, etc.)        │
│  3. Agor config (~/.agor/config.json)                      │
│                                                            │
│  We recommend using native CLIs when possible.             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**"Configure" Button Opens Modal:**

```
┌─ Configure Gemini API Key ────────────────────┐
│                                               │
│  API Key                                      │
│  ┌─────────────────────────────────────────┐ │
│  │ ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●      │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ☑ Save to ~/.agor/config.json               │
│                                               │
│  [Cancel]  [Save]                             │
└───────────────────────────────────────────────┘
```

**"Test Connection" Flow:**

1. Click "Test Connection"
2. Shows loading spinner
3. Calls tool's actual API (e.g., Claude list models)
4. Shows result:
   - ✓ "Connection successful (claude-3-5-sonnet-20241022 available)"
   - ✗ "Connection failed: Invalid API key"

---

### 6. Runtime Auth Handling

**When starting a session:**

```typescript
// In session creation service
async function createSession(params: CreateSessionInput) {
  const tool = getToolByName(params.agenticTool);

  // Check auth BEFORE creating session
  const authResult = await tool.authCheck();

  if (!authResult.authenticated) {
    throw new Error(
      `${tool.name} is not authenticated. ${authResult.setupInstructions}`
    );
  }

  // Proceed with session creation
  const session = await tool.startSession(...);
  // ...
}
```

**In UI:**

- Disable "Create Session" button if selected tool is unauthenticated
- Show inline warning with setup instructions
- Add "Refresh" button to re-check auth after user configures

---

## Implementation Phases

### Phase 1: Core Infrastructure (2-3 hours)

- ✅ Add `authCheck()` to ITool interface
- ✅ Implement for ClaudeTool, CodexTool, GeminiTool
- ✅ Add `agor config check` CLI command
- ✅ Test all three auth sources (native, env, agor)

### Phase 2: Init Enhancement (1-2 hours)

- ✅ Add auth check to `agor init`
- ✅ Add interactive prompt for missing keys
- ✅ Add `--no-interactive` flag
- ✅ Update init command help text

### Phase 3: UI Integration (2-3 hours)

- ✅ Add auth status badges to NewSessionModal
- ✅ Add tooltips with setup instructions
- ✅ Disable unavailable tools
- ✅ Add refresh mechanism after auth setup

### Phase 4: Settings UI (2-3 hours)

- ✅ Add "Authentication" tab to SettingsModal
- ✅ Show all tools with status
- ✅ Add "Test Connection" feature
- ✅ Add configure modal for entering keys

### Phase 5: Documentation (1 hour)

- ✅ Update README with auth setup instructions
- ✅ Add troubleshooting guide
- ✅ Document all three auth methods

**Total:** 8-12 hours

---

## Open Questions

1. **Should we validate API keys during init?**
   - Pro: Catch issues early
   - Con: Makes init slow (API calls)
   - **Recommendation:** No, just check file/env existence

2. **Should we store API keys in Agor config?**
   - Pro: Convenient for users without native CLIs
   - Con: Security (plain text in config.json)
   - **Recommendation:** Yes, but warn users, prefer native CLIs

3. **Should we support multiple API keys per tool?**
   - Use case: Team accounts, rate limit rotation
   - **Recommendation:** Not for v1, add later if needed

4. **Should we auto-detect and import native CLI configs?**
   - Pro: Zero-config for existing CLI users
   - Con: Complexity, permission issues
   - **Recommendation:** Yes via `authCheck()`, read-only

5. **Should "Test Connection" be part of authCheck()?**
   - Pro: Validates key actually works
   - Con: Makes authCheck() slow, requires network
   - **Recommendation:** Separate method `validateAuth()` for UI

---

## Security Considerations

1. **API Key Storage:**
   - Native CLI configs: Managed by native tools (secure)
   - Env vars: Managed by shell (secure)
   - Agor config: Plain text JSON (⚠️ less secure)

2. **Display in UI:**
   - Always obscure keys (show as `●●●●●●●●`)
   - Only show last 4 characters for verification
   - Use `type="password"` in input fields

3. **Logging:**
   - Never log API keys
   - Redact keys in error messages
   - Only log source (native-cli, env-var, agor-config)

4. **File Permissions:**
   - Set `~/.agor/config.json` to 0600 (user read/write only)
   - Warn if permissions are too open

---

## User Stories

### Story 1: Fresh Install with Native CLIs

**Persona:** Developer who already uses Claude Code CLI

**Flow:**

1. `pnpm install && agor init`
2. Init detects `~/.claude/config` exists
3. Shows "Claude Code ✓ Ready"
4. User creates session, works immediately
5. **Result:** Zero additional setup ✅

### Story 2: Fresh Install, No CLIs

**Persona:** New user, no native CLIs installed

**Flow:**

1. `pnpm install && agor init`
2. Init shows all tools unauthenticated
3. Prompts: "Configure Claude Code now? (Y/n)"
4. User enters API key
5. Saved to `~/.agor/config.json`
6. **Result:** Guided setup ✅

### Story 3: Adding Second Tool Later

**Persona:** User starts with Claude, adds Gemini later

**Flow:**

1. Already using Agor with Claude
2. Opens Settings → Authentication tab
3. Clicks "Configure" on Gemini
4. Enters API key
5. Returns to New Session modal
6. Gemini now shows "✓ Ready"
7. **Result:** Self-service tool addition ✅

### Story 4: API Key Rotation

**Persona:** Enterprise user, monthly key rotation

**Flow:**

1. Claude session fails: "Invalid API key"
2. Opens Settings → Authentication
3. Clicks "Configure" on Claude Code
4. Enters new key
5. Clicks "Test Connection" → ✓ Success
6. **Result:** Easy key updates ✅

---

## Alternative Approaches Considered

### Approach A: Require Native CLIs (Rejected)

**Idea:** Only support native CLI auth, don't store keys in Agor

**Pros:**

- Simpler implementation
- More secure (no key storage)
- Leverages existing tooling

**Cons:**

- Friction for new users
- Doesn't work if native CLI unavailable
- Limits Agor to CLI users only

**Verdict:** ❌ Too restrictive

### Approach B: OAuth-Style Flow (Rejected for v1)

**Idea:** Redirect to Anthropic/OpenAI/Google for auth, get tokens

**Pros:**

- Most secure
- Standard pattern
- No key storage

**Cons:**

- Requires Agor backend/auth server
- Complex implementation
- Doesn't work for self-hosted

**Verdict:** ❌ Save for federated/cloud version

### Approach C: Per-Session API Keys (Rejected)

**Idea:** Let users enter API keys per session

**Pros:**

- Maximum flexibility
- Easy A/B testing with different accounts

**Cons:**

- Terrible UX (enter key every time)
- Security (keys in session records)
- Doesn't solve onboarding

**Verdict:** ❌ Solves wrong problem

---

## Success Metrics

**Good onboarding experience if:**

- ✅ Users with native CLIs work immediately (0 additional setup)
- ✅ New users can configure all tools in <2 minutes
- ✅ Auth errors show actionable instructions
- ✅ Settings UI makes auth status transparent
- ✅ API key rotation is self-service

**Measure:**

- Time from `agor init` to first successful session
- % of sessions that fail due to auth issues
- Support requests about API key setup

---

## Future Enhancements

**Post-Launch (v1.1+):**

1. **Team Key Management**
   - Shared API keys across team
   - Usage tracking per user
   - Rate limit pooling

2. **Key Validation**
   - Background checks for expired keys
   - Proactive warnings before expiration
   - Auto-refresh for rotated keys

3. **Multi-Account Support**
   - Multiple API keys per tool
   - Switch accounts per session
   - Organization/personal separation

4. **Secret Management Integration**
   - 1Password integration
   - Vault/HashiCorp support
   - Encrypted key storage

5. **OAuth Flow**
   - Native OAuth for cloud version
   - Federated identity
   - SSO support

---

## References

- [Claude Code CLI Config](https://docs.anthropic.com/en/docs/claude-code)
- [Codex SDK Auth](https://developers.openai.com/docs/codex)
- [Gemini CLI Docs](https://ai.google.dev/gemini-api/docs/cli)
- [Auth UX Best Practices](https://www.nngroup.com/articles/authentication-patterns/)

---

## Related Explorations

- [[native-cli-feature-gaps]] - Understanding native CLI capabilities
- [[single-package]] - Distribution affects auth setup UX
- [[async-jobs]] - Background auth validation jobs
