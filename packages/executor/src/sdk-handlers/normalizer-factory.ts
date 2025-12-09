/**
 * SDK Response Normalizer Factory
 *
 * Dispatches to the appropriate normalizer based on agentic tool type.
 * This is the single entry point for normalizing raw SDK responses into
 * the standardized format used by UI and analytics.
 *
 * Usage:
 *   const normalized = await normalizeRawSdkResponse('claude-code', rawSdkResponse, context);
 */

import type { SessionID, TaskID } from '@agor/core/types';
import type { AgorClient } from '../services/feathers-client.js';
import type { NormalizedSdkData, NormalizerContext } from './base/normalizer.interface.js';
import { ClaudeCodeNormalizer } from './claude/normalizer.js';
import { CodexNormalizer } from './codex/normalizer.js';
import { GeminiNormalizer } from './gemini/normalizer.js';

// Singleton instances (normalizers are stateless, so one instance is fine)
const claudeNormalizer = new ClaudeCodeNormalizer();
const codexNormalizer = new CodexNormalizer();
const geminiNormalizer = new GeminiNormalizer();

/**
 * Normalize raw SDK response to common format
 *
 * @param agenticTool - The agentic tool type (determines which normalizer to use)
 * @param rawSdkResponse - Raw SDK response from the tool
 * @param client - Feathers client for querying previous task data
 * @param sessionId - Current session ID
 * @param taskId - Current task ID
 * @returns Normalized data with consistent structure, or undefined if normalization fails
 */
export async function normalizeRawSdkResponse(
  agenticTool: 'claude-code' | 'codex' | 'gemini' | 'opencode' | string,
  rawSdkResponse: unknown,
  client: AgorClient,
  sessionId: SessionID,
  taskId: TaskID
): Promise<NormalizedSdkData | undefined> {
  if (!rawSdkResponse) {
    return undefined;
  }

  const context: NormalizerContext = { client, sessionId, taskId };

  try {
    switch (agenticTool) {
      case 'claude-code':
        return await claudeNormalizer.normalize(
          rawSdkResponse as Parameters<typeof claudeNormalizer.normalize>[0],
          context
        );

      case 'codex':
        return await codexNormalizer.normalize(
          rawSdkResponse as Parameters<typeof codexNormalizer.normalize>[0],
          context
        );

      case 'gemini':
        return await geminiNormalizer.normalize(
          rawSdkResponse as Parameters<typeof geminiNormalizer.normalize>[0],
          context
        );

      case 'opencode':
        // OpenCode doesn't have a normalizer yet - return undefined
        console.debug('[Normalizer] OpenCode normalizer not implemented yet');
        return undefined;

      default:
        console.warn(`[Normalizer] Unknown agentic tool: ${agenticTool}`);
        return undefined;
    }
  } catch (error) {
    console.error(`[Normalizer] Failed to normalize ${agenticTool} response:`, error);
    return undefined;
  }
}
