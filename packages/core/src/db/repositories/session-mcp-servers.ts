/**
 * Session-MCP Server Relationship Repository
 *
 * Manages the many-to-many relationship between sessions and MCP servers.
 */

import type { MCPServer, MCPServerID, SessionID, SessionMCPServer } from '@agor/core/types';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { type SessionMCPServerInsert, sessionMcpServers } from '../schema';
import { EntityNotFoundError, RepositoryError } from './base';
import { MCPServerRepository } from './mcp-servers';
import { SessionRepository } from './sessions';

/**
 * Session-MCP Server repository implementation
 */
export class SessionMCPServerRepository {
  private sessionRepo: SessionRepository;
  private mcpServerRepo: MCPServerRepository;

  constructor(private db: Database) {
    this.sessionRepo = new SessionRepository(db);
    this.mcpServerRepo = new MCPServerRepository(db);
  }

  /**
   * Add MCP server to session
   */
  async addServer(sessionId: SessionID, serverId: MCPServerID): Promise<void> {
    try {
      // Verify session exists
      const session = await this.sessionRepo.findById(sessionId);
      if (!session) {
        throw new EntityNotFoundError('Session', sessionId);
      }

      // Verify MCP server exists
      const server = await this.mcpServerRepo.findById(serverId);
      if (!server) {
        throw new EntityNotFoundError('MCPServer', serverId);
      }

      // Check if relationship already exists
      const existing = await this.db
        .select()
        .from(sessionMcpServers)
        .where(
          and(
            eq(sessionMcpServers.session_id, sessionId),
            eq(sessionMcpServers.mcp_server_id, serverId)
          )
        )
        .get();

      if (existing) {
        // Already exists, just ensure it's enabled
        await this.db
          .update(sessionMcpServers)
          .set({ enabled: true })
          .where(
            and(
              eq(sessionMcpServers.session_id, sessionId),
              eq(sessionMcpServers.mcp_server_id, serverId)
            )
          );
        return;
      }

      // Create new relationship
      const insert: SessionMCPServerInsert = {
        session_id: sessionId,
        mcp_server_id: serverId,
        enabled: true,
        added_at: new Date(),
      };

      await this.db.insert(sessionMcpServers).values(insert);
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      throw new RepositoryError(
        `Failed to add MCP server to session: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Remove MCP server from session
   */
  async removeServer(sessionId: SessionID, serverId: MCPServerID): Promise<void> {
    try {
      const result = await this.db
        .delete(sessionMcpServers)
        .where(
          and(
            eq(sessionMcpServers.session_id, sessionId),
            eq(sessionMcpServers.mcp_server_id, serverId)
          )
        )
        .run();

      if (result.rowsAffected === 0) {
        throw new EntityNotFoundError('SessionMCPServer', `${sessionId}/${serverId}`);
      }
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      throw new RepositoryError(
        `Failed to remove MCP server from session: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Toggle MCP server enabled state for session
   */
  async toggleServer(sessionId: SessionID, serverId: MCPServerID, enabled: boolean): Promise<void> {
    try {
      const result = await this.db
        .update(sessionMcpServers)
        .set({ enabled })
        .where(
          and(
            eq(sessionMcpServers.session_id, sessionId),
            eq(sessionMcpServers.mcp_server_id, serverId)
          )
        )
        .run();

      if (result.rowsAffected === 0) {
        throw new EntityNotFoundError('SessionMCPServer', `${sessionId}/${serverId}`);
      }
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      throw new RepositoryError(
        `Failed to toggle MCP server: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * List MCP servers for a session
   */
  async listServers(sessionId: SessionID, enabledOnly = false): Promise<MCPServer[]> {
    try {
      // Get all relationships for this session
      const conditions = [eq(sessionMcpServers.session_id, sessionId)];

      if (enabledOnly) {
        conditions.push(eq(sessionMcpServers.enabled, true));
      }

      const relationships = await this.db
        .select()
        .from(sessionMcpServers)
        .where(and(...conditions))
        .all();

      // Fetch full MCP server details for each relationship
      const servers: MCPServer[] = [];
      for (const rel of relationships) {
        const server = await this.mcpServerRepo.findById(rel.mcp_server_id);
        if (server) {
          servers.push(server);
        }
      }

      return servers;
    } catch (error) {
      throw new RepositoryError(
        `Failed to list MCP servers for session: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Set MCP servers for a session (bulk operation)
   * Replaces existing relationships with new ones
   */
  async setServers(sessionId: SessionID, serverIds: MCPServerID[]): Promise<void> {
    try {
      // Verify session exists
      const session = await this.sessionRepo.findById(sessionId);
      if (!session) {
        throw new EntityNotFoundError('Session', sessionId);
      }

      // Remove all existing relationships
      await this.db.delete(sessionMcpServers).where(eq(sessionMcpServers.session_id, sessionId));

      // Add new relationships
      if (serverIds.length > 0) {
        const inserts: SessionMCPServerInsert[] = serverIds.map((serverId) => ({
          session_id: sessionId,
          mcp_server_id: serverId,
          enabled: true,
          added_at: new Date(),
        }));

        await this.db.insert(sessionMcpServers).values(inserts);
      }
    } catch (error) {
      if (error instanceof EntityNotFoundError) throw error;
      throw new RepositoryError(
        `Failed to set MCP servers for session: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Get relationship details
   */
  async getRelationship(
    sessionId: SessionID,
    serverId: MCPServerID
  ): Promise<SessionMCPServer | null> {
    try {
      const row = await this.db
        .select()
        .from(sessionMcpServers)
        .where(
          and(
            eq(sessionMcpServers.session_id, sessionId),
            eq(sessionMcpServers.mcp_server_id, serverId)
          )
        )
        .get();

      if (!row) {
        return null;
      }

      return {
        session_id: row.session_id as SessionID,
        mcp_server_id: row.mcp_server_id as MCPServerID,
        enabled: Boolean(row.enabled),
        added_at: new Date(row.added_at),
      };
    } catch (error) {
      throw new RepositoryError(
        `Failed to get relationship: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Count MCP servers for a session
   */
  async count(sessionId: SessionID, enabledOnly = false): Promise<number> {
    try {
      const servers = await this.listServers(sessionId, enabledOnly);
      return servers.length;
    } catch (error) {
      throw new RepositoryError(
        `Failed to count MCP servers: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }
}
