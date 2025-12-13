#!/bin/bash
# Build and optionally deploy Agor to Kubernetes
#
# Usage:
#   ./build.sh                    # Build images only
#   ./build.sh --push             # Build and push to registry
#   ./build.sh --deploy           # Build and deploy to local cluster
#   ./build.sh --deploy minikube  # Build for minikube
#   ./build.sh --deploy kind      # Build for kind

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default values
TAG="${TAG:-dev}"
REGISTRY="${REGISTRY:-}"
PUSH=false
DEPLOY=false
CLUSTER_TYPE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --deploy)
            DEPLOY=true
            if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
                CLUSTER_TYPE="$2"
                shift
            fi
            shift
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Set image names
if [[ -n "$REGISTRY" ]]; then
    DAEMON_IMAGE="${REGISTRY}/agor/daemon:${TAG}"
    UI_IMAGE="${REGISTRY}/agor/ui:${TAG}"
    SHELL_IMAGE="${REGISTRY}/agor/shell:${TAG}"
else
    DAEMON_IMAGE="agor/daemon:${TAG}"
    UI_IMAGE="agor/ui:${TAG}"
    SHELL_IMAGE="agor/shell:${TAG}"
fi

echo -e "${CYAN}Building Agor Docker images${NC}"
echo -e "  Daemon: ${DAEMON_IMAGE}"
echo -e "  UI:     ${UI_IMAGE}"
echo -e "  Shell:  ${SHELL_IMAGE}"
echo ""

# Build daemon
echo -e "${YELLOW}Building daemon image...${NC}"
docker build \
    -t "$DAEMON_IMAGE" \
    -f "$SCRIPT_DIR/docker/Dockerfile.daemon" \
    "$PROJECT_ROOT"
echo -e "${GREEN}✓ Daemon image built${NC}"

# Build UI
echo -e "${YELLOW}Building UI image...${NC}"
docker build \
    -t "$UI_IMAGE" \
    -f "$SCRIPT_DIR/docker/Dockerfile.ui" \
    "$PROJECT_ROOT"
echo -e "${GREEN}✓ UI image built${NC}"

# Build shell pod image (for terminal_mode: pod)
echo -e "${YELLOW}Building shell pod image...${NC}"
docker build \
    -t "$SHELL_IMAGE" \
    -f "$SCRIPT_DIR/docker/Dockerfile.shell" \
    "$SCRIPT_DIR/docker"
echo -e "${GREEN}✓ Shell image built${NC}"

# Push if requested
if $PUSH; then
    echo -e "${YELLOW}Pushing images to registry...${NC}"
    docker push "$DAEMON_IMAGE"
    docker push "$UI_IMAGE"
    docker push "$SHELL_IMAGE"
    echo -e "${GREEN}✓ Images pushed${NC}"
fi

# Deploy if requested
if $DEPLOY; then
    echo ""
    echo -e "${CYAN}Deploying to Kubernetes${NC}"

    # Load images for local clusters
    case "$CLUSTER_TYPE" in
        minikube)
            echo -e "${YELLOW}Loading images into minikube...${NC}"
            minikube image load "$DAEMON_IMAGE"
            minikube image load "$UI_IMAGE"
            minikube image load "$SHELL_IMAGE"
            ;;
        kind)
            echo -e "${YELLOW}Loading images into kind...${NC}"
            kind load docker-image "$DAEMON_IMAGE"
            kind load docker-image "$UI_IMAGE"
            kind load docker-image "$SHELL_IMAGE"
            ;;
    esac

    # Install/upgrade helm chart
    echo -e "${YELLOW}Installing Helm chart...${NC}"
    helm upgrade --install agor "$SCRIPT_DIR/agor" \
        -f "$SCRIPT_DIR/values-dev.yaml" \
        --set daemon.image.tag="$TAG" \
        --set ui.image.tag="$TAG"

    echo -e "${GREEN}✓ Deployed!${NC}"
    echo ""
    echo -e "Access Agor:"
    echo -e "  kubectl port-forward svc/agor-ui 5173:80"
    echo -e "  Open http://localhost:5173"
fi

echo ""
echo -e "${GREEN}Done!${NC}"
