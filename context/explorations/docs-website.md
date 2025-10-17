# Documentation Website

**Status:** Exploration - Critical Path for Launch
**Target:** Phase 3 (Pre-Launch)
**Date:** January 2025

---

## Problem Statement

Currently, Agor documentation is scattered:

- Architecture docs in `context/concepts/` (for contributors)
- README.md (overview + getting started)
- CLAUDE.md (AI agent instructions)
- No user-facing documentation website
- No API reference docs
- No CLI command reference

**Users can't easily discover features, learn workflows, or reference APIs.**

---

## Goal

Launch a professional documentation website with:

1. **User Guide** - Getting started, key features, workflows
2. **CLI Reference** - Auto-generated from oclif commands
3. **REST API Reference** - Auto-generated from FeathersJS services
4. **Architecture Docs** - Adapted from `context/concepts/` for contributors
5. **Search** - Fast, indexed search across all docs

---

## Recommended Stack: Nextra

**Why Nextra:**

- ✅ **First-class MDX support** - Interactive examples, live code demos
- ✅ **Next.js ecosystem** - React-based, huge community
- ✅ **Beautiful default theme** - Clean, modern, mobile-friendly
- ✅ **Built-in search** - Flexsearch (fast, fuzzy)
- ✅ **OpenAPI support** - Auto-generate REST API docs from OpenAPI/Swagger specs
- ✅ **Fast** - Static generation + incremental regeneration
- ✅ **Free hosting** - Vercel (one-click deploy)
- ✅ **Great DX** - Hot reload, TypeScript support, component imports

**Modern Stack (2025):**

| Tool       | Used By              | Best For                  | MDX | API Docs | Popularity |
| ---------- | -------------------- | ------------------------- | --- | -------- | ---------- |
| Nextra     | Turbo, SWR, Tailwind | Modern React projects     | ✅  | ✅       | 🔥🔥🔥     |
| Mintlify   | Anthropic, OpenAI    | AI-powered, beautiful     | ✅  | ✅       | 🔥🔥🔥     |
| VitePress  | Vue, Vite, Vitest    | Vue ecosystem             | ⚠️  | ❌       | 🔥🔥       |
| Docusaurus | Meta, Jest, Babel    | Large OSS projects        | ✅  | ⚠️       | 🔥🔥       |
| Fumadocs   | Lucia, Uploadthing   | Next.js 14+, ultra-modern | ✅  | ✅       | 🔥         |

**Recommendation:** **Nextra** (best MDX + OpenAPI support, React ecosystem, Vercel-backed)

**Alternative:** **Mintlify** if you want zero config + AI features (but vendor lock-in)

---

## Documentation Structure

```
docs/
├── .vitepress/
│   ├── config.ts           # VitePress config
│   └── theme/              # Custom theme overrides
│
├── index.md                # Landing page
│
├── guide/
│   ├── getting-started.md  # Installation, first session
│   ├── key-concepts.md     # Sessions, tasks, boards, agents
│   ├── claude-agent.md     # Using Claude Agent SDK
│   ├── codex-agent.md      # Using OpenAI Codex SDK
│   ├── boards.md           # Board organization, zones, triggers
│   ├── multiplayer.md      # Real-time collaboration
│   ├── mcp-servers.md      # MCP integration
│   └── workflows.md        # Common workflows (fork, spawn, etc.)
│
├── cli/
│   ├── index.md            # CLI overview
│   ├── session.md          # Session commands (auto-generated)
│   ├── repo.md             # Repo commands (auto-generated)
│   ├── board.md            # Board commands (auto-generated)
│   ├── user.md             # User commands (auto-generated)
│   ├── mcp.md              # MCP commands (auto-generated)
│   └── config.md           # Config commands (auto-generated)
│
├── api/
│   ├── index.md            # REST API overview
│   ├── sessions.md         # /sessions endpoints (auto-generated)
│   ├── tasks.md            # /tasks endpoints (auto-generated)
│   ├── messages.md         # /messages endpoints (auto-generated)
│   ├── repos.md            # /repos endpoints (auto-generated)
│   ├── boards.md           # /boards endpoints (auto-generated)
│   ├── users.md            # /users endpoints (auto-generated)
│   ├── mcp-servers.md      # /mcp-servers endpoints (auto-generated)
│   └── websockets.md       # WebSocket events reference
│
├── architecture/
│   ├── overview.md         # System design (adapted from context/concepts/architecture.md)
│   ├── data-models.md      # Data models (adapted from context/concepts/models.md)
│   ├── primitives.md       # Five primitives (adapted from context/concepts/core.md)
│   ├── frontend.md         # Frontend architecture (adapted from context/concepts/frontend-guidelines.md)
│   └── agent-integration.md # Agent abstraction layer (adapted from context/concepts/agent-integration.md)
│
└── contributing/
    ├── setup.md            # Dev environment setup
    ├── code-standards.md   # TypeScript patterns, conventions
    └── roadmap.md          # Implementation roadmap (adapted from PROJECT.md)
```

---

## Phase 1: Core Documentation (1-2 weeks)

**Goal:** Launch docs.agor.dev with essential user-facing content

### Setup

- [ ] Install Nextra in monorepo (`npm install nextra nextra-theme-docs`)
- [ ] Create `docs/` directory as Next.js app
- [ ] Configure Nextra (theme.config.tsx, next.config.js)
- [ ] Set up Vercel deployment (auto-detected)

### Content Migration

- [ ] **Landing page** (`docs/index.md`)
  - Hero section with demo video/gif
  - Key features (multiplayer, agents, MCP, boards)
  - Quick start (install → create session → view UI)

- [ ] **Getting Started** (`docs/guide/getting-started.md`)
  - Installation (npm/git clone)
  - First session (CLI + UI)
  - Basic workflows

- [ ] **Key Concepts** (`docs/guide/key-concepts.md`)
  - Sessions, tasks, messages
  - Boards and zones
  - Fork vs spawn
  - Adapted from `context/concepts/core.md`

- [ ] **CLI Reference** (auto-generated)
  - Use oclif's built-in docs generation
  - Script: `pnpm agor --help --markdown > docs/cli/index.md`

- [ ] **REST API Reference** (manual for now)
  - Document key endpoints
  - Request/response examples
  - Future: auto-generate from FeathersJS schemas

### Deployment

- [ ] Deploy to `docs.agor.dev` (Cloudflare Pages recommended)
- [ ] Add analytics (Plausible or Simple Analytics)
- [ ] Set up auto-deploy on push to main

**Timeline:** 1-2 weeks

---

## Phase 2: Advanced Features (2-3 weeks)

**Goal:** Complete documentation for all features

### Content

- [ ] **Agent Guides**
  - Claude Agent SDK setup
  - Codex SDK setup
  - Permission modes
  - MCP server integration

- [ ] **Board Features**
  - Zone triggers (Prompt/Task/Subtask)
  - Handlebars templates
  - Session pinning

- [ ] **Multiplayer**
  - Authentication (email/password vs anonymous)
  - Facepile and cursors
  - Multi-user boards

- [ ] **Architecture Docs**
  - Migrate from `context/concepts/`
  - Add diagrams (Mermaid.js)
  - Database schema visualization

### Enhancements

- [ ] **Interactive examples** - Use MDX for live demos
- [ ] **Video tutorials** - Screen recordings of key workflows
- [ ] **Search** - Enable VitePress built-in search
- [ ] **Dark mode** - Ensure proper dark mode support

**Timeline:** 2-3 weeks

---

## Phase 3: Auto-Generated Docs (1-2 weeks)

**Goal:** Automate CLI and API reference generation

### CLI Reference

**Current approach:** oclif generates markdown help output

**Improvement:**

```typescript
// scripts/generate-cli-docs.ts
import { CommandHelp } from '@oclif/core';

async function generateCliDocs() {
  const commands = ['session', 'repo', 'board', 'user', 'mcp', 'config'];

  for (const cmd of commands) {
    const help = await CommandHelp.generate(cmd);
    const markdown = formatAsMarkdown(help);
    await writeFile(`docs/cli/${cmd}.md`, markdown);
  }
}
```

**Run on build:**

```json
{
  "scripts": {
    "docs:cli": "tsx scripts/generate-cli-docs.ts",
    "docs:build": "pnpm docs:cli && vitepress build docs"
  }
}
```

### REST API Reference

**Current approach:** Manual documentation

**Improvement:** Generate from FeathersJS service schemas

```typescript
// scripts/generate-api-docs.ts
import { app } from '../apps/agor-daemon/src/index';

async function generateApiDocs() {
  const services = app.services;

  for (const [path, service] of Object.entries(services)) {
    const schema = service.schema; // If using JSON Schema
    const markdown = generateMarkdownFromSchema(path, schema);
    await writeFile(`docs/api/${path}.md`, markdown);
  }
}
```

**Future:** Integrate OpenAPI/Swagger if FeathersJS supports it

### WebSocket Events Reference

**Approach:** Document event schemas manually (no auto-gen needed)

```markdown
## cursor-moved

Broadcast when a user moves their cursor on the board.

**Event:** `cursor-moved`

**Payload:**
\`\`\`typescript
{
userId: string;
boardId: string;
position: { x: number; y: number };
timestamp: number;
}
\`\`\`

**Example:**
\`\`\`javascript
socket.on('cursor-moved', (data) => {
console.log(`User ${data.userId} moved to (${data.position.x}, ${data.position.y})`);
});
\`\`\`
```

**Timeline:** 1-2 weeks

---

## Hosting Options

### Option 1: Cloudflare Pages (Recommended)

**Pros:**

- ✅ Free unlimited builds
- ✅ Global CDN (fast worldwide)
- ✅ Auto-deploy from GitHub
- ✅ Custom domain support
- ✅ Preview deployments

**Setup:**

```bash
# .github/workflows/deploy-docs.yml
name: Deploy Docs
on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'context/concepts/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm docs:build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages publish docs/.vitepress/dist --project-name=agor-docs
```

### Option 2: Vercel

**Pros:**

- ✅ Great DX (auto-detect VitePress)
- ✅ Preview deployments
- ✅ Fast builds

**Cons:**

- ⚠️ Free tier has limits (100GB bandwidth/month)

### Option 3: GitHub Pages

**Pros:**

- ✅ Free (unlimited)
- ✅ Native GitHub integration

**Cons:**

- ❌ No custom headers (slower)
- ❌ No preview deployments

**Recommendation:** Cloudflare Pages (best performance + free)

---

## Nextra Configuration

```typescript
// theme.config.tsx
import { useRouter } from 'next/router';
import { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span><strong>Agor</strong></span>,
  project: {
    link: 'https://github.com/yourusername/agor',
  },
  docsRepositoryBase: 'https://github.com/yourusername/agor/tree/main/docs',

  useNextSeoProps() {
    const { asPath } = useRouter();
    if (asPath !== '/') {
      return {
        titleTemplate: '%s – Agor',
      };
    }
  },

  navigation: {
    prev: true,
    next: true,
  },

  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },

  footer: {
    text: `MIT ${new Date().getFullYear()} © Agor`,
  },

  toc: {
    backToTop: true,
  },

  editLink: {
    text: 'Edit this page on GitHub →',
  },

  feedback: {
    content: 'Question? Give us feedback →',
    labels: 'feedback',
  },

  search: {
    placeholder: 'Search documentation...',
  },
};

export default config;
```

```javascript
// next.config.js
const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  latex: true,
  defaultShowCopyCode: true,
});

module.exports = withNextra({
  // Next.js config
  reactStrictMode: true,
});
```

### OpenAPI Integration (Auto-Generated REST API Docs)

**Install OpenAPI plugin:**

```bash
npm install nextra-theme-openapi
```

**Generate OpenAPI spec from FeathersJS:**

```typescript
// scripts/generate-openapi.ts
import { app } from '../apps/agor-daemon/src/index';
import { generateOpenAPI } from './openapi-generator';

async function generate() {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'Agor REST API',
      version: '1.0.0',
    },
    servers: [{ url: 'http://localhost:3030' }],
    paths: {},
  };

  // Generate paths from FeathersJS services
  for (const [path, service] of Object.entries(app.services)) {
    spec.paths[`/${path}`] = generatePathsFromService(service);
  }

  await writeFile('docs/openapi.json', JSON.stringify(spec, null, 2));
}
```

**Use in Nextra:**

```mdx
// docs/api/sessions.mdx
import { OpenAPI } from 'nextra-theme-openapi';

# Sessions API

<OpenAPI path="/api/sessions" method="GET" />
<OpenAPI path="/api/sessions" method="POST" />
<OpenAPI path="/api/sessions/:id" method="GET" />
<OpenAPI path="/api/sessions/:id" method="PATCH" />
<OpenAPI path="/api/sessions/:id" method="DELETE" />
```

---

## Content Migration Strategy

### From `context/concepts/` to `docs/`

**Decision:** Keep both directories with different audiences

- **`context/concepts/`** - Internal architecture docs for contributors and AI agents
- **`docs/`** - User-facing documentation for end users

**Adaptation strategy:**

```
context/concepts/core.md
  → docs/guide/key-concepts.md (simplified, user-focused)

context/concepts/architecture.md
  → docs/architecture/overview.md (technical deep-dive)

context/concepts/multiplayer.md
  → docs/guide/multiplayer.md (user guide)
  → docs/architecture/websockets.md (technical reference)
```

**Process:**

1. Copy concept doc to appropriate docs/ location
2. Simplify language (remove "for contributors" sections)
3. Add user-focused examples
4. Add screenshots/videos
5. Remove implementation details (keep in concepts/)

---

## Analytics & Feedback

### Analytics (Privacy-Friendly)

**Option 1: Plausible Analytics (Recommended)**

- ✅ Privacy-friendly (no cookies)
- ✅ Lightweight script
- ✅ Beautiful dashboard
- ⚠️ Paid ($9/month)

**Option 2: Simple Analytics**

- ✅ Privacy-friendly
- ✅ Open-source
- ⚠️ Paid ($9/month)

**Option 3: Cloudflare Web Analytics**

- ✅ Free
- ✅ Privacy-friendly
- ❌ Basic features

**Recommendation:** Start with Cloudflare (free), upgrade to Plausible if needed

### Feedback Widget

**Add feedback buttons to each page:**

```markdown
---
Was this page helpful?
[👍 Yes] [👎 No] [Edit on GitHub]
---
```

**Implementation:**

```vue
<!-- docs/.vitepress/theme/components/Feedback.vue -->
<template>
  <div class="feedback">
    <p>Was this page helpful?</p>
    <button @click="sendFeedback('yes')">👍 Yes</button>
    <button @click="sendFeedback('no')">👎 No</button>
    <a :href="editLink" target="_blank">Edit on GitHub</a>
  </div>
</template>
```

---

## Visual Assets

### Landing Page

**Hero section:**

- Logo + tagline
- Animated terminal demo (asciinema or custom)
- "Get Started" CTA button

**Features section:**

- Icon grid (multiplayer, agents, MCP, boards)
- Screenshots of UI
- Code examples

**Testimonials/Social proof:**

- GitHub stars count
- "Used by X developers" (if applicable)

### Screenshots

**Priority screenshots:**

1. Session canvas with multiple sessions
2. Conversation view with tool blocks
3. Board with zones and triggers
4. Facepile with cursors
5. MCP server settings

**Tools:** Figma for mockups, actual app screenshots for v1

---

## Open Questions

1. **Domain name:** `docs.agor.dev` or `agor.dev/docs`?
   - **Recommendation:** `agor.dev/docs` (subdirectory, unified domain)

2. **Versioned docs:** Support multiple versions (v1.0, v1.1, etc.)?
   - **Recommendation:** Not yet, add in Phase 3 when needed

3. **Localization:** Support multiple languages?
   - **Recommendation:** English only for v1, i18n in Phase 5

4. **API playground:** Interactive REST API explorer (like Swagger UI)?
   - **Recommendation:** Not critical, add in Phase 3 if requested

---

## Success Metrics

**Phase 1 (Launch):**

- [ ] Docs site live at `docs.agor.dev`
- [ ] All CLI commands documented
- [ ] Getting started guide complete
- [ ] Search working

**Phase 2 (Growth):**

- [ ] 90%+ documentation coverage
- [ ] <5 seconds average page load time
- [ ] > 80% "Was this helpful?" positive feedback

**Phase 3 (Maturity):**

- [ ] Auto-generated CLI/API docs
- [ ] Video tutorials for key workflows
- [ ] SEO-optimized (ranking for "AI agent orchestration")

---

## Timeline

| Phase | Deliverable                | Timeline | Priority |
| ----- | -------------------------- | -------- | -------- |
| 1     | Core docs + deployment     | 1-2 wks  | Critical |
| 2     | Full feature documentation | 2-3 wks  | High     |
| 3     | Auto-generated references  | 1-2 wks  | Medium   |

**Total: 4-7 weeks to full documentation coverage**

**Recommendation:** Start Phase 1 immediately (critical path for launch)

---

## Storybook vs Documentation Website

**Different audiences, different purposes:**

### Storybook (Dev Tool)

**Audience:** Contributors, UI developers, designers

**Purpose:**

- Component development and testing
- Visual regression testing
- Isolated component playground
- Props documentation
- Interaction testing

**Keep it for:**

- ✅ SessionCard, MessageBlock, TaskBlock, etc. component demos
- ✅ Dark mode testing
- ✅ Different states (loading, error, empty)
- ✅ Interactive props testing
- ✅ Visual QA during development

**Example:**

```typescript
// SessionCard.stories.tsx
export const Default = {
  args: {
    session: mockSession,
    onSelect: action('onSelect'),
  },
};

export const WithTasks = {
  args: {
    session: { ...mockSession, tasks: mockTasks },
  },
};
```

### Nextra Docs (User Tool)

**Audience:** End users, API consumers

**Purpose:**

- Feature documentation
- Getting started guides
- API reference
- Workflow tutorials
- Conceptual explanations

**Use it for:**

- ✅ "How to create a session"
- ✅ "Board zones and triggers"
- ✅ REST API reference
- ✅ CLI command reference
- ✅ Architecture overview

**Example:**

````mdx
// docs/guide/boards.mdx
import { Tabs, Tab } from 'nextra/components';

# Board Zones

Zones are visual containers for organizing sessions.

<Tabs items={['UI', 'CLI', 'API']}>
  <Tab>
    Drag a session onto the canvas to create a zone.
    ![Zone creation demo](./zone-demo.gif)
  </Tab>
  <Tab>
    ```bash
    agor board add-zone --name "In Progress"
    ```
  </Tab>
  <Tab>
    ```typescript
    POST /boards/:id/zones
    { name: "In Progress", color: "#1890ff" }
    ```
  </Tab>
</Tabs>
````

### Decision Matrix

| Feature                    | Storybook | Nextra Docs |
| -------------------------- | --------- | ----------- |
| Component props            | ✅        | ❌          |
| Visual states              | ✅        | ❌          |
| User workflows             | ❌        | ✅          |
| API reference              | ❌        | ✅          |
| Getting started            | ❌        | ✅          |
| Interactive examples       | ✅        | ✅ (MDX)    |
| SEO/Public discoverability | ❌        | ✅          |

**Recommendation:**

- **Keep Storybook** for component development (dev tool, not public)
- **Use Nextra** for user-facing documentation (public, SEO-friendly)
- **Optional:** Embed Storybook iframe in Nextra for interactive component demos

**Example integration:**

```mdx
// docs/components/session-card.mdx
import { Callout } from 'nextra/components';

# SessionCard Component

The SessionCard displays session metadata and status.

## Live Demo

<iframe
  src="https://storybook.agor.dev/?path=/story/sessioncard--default"
  width="100%"
  height="600px"
/>

<Callout type="info">
  View full component documentation in [Storybook](https://storybook.agor.dev).
</Callout>
```

**Hosting Storybook (optional):**

- Deploy Storybook to `storybook.agor.dev` (Vercel/Chromatic)
- Link from Nextra docs for contributors
- Not critical for launch

---

## Alternative: Mintlify (Zero Config)

**If you want zero setup + beautiful UI out of the box:**

```bash
npx mintlify init
# Answer prompts, it auto-generates docs structure
```

**Pros:**

- ✅ Zero config (AI-powered setup)
- ✅ Beautiful default theme (best-in-class)
- ✅ Auto-detects OpenAPI specs
- ✅ AI-powered search suggestions
- ✅ Analytics built-in

**Cons:**

- ❌ Vendor lock-in (proprietary platform)
- ❌ Hosted only (no self-host)
- ❌ Paid for custom domain ($120/mo)

**Used by:** Anthropic (Claude API docs), OpenAI (API docs), Mistral

**Recommendation:** Use Mintlify if you want to launch docs in 1 day with zero config. Use Nextra if you want full control + open source.

---

## References

- [Nextra](https://nextra.site/) - Docs framework
- [Nextra OpenAPI](https://github.com/trevorblades/nextra-openapi) - OpenAPI integration
- [Mintlify](https://mintlify.com/) - AI-powered docs (proprietary)
- [oclif docs generation](https://oclif.io/docs/readme)
- [Vercel](https://vercel.com/) - Deployment
- [Cloudflare Pages](https://pages.cloudflare.com/) - Alternative deployment
- [Plausible Analytics](https://plausible.io/)
- [Example: Turbo docs](https://turbo.build/repo/docs) - Nextra example
- [Example: SWR docs](https://swr.vercel.app/) - Nextra example
- [Example: Claude API docs](https://docs.anthropic.com/) - Mintlify example
