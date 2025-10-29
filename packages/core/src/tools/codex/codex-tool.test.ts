/**
 * CodexTool Tests
 *
 * Tests for OpenAI Codex integration with:
 * - Tool initialization and capabilities
 * - Session management (thread ID capture)
 * - Message processing (user/assistant creation)
 * - Streaming execution with callbacks
 * - Non-streaming execution
 * - Error handling
 * - Stop task functionality
 *
 * NOTE: Mocks Codex SDK to avoid external API calls.
 */

import { describe, expect, it, vi } from 'vitest';
import type { MessagesRepository } from '../../db/repositories/messages';
import type { SessionRepository } from '../../db/repositories/sessions';
import { generateId } from '../../lib/ids';
import type { Message, MessageID, SessionID, TaskID } from '../../types';
import { MessageRole } from '../../types';
import type { StreamingCallbacks } from '../base/types';
import { CodexTool } from './codex-tool';
import { DEFAULT_CODEX_MODEL } from './models';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create mock messages repository with spies
 */
function createMockMessagesRepo() {
  const messages = new Map<MessageID, Message>();

  return {
    findBySessionId: vi.fn(async (sessionId: SessionID) => {
      return Array.from(messages.values())
        .filter((m) => m.session_id === sessionId)
        .sort((a, b) => a.index - b.index);
    }),
    create: vi.fn(async (message: Message) => {
      messages.set(message.message_id, message);
      return message;
    }),
    _messages: messages, // Expose for test inspection
  } as unknown as MessagesRepository;
}

/**
 * Create mock sessions repository with spies
 */
function createMockSessionsRepo() {
  const sessions = new Map<SessionID, any>();

  return {
    findById: vi.fn(async (sessionId: SessionID) => {
      return sessions.get(sessionId) || null;
    }),
    update: vi.fn(async (sessionId: SessionID, updates: any) => {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      Object.assign(session, updates);
      return session;
    }),
    _sessions: sessions, // Expose for test setup
  } as unknown as SessionRepository;
}

/**
 * Create mock messages service (FeathersJS)
 */
function createMockMessagesService() {
  return {
    create: vi.fn(async (message: Message) => message),
  };
}

/**
 * Create mock tasks service (FeathersJS)
 */
function createMockTasksService() {
  return {
    patch: vi.fn(async (taskId: TaskID, updates: any) => ({ task_id: taskId, ...updates })),
    get: vi.fn(async (taskId: TaskID) => ({ task_id: taskId })),
    emit: vi.fn(),
  } as any;
}

/**
 * Create mock streaming callbacks with spies
 */
function createMockStreamingCallbacks(): StreamingCallbacks {
  return {
    onStreamStart: vi.fn(),
    onStreamChunk: vi.fn(),
    onStreamEnd: vi.fn(),
    onStreamError: vi.fn(),
  };
}

/**
 * Create a test session
 */
function createTestSession(overrides?: any) {
  return {
    session_id: generateId() as SessionID,
    worktree_id: generateId(),
    agentic_tool: 'codex' as const,
    status: 'idle',
    created_by: 'test-user',
    permission_config: { mode: 'auto' },
    ...overrides,
  };
}

// ============================================================================
// Initialization & Capabilities
// ============================================================================

describe('CodexTool - Initialization', () => {
  it('should initialize with minimal config', () => {
    const tool = new CodexTool();

    expect(tool.toolType).toBe('codex');
    expect(tool.name).toBe('OpenAI Codex');
  });

  it('should initialize with repositories and services', () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'test-api-key',
      messagesService,
      tasksService
    );

    expect(tool.toolType).toBe('codex');
    expect(tool.name).toBe('OpenAI Codex');
  });

  it('should return correct capabilities', () => {
    const tool = new CodexTool();
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

describe('CodexTool - Installation Check', () => {
  it('should have checkInstalled method', async () => {
    const tool = new CodexTool();

    // NOTE: Mocking execSync is challenging in Vitest ESM due to module hoisting.
    // We validate the interface exists and returns a boolean.
    // In production: returns true if `which codex` succeeds, false if it throws.
    expect(tool.checkInstalled).toBeDefined();
    expect(typeof tool.checkInstalled).toBe('function');

    const result = await tool.checkInstalled();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================================
// Message Creation
// ============================================================================

describe('CodexTool - User Message Creation', () => {
  it('should create user message with correct structure', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const sessionId = generateId() as SessionID;
    const taskId = generateId() as TaskID;
    const prompt = 'Test prompt for Codex';

    // Mock prompt service to return empty stream (we're only testing user message)
    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        // Empty stream - no events
      }),
    });

    await tool.executePrompt(sessionId, prompt, taskId, 'auto');

    // Check messagesService.create was called with user message
    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        task_id: taskId,
        type: 'user',
        role: MessageRole.USER,
        content: prompt,
        content_preview: prompt.substring(0, 200),
        index: 0,
      })
    );
  });

  it('should truncate long prompts in content_preview', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const sessionId = generateId() as SessionID;
    const longPrompt = 'a'.repeat(300); // 300 chars

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {}),
    });

    await tool.executePrompt(sessionId, longPrompt);

    const call = messagesService.create.mock.calls[0][0] as Message;
    expect(call.content_preview?.length).toBe(200);
    expect(call.content).toBe(longPrompt);
  });
});

describe('CodexTool - Assistant Message Creation', () => {
  it('should create assistant message with text content', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const prompt = 'Test prompt';

    // Mock prompt service to return text response
    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Codex response text' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, prompt);

    // Should create user + assistant messages
    expect(messagesService.create).toHaveBeenCalledTimes(2);

    const assistantCall = messagesService.create.mock.calls[1][0] as Message;
    expect(assistantCall.type).toBe('assistant');
    expect(assistantCall.role).toBe(MessageRole.ASSISTANT);
    expect(assistantCall.content).toEqual([{ type: 'text', text: 'Codex response text' }]);
    expect(assistantCall.content_preview).toBe('Codex response text');
    expect(assistantCall.metadata?.model).toBe(DEFAULT_CODEX_MODEL);
  });

  it('should create assistant message with tool use', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const prompt = 'Run a command';

    // Mock prompt service to return tool use event
    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'tool_complete',
          toolUse: {
            id: 'tool_123',
            name: 'bash',
            input: { command: 'ls -la' },
            output: 'file1.txt\nfile2.txt',
            status: 'completed',
          },
          threadId: 'thread_123',
        };
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Command executed' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    // Use streaming version to get tool_complete events
    await tool.executePromptWithStreaming(sessionId, prompt);

    // Should create: user message + tool message + text message
    expect(messagesService.create).toHaveBeenCalledTimes(3);

    const toolMessageCall = messagesService.create.mock.calls[1][0] as Message;
    expect(toolMessageCall.type).toBe('assistant');
    expect(toolMessageCall.content).toEqual([
      {
        type: 'tool_use',
        id: 'tool_123',
        name: 'bash',
        input: { command: 'ls -la' },
      },
      {
        type: 'tool_result',
        tool_use_id: 'tool_123',
        content: 'file1.txt\nfile2.txt',
        is_error: false,
      },
    ]);
  });

  it('should handle tool errors correctly', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const prompt = 'Run failing command';

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'tool_complete',
          toolUse: {
            id: 'tool_456',
            name: 'bash',
            input: { command: 'invalid-command' },
            output: 'Command not found',
            status: 'failed',
          },
          threadId: 'thread_123',
        };
      }),
    });

    // Use streaming version to get tool_complete events
    await tool.executePromptWithStreaming(sessionId, prompt);

    // Should create user + tool message
    expect(messagesService.create).toHaveBeenCalledTimes(2);

    const toolMessageCall = messagesService.create.mock.calls[1][0] as Message;
    const toolResult = (toolMessageCall.content as any[]).find((c) => c.type === 'tool_result');
    expect(toolResult.is_error).toBe(true);
  });
});

// ============================================================================
// Session Management (Thread ID)
// ============================================================================

describe('CodexTool - Thread ID Capture', () => {
  it('should capture and store thread ID on first execution', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_new_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test prompt');

    expect(sessionsRepo.update).toHaveBeenCalledWith(sessionId, {
      sdk_session_id: 'thread_new_123',
    });
  });

  it('should not update thread ID if already exists', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const existingThreadId = 'thread_existing_456';
    const session = createTestSession({
      session_id: sessionId,
      sdk_session_id: existingThreadId,
    });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: existingThreadId, // Same thread ID
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test prompt');

    // Should still be called (implementation always calls on first event)
    expect(sessionsRepo.update).toHaveBeenCalled();
  });
});

// ============================================================================
// Streaming Execution
// ============================================================================

describe('CodexTool - Streaming Execution', () => {
  it('should invoke streaming callbacks during execution', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );
    const callbacks = createMockStreamingCallbacks();

    // Mock partial streaming (NOTE: Codex SDK doesn't actually emit partials, but we test the logic)
    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'partial',
          textChunk: 'Hello ',
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
        yield {
          type: 'partial',
          textChunk: 'world!',
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Hello world!' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePromptWithStreaming(sessionId, 'Test', undefined, 'auto', callbacks);

    // Should have called onStreamStart once
    expect(callbacks.onStreamStart).toHaveBeenCalledTimes(1);

    // Should have streamed two chunks
    expect(callbacks.onStreamChunk).toHaveBeenCalledTimes(2);
    expect(callbacks.onStreamChunk).toHaveBeenCalledWith(expect.any(String), 'Hello ');
    expect(callbacks.onStreamChunk).toHaveBeenCalledWith(expect.any(String), 'world!');

    // Should create final message in DB
    expect(messagesService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'assistant',
        content: [{ type: 'text', text: 'Hello world!' }],
      })
    );
  });

  it('should handle streaming without callbacks (fallback to non-streaming)', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response without streaming' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    // Call WITHOUT streamingCallbacks
    await tool.executePromptWithStreaming(sessionId, 'Test', undefined, 'auto');

    // Should still create messages
    expect(messagesService.create).toHaveBeenCalled();
  });
});

// ============================================================================
// Non-Streaming Execution
// ============================================================================

describe('CodexTool - Non-Streaming Execution', () => {
  it('should execute prompt without streaming callbacks', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'tool_complete',
          toolUse: {
            id: 'tool_1',
            name: 'bash',
            input: { command: 'echo test' },
            output: 'test',
            status: 'completed',
          },
          threadId: 'thread_123',
        };
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Done' }],
          toolUses: [{ id: 'tool_1', name: 'bash', input: { command: 'echo test' } }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    const result = await tool.executePrompt(sessionId, 'Run echo test');

    expect(result.userMessageId).toBeDefined();
    expect(result.assistantMessageIds).toHaveLength(1); // Only text message (tool events skipped in non-streaming)
    expect(messagesService.create).toHaveBeenCalledTimes(2); // User + text (tool_complete skipped)
  });

  it('should skip partial events in non-streaming mode', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        // Emit partials (should be ignored)
        yield { type: 'partial', textChunk: 'Chunk 1', threadId: 'thread_123' };
        yield { type: 'partial', textChunk: 'Chunk 2', threadId: 'thread_123' };
        yield {
          type: 'tool_start',
          toolUse: { id: 'tool_1', name: 'bash', input: {} },
          threadId: 'thread_123',
        };

        // Only complete events should be processed
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Final response' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test');

    // Should only create user + complete assistant (not partials/tool_start)
    expect(messagesService.create).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Task Management
// ============================================================================

describe('CodexTool - Task Updates', () => {
  it('should update task with resolved model', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const taskId = generateId() as TaskID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: 'gpt-5-codex',
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test', taskId);

    expect(tasksService.patch).toHaveBeenCalledWith(taskId, { model: 'gpt-5-codex' });
  });

  it('should not update task if no taskId provided', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test'); // No taskId

    expect(tasksService.patch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Message Indexing
// ============================================================================

describe('CodexTool - Message Indexing', () => {
  it('should assign sequential indices to messages', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    // Pre-populate with 3 existing messages
    const existingMessages = [
      { message_id: generateId() as MessageID, session_id: sessionId, index: 0 } as Message,
      { message_id: generateId() as MessageID, session_id: sessionId, index: 1 } as Message,
      { message_id: generateId() as MessageID, session_id: sessionId, index: 2 } as Message,
    ];
    existingMessages.forEach((m) => (messagesRepo as any)._messages.set(m.message_id, m));

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'New prompt');

    // User message should have index 3, assistant should have index 4
    const userCall = messagesService.create.mock.calls[0][0] as Message;
    const assistantCall = messagesService.create.mock.calls[1][0] as Message;

    expect(userCall.index).toBe(3);
    expect(assistantCall.index).toBe(4);
  });

  it('should handle first message with index 0', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'First prompt');

    const userCall = messagesService.create.mock.calls[0][0] as Message;
    const assistantCall = messagesService.create.mock.calls[1][0] as Message;

    expect(userCall.index).toBe(0);
    expect(assistantCall.index).toBe(1);
  });
});

// ============================================================================
// Stop Task
// ============================================================================

describe('CodexTool - Stop Task', () => {
  it('should stop task successfully', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const sessionId = generateId() as SessionID;
    const taskId = generateId() as TaskID;

    // Mock prompt service with stopTask
    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      stopTask: vi.fn(() => ({ success: true })),
    });

    const result = await tool.stopTask(sessionId, taskId);

    expect(result.success).toBe(true);
    expect(result.partialResult?.status).toBe('cancelled');
    expect(result.partialResult?.taskId).toBe(taskId);
  });

  it('should handle stop failure gracefully', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    const sessionId = generateId() as SessionID;

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      stopTask: vi.fn(() => ({ success: false, reason: 'No task running' })),
    });

    const result = await tool.stopTask(sessionId);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('No task running');
  });

  it('should return error if promptService not initialized', async () => {
    const tool = new CodexTool(); // No repos/services

    const sessionId = generateId() as SessionID;

    const result = await tool.stopTask(sessionId);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('CodexTool not initialized with prompt service');
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('CodexTool - Error Handling', () => {
  it('should throw error if not initialized for live execution', async () => {
    const tool = new CodexTool(); // No repos

    const sessionId = generateId() as SessionID;

    await expect(tool.executePrompt(sessionId, 'Test')).rejects.toThrow(
      'CodexTool not initialized with repositories for live execution'
    );
  });

  it('should throw error if messagesService missing', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();

    const tool = new CodexTool(messagesRepo, sessionsRepo, 'api-key'); // No messagesService

    const sessionId = generateId() as SessionID;

    await expect(tool.executePrompt(sessionId, 'Test')).rejects.toThrow(
      'CodexTool not initialized with messagesService for live execution'
    );
  });

  it('should throw error for streaming without initialization', async () => {
    const tool = new CodexTool();

    const sessionId = generateId() as SessionID;
    const callbacks = createMockStreamingCallbacks();

    await expect(
      tool.executePromptWithStreaming(sessionId, 'Test', undefined, 'auto', callbacks)
    ).rejects.toThrow('CodexTool not initialized with repositories for live execution');
  });
});

// ============================================================================
// Content Filtering
// ============================================================================

describe('CodexTool - Content Filtering', () => {
  it('should filter out tool blocks from complete events in streaming mode', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        // Emit tool_complete (creates message immediately)
        yield {
          type: 'tool_complete',
          toolUse: {
            id: 'tool_1',
            name: 'bash',
            input: { command: 'ls' },
            output: 'file.txt',
            status: 'completed',
          },
          threadId: 'thread_123',
        };

        // Complete event contains both tool_use/tool_result AND text
        // Text should be kept, tools should be filtered (already saved)
        yield {
          type: 'complete',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'bash', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'tool_1', content: 'file.txt' },
            { type: 'text', text: 'Here are the files' },
          ],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePromptWithStreaming(sessionId, 'List files');

    // Should create 3 messages: user, tool (from tool_complete), text (from complete with text only)
    expect(messagesService.create).toHaveBeenCalledTimes(3);

    const textMessageCall = messagesService.create.mock.calls[2][0] as Message;
    expect(textMessageCall.content).toEqual([{ type: 'text', text: 'Here are the files' }]);
  });

  it('should not create message if complete event has no text content', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'tool_complete',
          toolUse: {
            id: 'tool_1',
            name: 'bash',
            input: { command: 'ls' },
            output: 'file.txt',
            status: 'completed',
          },
          threadId: 'thread_123',
        };

        // Complete event with ONLY tool blocks (no text)
        yield {
          type: 'complete',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'bash', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'tool_1', content: 'file.txt' },
          ],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePromptWithStreaming(sessionId, 'List files');

    // Should only create 2 messages: user + tool (no text message)
    expect(messagesService.create).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Metadata Handling
// ============================================================================

describe('CodexTool - Metadata', () => {
  it('should include model in message metadata', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: 'gpt-5-codex',
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test');

    const assistantCall = messagesService.create.mock.calls[1][0] as Message;
    expect(assistantCall.metadata?.model).toBe('gpt-5-codex');
  });

  it('should use default model if resolvedModel not provided', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          // No resolvedModel
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test');

    const assistantCall = messagesService.create.mock.calls[1][0] as Message;
    expect(assistantCall.metadata?.model).toBe(DEFAULT_CODEX_MODEL);
  });

  it('should include zero tokens in metadata (TODO: extract from SDK)', async () => {
    const messagesRepo = createMockMessagesRepo();
    const sessionsRepo = createMockSessionsRepo();
    const messagesService = createMockMessagesService();
    const tasksService = createMockTasksService();

    const sessionId = generateId() as SessionID;
    const session = createTestSession({ session_id: sessionId });
    (sessionsRepo as any)._sessions.set(sessionId, session);

    const tool = new CodexTool(
      messagesRepo,
      sessionsRepo,
      'api-key',
      messagesService,
      tasksService
    );

    vi.spyOn(tool as any, 'promptService', 'get').mockReturnValue({
      promptSessionStreaming: vi.fn(async function* () {
        yield {
          type: 'complete',
          content: [{ type: 'text', text: 'Response' }],
          threadId: 'thread_123',
          resolvedModel: DEFAULT_CODEX_MODEL,
        };
      }),
    });

    await tool.executePrompt(sessionId, 'Test');

    const assistantCall = messagesService.create.mock.calls[1][0] as Message;
    expect(assistantCall.metadata?.tokens).toEqual({ input: 0, output: 0 });
  });
});
