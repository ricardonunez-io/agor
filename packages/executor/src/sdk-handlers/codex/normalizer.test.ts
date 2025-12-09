import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexSdkResponse } from '../../types/sdk-response.js';
import type { NormalizerContext } from '../base/normalizer.interface.js';
import * as models from './models.js';
import { CodexNormalizer } from './normalizer.js';

function buildTurnCompletedEvent(overrides: Partial<CodexSdkResponse> = {}): CodexSdkResponse {
  return {
    type: 'turn.completed',
    ...overrides,
  } as CodexSdkResponse;
}

function buildUsage(overrides: Record<string, number | undefined> = {}): CodexSdkResponse['usage'] {
  return {
    input_tokens: overrides.input_tokens,
    output_tokens: overrides.output_tokens,
    cached_input_tokens: overrides.cached_input_tokens,
    total_tokens: overrides.total_tokens,
  } as CodexSdkResponse['usage'];
}

/**
 * Create a mock context with a tasks service that returns specified previous tasks
 */
function createMockContext(
  previousTasks: Array<{ task_id: string; raw_sdk_response?: CodexSdkResponse }> = [],
  currentTaskId = 'current-task-id'
): NormalizerContext {
  const mockClient = {
    service: vi.fn().mockReturnValue({
      find: vi.fn().mockResolvedValue({
        data: [{ task_id: currentTaskId }, ...previousTasks],
      }),
    }),
  };
  return {
    client: mockClient as unknown as NormalizerContext['client'],
    sessionId: 'test-session-id' as NormalizerContext['sessionId'],
    taskId: currentTaskId as NormalizerContext['taskId'],
  };
}

describe('CodexNormalizer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gracefully handles events without usage data', async () => {
    const normalizer = new CodexNormalizer();
    const event = buildTurnCompletedEvent({ usage: undefined });

    const result = await normalizer.normalize(event);

    expect(result.tokenUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(result.contextWindowLimit).toBe(
      models.getCodexContextWindowLimit(models.DEFAULT_CODEX_MODEL)
    );
    expect(result.primaryModel).toBe(models.DEFAULT_CODEX_MODEL);
    expect(result.durationMs).toBeUndefined();
  });

  it('uses current tokens as-is when no context provided (first task)', async () => {
    const normalizer = new CodexNormalizer();
    const event = buildTurnCompletedEvent({
      usage: buildUsage({
        input_tokens: 1_200,
        output_tokens: 800,
        cached_input_tokens: 300,
      }),
    });

    // No context provided - should use current values directly
    const result = await normalizer.normalize(event);

    expect(result.tokenUsage).toEqual({
      inputTokens: 1_200,
      outputTokens: 800,
      totalTokens: 2_000,
      cacheReadTokens: 300,
      cacheCreationTokens: 0,
    });
    expect(result.primaryModel).toBe(models.DEFAULT_CODEX_MODEL);
  });

  it('computes delta when previous task exists', async () => {
    const normalizer = new CodexNormalizer();

    // Current task: cumulative 2000 input, 1000 output
    const event = buildTurnCompletedEvent({
      usage: buildUsage({
        input_tokens: 2_000,
        output_tokens: 1_000,
        cached_input_tokens: 500,
      }),
    });

    // Previous task: cumulative 1500 input, 800 output
    const context = createMockContext([
      {
        task_id: 'previous-task-id',
        raw_sdk_response: buildTurnCompletedEvent({
          usage: buildUsage({
            input_tokens: 1_500,
            output_tokens: 800,
            cached_input_tokens: 400,
          }),
        }),
      },
    ]);

    const result = await normalizer.normalize(event, context);

    // Delta: 2000-1500=500 input, 1000-800=200 output
    expect(result.tokenUsage).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      cacheReadTokens: 100, // 500-400
      cacheCreationTokens: 0,
    });
  });

  it('uses current tokens when new Codex CLI session detected (current < previous)', async () => {
    const normalizer = new CodexNormalizer();

    // Current task: new session with 500 input, 200 output (lower than previous)
    const event = buildTurnCompletedEvent({
      usage: buildUsage({
        input_tokens: 500,
        output_tokens: 200,
        cached_input_tokens: 0,
      }),
    });

    // Previous task: old session with 5000 input, 2000 output
    const context = createMockContext([
      {
        task_id: 'previous-task-id',
        raw_sdk_response: buildTurnCompletedEvent({
          usage: buildUsage({
            input_tokens: 5_000,
            output_tokens: 2_000,
            cached_input_tokens: 1_000,
          }),
        }),
      },
    ]);

    const result = await normalizer.normalize(event, context);

    // Current < previous means new Codex CLI session, use current as-is
    expect(result.tokenUsage).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it('defaults missing usage fields to zero', async () => {
    const normalizer = new CodexNormalizer();
    const event = buildTurnCompletedEvent({
      usage: buildUsage({}),
    });

    const result = await normalizer.normalize(event);

    expect(result.tokenUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it('uses context window limit lookup for the default model', async () => {
    const contextWindowLimit = 123_456;
    const lookupSpy = vi
      .spyOn(models, 'getCodexContextWindowLimit')
      .mockReturnValue(contextWindowLimit);

    const normalizer = new CodexNormalizer();
    const event = buildTurnCompletedEvent({
      usage: buildUsage({
        input_tokens: 10,
        output_tokens: 20,
        cached_input_tokens: 5,
      }),
    });

    const result = await normalizer.normalize(event);

    expect(lookupSpy).toHaveBeenCalledWith(models.DEFAULT_CODEX_MODEL);
    expect(result.contextWindowLimit).toBe(contextWindowLimit);
    expect(result.tokenUsage.totalTokens).toBe(30);
  });
});
