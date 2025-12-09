/**
 * SDK Response Normalizer Interface
 *
 * Each agentic tool implements this interface to transform its raw SDK response
 * into standardized derived values for consumption by UI, analytics, and other systems.
 *
 * Normalizers receive context (client, sessionId, taskId) to enable tools like Codex
 * to fetch previous task data for delta computation. Tools that don't need this
 * context (like Claude, Gemini) can ignore these parameters.
 */

import type { SessionID, TaskID } from '@agor/core/types';
import type { AgorClient } from '../../services/feathers-client.js';

export interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface NormalizedSdkData {
  /**
   * Aggregated token usage (summed across all models if multi-model)
   */
  tokenUsage: NormalizedTokenUsage;

  /**
   * Context window limit (model's maximum capacity)
   * For multi-model: maximum limit across all models
   *
   * Note: Context window USAGE is tracked separately via Task.computed_context_window
   * which is populated by tool.computeContextWindow(). This avoids confusion between
   * per-task tokens (in tokenUsage) vs cumulative session tokens (in computed_context_window).
   */
  contextWindowLimit: number;

  /**
   * Cost in USD (if available from SDK)
   * This is the actual cost reported by the SDK, not an estimate.
   */
  costUsd?: number;

  /**
   * Primary model used (e.g., "claude-sonnet-4-5-20250929")
   */
  primaryModel?: string;

  /**
   * Execution duration in milliseconds
   */
  durationMs?: number;
}

/**
 * Context passed to normalizers for tools that need to query previous task data
 */
export interface NormalizerContext {
  client: AgorClient;
  sessionId: SessionID;
  taskId: TaskID;
}

/**
 * Normalizer interface for agentic tool SDKs
 *
 * @template TRawSdkMessage - The SDK's raw result message type
 */
export interface INormalizer<TRawSdkMessage> {
  /**
   * Normalize raw SDK response into standardized format
   *
   * @param raw - Raw SDK response message
   * @param context - Optional context with client and IDs for tools that need
   *                  to query previous task data (e.g., Codex for delta computation)
   * @returns Normalized data with computed fields
   */
  normalize(raw: TRawSdkMessage, context?: NormalizerContext): Promise<NormalizedSdkData>;
}
