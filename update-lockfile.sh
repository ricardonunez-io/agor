#!/bin/bash
# Temporary script to update pnpm-lock.yaml in Docker environment
# Run this when package.json changes but lockfile is out of sync

echo "Updating pnpm-lock.yaml..."
pnpm install --no-frozen-lockfile
echo "Lockfile updated successfully!"
