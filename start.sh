#!/bin/bash

# Clear any processes still holding the ports from a previous run
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 5000/tcp 2>/dev/null || true

# Start the API server in the background on port 8080
PORT=8080 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &
API_PID=$!

# Start the frontend dev server on port 5000
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ochola-supernet run dev &
FRONTEND_PID=$!

# When either process exits, kill the other and exit
wait -n $API_PID $FRONTEND_PID
kill $API_PID $FRONTEND_PID 2>/dev/null
