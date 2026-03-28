#!/bin/bash
##############################################################
# OcholaSupernet — CyberPanel Deploy Script  (isplatty.org)
#
# Run manually:  bash deploy/cyberpanel/deploy.sh
# Or set as "Deploy Script" in CyberPanel → Git Manager
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
echo "[1/5] Installing dependencies..."
pnpm install --frozen-lockfile

# ── 2. Build the React frontend ───────────────────────────
echo ""
echo "[2/5] Building frontend..."
cd "$PROJECT_DIR/artifacts/ochola-supernet"
pnpm run build:vps
cd "$PROJECT_DIR"

# ── 3. Build the API server ───────────────────────────────
echo ""
echo "[3/5] Building API server..."
cd "$PROJECT_DIR/artifacts/api-server"
pnpm run build
cd "$PROJECT_DIR"

# ── 4. Sync built frontend → public_html/ ─────────────────
# CyberPanel's web server (OLS) serves files from public_html/.
# We copy the React build output there so the domain loads the app.
echo ""
echo "[4/5] Syncing frontend to public_html/..."
PUBLIC_HTML="/home/isplatty.org/public_html"

rsync -a --delete \
  "$PROJECT_DIR/artifacts/ochola-supernet/dist/public/" \
  "$PUBLIC_HTML/"
echo "  ✓ Synced to $PUBLIC_HTML"

# ── 5. Restart the API process via PM2 ───────────────────
echo ""
echo "[5/5] Restarting PM2..."
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
echo "  Site  → https://isplatty.org"
echo "  API   → PM2 (ocholanet-api) port 8080"
echo "  Files → $PUBLIC_HTML"
echo "══════════════════════════════════════════════"
echo ""
