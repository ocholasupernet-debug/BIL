#!/bin/bash
set -e

# Kill any lingering processes on our ports
fuser -k 5000/tcp 2>/dev/null || true
fuser -k 8080/tcp 2>/dev/null || true

# Build and start the API server in the background
echo "[startup] Building API server..."
cd /home/runner/workspace
PORT=8080 pnpm --filter @workspace/api-server run build

echo "[startup] Starting API server on port 8080..."
PORT=8080 pnpm --filter @workspace/api-server run start &
API_PID=$!

# Give the API server a moment to start
sleep 2

# Start the frontend dev server on port 5000
echo "[startup] Starting frontend on port 5000..."
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ochola-supernet run dev
