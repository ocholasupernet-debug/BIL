#!/bin/bash
##############################################################
# OcholaSupernet — VPS Deployment Script
# Run from the project root:  bash deploy/deploy.sh
##############################################################
set -e

echo "══════════════════════════════════════════"
echo "  OcholaSupernet — Deploying to VPS"
echo "══════════════════════════════════════════"

# 1. Force pull latest code (discard any local changes)
echo "[1/6] Pulling latest from GitHub..."
git fetch --all
git reset --hard origin/main
echo "      → Now on: $(git log -1 --format='%h %s')"

# 2. Install dependencies (no frozen-lockfile so it never blocks)
echo "[2/6] Installing dependencies..."
pnpm install --no-frozen-lockfile

# 3. Build the frontend (VPS config — no Replit plugins)
echo "[3/6] Building frontend..."
cd artifacts/ochola-supernet
BASE_PATH="/" pnpm run build:vps
cd ../..

# 4. Build the API server
echo "[4/6] Building API server..."
cd artifacts/api-server
pnpm run build
cd ../..

# 5. Create logs directory
echo "[5/6] Ensuring logs directory..."
mkdir -p logs

# 6. Restart with PM2
echo "[6/6] Restarting PM2..."
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env standalone
else
  pm2 start ecosystem.config.cjs --env standalone
  pm2 save
fi

echo ""
echo "✓ Deployment complete!"
echo "  Commit: $(git log -1 --format='%h — %s')"
echo "  App:    http://localhost:8080"
echo ""
