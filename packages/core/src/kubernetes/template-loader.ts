/**
 * Kubernetes Template Loader
 *
 * Loads YAML templates from the templates directory and interpolates values.
 * Uses a simple mustache-like syntax: {{variableName}}
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import type { V1Deployment, V1Ingress, V1Service } from '@kubernetes/client-node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');

/**
 * Template cache for performance
 */
const templateCache = new Map<string, string>();

/**
 * Load a template file (with caching)
 */
function loadTemplate(templateName: string): string {
  if (templateCache.has(templateName)) {
    return templateCache.get(templateName)!;
  }

  const templatePath = join(TEMPLATES_DIR, `${templateName}.yaml`);
  const content = readFileSync(templatePath, 'utf-8');
  templateCache.set(templateName, content);
  return content;
}

/**
 * Interpolate template variables using mustache-like syntax
 * Supports: {{variableName}} - replaced with string value
 */
function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in values) {
      return String(values[key]);
    }
    console.warn(`Template variable not found: ${key}`);
    return match;
  });
}

/**
 * Load and render a template
 */
function renderTemplate<T>(templateName: string, values: object): T {
  const template = loadTemplate(templateName);
  const rendered = interpolate(template, values as Record<string, string | number>);
  return parseYaml(rendered) as T;
}

// ============================================
// Template-specific loaders with typed parameters
// ============================================

export interface ShellDeploymentParams {
  name: string;
  namespace: string;
  worktreeId: string;
  userId: string;
  username: string;
  runAsUser: number;
  runAsGroup: number;
  worktreePath: string;
  dockerHost: string;
  shellImage: string;
  dataPvc: string;
  requestsCpu: string;
  requestsMemory: string;
  limitsCpu: string;
  limitsMemory: string;
  sshdRequestsCpu: string;
  sshdRequestsMemory: string;
  sshdLimitsCpu: string;
  sshdLimitsMemory: string;
  createdAt: string;
}

export function loadShellDeployment(params: ShellDeploymentParams): V1Deployment {
  return renderTemplate<V1Deployment>('shell-deployment', params);
}

export interface PodmanDeploymentParams {
  name: string;
  namespace: string;
  worktreeId: string;
  worktreePath: string;
  podmanImage: string;
  initImage: string;
  dataPvc: string;
  requestsCpu: string;
  requestsMemory: string;
  limitsCpu: string;
  limitsMemory: string;
  createdAt: string;
}

export function loadPodmanDeployment(params: PodmanDeploymentParams): V1Deployment {
  return renderTemplate<V1Deployment>('podman-deployment', params);
}

export interface PodmanServiceParams {
  name: string;
  namespace: string;
  worktreeId: string;
}

export function loadPodmanService(params: PodmanServiceParams): V1Service {
  return renderTemplate<V1Service>('podman-service', params);
}

export interface AppServiceParams {
  name: string;
  namespace: string;
  worktreeId: string;
  port: number;
}

export function loadAppService(params: AppServiceParams): V1Service {
  return renderTemplate<V1Service>('app-service', params);
}

export interface AppIngressParams {
  name: string;
  namespace: string;
  worktreeId: string;
  hostname: string;
  serviceName: string;
  port: number;
  ingressClassName: string;
}

export function loadAppIngress(params: AppIngressParams): V1Ingress {
  return renderTemplate<V1Ingress>('app-ingress', params);
}

export interface ShellSshServiceParams {
  name: string;
  namespace: string;
  worktreeId: string;
  userId: string;
}

export function loadShellSshService(params: ShellSshServiceParams): V1Service {
  return renderTemplate<V1Service>('shell-ssh-service', params);
}

/**
 * Traefik IngressRouteTCP for SSH
 * Note: This is a Traefik CRD, not a standard K8s resource
 */
export interface ShellSshIngressRouteParams {
  name: string;
  namespace: string;
  worktreeId: string;
  userId: string;
  hostname: string;
  serviceName: string;
  sshEntryPoint: string;
}

// IngressRouteTCP is a Traefik CRD - define minimal type
export interface IngressRouteTCP {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  spec: {
    entryPoints: string[];
    routes: Array<{
      match: string;
      services: Array<{
        name: string;
        port: number;
      }>;
    }>;
    tls?: {
      passthrough?: boolean;
    };
  };
}

export function loadShellSshIngressRoute(params: ShellSshIngressRouteParams): IngressRouteTCP {
  return renderTemplate<IngressRouteTCP>('shell-ssh-ingressroute', params);
}

/**
 * Clear template cache (for testing or hot reload)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}
