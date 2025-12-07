# Agor Helm Chart

Deploy Agor to Kubernetes using Helm.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.0+
- Docker (for building images)
- kubectl configured to access your cluster

## Quick Start

### 1. Build Docker Images

```bash
# From repository root
cd /path/to/agor

# Build daemon image
docker build -t agor/daemon:dev -f helm/docker/Dockerfile.daemon .

# Build UI image
docker build -t agor/ui:dev -f helm/docker/Dockerfile.ui .

# For minikube, load images into cluster
minikube image load agor/daemon:dev
minikube image load agor/ui:dev

# For kind
kind load docker-image agor/daemon:dev
kind load docker-image agor/ui:dev
```

### 2. Install Chart

```bash
# Development (local cluster)
helm install agor ./helm/agor -f helm/values-dev.yaml

# Production
helm install agor ./helm/agor -f helm/values-production.yaml

# With custom values
helm install agor ./helm/agor \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=agor.example.com
```

### 3. Access Agor

With ingress enabled:
```bash
# Add to /etc/hosts (for local dev)
echo "127.0.0.1 agor.local" | sudo tee -a /etc/hosts

# If using minikube
minikube tunnel
```

Without ingress (port-forward):
```bash
# UI
kubectl port-forward svc/agor-ui 5173:80

# API
kubectl port-forward svc/agor-daemon 3030:3030

# Open http://localhost:5173
```

## Configuration

### Key Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `daemon.enabled` | Deploy daemon | `true` |
| `daemon.image.repository` | Daemon image | `agor/daemon` |
| `daemon.image.tag` | Daemon image tag | `latest` |
| `daemon.persistence.enabled` | Enable persistent storage | `true` |
| `daemon.persistence.data.size` | Database PVC size | `1Gi` |
| `daemon.persistence.worktrees.size` | Worktrees PVC size | `10Gi` |
| `ui.enabled` | Deploy UI | `true` |
| `ui.image.repository` | UI image | `agor/ui` |
| `ingress.enabled` | Enable ingress | `false` |
| `ingress.className` | Ingress class | `""` |

### Secrets

Create a secret for API keys:

```bash
kubectl create secret generic agor-secrets \
  --from-literal=anthropic-api-key=sk-ant-xxx
```

Reference in values:

```yaml
daemon:
  extraEnv:
    - name: ANTHROPIC_API_KEY
      valueFrom:
        secretKeyRef:
          name: agor-secrets
          key: anthropic-api-key
```

### Storage

For production, use a proper storage class:

```yaml
global:
  storageClass: "gp3"  # AWS EBS
  # storageClass: "standard"  # GKE
  # storageClass: "managed-premium"  # AKS
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Ingress                        │
│                 (nginx/traefik)                  │
└───────────────────┬─────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│   agor-ui     │       │  agor-daemon  │
│   (nginx)     │       │  (node.js)    │
│   Port 80     │       │   Port 3030   │
└───────────────┘       └───────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
            ┌─────────────┐         ┌─────────────┐
            │  PVC: data  │         │PVC: worktrees│
            │ (SQLite DB) │         │  (git repos) │
            └─────────────┘         └─────────────┘
```

## Limitations

When running in Kubernetes:

1. **Terminal features**: Zellij-based terminals require special configuration
2. **Unix user isolation**: Not supported in K8s (designed for single-host)
3. **WebSocket**: Ensure ingress supports WebSocket upgrades

## Development

### Lint Chart

```bash
helm lint ./helm/agor
```

### Template Rendering

```bash
helm template agor ./helm/agor -f helm/values-dev.yaml
```

### Upgrade

```bash
helm upgrade agor ./helm/agor -f helm/values-dev.yaml
```

### Uninstall

```bash
helm uninstall agor

# Also delete PVCs if needed
kubectl delete pvc -l app.kubernetes.io/name=agor
```

## Troubleshooting

### Pod not starting

```bash
kubectl describe pod -l app.kubernetes.io/name=agor
kubectl logs -l app.kubernetes.io/component=daemon
```

### Database issues

```bash
# Connect to daemon pod
kubectl exec -it deploy/agor-daemon -- sh

# Check database
sqlite3 /data/agor.db ".tables"
```

### WebSocket connection issues

Ensure ingress has WebSocket support:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```
