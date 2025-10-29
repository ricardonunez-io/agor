/**
 * Config Service
 *
 * Provides REST + WebSocket API for configuration management.
 * Wraps @agor/core/config functions for UI access.
 */

import { type AgorConfig, loadConfig, saveConfig } from '@agor/core/config';
import type { Params } from '@agor/core/types';

/**
 * Mask API keys for secure display
 */
function maskApiKey(key: string | undefined): string | undefined {
  if (!key || typeof key !== 'string') return undefined;
  if (key.length <= 10) return '***';
  return `${key.substring(0, 10)}...`;
}

/**
 * Mask all credentials in config
 */
function maskCredentials(config: AgorConfig): AgorConfig {
  if (!config.credentials) return config;

  return {
    ...config,
    credentials: {
      ANTHROPIC_API_KEY: maskApiKey(config.credentials.ANTHROPIC_API_KEY),
      OPENAI_API_KEY: maskApiKey(config.credentials.OPENAI_API_KEY),
      GEMINI_API_KEY: maskApiKey(config.credentials.GEMINI_API_KEY),
      CURSOR_API_KEY: maskApiKey(config.credentials.CURSOR_API_KEY),
    },
  };
}

/**
 * Config service class
 */
export class ConfigService {
  /**
   * Get full config (masked)
   */
  async find(_params?: Params): Promise<AgorConfig> {
    const config = await loadConfig();
    return maskCredentials(config);
  }

  /**
   * Get specific config section or value
   */
  async get(id: string, _params?: Params): Promise<unknown> {
    const config = await loadConfig();
    const masked = maskCredentials(config);

    // Support dot notation (e.g., "credentials.ANTHROPIC_API_KEY")
    const parts = id.split('.');
    let value: unknown = masked;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Update config values
   *
   * SECURITY: Only allow updating credentials section from UI
   */
  async patch(_id: null, data: Partial<AgorConfig>, _params?: Params): Promise<AgorConfig> {
    const config = await loadConfig();

    // Only allow updating credentials section for security
    if (data.credentials) {
      config.credentials = {
        ...config.credentials,
        ...data.credentials,
      };
    }

    await saveConfig(config);

    // Return masked config
    return maskCredentials(config);
  }
}

/**
 * Service factory function
 */
export function createConfigService(): ConfigService {
  return new ConfigService();
}
