/**
 * MCP Tools Module
 *
 * Provides utilities for MCP (Model Context Protocol) server integration,
 * including authentication handling and configuration resolution.
 */

export {
  fetchJWTToken,
  resolveMCPAuthToken,
  clearJWTTokenCache,
  clearAllJWTTokenCache,
  MCPAuthError,
} from './jwt-auth';