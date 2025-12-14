/**
 * Kubernetes Deployment Manifest Builders
 *
 * Functions to build Deployment and Service manifests for isolated terminal pods.
 */

import type { V1Deployment, V1Pod, V1Service } from '@kubernetes/client-node';
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
 * Build shell deployment manifest
 */
export function buildShellDeploymentManifest(params: ShellPodParams): V1Deployment {
  const { worktreeId, userId, worktreePath, config, userUid, unixUsername } = params;
  const deploymentName = getShellPodName(worktreeId, userId);
  const dockerHost = getDockerHost(worktreeId, config.namespace);
  const now = new Date().toISOString();

  // Use user's UID if provided, otherwise fall back to default (1000)
  const runAsUser = userUid ?? 1000;
  const runAsGroup = userUid ?? 1000; // Use same value for group
  const username = unixUsername ?? 'agor';

  const labels = {
    [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.SHELL_POD,
    [POD_LABELS.COMPONENT]: POD_LABEL_VALUES.TERMINAL,
    [POD_LABELS.WORKTREE_ID]: worktreeId,
    [POD_LABELS.USER_ID]: userId,
    [POD_LABELS.UNIX_USERNAME]: username,
    [POD_LABELS.UNIX_UID]: String(runAsUser),
  };

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: deploymentName,
      namespace: config.namespace,
      labels,
      annotations: {
        [POD_ANNOTATIONS.CREATED_AT]: now,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.SHELL_POD,
          [POD_LABELS.WORKTREE_ID]: worktreeId,
          [POD_LABELS.USER_ID]: userId,
        },
      },
      template: {
        metadata: {
          labels,
          annotations: {
            [POD_ANNOTATIONS.CREATED_AT]: now,
            [POD_ANNOTATIONS.LAST_ACTIVITY]: now,
          },
        },
        spec: {
          serviceAccountName: SERVICE_ACCOUNTS.SHELL_POD,
          // fsGroup for volume permissions, but don't set runAsUser at pod level
          // so init container can run as root
          securityContext: {
            fsGroup: runAsGroup,
          },
          initContainers: [
            {
              name: 'init-user',
              image: 'busybox:1.36',
              // Run as root to create passwd/group files and home directory
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
echo "${username}:x:${runAsUser}:${runAsGroup}:${username}:/home/${username}:/bin/bash" >> /etc-override/passwd

# Create group with root and our group
cat > /etc-override/group << 'GROUP'
root:x:0:
nobody:x:65534:
GROUP
echo "${username}:x:${runAsGroup}:" >> /etc-override/group

chmod 644 /etc-override/passwd /etc-override/group

# Create persistent home directory in /data/homes/{username}
mkdir -p /data/homes/${username}
mkdir -p /data/homes/${username}/.agor
chown -R ${runAsUser}:${runAsGroup} /data/homes/${username}

# Create symlinks for worktrees/repos in user's .agor
ln -sf /data/worktrees /data/homes/${username}/.agor/worktrees
ln -sf /data/repos /data/homes/${username}/.agor/repos

# Create symlink: /home/{username} -> /data/homes/{username}
mkdir -p /home-override
ln -sf /data/homes/${username} /home-override/${username}

echo "Created user ${username} (UID ${runAsUser}) with home at /data/homes/${username}"`,
              ],
              volumeMounts: [
                { name: 'etc-override', mountPath: '/etc-override' },
                { name: 'home-override', mountPath: '/home-override' },
                { name: 'data', mountPath: '/data' },
              ],
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
                { name: 'HOME', value: `/home/${username}` },
                { name: 'USER', value: username },
                { name: 'LOGNAME', value: username },
              ],
              workingDir: worktreePath,
              volumeMounts: [
                { name: 'data', mountPath: '/data' },
                { name: 'home-override', mountPath: '/home' },
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
              name: 'home-override',
              emptyDir: {},
            },
            {
              name: 'etc-override',
              emptyDir: {},
            },
          ],
        },
      },
    },
  };
}

/**
 * Build Podman deployment manifest
 */
export function buildPodmanDeploymentManifest(params: PodmanPodParams): V1Deployment {
  const { worktreeId, worktreePath, config } = params;
  const deploymentName = getPodmanPodName(worktreeId);
  const now = new Date().toISOString();

  const labels = {
    [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.PODMAN_POD,
    [POD_LABELS.COMPONENT]: POD_LABEL_VALUES.CONTAINER_RUNTIME,
    [POD_LABELS.WORKTREE_ID]: worktreeId,
  };

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: deploymentName,
      namespace: config.namespace,
      labels,
      annotations: {
        [POD_ANNOTATIONS.CREATED_AT]: now,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          [POD_LABELS.APP_NAME]: POD_LABEL_VALUES.PODMAN_POD,
          [POD_LABELS.WORKTREE_ID]: worktreeId,
        },
      },
      template: {
        metadata: {
          labels,
          annotations: {
            [POD_ANNOTATIONS.CREATED_AT]: now,
            [POD_ANNOTATIONS.LAST_ACTIVITY]: now,
          },
        },
        spec: {
          serviceAccountName: SERVICE_ACCOUNTS.PODMAN_POD,
          initContainers: [
            {
              name: 'init-paths',
              image: 'busybox:1.36',
              command: ['sh', '-c'],
              args: [
                `set -e
# Generate machine-id (32 hex chars)
cat /proc/sys/kernel/random/uuid | tr -d "-" > /etc-override/machine-id
chmod 444 /etc-override/machine-id

# Create symlinks to match daemon paths
mkdir -p /home/agor/.agor
ln -sf /data/worktrees /home/agor/.agor/worktrees
ln -sf /data/repos /home/agor/.agor/repos
echo "Init complete"`,
              ],
              volumeMounts: [
                { name: 'etc-override', mountPath: '/etc-override' },
                { name: 'data', mountPath: '/data' },
                { name: 'home', mountPath: '/home' },
              ],
            },
          ],
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
                { name: 'home', mountPath: '/home' },
                { name: 'podman-storage', mountPath: '/var/lib/containers' },
                { name: 'etc-override', mountPath: '/etc/machine-id', subPath: 'machine-id' },
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
              name: 'home',
              emptyDir: {},
            },
            {
              name: 'podman-storage',
              emptyDir: {},
            },
            {
              name: 'etc-override',
              emptyDir: {},
            },
          ],
        },
      },
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

// ============================================
// Legacy Pod manifests (kept for compatibility)
// ============================================

/**
 * Build shell pod manifest (legacy - use buildShellDeploymentManifest instead)
 * @deprecated Use buildShellDeploymentManifest for better lifecycle management
 */
export function buildShellPodManifest(params: ShellPodParams): V1Pod {
  const { worktreeId, userId, worktreePath, config, userUid, unixUsername } = params;
  const podName = getShellPodName(worktreeId, userId);
  const dockerHost = getDockerHost(worktreeId, config.namespace);
  const now = new Date().toISOString();

  const runAsUser = userUid ?? 1000;
  const runAsGroup = userUid ?? 1000;
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
      securityContext: {
        fsGroup: runAsGroup,
      },
      initContainers: [
        {
          name: 'init-user',
          image: 'busybox:1.36',
          securityContext: {
            runAsUser: 0,
            runAsGroup: 0,
          },
          command: ['sh', '-c'],
          args: [
            `set -e
cat > /etc-override/passwd << 'PASSWD'
root:x:0:0:root:/root:/bin/sh
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
PASSWD
echo "${username}:x:${runAsUser}:${runAsGroup}:${username}:/home/agor:/bin/bash" >> /etc-override/passwd
cat > /etc-override/group << 'GROUP'
root:x:0:
nobody:x:65534:
GROUP
echo "${username}:x:${runAsGroup}:" >> /etc-override/group
chmod 644 /etc-override/passwd /etc-override/group`,
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
 * Build Podman pod manifest (legacy - use buildPodmanDeploymentManifest instead)
 * @deprecated Use buildPodmanDeploymentManifest for better lifecycle management
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
            privileged: true,
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
