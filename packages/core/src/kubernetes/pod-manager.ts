/**
 * Kubernetes Pod Manager
 *
 * Manages shell pods and Podman pods for isolated terminal execution.
 * Uses @kubernetes/client-node to interact with the Kubernetes API.
 */

import * as k8s from '@kubernetes/client-node';
import type { UserID, WorktreeID } from '../types/id.js';
import {
  buildPodmanPodManifest,
  buildPodmanServiceManifest,
  buildShellPodManifest,
} from './pod-manifests';
import {
  DEFAULT_USER_POD_CONFIG,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  POD_ANNOTATIONS,
  POD_LABEL_VALUES,
  POD_LABELS,
  type PodmanPodInfo,
  type ShellPodInfo,
  type UserPodConfig,
} from './types';

/**
 * Error thrown when a pod operation fails
 */
export class PodManagerError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly podName?: string
  ) {
    super(message);
    this.name = 'PodManagerError';
  }
}

/**
 * Options for creating PodManager
 */
export interface PodManagerOptions {
  config?: Partial<UserPodConfig>;
  kubeConfigPath?: string; // For testing outside cluster
}

/**
 * Manages Kubernetes pods for isolated terminal execution
 */
export class PodManager {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private exec: k8s.Exec;
  private config: UserPodConfig;
  private initialized = false;

  constructor(options: PodManagerOptions = {}) {
    this.kc = new k8s.KubeConfig();
    this.config = { ...DEFAULT_USER_POD_CONFIG, ...options.config };

    // Load kubeconfig
    if (options.kubeConfigPath) {
      this.kc.loadFromFile(options.kubeConfigPath);
    } else {
      try {
        this.kc.loadFromCluster();
      } catch {
        // Fallback to default config for local development
        this.kc.loadFromDefault();
      }
    }

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.exec = new k8s.Exec(this.kc);
    this.initialized = true;
  }

  /**
   * Check if PodManager is initialized and enabled
   */
  isEnabled(): boolean {
    return this.initialized && this.config.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): UserPodConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UserPodConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Ensure shell pod exists for user + worktree
   * Creates Podman pod first if needed (shared for worktree)
   *
   * @param userUid - Unix UID for consistent file ownership on EFS/NFS
   * @param unixUsername - Unix username for /etc/passwd entry
   */
  async ensureShellPod(
    worktreeId: WorktreeID,
    userId: UserID,
    worktreePath: string,
    userUid?: number,
    unixUsername?: string
  ): Promise<string> {
    const shellPodName = getShellPodName(worktreeId, userId);

    // Ensure Podman pod exists first (shared for worktree)
    await this.ensurePodmanPod(worktreeId, worktreePath);

    try {
      const { body: pod } = await this.k8sApi.readNamespacedPod(
        shellPodName,
        this.config.namespace
      );

      if (pod.status?.phase === 'Running') {
        // Update last activity
        await this.updateLastActivity(shellPodName);
        return shellPodName;
      }

      // Pod exists but not running, wait for it
      await this.waitForPod(shellPodName);
      return shellPodName;
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode === 404) {
        // Create shell pod
        await this.createShellPod(worktreeId, userId, worktreePath, userUid, unixUsername);
        await this.waitForPod(shellPodName);
        return shellPodName;
      }
      throw new PodManagerError(
        `Failed to get shell pod: ${error instanceof Error ? error.message : String(error)}`,
        e.statusCode,
        shellPodName
      );
    }
  }

  /**
   * Ensure Podman pod exists for worktree (shared by all users)
   */
  async ensurePodmanPod(worktreeId: WorktreeID, worktreePath: string): Promise<string> {
    const podmanPodName = getPodmanPodName(worktreeId);

    try {
      const { body: pod } = await this.k8sApi.readNamespacedPod(
        podmanPodName,
        this.config.namespace
      );

      if (pod.status?.phase === 'Running') {
        return podmanPodName;
      }

      // Pod exists but not running, wait for it
      await this.waitForPod(podmanPodName);
      return podmanPodName;
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode === 404) {
        // Create Podman pod and service
        await this.createPodmanPod(worktreeId, worktreePath);
        await this.createPodmanService(worktreeId);
        await this.waitForPod(podmanPodName);
        return podmanPodName;
      }
      throw new PodManagerError(
        `Failed to get Podman pod: ${error instanceof Error ? error.message : String(error)}`,
        e.statusCode,
        podmanPodName
      );
    }
  }

  /**
   * Create shell pod
   */
  private async createShellPod(
    worktreeId: WorktreeID,
    userId: UserID,
    worktreePath: string,
    userUid?: number,
    unixUsername?: string
  ): Promise<void> {
    const manifest = buildShellPodManifest({
      worktreeId,
      userId,
      worktreePath,
      config: this.config,
      userUid,
      unixUsername,
    });

    console.log(
      `[PodManager] Creating shell pod: ${manifest.metadata?.name} (UID: ${userUid ?? 'default'})`
    );

    try {
      await this.k8sApi.createNamespacedPod(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      throw new PodManagerError(
        `Failed to create shell pod: ${e.body?.message || String(error)}`,
        e.statusCode,
        manifest.metadata?.name
      );
    }
  }

  /**
   * Create Podman pod
   */
  private async createPodmanPod(worktreeId: WorktreeID, worktreePath: string): Promise<void> {
    const manifest = buildPodmanPodManifest({
      worktreeId,
      worktreePath,
      config: this.config,
    });

    console.log(`[PodManager] Creating Podman pod: ${manifest.metadata?.name}`);

    try {
      await this.k8sApi.createNamespacedPod(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      throw new PodManagerError(
        `Failed to create Podman pod: ${e.body?.message || String(error)}`,
        e.statusCode,
        manifest.metadata?.name
      );
    }
  }

  /**
   * Create Podman service
   */
  private async createPodmanService(worktreeId: WorktreeID): Promise<void> {
    const manifest = buildPodmanServiceManifest(worktreeId, this.config);
    const serviceName = manifest.metadata?.name;

    console.log(`[PodManager] Creating Podman service: ${serviceName}`);

    try {
      await this.k8sApi.createNamespacedService(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      // Ignore if service already exists
      if (e.statusCode !== 409) {
        throw new PodManagerError(
          `Failed to create Podman service: ${e.body?.message || String(error)}`,
          e.statusCode
        );
      }
    }
  }

  /**
   * Delete shell pod
   */
  async deleteShellPod(worktreeId: WorktreeID, userId: UserID): Promise<void> {
    const podName = getShellPodName(worktreeId, userId);

    console.log(`[PodManager] Deleting shell pod: ${podName}`);

    try {
      await this.k8sApi.deleteNamespacedPod(podName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      // Ignore if already deleted
      if (e.statusCode !== 404) {
        throw new PodManagerError(
          `Failed to delete shell pod: ${error instanceof Error ? error.message : String(error)}`,
          e.statusCode,
          podName
        );
      }
    }
  }

  /**
   * Delete Podman pod and service
   */
  async deletePodmanPod(worktreeId: WorktreeID): Promise<void> {
    const podName = getPodmanPodName(worktreeId);
    const serviceName = getPodmanServiceName(worktreeId);

    console.log(`[PodManager] Deleting Podman pod and service: ${podName}`);

    try {
      await this.k8sApi.deleteNamespacedPod(podName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete Podman pod ${podName}:`, error);
      }
    }

    try {
      await this.k8sApi.deleteNamespacedService(serviceName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete Podman service ${serviceName}:`, error);
      }
    }
  }

  /**
   * Update last activity annotation on pod
   */
  async updateLastActivity(podName: string): Promise<void> {
    try {
      await this.k8sApi.patchNamespacedPod(
        podName,
        this.config.namespace,
        {
          metadata: {
            annotations: {
              [POD_ANNOTATIONS.LAST_ACTIVITY]: new Date().toISOString(),
            },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      );
    } catch (error) {
      // Non-critical, just log
      console.warn(`Failed to update last activity for ${podName}:`, error);
    }
  }

  /**
   * Wait for pod to be running
   */
  private async waitForPod(podName: string, timeoutMs = 60000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const { body: pod } = await this.k8sApi.readNamespacedPod(podName, this.config.namespace);

        if (pod.status?.phase === 'Running') {
          return;
        }

        if (pod.status?.phase === 'Failed' || pod.status?.phase === 'Succeeded') {
          throw new PodManagerError(
            `Pod ${podName} is in terminal state: ${pod.status.phase}`,
            undefined,
            podName
          );
        }
      } catch (error: unknown) {
        const e = error as { statusCode?: number };
        if (e.statusCode !== 404) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new PodManagerError(`Timeout waiting for pod ${podName} to be ready`, undefined, podName);
  }

  /**
   * List all shell pods
   */
  async listShellPods(): Promise<ShellPodInfo[]> {
    const { body } = await this.k8sApi.listNamespacedPod(
      this.config.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `${POD_LABELS.COMPONENT}=${POD_LABEL_VALUES.TERMINAL}`
    );

    return body.items.map((pod) => ({
      podName: pod.metadata?.name || '',
      worktreeId: (pod.metadata?.labels?.[POD_LABELS.WORKTREE_ID] || '') as WorktreeID,
      userId: (pod.metadata?.labels?.[POD_LABELS.USER_ID] || '') as UserID,
      createdAt: pod.metadata?.annotations?.[POD_ANNOTATIONS.CREATED_AT] || '',
      lastActivity: pod.metadata?.annotations?.[POD_ANNOTATIONS.LAST_ACTIVITY] || '',
      status: (pod.status?.phase as ShellPodInfo['status']) || 'Unknown',
    }));
  }

  /**
   * List all Podman pods
   */
  async listPodmanPods(): Promise<PodmanPodInfo[]> {
    const { body } = await this.k8sApi.listNamespacedPod(
      this.config.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `${POD_LABELS.COMPONENT}=${POD_LABEL_VALUES.CONTAINER_RUNTIME}`
    );

    return body.items.map((pod) => {
      const worktreeId = (pod.metadata?.labels?.[POD_LABELS.WORKTREE_ID] || '') as WorktreeID;
      return {
        podName: pod.metadata?.name || '',
        serviceName: getPodmanServiceName(worktreeId),
        worktreeId,
        createdAt: pod.metadata?.annotations?.[POD_ANNOTATIONS.CREATED_AT] || '',
        lastActivity: pod.metadata?.annotations?.[POD_ANNOTATIONS.LAST_ACTIVITY] || '',
        status: (pod.status?.phase as PodmanPodInfo['status']) || 'Unknown',
      };
    });
  }

  /**
   * Garbage collect idle shell pods
   */
  async gcIdleShellPods(): Promise<number> {
    const pods = await this.listShellPods();
    const now = Date.now();
    const timeoutMs = this.config.idleTimeoutMinutes.shell * 60 * 1000;
    let deleted = 0;

    for (const pod of pods) {
      if (pod.lastActivity) {
        const idleMs = now - new Date(pod.lastActivity).getTime();
        if (idleMs > timeoutMs) {
          console.log(
            `[PodManager] GC: Deleting idle shell pod ${pod.podName} (idle ${Math.round(idleMs / 60000)}min)`
          );
          try {
            await this.k8sApi.deleteNamespacedPod(pod.podName, this.config.namespace);
            deleted++;
          } catch (error) {
            console.error(`Failed to delete shell pod ${pod.podName}:`, error);
          }
        }
      }
    }

    return deleted;
  }

  /**
   * Garbage collect orphaned Podman pods (no active shell pods)
   */
  async gcOrphanedPodmanPods(): Promise<number> {
    const shellPods = await this.listShellPods();
    const podmanPods = await this.listPodmanPods();
    const now = Date.now();
    const timeoutMs = this.config.idleTimeoutMinutes.podman * 60 * 1000;

    // Get worktree IDs with active shell pods
    const activeWorktreeIds = new Set(
      shellPods.filter((p) => p.status === 'Running').map((p) => p.worktreeId)
    );

    let deleted = 0;

    for (const pod of podmanPods) {
      // Skip if there are active shell pods for this worktree
      if (activeWorktreeIds.has(pod.worktreeId)) {
        continue;
      }

      // Check idle timeout
      if (pod.lastActivity) {
        const idleMs = now - new Date(pod.lastActivity).getTime();
        if (idleMs > timeoutMs) {
          console.log(
            `[PodManager] GC: Deleting orphaned Podman pod ${pod.podName} (idle ${Math.round(idleMs / 60000)}min)`
          );
          await this.deletePodmanPod(pod.worktreeId);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Run garbage collection for all pod types
   */
  async runGC(): Promise<{ shellPodsDeleted: number; podmanPodsDeleted: number }> {
    const shellPodsDeleted = await this.gcIdleShellPods();
    const podmanPodsDeleted = await this.gcOrphanedPodmanPods();

    if (shellPodsDeleted > 0 || podmanPodsDeleted > 0) {
      console.log(
        `[PodManager] GC complete: ${shellPodsDeleted} shell pods, ${podmanPodsDeleted} Podman pods deleted`
      );
    }

    return { shellPodsDeleted, podmanPodsDeleted };
  }

  /**
   * Get exec instance for terminal streaming
   */
  getExec(): k8s.Exec {
    return this.exec;
  }

  /**
   * Get namespace
   */
  getNamespace(): string {
    return this.config.namespace;
  }
}

/**
 * Singleton instance for daemon use
 */
let podManagerInstance: PodManager | null = null;

/**
 * Get or create PodManager instance
 */
export function getPodManager(options?: PodManagerOptions): PodManager {
  if (!podManagerInstance) {
    podManagerInstance = new PodManager(options);
  } else if (options?.config) {
    podManagerInstance.updateConfig(options.config);
  }
  return podManagerInstance;
}

/**
 * Reset PodManager instance (for testing)
 */
export function resetPodManager(): void {
  podManagerInstance = null;
}
