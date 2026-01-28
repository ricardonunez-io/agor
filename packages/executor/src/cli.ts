/**
 * CLI entry point for executor
 *
 * Supports two modes:
 * 1. --stdin mode (new): JSON payload via stdin - preferred for all commands
 * 2. Legacy args mode: CLI arguments for backward compatibility (prompt only)
 *
 * The executor is ephemeral and task-scoped. Each subprocess executes exactly
 * one command and then exits. Communication with daemon is via Feathers/WebSocket.
 *
 * IMPERSONATION:
 * Impersonation is handled at spawn time by the daemon using buildSpawnArgs().
 * When the daemon spawns the executor with asUser, it uses `sudo su -` to run
 * the executor directly as the target user. The executor itself doesn't handle
 * impersonation - it's already running as the correct user.
 */

import { parseArgs } from 'node:util';

import { generateId } from '@agor/core';
import { MessageRole } from '@agor/core/types';
import type { MessageID, SessionID, TaskID } from '@agor/core/types';
import { executeCommand, getRegisteredCommands } from './commands/index.js';
import { AgorExecutor } from './index.js';
import {
  type ExecutorPayload,
  ExecutorPayloadSchema,
  isPromptPayload,
  type PromptPayload,
} from './payload-types.js';

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Handle JSON-over-stdin mode
 */
async function handleStdinMode(options: { dryRun: boolean }): Promise<void> {
  // Read JSON from stdin
  const input = await readStdin();

  if (!input.trim()) {
    console.error('[executor] Error: Empty input received on stdin');
    console.error('[executor] Usage: echo \'{"command":"prompt",...}\' | agor-executor --stdin');
    process.exit(1);
  }

  let payload: ExecutorPayload;

  try {
    const parsed = JSON.parse(input);
    payload = ExecutorPayloadSchema.parse(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('[executor] Error: Invalid JSON input');
      console.error(`[executor] Details: ${error.message}`);
    } else if (error instanceof Error && error.name === 'ZodError') {
      console.error('[executor] Error: Invalid payload schema');
      console.error(`[executor] Details: ${error.message}`);
    } else {
      console.error('[executor] Error: Failed to parse payload');
      console.error(`[executor] Details: ${error}`);
    }
    process.exit(1);
  }

  console.log(`[executor] Received command: ${payload.command}`);

  // Special handling for prompt command - needs long-running WebSocket connection
  if (isPromptPayload(payload)) {
    await handlePromptPayload(payload, options);
    return;
  }

  // Special handling for zellij.attach - long-running PTY session
  // The executor must stay alive to stream PTY I/O
  if (payload.command === 'zellij.attach') {
    const result = await executeCommand(payload, { dryRun: options.dryRun });

    // Output result as JSON to stdout (for daemon to parse)
    console.log(JSON.stringify(result));

    if (!result.success) {
      process.exit(1);
    }

    // DON'T exit - stay alive to stream PTY I/O
    // The PTY onExit handler will call process.exit() when done
    console.log('[executor] Zellij attached, staying alive for PTY streaming...');
    return;
  }

  // All other commands go through the command router
  const result = await executeCommand(payload, { dryRun: options.dryRun });

  // Output result as JSON to stdout
  console.log(JSON.stringify(result));

  process.exit(result.success ? 0 : 1);
}

/**
 * Handle prompt command - requires special handling for long-running WebSocket
 */
async function handlePromptPayload(
  payload: PromptPayload,
  options: { dryRun: boolean }
): Promise<void> {
  const container = payload.params.container;

  if (options.dryRun) {
    console.log(
      JSON.stringify({
        success: true,
        data: {
          dryRun: true,
          command: 'prompt',
          sessionId: payload.params.sessionId,
          taskId: payload.params.taskId,
          tool: payload.params.tool,
          cwd: payload.params.cwd,
          container: container?.name || 'none',
          envVars: payload.env ? Object.keys(payload.env).length : 0,
        },
      })
    );
    process.exit(0);
  }

  // =========================================================================
  // CONTAINER MODE: Spawn AI agent CLI via docker exec
  // =========================================================================
  if (container) {
    console.log(`[executor] Container mode: spawning ${payload.params.tool} in ${container.name}`);
    await handlePromptInContainer(payload, container);
    return;
  }

  // =========================================================================
  // LOCAL MODE: Use SDK directly
  // =========================================================================

  // Apply environment variables from payload
  if (payload.env && Object.keys(payload.env).length > 0) {
    const skipKeys = ['HOME']; // Don't overwrite HOME set by docker exec
    const filteredEnv = Object.entries(payload.env).filter(([key]) => !skipKeys.includes(key));
    console.log(`[executor] Applying ${filteredEnv.length} env vars from payload (skipping: ${skipKeys.join(', ')})`);
    for (const [key, value] of filteredEnv) {
      process.env[key] = value;
    }
  }

  // Validate tool using registry
  const { ToolRegistry, initializeToolRegistry } = await import('./handlers/sdk/tool-registry.js');
  await initializeToolRegistry();

  if (!ToolRegistry.has(payload.params.tool)) {
    console.error(`[executor] Invalid tool: ${payload.params.tool}`);
    console.error(`[executor] Valid tools: ${ToolRegistry.getAll().join(', ')}`);
    process.exit(1);
  }

  // Start executor in Feathers mode
  const executor = new AgorExecutor({
    sessionToken: payload.sessionToken,
    sessionId: payload.params.sessionId,
    taskId: payload.params.taskId,
    prompt: payload.params.prompt,
    tool: payload.params.tool,
    permissionMode: payload.params.permissionMode,
    daemonUrl: payload.daemonUrl || 'http://localhost:3030',
    cwd: payload.params.cwd,
  });

  await executor.start();
}

/**
 * Handle prompt execution inside a container via docker exec
 *
 * Spawns the AI agent CLI directly inside the container and streams output
 * back to the daemon via WebSocket.
 */
async function handlePromptInContainer(
  payload: PromptPayload,
  container: { name: string; runtime?: 'docker' | 'podman'; user?: string; workdir?: string }
): Promise<void> {
  const nodePty = await import('node-pty');
  const { createFeathersClient } = await import('./services/feathers-client.js');
  const { generateId } = await import('@agor/core/db');

  const runtime = container.runtime || 'docker';
  const workdir = container.workdir || '/workspace';
  const tool = payload.params.tool;

  // Connect to daemon early so we can create user message
  console.log(`[executor] Connecting to daemon at ${payload.daemonUrl || 'http://localhost:3030'}`);
  const client = await createFeathersClient(payload.daemonUrl || 'http://localhost:3030', payload.sessionToken);

  // NOTE: Codex CLI doesn't support true conversation continuity via API.
  // The 'resume' command only loads local history, not API threads.
  // We still extract and store thread_id for potential future use (SDK or history injection).

  // Create user message (SDK does this, but CLI mode needs to do it explicitly)
  // Get next message index
  let nextIndex = 0;
  try {
    const existingMessages = await client.service('messages').find({
      query: { session_id: payload.params.sessionId, $limit: 1000 }
    }) as { data: unknown[] };
    nextIndex = existingMessages.data?.length || 0;
  } catch (err) {
    console.warn('[executor] Failed to get message count, using index 0');
  }

  try {
    const userMessageId = generateId() as MessageID;
    await client.service('messages').create({
      message_id: userMessageId,
      session_id: payload.params.sessionId as SessionID,
      task_id: payload.params.taskId as TaskID,
      type: 'user',
      role: MessageRole.USER,
      index: nextIndex,
      timestamp: new Date().toISOString(),
      content_preview: payload.params.prompt.substring(0, 200),
      content: payload.params.prompt,
    });
    nextIndex++; // Increment for assistant message
    console.log(`[executor] Created user message: ${userMessageId.substring(0, 8)}`);
  } catch (err) {
    console.error('[executor] Failed to create user message:', err);
    // Continue anyway - assistant response is more important
  }

  // Map tool to CLI command with JSON output (each CLI has different flags)
  // Claude: --print (non-interactive) + --output-format stream-json + --verbose (required with stream-json)
  // Gemini: --output-format stream-json (positional prompt for one-shot mode)
  // Codex: exec subcommand (non-interactive) + --json (JSONL output)
  // OpenCode: run subcommand (non-interactive) + --format json
  // Codex API config flags (shared between exec and resume)
  const codexApiConfig = [
    '-c', 'model_provider=openai-api',
    '-c', 'model_providers.openai-api.name=OpenAI',
    '-c', 'model_providers.openai-api.base_url=https://api.openai.com/v1',
    '-c', 'model_providers.openai-api.env_key=OPENAI_API_KEY',
    '-c', 'model_providers.openai-api.wire_api=chat',
  ];

  const toolCommands: Record<string, { cmd: string; args: string[] }> = {
    'claude-code': { cmd: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose'] },
    'gemini': { cmd: 'gemini', args: ['--output-format', 'stream-json'] },
    // Codex: Configure to use OpenAI API directly (not ChatGPT backend which requires login)
    // NOTE: Codex CLI 'resume' doesn't actually continue API threads - it only loads local history
    // Each prompt starts a fresh API thread. True continuity would require SDK or injecting history.
    'codex': { cmd: 'codex', args: ['exec', '--json', ...codexApiConfig] },
    'opencode': { cmd: 'opencode', args: ['run', '--format', 'json'] },
  };

  const toolConfig = toolCommands[tool];
  if (!toolConfig) {
    console.error(`[executor] Unknown tool: ${tool}`);
    process.exit(1);
  }

  // Build docker exec -it command
  const dockerArgs: string[] = ['exec', '-it'];
  if (container.user) dockerArgs.push('-u', container.user);
  dockerArgs.push('-w', workdir);
  dockerArgs.push('-e', 'TERM=xterm-256color');

  // Add env vars
  if (payload.env) {
    const envKeys = Object.keys(payload.env).filter(k => k !== 'HOME' && payload.env![k]);
    console.log(`[executor] Passing ${envKeys.length} env vars to container: ${envKeys.join(', ') || '(none)'}`);
    for (const [key, value] of Object.entries(payload.env)) {
      if (key !== 'HOME' && value) dockerArgs.push('-e', `${key}=${value}`);
    }
  } else {
    console.log('[executor] No env vars in payload');
  }

  // Add permission mode (each CLI has different flag names and values)
  if (payload.params.permissionMode) {
    const mode = payload.params.permissionMode;
    if (tool === 'claude-code') {
      // Claude: --permission-mode (default, plan, acceptEdits, bypassPermissions, etc.)
      toolConfig.args.push('--permission-mode', mode);
    } else if (tool === 'gemini') {
      // Gemini: --approval-mode (default, auto_edit, yolo)
      // Map Agor modes to Gemini modes
      const geminiMode = mode === 'autoEdit' ? 'auto_edit' : mode === 'yolo' ? 'yolo' : 'default';
      toolConfig.args.push('--approval-mode', geminiMode);
    } else if (tool === 'codex') {
      // Codex: Use danger-full-access since container already provides isolation
      // --full-auto uses workspace-write sandbox which blocks network access
      if (mode === 'allow-all' || mode === 'auto' || mode === 'autoEdit') {
        toolConfig.args.push('--dangerously-bypass-approvals-and-sandbox');
      }
    }
    // OpenCode: doesn't seem to have approval mode flags
  }

  // Add model flag (from session config or default for each tool)
  const sessionModel = payload.params.modelConfig?.model;
  const defaultModels: Record<string, string> = {
    'claude-code': 'claude-sonnet-4-5-latest',
    'gemini': 'gemini-2.5-flash',
    'codex': 'gpt-4o', // Using chat API, so use a chat model
    'opencode': 'anthropic/claude-sonnet-4-5', // OpenCode uses provider/model format
  };
  const modelToUse = sessionModel || defaultModels[tool];

  if (modelToUse) {
    if (tool === 'claude-code') {
      toolConfig.args.push('--model', modelToUse);
    } else if (tool === 'gemini') {
      toolConfig.args.push('--model', modelToUse);
    } else if (tool === 'codex') {
      toolConfig.args.push('--model', modelToUse);
    } else if (tool === 'opencode') {
      // OpenCode uses --model with provider/model format
      toolConfig.args.push('--model', modelToUse);
    }
    console.log(`[executor] Using model: ${modelToUse}${sessionModel ? ' (from session)' : ' (default)'}`);
  }

  // Pass prompt as argument
  dockerArgs.push(container.name, toolConfig.cmd, ...toolConfig.args, payload.params.prompt);

  console.log(`[executor] Spawning PTY: ${runtime} exec -it ... ${toolConfig.cmd} ${toolConfig.args.join(' ')}`);

  const broadcastEvent = async (event: string, data: Record<string, unknown>) => {
    try {
      await client.service('/messages/streaming').create({ event, data });
    } catch (err) {
      console.error(`[executor] Failed to broadcast ${event}:`, err);
    }
  };

  // Spawn with node-pty (provides real TTY)
  const pty = nodePty.spawn(runtime, dockerArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
  });

  const messageId = generateId() as MessageID;
  let buffer = '';
  let assistantContent = ''; // Collect full content for DB persistence
  let extractedModel: string | undefined; // Model extracted from CLI output (init event)
  let extractedThreadId: string | undefined; // Thread ID for Codex session continuity

  // Start streaming
  console.log(`[executor] Starting stream for session ${payload.params.sessionId}, task ${payload.params.taskId}`);
  await broadcastEvent('streaming:start', {
    message_id: messageId,
    session_id: payload.params.sessionId,
    task_id: payload.params.taskId,
    role: 'assistant',
    timestamp: new Date().toISOString(),
  });

  pty.onData((data) => {
    // Buffer and parse JSON lines
    buffer += data;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;

      try {
        const event = JSON.parse(trimmed);
        console.log(`[executor] JSON event: ${event.type || 'unknown'}`);

        // Extract text content from assistant messages
        // Each CLI has different JSON format:

        // Claude: {"type":"assistant","message":{"content":[{"type":"text","text":"Hi!"}]}}
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              assistantContent += block.text;
              broadcastEvent('streaming:chunk', {
                message_id: messageId,
                session_id: payload.params.sessionId,
                chunk: block.text,
              });
            }
          }
        }
        // Gemini: {"type":"message","role":"assistant","content":"Hi!"}
        else if (event.type === 'message' && event.role === 'assistant' && event.content) {
          console.log(`[executor] Gemini assistant content: ${event.content.substring(0, 50)}...`);
          assistantContent += event.content;
          broadcastEvent('streaming:chunk', {
            message_id: messageId,
            session_id: payload.params.sessionId,
            chunk: event.content,
          });
        }
        // Gemini user message - skip
        else if (event.type === 'message' && event.role === 'user') {
          console.log(`[executor] Skipping Gemini user message`);
        }
        // Codex: {"type":"item.completed","item":{"type":"agent_message","text":"Hello!"}}
        else if (event.type === 'item.completed' && event.item?.text) {
          console.log(`[executor] Codex item.completed: ${event.item.text.substring(0, 50)}...`);
          assistantContent += event.item.text;
          broadcastEvent('streaming:chunk', {
            message_id: messageId,
            session_id: payload.params.sessionId,
            chunk: event.item.text,
          });
        }
        // Codex/OpenCode: {"type":"text","content":"Hi!"} or similar
        else if (event.type === 'text' && event.content) {
          assistantContent += event.content;
          broadcastEvent('streaming:chunk', {
            message_id: messageId,
            session_id: payload.params.sessionId,
            chunk: event.content,
          });
        }
        // Handle result message (final response text)
        else if (event.type === 'result') {
          console.log(`[executor] Result event: status=${event.status}, is_error=${event.is_error}`);
          if (event.result && typeof event.result === 'string' && !event.is_error) {
            console.log(`[executor] Result text: ${event.result.substring(0, 50)}...`);
          }
          // Gemini result has status field
          if (event.status && event.status !== 'success') {
            console.log(`[executor] Result error: ${JSON.stringify(event).substring(0, 200)}`);
          }
        }
        // Extract model from init event (Claude and Gemini both use this)
        else if (event.type === 'init') {
          // Log full init event to debug model extraction
          console.log(`[executor] Init event: ${JSON.stringify(event).substring(0, 300)}`);
          if (event.model) {
            extractedModel = event.model;
            console.log(`[executor] Extracted model from init.model: ${extractedModel}`);
          } else if (event.session?.model) {
            // Gemini might have model nested in session object
            extractedModel = event.session.model;
            console.log(`[executor] Extracted model from init.session.model: ${extractedModel}`);
          }
        }
        // Codex: Extract thread_id for session continuity
        // {"type":"thread.started","thread_id":"019c05f8-e016-7340-bfee-d770c719bce6"}
        else if (event.type === 'thread.started' && event.thread_id) {
          extractedThreadId = event.thread_id;
          console.log(`[executor] Extracted thread_id: ${extractedThreadId}`);
        }
        // Log error events with details
        else if (event.type === 'error') {
          const errorMsg = event.message || event.error || JSON.stringify(event).substring(0, 200);
          console.error(`[executor] Error event: ${errorMsg}`);
        }
        // Log other event types for debugging
        else if (event.type !== 'system' && event.type !== 'turn.started' && event.type !== 'turn.completed') {
          console.log(`[executor] Skipping event type: ${event.type}`);
        }
      } catch {
        // Not valid JSON, might be CLI output - forward as-is
        console.log(`[executor] Non-JSON data: ${trimmed.substring(0, 50)}...`);
      }
    }
  });

  // Wait for exit
  await new Promise<void>((resolve, reject) => {
    pty.onExit(async ({ exitCode }) => {
      // Create assistant message in database (persists the streamed content)
      if (assistantContent) {
        try {
          await client.service('messages').create({
            message_id: messageId,
            session_id: payload.params.sessionId as SessionID,
            task_id: payload.params.taskId as TaskID,
            type: 'assistant',
            role: MessageRole.ASSISTANT,
            index: nextIndex,
            timestamp: new Date().toISOString(),
            content_preview: assistantContent.substring(0, 200),
            content: assistantContent,
          });
          console.log(`[executor] Created assistant message: ${messageId.substring(0, 8)} (${assistantContent.length} chars)`);
        } catch (err) {
          console.error('[executor] Failed to create assistant message:', err);
        }
      }

      await broadcastEvent('streaming:end', {
        message_id: messageId,
        session_id: payload.params.sessionId,
      });

      try {
        // Build patch data with status, completion time, and extracted model
        const taskPatch: Record<string, unknown> = {
          status: exitCode === 0 ? 'completed' : 'failed',
          completed_at: new Date().toISOString(),
        };
        if (extractedModel) {
          taskPatch.model = extractedModel;
          console.log(`[executor] Setting task model to: ${extractedModel}`);
        }
        await client.service('tasks').patch(payload.params.taskId, taskPatch);
      } catch (err) {
        console.error('[executor] Failed to update task:', err);
      }

      // Store thread_id in session for potential future use (Codex)
      // NOTE: Currently not used for resume since Codex CLI doesn't support true API thread continuity
      if (extractedThreadId) {
        try {
          await client.service('sessions').patch(payload.params.sessionId, {
            sdk_session_id: extractedThreadId,
          });
          console.log(`[executor] Stored thread_id in session: ${extractedThreadId.substring(0, 8)}...`);
        } catch (err) {
          console.error('[executor] Failed to store thread_id in session:', err);
        }
      }

      if (exitCode === 0) {
        console.log('[executor] Container prompt completed');
        resolve();
      } else {
        console.error(`[executor] Container prompt failed (code ${exitCode})`);
        reject(new Error(`Exit code ${exitCode}`));
      }
    });
  });
}

/**
 * Handle legacy CLI arguments mode (backward compatibility)
 */
async function handleLegacyMode(values: {
  'session-token'?: string;
  'session-id'?: string;
  'task-id'?: string;
  prompt?: string;
  tool?: string;
  'permission-mode'?: string;
  'daemon-url'?: string;
}): Promise<void> {
  // Validate required arguments
  if (
    !values['session-token'] ||
    !values['session-id'] ||
    !values['task-id'] ||
    !values.prompt ||
    !values.tool
  ) {
    printUsage();
    process.exit(1);
  }

  // Validate tool using registry
  const { ToolRegistry, initializeToolRegistry } = await import('./handlers/sdk/tool-registry.js');
  await initializeToolRegistry();

  if (!ToolRegistry.has(values.tool as string)) {
    console.error(`Invalid tool: ${values.tool}`);
    console.error(`Valid tools: ${ToolRegistry.getAll().join(', ')}`);
    process.exit(1);
  }

  // Start executor in Feathers mode
  const executor = new AgorExecutor({
    sessionToken: values['session-token'] as string,
    sessionId: values['session-id'] as string,
    taskId: values['task-id'] as string,
    prompt: values.prompt as string,
    tool: values.tool as 'claude-code' | 'gemini' | 'codex' | 'opencode',
    permissionMode: (values['permission-mode'] as 'ask' | 'auto' | 'allow-all') || undefined,
    daemonUrl: (values['daemon-url'] as string) || 'http://localhost:3030',
  });

  await executor.start();
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.error('Usage: agor-executor [OPTIONS]');
  console.error('');
  console.error('Modes:');
  console.error('  --stdin                  Read JSON payload from stdin (recommended)');
  console.error('  [legacy args]            Use CLI arguments (backward compatible)');
  console.error('');
  console.error('Options:');
  console.error('  --stdin                  Read JSON payload from stdin');
  console.error('  --dry-run                Parse and validate without executing');
  console.error('');
  console.error('Legacy options (for prompt command only):');
  console.error('  --session-token <jwt>    JWT for Feathers authentication');
  console.error('  --session-id <id>        Session ID to execute prompt for');
  console.error('  --task-id <id>           Task ID created by daemon');
  console.error('  --prompt <text>          User prompt to execute');
  console.error('  --tool <name>            SDK tool (claude-code, gemini, codex, opencode)');
  console.error('  --permission-mode <mode> Permission mode (ask, auto, allow-all)');
  console.error('  --daemon-url <url>       Daemon WebSocket URL (default: http://localhost:3030)');
  console.error('');
  console.error('Supported commands (via --stdin):');
  for (const cmd of getRegisteredCommands()) {
    console.error(`  - ${cmd}`);
  }
  console.error('');
  console.error('Example (stdin mode):');
  console.error(
    '  echo \'{"command":"prompt","sessionToken":"...","params":{...}}\' | agor-executor --stdin'
  );
}

async function main() {
  // Parse command-line arguments
  const { values } = parseArgs({
    options: {
      stdin: {
        type: 'boolean',
        default: false,
      },
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      // Legacy args for backward compatibility
      'session-token': {
        type: 'string',
      },
      'session-id': {
        type: 'string',
      },
      'task-id': {
        type: 'string',
      },
      prompt: {
        type: 'string',
      },
      tool: {
        type: 'string',
      },
      'permission-mode': {
        type: 'string',
      },
      'daemon-url': {
        type: 'string',
      },
    },
    allowPositionals: false,
  });

  // Route to appropriate mode
  if (values.stdin) {
    await handleStdinMode({ dryRun: values['dry-run'] || false });
  } else if (values['session-token']) {
    // Legacy mode - use CLI arguments
    await handleLegacyMode(values);
  } else {
    printUsage();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[executor] Fatal error:', error);
  process.exit(1);
});
