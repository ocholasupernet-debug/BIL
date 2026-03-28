#!/bin/bash
##############################################################
# OcholaSupernet — VPS Deployment Script
# Run from the project root:  bash deploy/deploy.sh
##############################################################
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# CyberPanel serves static files from public_html/.
# Auto-detect the path: try common locations.
if   [ -d "/home/isplatty.org/public_html" ];    then PUBLIC_HTML="/home/isplatty.org/public_html"
elif [ -d "/home/ocholasupernet/public_html" ];   then PUBLIC_HTML="/home/ocholasupernet/public_html"
else
  # Fallback: look for any public_html containing our index.html
  PUBLIC_HTML=$(find /home -maxdepth 3 -name "public_html" -type d 2>/dev/null | head -1)
fi

echo "══════════════════════════════════════════"
echo "  OcholaSupernet — Deploying to VPS"
echo "  Dir:         $PROJECT_DIR"
echo "  public_html: ${PUBLIC_HTML:-NOT FOUND}"
echo "══════════════════════════════════════════"

# 1. Force-pull latest code from GitHub
echo "[1/6] Pulling latest from GitHub..."
git fetch --all
git reset --hard origin/main
echo "      → $(git log -1 --format='%h %s')"

# 2. Install dependencies
echo "[2/6] Installing dependencies..."
pnpm install --no-frozen-lockfile

# 3. Build the frontend
echo "[3/6] Building frontend..."
cd "$PROJECT_DIR/artifacts/ochola-supernet"
pnpm run build:vps
cd "$PROJECT_DIR"

# 4. Build the API server
echo "[4/6] Building API server..."
cd "$PROJECT_DIR/artifacts/api-server"
pnpm run build
cd "$PROJECT_DIR"

# 5. Copy frontend build → CyberPanel public_html (LiteSpeed serves from here)
echo "[5/6] Syncing frontend to public_html/..."
if [ -n "$PUBLIC_HTML" ]; then
  rsync -a --delete \
    "$PROJECT_DIR/artifacts/ochola-supernet/dist/public/" \
    "$PUBLIC_HTML/"
  echo "      ✓ Synced to $PUBLIC_HTML"
else
  echo "      ⚠ public_html not found — skipping rsync (check the path manually)"
fi

# 6. Restart API via PM2 (production mode — LiteSpeed serves static files)
echo "[6/6] Restarting PM2..."
mkdir -p logs
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
  pm2 save
fi

echo ""
echo "✓ Deployment complete!"
echo "  Commit: $(git log -1 --format='%h — %s')"
echo "  Site:   https://isplatty.org"
echo "  API:    PM2 (ocholanet-api) port 8080"
echo ""
