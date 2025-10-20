// src/types/worktree.ts
import type { SessionID, UUID, WorktreeID } from './id';
import type { WorktreeName } from './repo';

/**
 * Git worktree - First-class entity for isolated development contexts
 *
 * Worktrees are persistent work contexts that outlive individual sessions.
 * Each worktree has:
 * - Isolated git working directory and branch
 * - Environment configuration and runtime state
 * - Work metadata (issue, PR, notes)
 * - Session history
 *
 * Relationship to sessions:
 * - Sessions = ephemeral conversations with AI agents
 * - Worktrees = persistent work contexts (git + environment + metadata)
 * - Multiple sessions can work on the same worktree over time
 */
export interface Worktree {
  // ===== Identity =====

  /** Unique worktree identifier (UUIDv7) */
  worktree_id: WorktreeID;

  /** Repository this worktree belongs to */
  repo_id: UUID;

  /** Timestamps */
  created_at: string;
  updated_at: string;

  /** User who created this worktree */
  created_by: UUID;

  // ===== Materialized (for indexes/queries) =====

  /**
   * Worktree name (slug format)
   *
   * Used for:
   * - Directory name: ~/.agor/worktrees/{repo-slug}/{name}
   * - Default branch name (if creating new branch)
   * - CLI references
   *
   * Examples: "main", "feat-auth", "exp-rewrite"
   */
  name: WorktreeName;

  /**
   * Git ref (branch/tag/commit) currently checked out
   *
   * Examples: "feat-auth", "main", "v1.2.3", "a1b2c3d"
   */
  ref: string;

  // ===== File System =====

  /**
   * Absolute path to worktree directory
   *
   * Example: "/Users/max/.agor/worktrees/myapp/feat-auth"
   */
  path: string;

  // ===== Git State (Current) =====

  /**
   * Branch this worktree diverged from
   *
   * Example: "main" (if this is a feature branch)
   */
  base_ref?: string;

  /**
   * SHA at worktree creation (base commit)
   *
   * Tracks where this branch started.
   */
  base_sha?: string;

  /**
   * Latest commit SHA in this worktree
   *
   * Updated when sessions make commits.
   */
  last_commit_sha?: string;

  /**
   * Remote tracking branch (if any)
   *
   * Examples: "origin/feat-auth", "upstream/main"
   */
  tracking_branch?: string;

  /**
   * Whether this ref is a new branch created by Agor
   *
   * true:  Branch was created during worktree creation
   * false: Branch existed before (tracked from remote or local)
   */
  new_branch: boolean;

  // ===== Work Context (Persistent Across Sessions) =====

  /**
   * Associated GitHub/GitLab issue
   *
   * Links worktree to issue it addresses.
   * Worktree-level (not session) because work persists across sessions.
   *
   * Example: "https://github.com/org/repo/issues/123"
   */
  issue_url?: string;

  /**
   * Associated pull request
   *
   * Links worktree to PR containing changes.
   * Auto-populated when user creates PR.
   *
   * Example: "https://github.com/org/repo/pull/42"
   */
  pull_request_url?: string;

  /**
   * Freeform notes about this worktree
   *
   * User can document:
   * - What they're working on
   * - Blockers or issues
   * - Design decisions
   * - Next steps
   *
   * Supports markdown.
   */
  notes?: string;

  // ===== Environment =====

  /**
   * Environment instance (if repo has environment config)
   *
   * Tracks runtime state, process info, variable values.
   * Each worktree gets its own environment instance with unique ports.
   */
  environment_instance?: WorktreeEnvironmentInstance;

  // ===== Sessions =====

  /**
   * Sessions using this worktree
   *
   * Multiple sessions can work on same worktree over time.
   * Useful for:
   * - Continuing work across sessions
   * - Collaboration (multiple users working on same worktree)
   * - Fork/spawn relationships on same branch
   */
  sessions: SessionID[];

  /**
   * Last time this worktree was used
   *
   * Updated when sessions start/complete.
   */
  last_used: string;

  // ===== Custom Context =====

  /**
   * Custom context for Handlebars templates
   *
   * User-defined variables for zone triggers, reports, etc.
   */
  custom_context?: Record<string, unknown>;
}

/**
 * Worktree environment instance
 *
 * Runtime state for a worktree's environment (dev server, Docker, etc.).
 * Resolves template variables from repo-level environment config.
 */
export interface WorktreeEnvironmentInstance {
  /**
   * Instance-specific variable values
   *
   * Resolves template variables from repo config.
   * Example: { UI_PORT: 5173, DAEMON_PORT: 3030 }
   */
  variables: Record<string, string | number>;

  /**
   * Current environment status
   */
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

  /**
   * Process metadata (if managed by Agor)
   */
  process?: {
    /** Process ID */
    pid?: number;
    /** When process started */
    started_at?: string;
    /** Human-readable uptime */
    uptime?: string;
  };

  /**
   * Last health check result
   */
  last_health_check?: {
    timestamp: string;
    status: 'healthy' | 'unhealthy' | 'unknown';
    message?: string;
  };

  /**
   * Resolved access URLs (after template substitution)
   *
   * Example: [
   *   { name: "UI", url: "http://localhost:5173" },
   *   { name: "API", url: "http://localhost:3030" }
   * ]
   */
  access_urls?: Array<{
    name: string;
    url: string;
  }>;

  /**
   * Process logs (last N lines)
   *
   * Captured from stdout/stderr of environment process.
   */
  logs?: string[];
}

/**
 * Repository environment configuration template
 *
 * Defines how to run environments for all worktrees in a repo.
 * Each worktree creates an instance with specific variable values.
 */
export interface RepoEnvironmentConfig {
  /**
   * Command to start environment (templated)
   *
   * Template variables are resolved from worktree.environment_instance.variables.
   *
   * Examples:
   * - "docker compose -p {{worktree.name}} up -d"
   * - "PORT={{UI_PORT}} pnpm dev"
   */
  up_command: string;

  /**
   * Command to stop environment (templated)
   *
   * Examples:
   * - "docker compose -p {{worktree.name}} down"
   * - "pkill -f 'vite.*{{UI_PORT}}'"
   */
  down_command: string;

  /**
   * Template variables that worktrees must provide
   *
   * Example: ["UI_PORT", "DAEMON_PORT"]
   *
   * Agor can auto-assign values (e.g., find available ports).
   */
  template_vars: string[];

  /**
   * Optional health check configuration
   */
  health_check?: {
    /** Health check type */
    type: 'http' | 'tcp' | 'process';
    /** URL template for HTTP checks (e.g., "http://localhost:{{UI_PORT}}/health") */
    url_template?: string;
    /** Port variable for TCP checks (e.g., "UI_PORT") */
    port_var?: string;
  };
}
