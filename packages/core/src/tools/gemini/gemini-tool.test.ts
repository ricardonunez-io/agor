/**
 * GeminiTool Tests
 *
 * Tests for Gemini tool implementation including:
 * - Tool initialization
 * - Message processing flow
 * - Prompt construction
 * - Response handling
 * - Error handling
 * - Edge cases
 */

import { execSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { generateId } from '../../lib/ids';
import type { Message, SessionID, TaskID } from '../../types';
import { MessageRole } from '../../types';
import type { StreamingCallbacks } from '../base/types';
import { GeminiTool } from './gemini-tool';
import { DEFAULT_GEMINI_MODEL } from './models';
import type { GeminiPromptService, GeminiStreamEvent } from './prompt-service';

// Mock dependencies
vi.mock('node:child_process');
vi.mock('./prompt-service');

// ============================================================
// Test Helpers
// ============================================================

interface MockMessagesRepo {
  findBySessionId: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

interface MockSessionsRepo {
  findById: ReturnType<typeof vi.fn>;
}

interface MockMessagesService {
  create: ReturnType<typeof vi.fn>;
}

interface MockTasksService {
  patch: ReturnType<typeof vi.fn>;
}

function createMockMessagesRepo(): MockMessagesRepo {
  return {
    findBySessionId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((msg: Message) => Promise.resolve(msg)),
  };
}

function createMockSessionsRepo(): MockSessionsRepo {
  return {
    findById: vi.fn().mockResolvedValue({
      session_id: 'test-session' as SessionID,
      model_config: { model: DEFAULT_GEMINI_MODEL },
    }),
  };
}

function createMockMessagesService(): MockMessagesService {
  return {
    create: vi.fn().mockImplementation((msg: Message) => Promise.resolve(msg)),
  };
}

function createMockTasksService(): MockTasksService {
  return {
    patch: vi.fn().mockResolvedValue({}),
  };
}

function createMockPromptService(): Partial<GeminiPromptService> {
  return {
    promptSessionStreaming: vi.fn().mockImplementation(async function* () {
      yield {
        type: 'partial',
        textChunk: 'Hello',
        resolvedModel: DEFAULT_GEMINI_MODEL,
      } as GeminiStreamEvent;
      yield {
        type: 'partial',
        textChunk: ' world',
        resolvedModel: DEFAULT_GEMINI_MODEL,
      } as GeminiStreamEvent;
      yield {
        type: 'complete',
        content: [{ type: 'text', text: 'Hello world' }],
        resolvedModel: DEFAULT_GEMINI_MODEL,
      } as GeminiStreamEvent;
    }),
    stopTask: vi.fn().mockReturnValue({ success: true }),
  };
}

function createMockStreamingCallbacks(): StreamingCallbacks {
  return {
    onStreamStart: vi.fn(),
    onStreamChunk: vi.fn(),
    onStreamEnd: vi.fn(),
    onStreamError: vi.fn(),
  };
}

// ============================================================
// Tool Initialization
// ============================================================

describe('GeminiTool - Initialization', () => {
  it('should initialize with minimal dependencies', () => {
    const tool = new GeminiTool();
    expect(tool.toolType).toBe('gemini');
    expect(tool.name).toBe('Google Gemini');
  });

  it('should initialize with full dependencies', () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-api-key',
      messagesService as any,
      tasksService as any
    );

    expect(tool.toolType).toBe('gemini');
    expect(tool.name).toBe('Google Gemini');
  });

  it('should expose correct capabilities', () => {
    const tool = new GeminiTool();
    const capabilities = tool.getCapabilities();

    expect(capabilities).toEqual({
      supportsSessionImport: false,
      supportsSessionCreate: false,
      supportsLiveExecution: true,
      supportsSessionFork: false,
      supportsChildSpawn: false,
      supportsGitState: false,
      supportsStreaming: true,
    });
  });
});

// ============================================================
// Installation Check
// ============================================================

describe('GeminiTool - Installation Check', () => {
  it('should detect installed Gemini CLI', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/local/bin/gemini'));

    const tool = new GeminiTool();
    const isInstalled = await tool.checkInstalled();

    expect(isInstalled).toBe(true);
    expect(execSync).toHaveBeenCalledWith('which gemini', { encoding: 'utf-8' });
  });

  it('should detect missing Gemini CLI', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Command not found');
    });

    const tool = new GeminiTool();
    const isInstalled = await tool.checkInstalled();

    expect(isInstalled).toBe(false);
  });

  it('should handle execSync errors gracefully', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const tool = new GeminiTool();
    const isInstalled = await tool.checkInstalled();

    expect(isInstalled).toBe(false);
  });
});

// ============================================================
// Message Processing - Streaming
// ============================================================

describe('GeminiTool - executePromptWithStreaming', () => {
  it('should throw if not initialized with repositories', async () => {
    const tool = new GeminiTool();

    await expect(
      tool.executePromptWithStreaming('session-id' as SessionID, 'test prompt')
    ).rejects.toThrow('GeminiTool not initialized with repositories');
  });

  it('should throw if not initialized with messagesService', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();

    const tool = new GeminiTool(messagesRepo as any, sessionsRepo as any);

    await expect(
      tool.executePromptWithStreaming('session-id' as SessionID, 'test prompt')
    ).rejects.toThrow('GeminiTool not initialized with messagesService');
  });

  it('should create user message before streaming', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    // Inject mock prompt service
    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session' as SessionID;
    const prompt = 'Hello Gemini';

    await tool.executePromptWithStreaming(sessionId, prompt);

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        type: 'user',
        role: MessageRole.USER,
        content: prompt,
        content_preview: prompt,
        index: 0,
      })
    );
  });

  it('should handle streaming events correctly', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const streamingCallbacks = createMockStreamingCallbacks();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session' as SessionID;
    await tool.executePromptWithStreaming(
      sessionId,
      'test',
      undefined,
      undefined,
      streamingCallbacks
    );

    // Should start streaming
    expect(streamingCallbacks.onStreamStart).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        session_id: sessionId,
        role: MessageRole.ASSISTANT,
      })
    );

    // Should stream chunks
    expect(streamingCallbacks.onStreamChunk).toHaveBeenCalledWith(expect.any(String), 'Hello');
    expect(streamingCallbacks.onStreamChunk).toHaveBeenCalledWith(expect.any(String), ' world');

    // Should end streaming
    expect(streamingCallbacks.onStreamEnd).toHaveBeenCalledWith(expect.any(String));
  });

  it('should create assistant message after streaming', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session' as SessionID;
    await tool.executePromptWithStreaming(sessionId, 'test');

    // Should create assistant message
    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        type: 'assistant',
        role: MessageRole.ASSISTANT,
        content: [{ type: 'text', text: 'Hello world' }],
        content_preview: 'Hello world',
        index: 1,
        metadata: expect.objectContaining({
          model: DEFAULT_GEMINI_MODEL,
        }),
      })
    );
  });

  it('should return user and assistant message IDs', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const result = await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(result).toMatchObject({
      userMessageId: expect.any(String),
      assistantMessageIds: expect.arrayContaining([expect.any(String)]),
    });
    expect(result.assistantMessageIds).toHaveLength(1);
  });

  it('should handle multiple assistant messages', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'First message' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Second message' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const result = await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(result.assistantMessageIds).toHaveLength(2);
    expect(messagesService.create).toHaveBeenCalledTimes(3); // 1 user + 2 assistant
  });

  it('should link messages to task if taskId provided', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const taskId = generateId() as TaskID;
    await tool.executePromptWithStreaming('session-id' as SessionID, 'test', taskId);

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: taskId,
      })
    );
  });

  it('should pass permission mode to prompt service', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session' as SessionID;
    const prompt = 'test';
    const taskId = 'test-task' as TaskID;
    const permissionMode = 'auto';

    await tool.executePromptWithStreaming(sessionId, prompt, taskId, permissionMode);

    expect(mockPromptService.promptSessionStreaming).toHaveBeenCalledWith(
      sessionId,
      prompt,
      taskId,
      permissionMode
    );
  });

  it('should handle tool uses in messages', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [
            { type: 'text', text: 'Using tool' },
            { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/test' } },
          ],
          toolUses: [{ id: 'tool-1', name: 'read_file', input: { path: '/test' } }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_uses: [{ id: 'tool-1', name: 'read_file', input: { path: '/test' } }],
      })
    );
  });

  it('should update task with resolved model', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any,
      tasksService as any
    );

    (tool as any).promptService = mockPromptService;

    const taskId = generateId() as TaskID;
    await tool.executePromptWithStreaming('session-id' as SessionID, 'test', taskId);

    expect(tasksService.patch).toHaveBeenCalledWith(taskId, {
      model: DEFAULT_GEMINI_MODEL,
    });
  });

  it('should calculate correct message indices', async () => {
    const messagesRepo = createMockMessagesRepo();
    messagesRepo.findBySessionId.mockResolvedValue([
      { index: 0 } as Message,
      { index: 1 } as Message,
    ]);

    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    // User message should be index 2, assistant should be index 3
    expect(messagesService.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ index: 2 })
    );
    expect(messagesService.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ index: 3 })
    );
  });
});

// ============================================================
// Message Processing - Non-Streaming
// ============================================================

describe('GeminiTool - executePrompt', () => {
  it('should throw if not initialized with repositories', async () => {
    const tool = new GeminiTool();

    await expect(tool.executePrompt('session-id' as SessionID, 'test prompt')).rejects.toThrow(
      'GeminiTool not initialized with repositories'
    );
  });

  it('should skip partial events in non-streaming mode', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield { type: 'partial', textChunk: 'Ignored' } as GeminiStreamEvent;
        yield { type: 'tool_start', toolName: 'test' } as GeminiStreamEvent;
        yield { type: 'tool_complete', toolName: 'test', result: {} } as GeminiStreamEvent;
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Final result' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    // Should only create user + complete assistant message (no partials)
    expect(messagesService.create).toHaveBeenCalledTimes(2);
    expect(messagesService.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: 'Final result' }],
      })
    );
  });

  it('should create new message ID for each complete event', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'First' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Second' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const result = await tool.executePrompt('session-id' as SessionID, 'test');

    expect(result.assistantMessageIds).toHaveLength(2);
    expect(result.assistantMessageIds[0]).not.toBe(result.assistantMessageIds[1]);
  });

  it('should handle content preview generation', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const longText = 'a'.repeat(300);
    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: longText }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content_preview: longText.substring(0, 200),
      })
    );
  });

  it('should handle mixed content blocks correctly', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [
            { type: 'text', text: 'First text' },
            { type: 'tool_use', id: 'tool-1', name: 'test' },
            { type: 'text', text: 'Second text' },
          ],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content_preview: 'First textSecond text',
      })
    );
  });
});

// ============================================================
// Task Control
// ============================================================

describe('GeminiTool - stopTask', () => {
  it('should return error if not initialized with prompt service', async () => {
    const tool = new GeminiTool();

    const result = await tool.stopTask('session-id');

    expect(result).toEqual({
      success: false,
      reason: 'GeminiTool not initialized with prompt service',
    });
  });

  it('should delegate to prompt service', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(messagesRepo as any, sessionsRepo as any, 'test-key');

    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session';
    const result = await tool.stopTask(sessionId);

    expect(mockPromptService.stopTask).toHaveBeenCalledWith(sessionId);
    expect(result.success).toBe(true);
  });

  it('should include partial result on success', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(messagesRepo as any, sessionsRepo as any, 'test-key');

    (tool as any).promptService = mockPromptService;

    const taskId = 'test-task';
    const result = await tool.stopTask('session-id', taskId);

    expect(result).toEqual({
      success: true,
      partialResult: {
        taskId,
        status: 'cancelled',
      },
    });
  });

  it('should handle prompt service failure', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();

    const mockPromptService = {
      promptSessionStreaming: vi.fn(),
      stopTask: vi.fn().mockReturnValue({
        success: false,
        reason: 'No active task',
      }),
    };

    const tool = new GeminiTool(messagesRepo as any, sessionsRepo as any, 'test-key');

    (tool as any).promptService = mockPromptService;

    const result = await tool.stopTask('session-id');

    expect(result).toEqual({
      success: false,
      reason: 'No active task',
    });
  });

  it('should use "unknown" taskId if not provided', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(messagesRepo as any, sessionsRepo as any, 'test-key');

    (tool as any).promptService = mockPromptService;

    const result = await tool.stopTask('session-id');

    expect(result.partialResult?.taskId).toBe('unknown');
  });
});

// ============================================================
// Edge Cases & Error Handling
// ============================================================

describe('GeminiTool - Edge Cases', () => {
  it('should handle empty prompt', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, '');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '',
        content_preview: '',
      })
    );
  });

  it('should handle streaming without callbacks', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const result = await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(result.assistantMessageIds).toHaveLength(1);
  });

  it('should handle complete event without content', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const result = await tool.executePrompt('session-id' as SessionID, 'test');

    // Should still return result but with empty assistant messages
    expect(result.userMessageId).toBeDefined();
    expect(result.assistantMessageIds).toHaveLength(0);
  });

  it('should handle content with only tool uses', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
          toolUses: [{ id: 'tool-1', name: 'test', input: {} }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content_preview: '', // No text blocks
        tool_uses: [{ id: 'tool-1', name: 'test', input: {} }],
      })
    );
  });

  it('should reuse message ID when streaming starts before complete', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const streamingCallbacks = createMockStreamingCallbacks();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield { type: 'partial', textChunk: 'Hello' } as GeminiStreamEvent;
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Hello world' }],
          resolvedModel: DEFAULT_GEMINI_MODEL,
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming(
      'session-id' as SessionID,
      'test',
      undefined,
      undefined,
      streamingCallbacks
    );

    // Get the message ID used in streaming
    const streamedMessageId = vi.mocked(streamingCallbacks.onStreamStart).mock.calls[0][0];

    // Should reuse the same ID for the complete message
    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: streamedMessageId,
      })
    );
  });

  it('should handle metadata with zero tokens', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          model: DEFAULT_GEMINI_MODEL,
          tokens: { input: 0, output: 0 },
        },
      })
    );
  });

  it('should not update task if no taskId provided', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any,
      tasksService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(tasksService.patch).not.toHaveBeenCalled();
  });

  it('should handle model resolution from partial events', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const customModel = 'gemini-2.0-flash-exp';
    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'partial',
          textChunk: 'test',
          resolvedModel: customModel,
        } as GeminiStreamEvent;
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'test' }],
          // No resolvedModel in complete - should use from partial
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          model: customModel,
        }),
      })
    );
  });

  it('should fall back to DEFAULT_GEMINI_MODEL if no model resolved', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();

    const mockPromptService = {
      promptSessionStreaming: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'test' }],
          // No resolvedModel
        } as GeminiStreamEvent;
      }),
      stopTask: vi.fn().mockReturnValue({ success: true }),
    };

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePrompt('session-id' as SessionID, 'test');

    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          model: DEFAULT_GEMINI_MODEL,
        }),
      })
    );
  });
});

// ============================================================
// Type Safety & Validation
// ============================================================

describe('GeminiTool - Type Safety', () => {
  it('should create messages with proper typed IDs', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const sessionId = 'test-session' as SessionID;
    const taskId = 'test-task' as TaskID;

    await tool.executePromptWithStreaming(sessionId, 'test', taskId);

    const userMessageCall = vi.mocked(messagesService.create).mock.calls[0][0];
    expect(userMessageCall.session_id).toBe(sessionId);
    expect(userMessageCall.task_id).toBe(taskId);
    expect(userMessageCall.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('should properly type message content as ContentBlock array', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    await tool.executePromptWithStreaming('session-id' as SessionID, 'test');

    const assistantMessageCall = vi.mocked(messagesService.create).mock.calls[1][0];
    expect(Array.isArray(assistantMessageCall.content)).toBe(true);
    expect(assistantMessageCall.content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('should properly type user message content as string', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const mockPromptService = createMockPromptService();

    const tool = new GeminiTool(
      messagesRepo as any,
      sessionsRepo as any,
      'test-key',
      messagesService as any
    );

    (tool as any).promptService = mockPromptService;

    const prompt = 'Hello Gemini';
    await tool.executePromptWithStreaming('session-id' as SessionID, prompt);

    const userMessageCall = vi.mocked(messagesService.create).mock.calls[0][0];
    expect(typeof userMessageCall.content).toBe('string');
    expect(userMessageCall.content).toBe(prompt);
  });
});
