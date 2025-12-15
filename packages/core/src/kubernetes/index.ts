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
} from './pod-manager.js';

// Deployment manifest builders
export {
  buildAppIngressManifest,
  buildAppServiceManifest,
  buildPodmanDeploymentManifest,
  buildPodmanServiceManifest,
  buildShellDeploymentManifest,
  type PodmanPodParams,
  type ShellPodParams,
} from './pod-manifests.js';

// Template loader (for advanced use cases)
export { clearTemplateCache } from './template-loader.js';

// Types and naming utilities
export {
  DEFAULT_USER_POD_CONFIG,
  // Naming functions
  getAppIngressName,
  getAppServiceName,
  getDockerHost,
  getPodmanPodName,
  getPodmanServiceName,
  getShellPodName,
  getUserShortId,
  getWorktreeShortId,
  // Labels and annotations
  POD_ANNOTATIONS,
  POD_LABEL_VALUES,
  POD_LABELS,
  SERVICE_ACCOUNTS,
  // Types
  type PodmanPodConfig,
  type PodmanPodInfo,
  type ShellPodConfig,
  type ShellPodInfo,
  type TerminalMode,
  type UserPodConfig,
} from './types.js';
