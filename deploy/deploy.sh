#!/bin/bash
##############################################################
# OcholaSupernet — VPS Deployment Script
# Run from the project root:  bash deploy/deploy.sh
##############################################################
set -e

echo "──────────────────────────────────────────"
echo "  OcholaSupernet — Deploying to VPS"
echo "──────────────────────────────────────────"

# 1. Pull latest code
echo "[1/6] Pulling latest from GitHub..."
git pull origin main

# 2. Install dependencies
echo "[2/6] Installing dependencies..."
pnpm install --frozen-lockfile

# 3. Build the frontend (VPS config — no Replit plugins)
echo "[3/6] Building frontend..."
cd artifacts/ochola-supernet
BASE_PATH="/" PORT=3000 pnpm run build:vps
cd ../..

# 4. Build the API server
echo "[4/6] Building API server..."
cd artifacts/api-server
pnpm run build
cd ../..

# 5. Create logs directory
echo "[5/6] Ensuring logs directory exists..."
mkdir -p logs

# 6. Restart with PM2
echo "[6/6] Restarting with PM2..."
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
  pm2 save
fi

echo ""
echo "✓ Deployment complete!"
echo "  API running on port 8080 (PM2)"
echo "  Frontend built to artifacts/ochola-supernet/dist/public"
echo "  Configure nginx with deploy/nginx.conf to serve the app"
echo ""
