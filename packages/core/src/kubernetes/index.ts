/**
 * Kubernetes Integration Module
 *
 * Provides isolated terminal pod management for Kubernetes deployments.
 *
 * @module kubernetes
 */

// Pod manager
export {
  getPodManager,
  PodManager,
  PodManagerError,
  type PodManagerOptions,
  resetPodManager,
} from './pod-manager';

// Deployment manifest builders
export {
  buildPodmanDeploymentManifest,
  buildPodmanServiceManifest,
  buildShellDeploymentManifest,
  type PodmanPodParams,
  type ShellPodParams,
} from './pod-manifests';

// Legacy Pod manifests (deprecated)
export { buildPodmanPodManifest, buildShellPodManifest } from './pod-manifests';
// Types
export {
  DEFAULT_USER_POD_CONFIG,
  getDockerHost,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  POD_ANNOTATIONS,
  POD_LABEL_VALUES,
  POD_LABELS,
  type PodmanPodConfig,
  type PodmanPodInfo,
  SERVICE_ACCOUNTS,
  type ShellPodConfig,
  type ShellPodInfo,
  type TerminalMode,
  type UserPodConfig,
} from './types';
