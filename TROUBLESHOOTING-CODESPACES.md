# Troubleshooting Codespaces

Quick guide for debugging Agor in GitHub Codespaces.

## Quick Health Check

Run these commands in the Codespaces terminal:

```bash
# Check if services are running
ps aux | grep -E '(tsx|vite)' | grep -v grep

# Check daemon health
curl http://localhost:3030/health

# Check UI
curl http://localhost:5173

# View logs
tail -f /tmp/agor-daemon.log
tail -f /tmp/agor-ui.log
```

## Common Issues

### 1. Services Not Running

**Symptom:** Can't access http://localhost:5173 or ports show as not forwarded

**Check:**

```bash
# See if processes are running
ps aux | grep -E '(tsx|vite)' | grep -v grep

# If empty, services didn't start
```

**Fix:**

```bash
# Manually run the startup script
cd /workspaces/agor
bash .devcontainer/playground/start-services.sh

# Or start services individually:

# Daemon
cd /workspaces/agor/apps/agor-daemon
pnpm exec tsx src/index.ts > /tmp/agor-daemon.log 2>&1 &

# UI
cd /workspaces/agor/apps/agor-ui
pnpm dev > /tmp/agor-ui.log 2>&1 &
```

---

### 2. Daemon Won't Start

**Symptom:** Daemon log shows errors or health check fails

**Check logs:**

```bash
tail -f /tmp/agor-daemon.log
```

**Common causes:**

**A. Core package not built**

```bash
# Check if core package is built
ls -la /workspaces/agor/packages/core/dist/index.js

# If missing, build it:
cd /workspaces/agor/packages/core
pnpm build
```

**B. Database initialization failed**

```bash
# Check if database exists
ls -la ~/.agor/agor.db

# If missing, reinitialize:
cd /workspaces/agor/apps/agor-cli
pnpm exec tsx bin/dev.ts init --force
```

**C. Port already in use**

```bash
# Check if something else is on port 3030
lsof -ti:3030

# Kill it if needed
lsof -ti:3030 | xargs kill -9

# Restart daemon
cd /workspaces/agor/apps/agor-daemon
pnpm exec tsx src/index.ts > /tmp/agor-daemon.log 2>&1 &
```

---

### 3. UI Won't Start

**Symptom:** UI log shows errors or http://localhost:5173 fails

**Check logs:**

```bash
tail -f /tmp/agor-ui.log
```

**Common causes:**

**A. Dependencies not installed**

```bash
# Check node_modules
ls -la /workspaces/agor/apps/agor-ui/node_modules

# If missing or incomplete:
cd /workspaces/agor
pnpm install
```

**B. Port already in use**

```bash
# Check if something else is on port 5173
lsof -ti:5173

# Kill it if needed
lsof -ti:5173 | xargs kill -9

# Restart UI
cd /workspaces/agor/apps/agor-ui
pnpm dev > /tmp/agor-ui.log 2>&1 &
```

**C. Vite build errors**

```bash
# Try running UI in foreground to see errors
cd /workspaces/agor/apps/agor-ui
pnpm dev
```

---

### 4. Can't Access Forwarded Ports

**Symptom:** Ports show as forwarded in Codespaces, but browser shows errors

**Check port visibility:**

1. Open **Ports** panel in VS Code (Codespaces)
2. Ensure ports 3030 and 5173 are **Public** (not Private)
3. Right-click port → **Port Visibility** → **Public**

**Check forwarded URLs:**

```bash
# Print the expected URLs
echo "Daemon: https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
echo "UI: https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
```

**Test daemon from browser:**

```bash
# Get the forwarded daemon URL
echo "https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/health"
```

Open that URL in browser - should return `{"status":"ok"}`

---

### 5. CORS Errors in Browser Console

**Symptom:** Browser console shows CORS errors when UI tries to connect to daemon

**Fix:** Ensure daemon is using CORS wildcard (should be default in Codespaces)

```bash
# Check if CORS_ORIGIN is set
echo $CORS_ORIGIN  # Should be "*"

# If not, set it and restart daemon
export CORS_ORIGIN="*"
cd /workspaces/agor/apps/agor-daemon
pkill -f "tsx src/index.ts"
pnpm exec tsx src/index.ts > /tmp/agor-daemon.log 2>&1 &
```

---

### 6. UI Can't Connect to Daemon

**Symptom:** UI loads but shows connection errors

**Check daemon URL configuration:**

```bash
# UI should be using the forwarded daemon URL
echo $VITE_DAEMON_URL
# Should be: https://{CODESPACE_NAME}-3030.{DOMAIN}

# If not set correctly, set it manually and restart UI
export VITE_DAEMON_URL="https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
cd /workspaces/agor/apps/agor-ui
pkill -f "vite"
pnpm dev > /tmp/agor-ui.log 2>&1 &
```

---

## Full Reset

If nothing works, do a full reset:

```bash
# 1. Kill all services
pkill -f "tsx"
pkill -f "vite"

# 2. Clean data
rm -rf ~/.agor

# 3. Rebuild core package
cd /workspaces/agor/packages/core
rm -rf dist
pnpm build

# 4. Reinitialize
cd /workspaces/agor/apps/agor-cli
pnpm exec tsx bin/dev.ts init --force
pnpm exec tsx bin/dev.ts user create-admin

# 5. Restart services
cd /workspaces/agor
bash .devcontainer/playground/start-services.sh
```

---

## Checking Service Status

### Quick Status Check

```bash
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
else
  echo "  ❌ Not initialized"
fi
echo ""

echo "🔧 Daemon (port 3030):"
if ps aux | grep -E 'tsx src/index.ts' | grep -v grep > /dev/null; then
  echo "  ✅ Running (PID: $(pgrep -f 'tsx src/index.ts'))"
  if curl -s http://localhost:3030/health > /dev/null 2>&1; then
    echo "  ✅ Health check passed"
  else
    echo "  ⚠️  Not responding to health check"
  fi
else
  echo "  ❌ Not running"
fi
echo ""

echo "🎨 UI (port 5173):"
if ps aux | grep -E 'vite' | grep -v grep > /dev/null; then
  echo "  ✅ Running (PID: $(pgrep -f 'vite'))"
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "  ✅ Responding"
  else
    echo "  ⚠️  Not responding"
  fi
else
  echo "  ❌ Not running"
fi
echo ""

echo "🌐 Forwarded URLs:"
if [ -n "$CODESPACE_NAME" ]; then
  echo "  Daemon: https://${CODESPACE_NAME}-3030.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  echo "  UI: https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  echo "  ⚠️  Not in Codespaces"
fi
echo ""
```

**Save this as `check-status.sh` and run:**

```bash
bash check-status.sh
```

---

## Viewing Logs in Real-Time

```bash
# Daemon logs
tail -f /tmp/agor-daemon.log

# UI logs
tail -f /tmp/agor-ui.log

# Both at once (requires tmux or split terminal)
# Terminal 1:
tail -f /tmp/agor-daemon.log

# Terminal 2:
tail -f /tmp/agor-ui.log
```

---

## Port Forwarding Check

```bash
# List all forwarded ports (from Codespaces)
# This requires gh CLI to be installed in Codespace

# Manual check via VS Code:
# 1. Open Ports panel (View → Ports)
# 2. Should see:
#    - 3030 (Agor Daemon) - Public
#    - 5173 (Agor UI) - Public

# If ports aren't forwarded:
# - They should auto-forward when services start
# - If not, manually add them in Ports panel
```

---

## Getting Help

If you're still stuck:

1. **Capture diagnostics:**

   ```bash
   bash check-status.sh > /tmp/diagnostics.txt
   tail -100 /tmp/agor-daemon.log >> /tmp/diagnostics.txt
   tail -100 /tmp/agor-ui.log >> /tmp/diagnostics.txt
   ```

2. **Share in GitHub Discussions:**
   - https://github.com/mistercrunch/agor/discussions
   - Include output from `/tmp/diagnostics.txt`

3. **File an issue:**
   - https://github.com/mistercrunch/agor/issues
   - Label: `codespaces`, `bug`
