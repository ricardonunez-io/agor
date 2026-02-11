# Agor Documentation

Documentation website built with Mintlify.

## Development

```bash
# From project root
pnpm docs:dev

# Or directly
cd apps/agor-docs
pnpm dev
```

Open http://localhost:3000

## Structure

```
docs/
├── index.mdx
├── guide/
├── api-reference/
└── blog/
```

## Phase 1 (Complete)

- ✅ Mintlify setup with dark mode
- ✅ Agor brand colors (#2e9a92 teal)
- ✅ Landing page with Mintlify components
- ✅ Basic navigation structure
- ✅ Guide pages (Getting Started, Docker, Development)
- ✅ Auto-generated CLI docs from oclif
- ✅ Auto-generated API docs from FeathersJS services

## Phase 2 (Next)

- [ ] Add more guide content
- [ ] Improve CLI doc parsing
- [ ] Add code examples to API docs
- [ ] Deploy to docs.agor.dev

## Generate Documentation

Auto-generate CLI and API docs:

```bash
# From root
pnpm docs:generate

# Or from docs directory
pnpm generate        # Generate both CLI and API docs
pnpm generate:cli    # Generate CLI docs only
pnpm generate:api    # Generate API docs only
```

## Build

```bash
pnpm docs:build      # Auto-generates docs then builds
```

Output: Mintlify deployment artifacts

## Deployment

Docs are deployed via Mintlify on every push to `main` that changes:

- `apps/agor-docs/**`

**Mintlify Setup (one-time):**

1. Connect the repository in the Mintlify dashboard
2. Set the docs path to `apps/agor-docs`
3. Deployments trigger automatically on push

**Deployment URL:** https://agor.live/
