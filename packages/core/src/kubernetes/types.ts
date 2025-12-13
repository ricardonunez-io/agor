/**
 * Kubernetes Integration Types
 *
 * Types for isolated terminal pods feature.
 */

import type { UserID, WorktreeID } from '../types/id.js';

/**
 * Terminal execution mode
 */
export type TerminalMode = 'daemon' | 'pod';

/**
 * Shell pod configuration
 */
export interface ShellPodConfig {
  image: string;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
}

/**
 * Podman pod configuration
 */
export interface PodmanPodConfig {
  image: string;
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
}

/**
 * User pod configuration (from Helm values)
 */
export interface UserPodConfig {
  enabled: boolean;
  namespace: string;
  shellPod: ShellPodConfig;
  podmanPod: PodmanPodConfig;
  idleTimeoutMinutes: {
    shell: number;
    podman: number;
  };
  storage: {
    /** Single PVC for all data (worktrees + repos as subdirectories) */
    dataPvc: string;
  };
}

/**
 * Default user pod configuration
 */
export const DEFAULT_USER_POD_CONFIG: UserPodConfig = {
  enabled: false,
  namespace: 'agor',
  shellPod: {
    image: 'agor/shell:dev',
    resources: {
      requests: { cpu: '50m', memory: '128Mi' },
      limits: { cpu: '1', memory: '1Gi' },
    },
  },
  podmanPod: {
    image: 'quay.io/podman/stable',
    resources: {
      requests: { cpu: '100m', memory: '256Mi' },
      limits: { cpu: '4', memory: '8Gi' },
    },
  },
  idleTimeoutMinutes: {
    shell: 30,
    podman: 60,
  },
  storage: {
    dataPvc: 'agor-data',
  },
};

/**
 * Shell pod metadata
 */
export interface ShellPodInfo {
  podName: string;
  worktreeId: WorktreeID;
  userId: UserID;
  createdAt: string;
  lastActivity: string;
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
}

/**
 * Podman pod metadata
 */
export interface PodmanPodInfo {
  podName: string;
  serviceName: string;
  worktreeId: WorktreeID;
  createdAt: string;
  lastActivity: string;
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
}

/**
 * Pod labels used for querying
 */
export const POD_LABELS = {
  APP_NAME: 'app.kubernetes.io/name',
  COMPONENT: 'app.kubernetes.io/component',
  WORKTREE_ID: 'agor.io/worktree-id',
  USER_ID: 'agor.io/user-id',
  UNIX_USERNAME: 'agor.io/unix-username',
  UNIX_UID: 'agor.io/unix-uid',
} as const;

/**
 * Pod label values
 */
export const POD_LABEL_VALUES = {
  SHELL_POD: 'agor-shell-pod',
  PODMAN_POD: 'agor-podman-pod',
  TERMINAL: 'terminal',
  CONTAINER_RUNTIME: 'container-runtime',
} as const;

/**
 * Pod annotations
 */
export const POD_ANNOTATIONS = {
  CREATED_AT: 'agor.io/created-at',
  LAST_ACTIVITY: 'agor.io/last-activity',
} as const;

/**
 * Service account names
 */
export const SERVICE_ACCOUNTS = {
  SHELL_POD: 'agor-shell-pod',
  PODMAN_POD: 'agor-podman-pod',
} as const;

/**
 * Generate shell pod name
 */
export function getShellPodName(worktreeId: WorktreeID, userId: UserID): string {
  const worktreeShort = worktreeId.slice(0, 8);
  const userShort = userId.slice(0, 8);
  return `agor-shell-${worktreeShort}-${userShort}`;
}

/**
 * Generate podman pod name
 */
export function getPodmanPodName(worktreeId: WorktreeID): string {
  const worktreeShort = worktreeId.slice(0, 8);
  return `agor-podman-${worktreeShort}`;
}

/**
 * Generate podman service name
 */
export function getPodmanServiceName(worktreeId: WorktreeID): string {
  const worktreeShort = worktreeId.slice(0, 8);
  return `podman-${worktreeShort}`;
}

/**
 * Generate DOCKER_HOST value for a worktree
 */
export function getDockerHost(worktreeId: WorktreeID, namespace: string): string {
  const serviceName = getPodmanServiceName(worktreeId);
  return `tcp://${serviceName}.${namespace}.svc:2375`;
}
