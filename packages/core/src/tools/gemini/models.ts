/**
 * Gemini model definitions and selection
 *
 * Reference: https://ai.google.dev/gemini-api/docs/models
 */

/**
 * Available Gemini models (2025)
 */
export type GeminiModel =
  | 'gemini-2.5-pro' // Most capable, complex reasoning (SWE-bench: 63.8%)
  | 'gemini-2.5-flash' // Balanced cost/capability, agentic tasks
  | 'gemini-2.5-flash-lite'; // High throughput, low cost, simple tasks

/**
 * Default model for new Gemini sessions
 *
 * Using Flash by default for balanced cost/performance.
 * Users can upgrade to Pro for complex tasks.
 */
export const DEFAULT_GEMINI_MODEL: GeminiModel = 'gemini-2.5-flash';

/**
 * Model metadata for UI display
 */
export const GEMINI_MODELS: Record<
  GeminiModel,
  {
    name: string;
    description: string;
    inputPrice: string; // $ per 1M tokens
    outputPrice: string; // $ per 1M tokens
    useCase: string;
  }
> = {
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description: 'Most capable model for complex reasoning and multi-step tasks',
    inputPrice: 'Higher', // Pricing not publicly disclosed yet
    outputPrice: 'Higher',
    useCase: 'Complex refactoring, architecture decisions, advanced debugging',
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    description: 'Balanced performance and cost for most agentic coding tasks',
    inputPrice: '$0.30',
    outputPrice: '$2.50',
    useCase: 'Feature development, bug fixes, code reviews, testing',
  },
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Ultra-fast, low-cost model for simple tasks',
    inputPrice: '$0.10',
    outputPrice: '$0.40',
    useCase: 'File search, summaries, simple edits, code formatting',
  },
};
