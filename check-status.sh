#!/bin/bash
echo "=== Agor Codespaces Status ==="
echo ""

echo "📦 Core Package:"
if [ -f "/workspaces/agor/packages/core/dist/index.js" ]; then
  echo "  ✅ Built"
else
  echo "  ❌ Not built"
fi
echo ""

echo "💾 Database:"
if [ -f ~/.agor/agor.db ]; then
  echo "  ✅ Initialized"
  echo "  📊 Size: $(du -h ~/.agor/agor.db | cut -f1)"
else
  echo "  ❌ Not initialized"
fi
echo ""

echo "🔧 Daemon (port 3030):"
DAEMON_PID=$(pgrep -f 'tsx src/index.ts')
if [ -n "$DAEMON_PID" ]; then
  echo "  ✅ Running (PID: $DAEMON_PID)"

  # Test health endpoint
  HEALTH_RESPONSE=$(curl -s -w "%{http_code}" http://localhost:3030/health -o /tmp/health.txt 2>&1)
  if [ "$HEALTH_RESPONSE" = "200" ]; then
    echo "  ✅ Health check passed: $(cat /tmp/health.txt)"
  else
    echo "  ⚠️  Health check failed (HTTP $HEALTH_RESPONSE)"
  fi
else
  echo "  ❌ Not running"
fi
echo ""

echo "🎨 UI (port 5173):"
VITE_PID=$(pgrep -f 'vite')
if [ -n "$VITE_PID" ]; then
  echo "  ✅ Running (PID: $VITE_PID)"

  # Test if UI is responding
  UI_RESPONSE=$(curl -s -w "%{http_code}" http://localhost:5173 -o /dev/null 2>&1)
  if [ "$UI_RESPONSE" = "200" ]; then
    echo "  ✅ Responding (HTTP 200)"
  else
    echo "  ⚠️  Not responding (HTTP $UI_RESPONSE)"
  fi
else
  echo "  ❌ Not running"
fi
echo ""

echo "🌐 Port Forwarding:"
if [ -n "$CODESPACE_NAME" ]; then
  DAEMON_URL="https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  UI_URL="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"

  echo "  Daemon: $DAEMON_URL"
  echo "  UI: $UI_URL"
  echo ""
  echo "  💡 Click the UI URL above to open Agor in your browser!"
else
  echo "  ⚠️  Not in Codespaces environment"
fi
echo ""

echo "📝 Recent Logs (last 5 lines):"
echo ""
echo "  Daemon log:"
if [ -f /tmp/agor-daemon.log ]; then
  tail -5 /tmp/agor-daemon.log | sed 's/^/    /'
else
  echo "    ⚠️  No log file found"
fi
echo ""
echo "  UI log:"
if [ -f /tmp/agor-ui.log ]; then
  tail -5 /tmp/agor-ui.log | sed 's/^/    /'
else
  echo "    ⚠️  No log file found"
fi
echo ""

echo "🔍 Troubleshooting:"
echo "  View full logs:"
echo "    tail -f /tmp/agor-daemon.log"
echo "    tail -f /tmp/agor-ui.log"
echo ""
echo "  Restart services:"
echo "    bash .devcontainer/playground/start-services.sh"
echo ""
