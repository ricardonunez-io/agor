#!/bin/bash
set -e

echo "🔄 Restarting Agor in Codespaces..."

# Kill existing services
pkill -f "tsx src/index.ts" || true
pkill -f "vite" || true

sleep 2

# Set daemon URL with actual values
DAEMON_URL="https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
export VITE_DAEMON_URL="$DAEMON_URL"

echo "🔧 Starting daemon..."
cd /workspaces/agor/apps/agor-daemon
nohup pnpm exec tsx src/index.ts > /tmp/agor-daemon.log 2>&1 &

sleep 3

echo "🎨 Starting UI (daemon URL: $VITE_DAEMON_URL)..."
cd /workspaces/agor/apps/agor-ui
nohup pnpm dev > /tmp/agor-ui.log 2>&1 &

sleep 3

echo ""
echo "✅ Services restarted!"
echo ""
echo "UI: https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
echo ""
