#!/bin/bash
# Build tarballs for @agor/core and @agor/executor
# These are used by Dockerfile.workspace to install the executor inside containers

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building @agor/core and @agor/executor tarballs..."

# Build packages
cd "$REPO_ROOT"
pnpm --filter @agor/core build
pnpm --filter @agor/executor build

# Create temp directory for packaging
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Package @agor/core
echo "Packaging @agor/core..."
cd "$REPO_ROOT/packages/core"
npm pack --pack-destination "$TEMP_DIR"
mv "$TEMP_DIR"/agor-core-*.tgz "$SCRIPT_DIR/agor-core.tgz"

# Package @agor/executor (need to fix workspace dep first)
echo "Packaging @agor/executor..."
cd "$REPO_ROOT/packages/executor"

# Create a temp package.json with file reference instead of workspace:*
cp package.json package.json.bak
sed -i.tmp 's|"@agor/core": "workspace:\*"|"@agor/core": "file:../core"|' package.json
npm pack --pack-destination "$TEMP_DIR"
mv package.json.bak package.json
rm -f package.json.tmp

mv "$TEMP_DIR"/agor-executor-*.tgz "$SCRIPT_DIR/agor-executor.tgz"

echo "Done! Tarballs created:"
ls -la "$SCRIPT_DIR"/*.tgz
