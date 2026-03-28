#!/bin/bash

# Clear any processes still holding port 5000 from a previous run
fuser -k 5000/tcp 2>/dev/null || true

# Start the frontend dev server on port 5000
# The API server runs as a separate artifact on port 8080
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ochola-supernet run dev
