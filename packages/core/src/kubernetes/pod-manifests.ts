/**
 * Kubernetes Deployment Manifest Builders
 *
 * Functions to build Deployment and Service manifests for isolated terminal pods.
 * Uses YAML templates from the templates directory for maintainability.
 */

import type { V1Deployment, V1Ingress, V1Service } from '@kubernetes/client-node';
import type { UserID, WorktreeID } from '../types/id.js';
import {
  loadAppIngress,
  loadAppService,
  loadPodmanDeployment,
  loadPodmanService,
  loadShellDeployment,
  loadShellSshService,
} from './template-loader.js';
import {
  getAppIngressName,
  getAppServiceName,
  getDockerHost,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  getShellSshServiceName,
  getUserSecretName,
  type UserPodConfig,
} from './types.js';

export interface ShellPodParams {
  worktreeId: WorktreeID;
  worktreeName: string;
  userId: UserID;
  worktreePath: string;
  config: UserPodConfig;
  /** Unix UID for consistent file ownership on EFS/NFS */
  userUid?: number;
  /** Unix username for /etc/passwd entry */
  unixUsername?: string;
}

export interface PodmanPodParams {
  worktreeId: WorktreeID;
  worktreePath: string;
  config: UserPodConfig;
}

/**
 * Build shell deployment manifest using YAML template
 */
export function buildShellDeploymentManifest(params: ShellPodParams): V1Deployment {
  const { worktreeId, worktreeName, userId, worktreePath, config, userUid, unixUsername } = params;

  const runAsUser = userUid ?? 1000;
  const runAsGroup = userUid ?? 1000;
  const username = unixUsername ?? 'agor';
  const now = new Date().toISOString();

  const sshdResources = config.shellPod.sshdResources ?? {
    requests: { cpu: '10m', memory: '32Mi' },
    limits: { cpu: '100m', memory: '64Mi' },
  };

  return loadShellDeployment({
    name: getShellPodName(worktreeId, userId),
    namespace: config.namespace,
    worktreeId,
    worktreeName,
    userId,
    username,
    runAsUser,
    runAsGroup,
    worktreePath,
    dockerHost: getDockerHost(worktreeId, config.namespace),
    shellImage: config.shellPod.image,
    dataPvc: config.storage.dataPvc,
    requestsCpu: config.shellPod.resources.requests.cpu,
    requestsMemory: config.shellPod.resources.requests.memory,
    limitsCpu: config.shellPod.resources.limits.cpu,
    limitsMemory: config.shellPod.resources.limits.memory,
    sshdRequestsCpu: sshdResources.requests.cpu,
    sshdRequestsMemory: sshdResources.requests.memory,
    sshdLimitsCpu: sshdResources.limits.cpu,
    sshdLimitsMemory: sshdResources.limits.memory,
    createdAt: now,
    userSecretName: getUserSecretName(userId),
  });
}

/**
 * Build Podman deployment manifest using YAML template
 */
export function buildPodmanDeploymentManifest(params: PodmanPodParams): V1Deployment {
  const { worktreeId, worktreePath, config } = params;
  const now = new Date().toISOString();

  return loadPodmanDeployment({
    name: getPodmanPodName(worktreeId),
    namespace: config.namespace,
    worktreeId,
    worktreePath,
    podmanImage: config.podmanPod.image,
    initImage: config.podmanPod.initImage ?? 'busybox:1.36',
    dataPvc: config.storage.dataPvc,
    requestsCpu: config.podmanPod.resources.requests.cpu,
    requestsMemory: config.podmanPod.resources.requests.memory,
    limitsCpu: config.podmanPod.resources.limits.cpu,
    limitsMemory: config.podmanPod.resources.limits.memory,
    createdAt: now,
  });
}

/**
 * Build Podman service manifest using YAML template
 */
export function buildPodmanServiceManifest(
  worktreeId: WorktreeID,
  config: UserPodConfig
): V1Service {
  return loadPodmanService({
    name: getPodmanServiceName(worktreeId),
    namespace: config.namespace,
    worktreeId,
  });
}

/**
 * Build app service manifest using YAML template
 */
export function buildAppServiceManifest(
  worktreeId: WorktreeID,
  port: number,
  config: UserPodConfig
): V1Service {
  return loadAppService({
    name: getAppServiceName(worktreeId),
    namespace: config.namespace,
    worktreeId,
    port,
  });
}

/**
 * Build app ingress manifest using YAML template
 */
export function buildAppIngressManifest(
  worktreeId: WorktreeID,
  worktreeName: string,
  port: number,
  config: UserPodConfig,
  baseDomain?: string
): V1Ingress {
  const domain = baseDomain || config.appBaseDomain || 'agor.local';
  const hostname = `${worktreeName}.${domain}`;

  return loadAppIngress({
    name: getAppIngressName(worktreeId),
    namespace: config.namespace,
    worktreeId,
    hostname,
    serviceName: getAppServiceName(worktreeId),
    port,
    ingressClassName: config.ingressClassName || 'traefik',
  });
}

/**
 * Build shell SSH service manifest using YAML template
 * This NodePort service exposes SSH port 22 for shell pods
 */
export function buildShellSshServiceManifest(
  worktreeId: WorktreeID,
  userId: UserID,
  config: UserPodConfig
): V1Service {
  return loadShellSshService({
    name: getShellSshServiceName(worktreeId, userId),
    namespace: config.namespace,
    worktreeId,
    userId,
  });
}
