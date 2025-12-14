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
  buildPodmanDeploymentManifest,
  buildPodmanServiceManifest,
  buildShellDeploymentManifest,
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
    const deploymentName = getShellPodName(worktreeId, userId);

    // Ensure Podman deployment exists first (shared for worktree)
    await this.ensurePodmanPod(worktreeId, worktreePath);

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
        await this.createShellDeployment(worktreeId, userId, worktreePath, userUid, unixUsername);
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
    userId: UserID,
    worktreePath: string,
    userUid?: number,
    unixUsername?: string
  ): Promise<void> {
    const manifest = buildShellDeploymentManifest({
      worktreeId,
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
   * Delete shell deployment
   */
  async deleteShellPod(worktreeId: WorktreeID, userId: UserID): Promise<void> {
    const deploymentName = getShellPodName(worktreeId, userId);

    console.log(`[PodManager] Deleting shell deployment: ${deploymentName}`);

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
    baseDomain: string = 'agor.local'
  ): Promise<string> {
    const shortId = worktreeId.substring(0, 8);
    const appServiceName = `app-${shortId}`;
    const ingressName = `app-${shortId}`;
    const hostname = `${worktreeName}.${baseDomain}`;

    console.log(`[PodManager] Creating Ingress for ${worktreeName} on port ${port} -> ${hostname}`);

    // Get the podman pod selector to target
    const podmanDeploymentName = getPodmanPodName(worktreeId);

    // Create Service for the app port (targets podman pod)
    const serviceManifest: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: appServiceName,
        namespace: this.config.namespace,
        labels: {
          [POD_LABELS.COMPONENT]: 'worktree-app',
          [POD_LABELS.WORKTREE_ID]: worktreeId,
        },
      },
      spec: {
        selector: {
          // Use APP_NAME (not COMPONENT) - podman pods have app.kubernetes.io/name=agor-podman-pod
          [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.PODMAN_POD,
          [POD_LABELS.WORKTREE_ID]: worktreeId,
        },
        ports: [
          {
            name: 'http',
            port: port,
            targetPort: port,
            protocol: 'TCP',
          },
        ],
      },
    };

    // Create Ingress with Traefik
    const ingressManifest: k8s.V1Ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: ingressName,
        namespace: this.config.namespace,
        labels: {
          [POD_LABELS.COMPONENT]: 'worktree-app',
          [POD_LABELS.WORKTREE_ID]: worktreeId,
        },
        annotations: {
          'traefik.ingress.kubernetes.io/router.entrypoints': 'web',
        },
      },
      spec: {
        ingressClassName: 'traefik',
        rules: [
          {
            host: hostname,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: appServiceName,
                      port: {
                        number: port,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };

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
    const shortId = worktreeId.substring(0, 8);
    const appServiceName = `app-${shortId}`;
    const ingressName = `app-${shortId}`;

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
    // Pod name format: agor-shell-{worktree}-{user}-{replicaset}-{random}
    // Deployment name: agor-shell-{worktree}-{user}
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
