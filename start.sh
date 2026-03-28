#!/bin/bash
set -e

# Start the API server in the background on port 8080
PORT=8080 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &
API_PID=$!

# Start the frontend dev server on port 5000
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ochola-supernet run dev &
FRONTEND_PID=$!

# Wait for either process to exit
wait -n $API_PID $FRONTEND_PID

# If either exits, kill the other
kill $API_PID $FRONTEND_PID 2>/dev/null
