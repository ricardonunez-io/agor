/**
 * Gemini Tool - Google Gemini CLI integration for Agor
 *
 * Exports GeminiTool class and related types for use in daemon/CLI.
 */

export { GeminiTool } from './gemini-tool';
export { DEFAULT_GEMINI_MODEL, GEMINI_MODELS, type GeminiModel } from './models';
export type { GeminiStreamEvent } from './prompt-service';
export { GeminiPromptService } from './prompt-service';
