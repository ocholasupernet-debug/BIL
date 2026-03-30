#!/bin/bash
set -e

# Kill any lingering process on the frontend port only
fuser -k 5000/tcp 2>/dev/null || true

# Start the frontend dev server on port 5000
# The backend is managed by the separate "API Server" workflow on port 8080
echo "[startup] Starting frontend on port 5000..."
cd /home/runner/workspace
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ochola-supernet run dev
