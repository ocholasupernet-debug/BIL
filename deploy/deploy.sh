#!/bin/bash
##############################################################
# OcholaSupernet — VPS Deployment Script
# Run from the project root:  bash deploy/deploy.sh
##############################################################
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# CyberPanel serves static files from public_html/
if   [ -d "/home/isplatty.org/public_html" ];  then PUBLIC_HTML="/home/isplatty.org/public_html"
elif [ -d "/home/ocholasupernet/public_html" ]; then PUBLIC_HTML="/home/ocholasupernet/public_html"
else
  PUBLIC_HTML=$(find /home -maxdepth 3 -name "public_html" -type d 2>/dev/null | head -1)
fi

echo "══════════════════════════════════════════"
echo "  OcholaSupernet — Deploying to VPS"
echo "  Dir:         $PROJECT_DIR"
echo "  public_html: ${PUBLIC_HTML:-NOT FOUND}"
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
#    Source .env so VITE_SUPABASE_URL / VITE_SUPABASE_KEY are embedded at build time
echo "[3/6] Building frontend..."
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
  echo "      ✓ Sourced .env (VITE_SUPABASE_URL=${VITE_SUPABASE_URL:+set})"
else
  echo "      ⚠ No .env found — Supabase env vars may be missing"
fi
cd "$PROJECT_DIR/artifacts/ochola-supernet"
BASE_PATH="/" pnpm run build:vps
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
  echo "      ⚠ public_html not found — skipping rsync"
fi

# 6. Restart API via PM2
#    .env was already sourced in step 3 (set -a), so VITE_SUPABASE_* are in the shell env.
#    ecosystem.config.cjs reads process.env for those vars → --update-env applies them.
echo "[6/6] Restarting PM2..."
mkdir -p logs
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env standalone --update-env
else
  pm2 start ecosystem.config.cjs --env standalone
  pm2 save
fi

echo ""
echo "✓ Deployment complete!"
echo "  Commit: $(git log -1 --format='%h — %s')"
echo "  Site:   https://isplatty.org"
echo "  API:    PM2 (ocholanet-api) port 8080"
echo ""
