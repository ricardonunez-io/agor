/**
 * Kubernetes Pod Manifest Builders
 *
 * Functions to build Pod and Service manifests for isolated terminal pods.
 */

import type { V1Pod, V1Service } from '@kubernetes/client-node';
import type { UserID, WorktreeID } from '../types/id.js';
import {
  getDockerHost,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  POD_ANNOTATIONS,
  POD_LABEL_VALUES,
  POD_LABELS,
  SERVICE_ACCOUNTS,
  type UserPodConfig,
} from './types';

export interface ShellPodParams {
  worktreeId: WorktreeID;
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
 * Build shell pod manifest
 */
export function buildShellPodManifest(params: ShellPodParams): V1Pod {
  const { worktreeId, userId, worktreePath, config, userUid, unixUsername } = params;
  const podName = getShellPodName(worktreeId, userId);
  const dockerHost = getDockerHost(worktreeId, config.namespace);
  const now = new Date().toISOString();

  // Use user's UID if provided, otherwise fall back to default (1000)
  const runAsUser = userUid ?? 1000;
  const runAsGroup = userUid ?? 1000; // Use same value for group
  const username = unixUsername ?? 'agor';

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: config.namespace,
      labels: {
        [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.SHELL_POD,
        [POD_LABELS.COMPONENT]: POD_LABEL_VALUES.TERMINAL,
        [POD_LABELS.WORKTREE_ID]: worktreeId,
        [POD_LABELS.USER_ID]: userId,
        [POD_LABELS.UNIX_USERNAME]: username,
        [POD_LABELS.UNIX_UID]: String(runAsUser),
      },
      annotations: {
        [POD_ANNOTATIONS.CREATED_AT]: now,
        [POD_ANNOTATIONS.LAST_ACTIVITY]: now,
      },
    },
    spec: {
      serviceAccountName: SERVICE_ACCOUNTS.SHELL_POD,
      restartPolicy: 'Never',
      // fsGroup for volume permissions, but don't set runAsUser at pod level
      // so init container can run as root
      securityContext: {
        fsGroup: runAsGroup,
      },
      initContainers: [
        {
          name: 'init-user',
          image: 'busybox:1.36',
          // Run as root to create passwd/group files
          securityContext: {
            runAsUser: 0,
            runAsGroup: 0,
          },
          command: ['sh', '-c'],
          args: [
            `set -e
# Create passwd with root and our user
cat > /etc-override/passwd << 'PASSWD'
root:x:0:0:root:/root:/bin/sh
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
PASSWD
echo "${username}:x:${runAsUser}:${runAsGroup}:${username}:/home/agor:/bin/bash" >> /etc-override/passwd

# Create group with root and our group
cat > /etc-override/group << 'GROUP'
root:x:0:
nobody:x:65534:
GROUP
echo "${username}:x:${runAsGroup}:" >> /etc-override/group

chmod 644 /etc-override/passwd /etc-override/group
echo "Created user ${username} with UID ${runAsUser}"
cat /etc-override/passwd`,
          ],
          volumeMounts: [{ name: 'etc-override', mountPath: '/etc-override' }],
        },
      ],
      containers: [
        {
          name: 'shell',
          image: config.shellPod.image,
          command: ['sleep', 'infinity'],
          securityContext: {
            runAsUser,
            runAsGroup,
            runAsNonRoot: true,
          },
          env: [
            { name: 'WORKTREE_PATH', value: worktreePath },
            { name: 'DOCKER_HOST', value: dockerHost },
            { name: 'HOME', value: '/home/agor' },
            { name: 'USER', value: username },
            { name: 'LOGNAME', value: username },
          ],
          workingDir: worktreePath,
          volumeMounts: [
            { name: 'data', mountPath: '/data' },
            { name: 'etc-override', mountPath: '/etc/passwd', subPath: 'passwd' },
            { name: 'etc-override', mountPath: '/etc/group', subPath: 'group' },
          ],
          resources: {
            requests: {
              cpu: config.shellPod.resources.requests.cpu,
              memory: config.shellPod.resources.requests.memory,
            },
            limits: {
              cpu: config.shellPod.resources.limits.cpu,
              memory: config.shellPod.resources.limits.memory,
            },
          },
        },
      ],
      volumes: [
        {
          name: 'data',
          persistentVolumeClaim: { claimName: config.storage.dataPvc },
        },
        {
          name: 'etc-override',
          emptyDir: {},
        },
      ],
    },
  };
}

/**
 * Build Podman pod manifest
 */
export function buildPodmanPodManifest(params: PodmanPodParams): V1Pod {
  const { worktreeId, worktreePath, config } = params;
  const podName = getPodmanPodName(worktreeId);
  const now = new Date().toISOString();

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: config.namespace,
      labels: {
        [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.PODMAN_POD,
        [POD_LABELS.COMPONENT]: POD_LABEL_VALUES.CONTAINER_RUNTIME,
        [POD_LABELS.WORKTREE_ID]: worktreeId,
      },
      annotations: {
        [POD_ANNOTATIONS.CREATED_AT]: now,
        [POD_ANNOTATIONS.LAST_ACTIVITY]: now,
      },
    },
    spec: {
      serviceAccountName: SERVICE_ACCOUNTS.PODMAN_POD,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'podman',
          image: config.podmanPod.image,
          command: ['podman', 'system', 'service', '--time=0', 'tcp://0.0.0.0:2375'],
          securityContext: {
            privileged: true, // Required for nested containers
          },
          ports: [{ containerPort: 2375, name: 'docker-api', protocol: 'TCP' }],
          env: [{ name: 'WORKTREE_PATH', value: worktreePath }],
          workingDir: worktreePath,
          volumeMounts: [
            { name: 'data', mountPath: '/data' },
            { name: 'podman-storage', mountPath: '/var/lib/containers' },
          ],
          resources: {
            requests: {
              cpu: config.podmanPod.resources.requests.cpu,
              memory: config.podmanPod.resources.requests.memory,
            },
            limits: {
              cpu: config.podmanPod.resources.limits.cpu,
              memory: config.podmanPod.resources.limits.memory,
            },
          },
          // Readiness probe to ensure Podman is ready
          readinessProbe: {
            tcpSocket: { port: 2375 },
            initialDelaySeconds: 2,
            periodSeconds: 5,
          },
        },
      ],
      volumes: [
        {
          name: 'data',
          persistentVolumeClaim: { claimName: config.storage.dataPvc },
        },
        {
          name: 'podman-storage',
          emptyDir: {},
        },
      ],
    },
  };
}

/**
 * Build Podman service manifest
 */
export function buildPodmanServiceManifest(
  worktreeId: WorktreeID,
  config: UserPodConfig
): V1Service {
  const serviceName = getPodmanServiceName(worktreeId);

  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: serviceName,
      namespace: config.namespace,
      labels: {
        [POD_LABELS.WORKTREE_ID]: worktreeId,
      },
    },
    spec: {
      selector: {
        [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.PODMAN_POD,
        [POD_LABELS.WORKTREE_ID]: worktreeId,
      },
      ports: [{ port: 2375, targetPort: 2375, name: 'docker-api', protocol: 'TCP' }],
    },
  };
}
