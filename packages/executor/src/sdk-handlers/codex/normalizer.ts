/**
 * Codex SDK Response Normalizer
 *
 * Transforms Codex SDK's raw turn.completed event into standardized format.
 *
 * The raw event structure from Codex SDK:
 * {
 *   type: 'turn.completed',
 *   usage: { input_tokens, output_tokens, cached_input_tokens },
 *   model: string (optional)
 * }
 *
 * IMPORTANT: Codex reports CUMULATIVE token counts across the entire Codex CLI session,
 * not per-task deltas. To get per-task usage (aligned with Claude/Gemini behavior),
 * we must compute the delta by subtracting the previous task's cumulative tokens.
 *
 * Key responsibilities:
 * - Fetch previous task's raw_sdk_response to compute delta
 * - Extract token usage delta from raw SDK event
 * - Map cached_input_tokens to cacheReadTokens for consistency
 * - Determine context window limit based on model
 */

import type { CodexSdkResponse } from '../../types/sdk-response.js';
import type {
  INormalizer,
  NormalizedSdkData,
  NormalizerContext,
} from '../base/normalizer.interface.js';
import { DEFAULT_CODEX_MODEL, getCodexContextWindowLimit } from './models.js';

export class CodexNormalizer implements INormalizer<CodexSdkResponse> {
  async normalize(
    event: CodexSdkResponse,
    context?: NormalizerContext
  ): Promise<NormalizedSdkData> {
    // Extract usage from TurnCompletedEvent
    const usage = event.usage;

    // Handle missing usage gracefully (legacy tasks or malformed responses)
    if (!usage) {
      return {
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        contextWindowLimit: getCodexContextWindowLimit(DEFAULT_CODEX_MODEL),
        primaryModel: DEFAULT_CODEX_MODEL,
        durationMs: undefined,
      };
    }

    // Current task's cumulative tokens from Codex SDK
    const currentInputTokens = usage.input_tokens || 0;
    const currentOutputTokens = usage.output_tokens || 0;
    const currentCacheReadTokens = usage.cached_input_tokens || 0;
    const currentTotalTokens = currentInputTokens + currentOutputTokens;

    // Try to compute delta by fetching previous task's cumulative tokens
    let deltaInputTokens = currentInputTokens;
    let deltaOutputTokens = currentOutputTokens;
    let deltaCacheReadTokens = currentCacheReadTokens;

    if (context) {
      try {
        const previousTokens = await this.getPreviousTaskTokens(context);
        if (previousTokens && currentTotalTokens >= previousTokens.totalTokens) {
          // Current is greater than previous - compute delta
          // Delta = current cumulative - previous cumulative
          deltaInputTokens = currentInputTokens - previousTokens.inputTokens;
          deltaOutputTokens = currentOutputTokens - previousTokens.outputTokens;
          deltaCacheReadTokens = Math.max(
            0,
            currentCacheReadTokens - previousTokens.cacheReadTokens
          );

          console.log(
            `[Codex Normalizer] Computed delta: input=${deltaInputTokens} (${currentInputTokens}-${previousTokens.inputTokens}), ` +
              `output=${deltaOutputTokens} (${currentOutputTokens}-${previousTokens.outputTokens})`
          );
        } else if (previousTokens && currentTotalTokens < previousTokens.totalTokens) {
          // Current is less than previous - new Codex CLI session started
          // Use current values as-is (they represent the first task's tokens in new session)
          console.log(
            `[Codex Normalizer] New Codex CLI session detected (current ${currentTotalTokens} < previous ${previousTokens.totalTokens}). Using current tokens as delta.`
          );
        }
        // If no previous task, use current values as-is (first task in session)
      } catch (error) {
        console.warn(
          '[Codex Normalizer] Failed to fetch previous task tokens, using current values:',
          error
        );
        // Fall back to current values
      }
    }

    // Get context window limit based on model
    const contextWindowLimit = getCodexContextWindowLimit(DEFAULT_CODEX_MODEL);

    return {
      tokenUsage: {
        inputTokens: deltaInputTokens,
        outputTokens: deltaOutputTokens,
        totalTokens: deltaInputTokens + deltaOutputTokens,
        cacheReadTokens: deltaCacheReadTokens,
        cacheCreationTokens: 0, // Codex doesn't provide this
      },
      contextWindowLimit,
      primaryModel: DEFAULT_CODEX_MODEL,
      durationMs: undefined, // Not available in raw SDK event
    };
  }

  /**
   * Fetch the previous task's cumulative token counts from the same session
   */
  private async getPreviousTaskTokens(context: NormalizerContext): Promise<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
  } | null> {
    const { client, sessionId, taskId } = context;

    try {
      // Query tasks for this session, ordered by created_at descending
      // We want the task immediately before the current one
      const result = await client.service('tasks').find({
        query: {
          session_id: sessionId,
          status: 'completed',
          $sort: { created_at: -1 }, // Most recent first
          $limit: 10, // Get a few recent tasks to find the previous one
        },
      });

      const tasks = Array.isArray(result) ? result : result.data || [];

      // Find the current task's position and get the one before it
      let foundCurrent = false;
      for (const task of tasks) {
        if (foundCurrent) {
          // This is the previous task
          const rawSdkResponse = task.raw_sdk_response as CodexSdkResponse | undefined;
          if (rawSdkResponse?.usage) {
            const inputTokens = rawSdkResponse.usage.input_tokens || 0;
            const outputTokens = rawSdkResponse.usage.output_tokens || 0;
            const cacheReadTokens = rawSdkResponse.usage.cached_input_tokens || 0;
            return {
              inputTokens,
              outputTokens,
              cacheReadTokens,
              totalTokens: inputTokens + outputTokens,
            };
          }
          return null;
        }
        if (task.task_id === taskId) {
          foundCurrent = true;
        }
      }

      // No previous task found (this is the first task)
      return null;
    } catch (error) {
      console.error('[Codex Normalizer] Error fetching previous task:', error);
      return null;
    }
  }
}
