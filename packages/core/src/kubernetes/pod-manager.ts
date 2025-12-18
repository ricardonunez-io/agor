/**
 * Kubernetes Pod Manager
 *
 * Manages shell pods and Podman pods for isolated terminal execution.
 * Uses @kubernetes/client-node to interact with the Kubernetes API.
 */

import { Writable } from 'node:stream';
import * as k8s from '@kubernetes/client-node';
import type { UserID, WorktreeID } from '../types/id.js';
import {
  buildAppIngressManifest,
  buildAppServiceManifest,
  buildPodmanDeploymentManifest,
  buildPodmanServiceManifest,
  buildShellDeploymentManifest,
  buildShellSshServiceManifest,
} from './pod-manifests.js';
import {
  DEFAULT_USER_POD_CONFIG,
  getAppIngressName,
  getAppServiceName,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  getShellSshServiceName,
  getUserSecretName,
  getWorktreeShortId,
  POD_ANNOTATIONS,
  POD_LABEL_VALUES,
  POD_LABELS,
  type PodmanPodInfo,
  type ShellPodInfo,
  type UserPodConfig,
} from './types.js';

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
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private networkingApi: k8s.NetworkingV1Api;
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

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
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
   * Ensure shell deployment exists for user + worktree
   * Creates Podman deployment first if needed (shared for worktree)
   * Returns the actual pod name (not deployment name) for exec
   *
   * @param worktreeName - Worktree name (used as pod hostname)
   * @param userUid - Unix UID for consistent file ownership on EFS/NFS
   * @param unixUsername - Unix username for /etc/passwd entry
   * @param apiKeys - User's API keys (ANTHROPIC_API_KEY, etc.) to inject as Secret
   */
  async ensureShellPod(
    worktreeId: WorktreeID,
    worktreeName: string,
    userId: UserID,
    worktreePath: string,
    userUid?: number,
    unixUsername?: string,
    apiKeys?: Record<string, string>
  ): Promise<string> {
    const deploymentName = getShellPodName(worktreeId, userId);

    // Ensure Podman deployment exists first (shared for worktree)
    await this.ensurePodmanPod(worktreeId, worktreePath);

    // Create/update user secret with API keys (if provided)
    if (apiKeys && Object.keys(apiKeys).length > 0) {
      await this.ensureUserSecret(userId, apiKeys);
    }

    try {
      const { body: deployment } = await this.appsApi.readNamespacedDeployment(
        deploymentName,
        this.config.namespace
      );

      if (deployment.status?.readyReplicas === 1) {
        // Update last activity on the deployment
        await this.updateDeploymentActivity(deploymentName);
        // Return actual pod name for exec
        const podName = await this.getPodNameFromDeployment(deploymentName);
        if (!podName) {
          throw new PodManagerError(`No running pod found for deployment ${deploymentName}`);
        }
        return podName;
      }

      // Deployment exists but not ready, wait for it
      await this.waitForDeployment(deploymentName);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode === 404) {
        // Create shell deployment
        await this.createShellDeployment(worktreeId, worktreeName, userId, worktreePath, userUid, unixUsername);
        await this.waitForDeployment(deploymentName);
      } else {
        throw new PodManagerError(
          `Failed to get shell deployment: ${error instanceof Error ? error.message : String(error)}`,
          e.statusCode,
          deploymentName
        );
      }
    }

    // Get actual pod name for exec
    const podName = await this.getPodNameFromDeployment(deploymentName);
    if (!podName) {
      throw new PodManagerError(`No running pod found for deployment ${deploymentName}`);
    }
    return podName;
  }

  /**
   * Ensure Podman deployment exists for worktree (shared by all users)
   */
  async ensurePodmanPod(worktreeId: WorktreeID, worktreePath: string): Promise<string> {
    const deploymentName = getPodmanPodName(worktreeId);

    try {
      const { body: deployment } = await this.appsApi.readNamespacedDeployment(
        deploymentName,
        this.config.namespace
      );

      if (deployment.status?.readyReplicas === 1) {
        return deploymentName;
      }

      // Deployment exists but not ready, wait for it
      await this.waitForDeployment(deploymentName);
      return deploymentName;
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode === 404) {
        // Create Podman deployment and service
        await this.createPodmanDeployment(worktreeId, worktreePath);
        await this.createPodmanService(worktreeId);
        await this.waitForDeployment(deploymentName);
        return deploymentName;
      }
      throw new PodManagerError(
        `Failed to get Podman deployment: ${error instanceof Error ? error.message : String(error)}`,
        e.statusCode,
        deploymentName
      );
    }
  }

  /**
   * Create shell deployment
   */
  private async createShellDeployment(
    worktreeId: WorktreeID,
    worktreeName: string,
    userId: UserID,
    worktreePath: string,
    userUid?: number,
    unixUsername?: string
  ): Promise<void> {
    const manifest = buildShellDeploymentManifest({
      worktreeId,
      worktreeName,
      userId,
      worktreePath,
      config: this.config,
      userUid,
      unixUsername,
    });

    console.log(
      `[PodManager] Creating shell deployment: ${manifest.metadata?.name} (UID: ${userUid ?? 'default'})`
    );

    try {
      await this.appsApi.createNamespacedDeployment(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      throw new PodManagerError(
        `Failed to create shell deployment: ${e.body?.message || String(error)}`,
        e.statusCode,
        manifest.metadata?.name
      );
    }

    // Create SSH service for the shell pod
    await this.createShellSshService(worktreeId, userId);
  }

  /**
   * Create SSH service for shell pod (NodePort to expose SSH)
   */
  private async createShellSshService(worktreeId: WorktreeID, userId: UserID): Promise<void> {
    const manifest = buildShellSshServiceManifest(worktreeId, userId, this.config);
    const serviceName = manifest.metadata?.name;

    console.log(`[PodManager] Creating shell SSH service: ${serviceName}`);

    try {
      await this.coreApi.createNamespacedService(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      // Ignore if service already exists
      if (e.statusCode !== 409) {
        throw new PodManagerError(
          `Failed to create shell SSH service: ${e.body?.message || String(error)}`,
          e.statusCode
        );
      }
    }
  }

  /**
   * Create or update user secret with API keys
   * Secret is referenced by shell pods via envFrom
   */
  private async ensureUserSecret(userId: UserID, apiKeys: Record<string, string>): Promise<void> {
    const secretName = getUserSecretName(userId);

    // Convert string values to base64 for Kubernetes Secret
    const secretData: Record<string, string> = {};
    for (const [key, value] of Object.entries(apiKeys)) {
      secretData[key] = Buffer.from(value).toString('base64');
    }

    const manifest = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace: this.config.namespace,
        labels: {
          'app.kubernetes.io/name': 'agor-user-secret',
          'agor.io/user-id': userId,
        },
      },
      type: 'Opaque',
      data: secretData,
    };

    console.log(`[PodManager] Ensuring user secret: ${secretName} (${Object.keys(apiKeys).length} keys)`);

    try {
      // Try to create first
      await this.coreApi.createNamespacedSecret(this.config.namespace, manifest);
      console.log(`[PodManager] Created user secret: ${secretName}`);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      if (e.statusCode === 409) {
        // Already exists, update it
        await this.coreApi.replaceNamespacedSecret(secretName, this.config.namespace, manifest);
        console.log(`[PodManager] Updated user secret: ${secretName}`);
      } else {
        throw new PodManagerError(
          `Failed to create user secret: ${e.body?.message || String(error)}`,
          e.statusCode
        );
      }
    }
  }

  /**
   * Create Podman deployment
   */
  private async createPodmanDeployment(worktreeId: WorktreeID, worktreePath: string): Promise<void> {
    const manifest = buildPodmanDeploymentManifest({
      worktreeId,
      worktreePath,
      config: this.config,
    });

    console.log(`[PodManager] Creating Podman deployment: ${manifest.metadata?.name}`);

    try {
      await this.appsApi.createNamespacedDeployment(this.config.namespace, manifest);
    } catch (error: unknown) {
      const e = error as { statusCode?: number; body?: { message?: string } };
      throw new PodManagerError(
        `Failed to create Podman deployment: ${e.body?.message || String(error)}`,
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
      await this.coreApi.createNamespacedService(this.config.namespace, manifest);
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
   * Delete shell deployment and SSH service
   */
  async deleteShellPod(worktreeId: WorktreeID, userId: UserID): Promise<void> {
    const deploymentName = getShellPodName(worktreeId, userId);
    const sshServiceName = getShellSshServiceName(worktreeId, userId);

    console.log(`[PodManager] Deleting shell deployment and SSH service: ${deploymentName}`);

    try {
      await this.appsApi.deleteNamespacedDeployment(deploymentName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      // Ignore if already deleted
      if (e.statusCode !== 404) {
        throw new PodManagerError(
          `Failed to delete shell deployment: ${error instanceof Error ? error.message : String(error)}`,
          e.statusCode,
          deploymentName
        );
      }
    }

    // Delete SSH service
    try {
      await this.coreApi.deleteNamespacedService(sshServiceName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete shell SSH service ${sshServiceName}:`, error);
      }
    }
  }

  /**
   * Delete Podman deployment and service
   */
  async deletePodmanPod(worktreeId: WorktreeID): Promise<void> {
    const deploymentName = getPodmanPodName(worktreeId);
    const serviceName = getPodmanServiceName(worktreeId);

    console.log(`[PodManager] Deleting Podman deployment and service: ${deploymentName}`);

    try {
      await this.appsApi.deleteNamespacedDeployment(deploymentName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete Podman deployment ${deploymentName}:`, error);
      }
    }

    try {
      await this.coreApi.deleteNamespacedService(serviceName, this.config.namespace);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete Podman service ${serviceName}:`, error);
      }
    }
  }

  /**
   * Create an Ingress to expose a worktree's app port via subdomain
   * Creates a Service pointing to the podman pod's app port, then an Ingress for it
   *
   * @param worktreeId - Worktree ID
   * @param worktreeName - Worktree name (used for subdomain)
   * @param port - Port to expose (e.g., 8000)
   * @param baseDomain - Base domain (e.g., "agor.local") - subdomain will be {worktreeName}.{baseDomain}
   */
  async createWorktreeIngress(
    worktreeId: WorktreeID,
    worktreeName: string,
    port: number,
    baseDomain?: string
  ): Promise<string> {
    const appServiceName = getAppServiceName(worktreeId);
    const ingressName = getAppIngressName(worktreeId);
    const domain = baseDomain || this.config.appBaseDomain || 'agor.local';
    const hostname = `${worktreeName}.${domain}`;

    console.log(`[PodManager] Creating Ingress for ${worktreeName} on port ${port} -> ${hostname}`);

    // Build manifests using YAML templates
    const serviceManifest = buildAppServiceManifest(worktreeId, port, this.config);
    const ingressManifest = buildAppIngressManifest(worktreeId, worktreeName, port, this.config, baseDomain);

    try {
      // Create or update Service
      try {
        await this.coreApi.createNamespacedService(this.config.namespace, serviceManifest);
        console.log(`[PodManager] Created app Service: ${appServiceName}`);
      } catch (error: unknown) {
        const e = error as { statusCode?: number };
        if (e.statusCode === 409) {
          // Already exists, update it
          await this.coreApi.replaceNamespacedService(appServiceName, this.config.namespace, serviceManifest);
          console.log(`[PodManager] Updated app Service: ${appServiceName}`);
        } else {
          throw error;
        }
      }

      // Create or update Ingress
      try {
        await this.networkingApi.createNamespacedIngress(this.config.namespace, ingressManifest);
        console.log(`[PodManager] Created Ingress: ${ingressName} -> ${hostname}`);
      } catch (error: unknown) {
        const e = error as { statusCode?: number };
        if (e.statusCode === 409) {
          // Already exists, update it
          await this.networkingApi.replaceNamespacedIngress(ingressName, this.config.namespace, ingressManifest);
          console.log(`[PodManager] Updated Ingress: ${ingressName} -> ${hostname}`);
        } else {
          throw error;
        }
      }

      return `http://${hostname}`;
    } catch (error) {
      console.error(`[PodManager] Failed to create Ingress for ${worktreeName}:`, error);
      throw new PodManagerError(
        `Failed to create Ingress: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        ingressName
      );
    }
  }

  /**
   * Delete the Ingress and app Service for a worktree
   */
  async deleteWorktreeIngress(worktreeId: WorktreeID): Promise<void> {
    const shortId = getWorktreeShortId(worktreeId);
    const appServiceName = getAppServiceName(worktreeId);
    const ingressName = getAppIngressName(worktreeId);

    console.log(`[PodManager] Deleting Ingress and app Service for worktree ${shortId}`);

    try {
      await this.networkingApi.deleteNamespacedIngress(ingressName, this.config.namespace);
      console.log(`[PodManager] Deleted Ingress: ${ingressName}`);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete Ingress ${ingressName}:`, error);
      }
    }

    try {
      await this.coreApi.deleteNamespacedService(appServiceName, this.config.namespace);
      console.log(`[PodManager] Deleted app Service: ${appServiceName}`);
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode !== 404) {
        console.error(`Failed to delete app Service ${appServiceName}:`, error);
      }
    }
  }

  /**
   * Update last activity annotation on deployment (internal)
   */
  private async updateDeploymentActivity(deploymentName: string): Promise<void> {
    try {
      // Update deployment metadata annotations (NOT pod template) to avoid triggering rolling updates
      await this.appsApi.patchNamespacedDeployment(
        deploymentName,
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
        { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
      );
    } catch (error) {
      // Non-critical, just log
      console.warn(`Failed to update last activity for deployment ${deploymentName}:`, error);
    }
  }

  /**
   * Update last activity timestamp for a deployment
   * Called when terminal activity occurs
   * @param podName - The actual pod name (will extract deployment name from it)
   */
  async updateLastActivity(podName: string): Promise<void> {
    // Pod name format: wt-{worktree}-shell-{user}-{replicaset}-{random}
    // Deployment name: wt-{worktree}-shell-{user}
    // Remove the last two hyphen-separated parts to get deployment name
    const parts = podName.split('-');
    if (parts.length >= 6) {
      // Remove replicaset hash and pod random suffix
      const deploymentName = parts.slice(0, -2).join('-');
      await this.updateDeploymentActivity(deploymentName);
    } else {
      // Fallback: try as-is (might be deployment name already)
      await this.updateDeploymentActivity(podName);
    }
  }

  /**
   * Wait for deployment to have ready replicas
   */
  private async waitForDeployment(deploymentName: string, timeoutMs = 120000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const { body: deployment } = await this.appsApi.readNamespacedDeployment(
          deploymentName,
          this.config.namespace
        );

        if (deployment.status?.readyReplicas === 1) {
          return;
        }

        // Check for failure conditions
        const conditions = deployment.status?.conditions || [];
        const failedCondition = conditions.find(
          (c) => c.type === 'ReplicaFailure' && c.status === 'True'
        );
        if (failedCondition) {
          throw new PodManagerError(
            `Deployment ${deploymentName} failed: ${failedCondition.message}`,
            undefined,
            deploymentName
          );
        }
      } catch (error: unknown) {
        if (error instanceof PodManagerError) throw error;
        const e = error as { statusCode?: number };
        if (e.statusCode !== 404) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new PodManagerError(
      `Timeout waiting for deployment ${deploymentName} to be ready`,
      undefined,
      deploymentName
    );
  }

  /**
   * Get pod name from deployment (finds the running pod created by the deployment)
   */
  private async getPodNameFromDeployment(deploymentName: string): Promise<string | null> {
    try {
      const { body } = await this.coreApi.listNamespacedPod(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `app.kubernetes.io/name in (${POD_LABEL_VALUES.SHELL_POD},${POD_LABEL_VALUES.PODMAN_POD})`
      );

      // Find pod whose name starts with the deployment name
      const pod = body.items.find(
        (p) => p.metadata?.name?.startsWith(deploymentName) && p.status?.phase === 'Running'
      );

      return pod?.metadata?.name || null;
    } catch {
      return null;
    }
  }

  /**
   * List all shell pods (returns pod info from deployments' pods)
   */
  async listShellPods(): Promise<ShellPodInfo[]> {
    const { body } = await this.coreApi.listNamespacedPod(
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
   * List all Podman pods (returns pod info from deployments' pods)
   */
  async listPodmanPods(): Promise<PodmanPodInfo[]> {
    const { body } = await this.coreApi.listNamespacedPod(
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
   * Get SSH connection info for a shell pod
   * Returns the NodePort for SSH connection
   */
  async getShellSshInfo(
    worktreeId: WorktreeID,
    userId: UserID
  ): Promise<{ serviceName: string; nodePort: number | null } | null> {
    const serviceName = getShellSshServiceName(worktreeId, userId);

    try {
      const { body: service } = await this.coreApi.readNamespacedService(
        serviceName,
        this.config.namespace
      );

      // Find the SSH port's NodePort
      const sshPort = service.spec?.ports?.find((p) => p.name === 'ssh' || p.port === 22);
      const nodePort = sshPort?.nodePort ?? null;

      return { serviceName, nodePort };
    } catch (error: unknown) {
      const e = error as { statusCode?: number };
      if (e.statusCode === 404) {
        return null;
      }
      throw new PodManagerError(
        `Failed to get SSH service info: ${error instanceof Error ? error.message : String(error)}`,
        e.statusCode,
        serviceName
      );
    }
  }

  /**
   * Garbage collect idle shell deployments
   */
  async gcIdleShellPods(): Promise<number> {
    const pods = await this.listShellPods();
    const now = Date.now();
    const timeoutMs = this.config.idleTimeoutMinutes.shell * 60 * 1000;
    let deleted = 0;

    // Track which deployments we've already deleted (pods may have same labels)
    const deletedDeployments = new Set<string>();

    for (const pod of pods) {
      if (pod.lastActivity && pod.worktreeId && pod.userId) {
        const idleMs = now - new Date(pod.lastActivity).getTime();
        if (idleMs > timeoutMs) {
          const deploymentName = getShellPodName(pod.worktreeId, pod.userId);
          if (deletedDeployments.has(deploymentName)) continue;

          console.log(
            `[PodManager] GC: Deleting idle shell deployment ${deploymentName} (idle ${Math.round(idleMs / 60000)}min)`
          );
          try {
            await this.deleteShellPod(pod.worktreeId, pod.userId);
            deletedDeployments.add(deploymentName);
            deleted++;
          } catch (error) {
            console.error(`Failed to delete shell deployment ${deploymentName}:`, error);
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
          // Also delete associated ingress and app service
          await this.deleteWorktreeIngress(pod.worktreeId);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Garbage collect orphaned Deployments (no corresponding pods)
   * This catches deployments where pods failed to schedule or crashed
   */
  async gcOrphanedDeployments(): Promise<number> {
    const gracePeriodMs = 10 * 60 * 1000; // 10 minute grace period for pods to start
    const now = Date.now();
    let deleted = 0;

    try {
      // List all agor shell deployments
      const { body: shellDeployments } = await this.appsApi.listNamespacedDeployment(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `${POD_LABELS.APP_NAME}=${POD_LABEL_VALUES.SHELL_POD}`
      );

      // List all agor podman deployments
      const { body: podmanDeployments } = await this.appsApi.listNamespacedDeployment(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `${POD_LABELS.APP_NAME}=${POD_LABEL_VALUES.PODMAN_POD}`
      );

      // Get all running pods to check which deployments have pods
      const { body: pods } = await this.coreApi.listNamespacedPod(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `${POD_LABELS.APP_NAME} in (${POD_LABEL_VALUES.SHELL_POD},${POD_LABEL_VALUES.PODMAN_POD})`
      );

      // Build set of deployment names that have running/pending pods
      const deploymentsWithPods = new Set<string>();
      for (const pod of pods.items) {
        const podName = pod.metadata?.name || '';
        // Extract deployment name from pod name (remove -<replicaset>-<random> suffix)
        const parts = podName.split('-');
        if (parts.length >= 3) {
          const deploymentName = parts.slice(0, -2).join('-');
          deploymentsWithPods.add(deploymentName);
        }
      }

      // GC shell deployments without pods
      for (const deployment of shellDeployments.items) {
        const name = deployment.metadata?.name || '';
        if (deploymentsWithPods.has(name)) continue;

        // Check grace period
        const createdAt = deployment.metadata?.annotations?.[POD_ANNOTATIONS.CREATED_AT];
        if (createdAt) {
          const age = now - new Date(createdAt).getTime();
          if (age < gracePeriodMs) continue;
        }

        console.log(`[PodManager] GC: Deleting orphaned shell deployment ${name} (no pods)`);
        try {
          await this.appsApi.deleteNamespacedDeployment(name, this.config.namespace);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete orphaned shell deployment ${name}:`, error);
        }
      }

      // GC podman deployments without pods
      for (const deployment of podmanDeployments.items) {
        const name = deployment.metadata?.name || '';
        if (deploymentsWithPods.has(name)) continue;

        // Check grace period
        const createdAt = deployment.metadata?.annotations?.[POD_ANNOTATIONS.CREATED_AT];
        if (createdAt) {
          const age = now - new Date(createdAt).getTime();
          if (age < gracePeriodMs) continue;
        }

        const worktreeId = deployment.metadata?.labels?.[POD_LABELS.WORKTREE_ID] as WorktreeID;
        console.log(`[PodManager] GC: Deleting orphaned podman deployment ${name} (no pods)`);
        try {
          await this.appsApi.deleteNamespacedDeployment(name, this.config.namespace);
          // Also clean up associated service
          const serviceName = getPodmanServiceName(worktreeId);
          await this.coreApi.deleteNamespacedService(serviceName, this.config.namespace).catch(() => {});
          deleted++;
        } catch (error) {
          console.error(`Failed to delete orphaned podman deployment ${name}:`, error);
        }
      }
    } catch (error) {
      console.error('[PodManager] GC orphaned deployments error:', error);
    }

    return deleted;
  }

  /**
   * Garbage collect orphaned Services (no corresponding deployment/pods)
   */
  async gcOrphanedServices(): Promise<number> {
    const gracePeriodMs = 10 * 60 * 1000; // 10 minute grace period
    let deleted = 0;

    try {
      // List all services with worktree-id label (our services)
      const { body: services } = await this.coreApi.listNamespacedService(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        POD_LABELS.WORKTREE_ID // Any service with this label is ours
      );

      // Get all deployments to check which services have backing deployments
      const { body: deployments } = await this.appsApi.listNamespacedDeployment(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `${POD_LABELS.APP_NAME} in (${POD_LABEL_VALUES.SHELL_POD},${POD_LABEL_VALUES.PODMAN_POD})`
      );

      // Build set of worktree IDs that have active deployments
      const activeWorktreeIds = new Set<string>();
      for (const deployment of deployments.items) {
        const worktreeId = deployment.metadata?.labels?.[POD_LABELS.WORKTREE_ID];
        if (worktreeId) {
          activeWorktreeIds.add(worktreeId);
        }
      }

      for (const service of services.items) {
        const name = service.metadata?.name || '';
        const worktreeId = service.metadata?.labels?.[POD_LABELS.WORKTREE_ID];

        // Skip if there's an active deployment for this worktree
        if (worktreeId && activeWorktreeIds.has(worktreeId)) continue;

        // Check grace period based on creation time
        const creationTimestamp = service.metadata?.creationTimestamp;
        if (creationTimestamp) {
          const age = Date.now() - new Date(creationTimestamp).getTime();
          if (age < gracePeriodMs) continue;
        }

        console.log(`[PodManager] GC: Deleting orphaned service ${name} (no backing deployment)`);
        try {
          await this.coreApi.deleteNamespacedService(name, this.config.namespace);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete orphaned service ${name}:`, error);
        }
      }
    } catch (error) {
      console.error('[PodManager] GC orphaned services error:', error);
    }

    return deleted;
  }

  /**
   * Garbage collect orphaned Ingresses (no corresponding service/deployment)
   */
  async gcOrphanedIngresses(): Promise<number> {
    const gracePeriodMs = 10 * 60 * 1000; // 10 minute grace period
    let deleted = 0;

    try {
      // List all ingresses with worktree-id label (our ingresses)
      const { body: ingresses } = await this.networkingApi.listNamespacedIngress(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        POD_LABELS.WORKTREE_ID // Any ingress with this label is ours
      );

      // Get all services to check which ingresses have backing services
      const { body: services } = await this.coreApi.listNamespacedService(
        this.config.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        POD_LABELS.WORKTREE_ID
      );

      // Build set of service names
      const activeServiceNames = new Set<string>();
      for (const service of services.items) {
        if (service.metadata?.name) {
          activeServiceNames.add(service.metadata.name);
        }
      }

      for (const ingress of ingresses.items) {
        const name = ingress.metadata?.name || '';

        // Get the backend service name from ingress rules
        const backendServiceName = ingress.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name;

        // Skip if there's an active service for this ingress
        if (backendServiceName && activeServiceNames.has(backendServiceName)) continue;

        // Check grace period based on creation time
        const creationTimestamp = ingress.metadata?.creationTimestamp;
        if (creationTimestamp) {
          const age = Date.now() - new Date(creationTimestamp).getTime();
          if (age < gracePeriodMs) continue;
        }

        console.log(`[PodManager] GC: Deleting orphaned ingress ${name} (no backing service)`);
        try {
          await this.networkingApi.deleteNamespacedIngress(name, this.config.namespace);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete orphaned ingress ${name}:`, error);
        }
      }
    } catch (error) {
      console.error('[PodManager] GC orphaned ingresses error:', error);
    }

    return deleted;
  }

  /**
   * Run garbage collection for all resource types
   */
  async runGC(): Promise<{
    shellPodsDeleted: number;
    podmanPodsDeleted: number;
    orphanedDeploymentsDeleted: number;
    orphanedServicesDeleted: number;
    orphanedIngressesDeleted: number;
  }> {
    // First, GC idle pods (this also cleans up their deployments)
    const shellPodsDeleted = await this.gcIdleShellPods();
    const podmanPodsDeleted = await this.gcOrphanedPodmanPods();

    // Then, GC orphaned resources (deployments without pods, services without deployments, etc.)
    const orphanedDeploymentsDeleted = await this.gcOrphanedDeployments();
    const orphanedServicesDeleted = await this.gcOrphanedServices();
    const orphanedIngressesDeleted = await this.gcOrphanedIngresses();

    const totalDeleted =
      shellPodsDeleted +
      podmanPodsDeleted +
      orphanedDeploymentsDeleted +
      orphanedServicesDeleted +
      orphanedIngressesDeleted;

    if (totalDeleted > 0) {
      console.log(
        `[PodManager] GC complete: ${shellPodsDeleted} shell pods, ${podmanPodsDeleted} Podman pods, ` +
          `${orphanedDeploymentsDeleted} orphaned deployments, ${orphanedServicesDeleted} orphaned services, ` +
          `${orphanedIngressesDeleted} orphaned ingresses deleted`
      );
    }

    return {
      shellPodsDeleted,
      podmanPodsDeleted,
      orphanedDeploymentsDeleted,
      orphanedServicesDeleted,
      orphanedIngressesDeleted,
    };
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

  /**
   * Execute a command in the Podman pod for a worktree
   * Returns stdout/stderr and exit code
   */
  async execInPodmanPod(
    worktreeId: WorktreeID,
    command: string[],
    cwd?: string,
    env?: Record<string, string>
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const deploymentName = getPodmanPodName(worktreeId);

    // Find the actual pod created by the deployment
    const podName = await this.getPodNameFromDeployment(deploymentName);
    if (!podName) {
      throw new PodManagerError(
        `No running pod found for Podman deployment ${deploymentName}`,
        undefined,
        deploymentName
      );
    }

    // Build the full command with cd and env if needed
    let fullCommand = command;
    if (cwd || env) {
      const envVars = env
        ? Object.entries(env)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(' ')
        : '';
      const cdCmd = cwd ? `cd ${JSON.stringify(cwd)} &&` : '';
      const envCmd = envVars ? `env ${envVars}` : '';
      fullCommand = ['sh', '-c', `${cdCmd} ${envCmd} ${command.join(' ')}`];
    }

    console.log(`[PodManager] Exec in Podman pod ${podName}: ${fullCommand.join(' ')}`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const stdoutStream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write(chunk: Buffer, _encoding: string, callback: () => void) {
          stderr += chunk.toString();
          callback();
        },
      });

      this.exec
        .exec(
          this.config.namespace,
          podName,
          'podman', // container name
          fullCommand,
          stdoutStream,
          stderrStream,
          null, // stdin
          false, // tty
          (status) => {
            const exitCode = status?.status === 'Success' ? 0 : 1;
            console.log(`[PodManager] Exec completed with code ${exitCode}`);
            resolve({ stdout, stderr, exitCode });
          }
        )
        .catch(reject);
    });
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
