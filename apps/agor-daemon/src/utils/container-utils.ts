/**
 * Container Utilities
 *
 * Helper functions for working with worktree containers.
 * Container info is derived dynamically rather than stored in DB.
 */

import { execSync } from 'node:child_process';
import { formatShortId } from '@agor/core/db';
import type { WorktreeID } from '@agor/core/types';

/**
 * Container status derived from Docker
 */
export type ContainerStatus = 'running' | 'stopped' | 'not_found';

/**
 * Container info derived dynamically
 */
export interface ContainerInfo {
  name: string;
  status: ContainerStatus;
  sshPort: number;
  appPort: number;
}

/**
 * Default SSH base port
 */
const DEFAULT_SSH_BASE_PORT = 2222;

/**
 * Default app base port for exposing applications
 */
const DEFAULT_APP_BASE_PORT = 16000;

/**
 * Generate container name from worktree ID
 * Deterministic: same worktree ID always produces same container name
 */
export function getContainerName(worktreeId: WorktreeID): string {
  return `agor-wt-${formatShortId(worktreeId)}`;
}

/**
 * Calculate SSH port for a worktree
 * Deterministic: same worktree unique ID always produces same port
 */
export function calculateSSHPort(worktreeUniqueId: number, basePort?: number): number {
  return (basePort || DEFAULT_SSH_BASE_PORT) + worktreeUniqueId;
}

/**
 * Calculate app port for a worktree
 * This port is exposed on the host and can be forwarded to any app inside the container
 * Deterministic: same worktree unique ID always produces same port
 */
export function calculateAppPort(worktreeUniqueId: number, basePort?: number): number {
  return (basePort || DEFAULT_APP_BASE_PORT) + worktreeUniqueId;
}

/**
 * Check if a container exists and get its status
 */
export function getContainerStatus(containerName: string, runtime: 'docker' | 'podman' = 'docker'): ContainerStatus {
  try {
    const result = execSync(
      `${runtime} inspect --format='{{.State.Running}}' ${containerName} 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    return result === 'true' ? 'running' : 'stopped';
  } catch {
    return 'not_found';
  }
}

/**
 * Check if a container exists (regardless of status)
 */
export function containerExists(containerName: string, runtime: 'docker' | 'podman' = 'docker'): boolean {
  return getContainerStatus(containerName, runtime) !== 'not_found';
}

/**
 * Get full container info for a worktree
 */
export function getContainerInfo(
  worktreeId: WorktreeID,
  worktreeUniqueId: number,
  runtime: 'docker' | 'podman' = 'docker',
  sshBasePort?: number,
  appBasePort?: number
): ContainerInfo {
  const name = getContainerName(worktreeId);
  const status = getContainerStatus(name, runtime);
  const sshPort = calculateSSHPort(worktreeUniqueId, sshBasePort);
  const appPort = calculateAppPort(worktreeUniqueId, appBasePort);

  return { name, status, sshPort, appPort };
}

/**
 * Start a stopped container
 */
export async function startContainer(containerName: string, runtime: 'docker' | 'podman' = 'docker'): Promise<void> {
  execSync(`${runtime} start ${containerName}`, { timeout: 30000 });
}

/**
 * Stop a running container
 */
export async function stopContainer(containerName: string, runtime: 'docker' | 'podman' = 'docker'): Promise<void> {
  execSync(`${runtime} stop ${containerName}`, { timeout: 30000 });
}

/**
 * Remove a container
 */
export async function removeContainer(containerName: string, runtime: 'docker' | 'podman' = 'docker', force = false): Promise<void> {
  const forceFlag = force ? '-f' : '';
  execSync(`${runtime} rm ${forceFlag} ${containerName}`, { timeout: 30000 });
}

/**
 * Extract port from a URL string
 * Returns undefined if no port is found or URL is invalid
 *
 * Examples:
 * - "http://localhost:5003" → 5003
 * - "http://localhost:5003/health" → 5003
 * - "http://example.com" → undefined (uses default port)
 */
export function extractPortFromUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    const port = parsed.port;
    return port ? parseInt(port, 10) : undefined;
  } catch {
    // Try regex fallback for malformed URLs
    const match = url.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }
}
