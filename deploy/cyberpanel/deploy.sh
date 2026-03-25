#!/bin/bash
##############################################################
# OcholaSupernet — CyberPanel VPS Deployment Script
#
# This script is triggered by CyberPanel's Git Manager
# after every git pull from GitHub.
#
# Run manually:  bash deploy/cyberpanel/deploy.sh
# Or set it as the "Deploy Script" in CyberPanel → Git Manager
##############################################################
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "══════════════════════════════════════════════"
echo "  OcholaSupernet — CyberPanel Deploy"
echo "  Dir: $PROJECT_DIR"
echo "══════════════════════════════════════════════"

# ── 1. Install / update dependencies ──────────────────────
echo ""
echo "[1/4] Installing dependencies..."
pnpm install --frozen-lockfile

# ── 2. Build the React frontend ───────────────────────────
echo ""
echo "[2/4] Building frontend..."
cd "$PROJECT_DIR/artifacts/ochola-supernet"
pnpm run build:vps
cd "$PROJECT_DIR"

# ── 3. Build the API server ───────────────────────────────
echo ""
echo "[3/4] Building API server..."
cd "$PROJECT_DIR/artifacts/api-server"
pnpm run build
cd "$PROJECT_DIR"

# ── 4. Restart the API process via PM2 ───────────────────
echo ""
echo "[4/4] Restarting PM2..."
mkdir -p logs

if pm2 list 2>/dev/null | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
  pm2 save
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  ✓  Deploy complete!"
echo "  Frontend → $PROJECT_DIR/artifacts/ochola-supernet/dist/public"
echo "  API      → PM2 (ocholanet-api) on port 8080"
echo "══════════════════════════════════════════════"
echo ""
