/**
 * Session Defaults Utility
 *
 * Provides reusable logic for applying user default_agentic_config to session creation.
 * Used across MCP sessions.create, sessions.spawn, and other session creation flows.
 */

import type {
  AgenticToolName,
  CodexApprovalPolicy,
  CodexSandboxMode,
  DefaultAgenticToolConfig,
  PermissionMode,
  Session,
  User,
} from '../types';
import { getDefaultPermissionMode } from '../types';

/**
 * Resolved session configuration from user defaults
 */
export interface ResolvedSessionConfig {
  permissionConfig: {
    mode?: PermissionMode;
    allowedTools?: string[];
    codex?: {
      sandboxMode: CodexSandboxMode;
      approvalPolicy: CodexApprovalPolicy;
      networkAccess?: boolean;
    };
  };
  modelConfig?: {
    mode: 'alias' | 'exact';
    model: string;
    updated_at: string;
    thinkingMode?: 'auto' | 'manual' | 'off';
    manualThinkingTokens?: number;
  };
  mcpServerIds: string[];
}

/**
 * Options for applying user defaults
 */
export interface ApplyUserDefaultsOptions {
  /** The agentic tool to get defaults for */
  agenticTool: AgenticToolName;

  /** User object containing default_agentic_config */
  user?: Pick<User, 'default_agentic_config'> | null;

  /** Explicit permission mode override (highest priority) */
  explicitPermissionMode?: PermissionMode;

  /** Explicit model config override (highest priority) */
  explicitModelConfig?: {
    mode?: 'alias' | 'exact';
    model?: string;
    thinkingMode?: 'auto' | 'manual' | 'off';
    manualThinkingTokens?: number;
  };

  /** Explicit MCP server IDs override (highest priority) */
  explicitMcpServerIds?: string[];

  /** Explicit Codex sandbox mode override */
  explicitCodexSandboxMode?: CodexSandboxMode;

  /** Explicit Codex approval policy override */
  explicitCodexApprovalPolicy?: CodexApprovalPolicy;

  /** Explicit Codex network access override */
  explicitCodexNetworkAccess?: boolean;

  /** Parent session to inherit from (fallback priority) */
  parentSession?: Pick<Session, 'permission_config' | 'model_config'>;
}

/**
 * Apply user defaults to session configuration
 *
 * Priority order:
 * 1. Explicit overrides (explicitPermissionMode, explicitModelConfig, etc.)
 * 2. User's default_agentic_config for the tool
 * 3. Parent session config (if provided)
 * 4. System defaults (getDefaultPermissionMode)
 *
 * @example
 * ```ts
 * const config = applyUserDefaultsToSessionConfig({
 *   agenticTool: 'claude-code',
 *   user: await app.service('users').get(userId),
 *   explicitPermissionMode: args.permissionMode,
 * });
 *
 * const session = await app.service('sessions').create({
 *   ...sessionData,
 *   permission_config: config.permissionConfig,
 *   model_config: config.modelConfig,
 * });
 * ```
 */
export function applyUserDefaultsToSessionConfig(
  options: ApplyUserDefaultsOptions
): ResolvedSessionConfig {
  const {
    agenticTool,
    user,
    explicitPermissionMode,
    explicitModelConfig,
    explicitMcpServerIds,
    explicitCodexSandboxMode,
    explicitCodexApprovalPolicy,
    explicitCodexNetworkAccess,
    parentSession,
  } = options;

  // Get user's defaults for this tool
  const userToolDefaults: DefaultAgenticToolConfig | undefined =
    user?.default_agentic_config?.[agenticTool];

  // ===== Permission Mode =====
  // Priority: explicit > user defaults > parent > system defaults
  const resolvedPermissionMode =
    explicitPermissionMode ||
    userToolDefaults?.permissionMode ||
    parentSession?.permission_config?.mode ||
    getDefaultPermissionMode(agenticTool);

  // ===== Permission Config =====
  const permissionConfig: ResolvedSessionConfig['permissionConfig'] = {
    mode: resolvedPermissionMode,
    allowedTools: [],
  };

  // Apply Codex-specific settings if creating a Codex session
  // Priority: explicit > user defaults > parent
  if (agenticTool === 'codex') {
    const sandboxMode =
      explicitCodexSandboxMode ||
      userToolDefaults?.codexSandboxMode ||
      parentSession?.permission_config?.codex?.sandboxMode;

    const approvalPolicy =
      explicitCodexApprovalPolicy ||
      userToolDefaults?.codexApprovalPolicy ||
      parentSession?.permission_config?.codex?.approvalPolicy;

    const networkAccess =
      explicitCodexNetworkAccess ??
      userToolDefaults?.codexNetworkAccess ??
      parentSession?.permission_config?.codex?.networkAccess;

    if (sandboxMode && approvalPolicy) {
      permissionConfig.codex = {
        sandboxMode,
        approvalPolicy,
        networkAccess,
      };
    }
  }

  // ===== Model Config =====
  // Priority: explicit > user defaults > parent
  let modelConfig: ResolvedSessionConfig['modelConfig'] = undefined;

  const sourceModelConfig =
    explicitModelConfig || userToolDefaults?.modelConfig || parentSession?.model_config;

  if (sourceModelConfig) {
    modelConfig = {
      mode: sourceModelConfig.mode || 'alias',
      model: sourceModelConfig.model || '',
      updated_at: new Date().toISOString(),
      thinkingMode: sourceModelConfig.thinkingMode,
      manualThinkingTokens: sourceModelConfig.manualThinkingTokens,
    };
  }

  // ===== MCP Server IDs =====
  // Priority: explicit > user defaults > empty array
  const mcpServerIds = explicitMcpServerIds || userToolDefaults?.mcpServerIds || [];

  return {
    permissionConfig,
    modelConfig,
    mcpServerIds,
  };
}
