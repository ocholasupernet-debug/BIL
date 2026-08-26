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

if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_CMD=(corepack pnpm)
elif command -v npx >/dev/null 2>&1; then
  PNPM_CMD=(npx --yes pnpm@10.26.1)
else
  echo "✗ pnpm, corepack, and npx are unavailable in the CyberPanel build environment."
  exit 1
fi

echo "══════════════════════════════════════════════"
echo "  OcholaSupernet — CyberPanel Deploy"
echo "  Dir: $PROJECT_DIR"
echo "══════════════════════════════════════════════"

# ── 1. Install / update dependencies ──────────────────────
echo ""
echo "[1/5] Installing dependencies..."
"${PNPM_CMD[@]}" install --frozen-lockfile

# Load build/runtime settings from the project root when present. This lets
# CyberPanel Git Manager builds embed VITE_* values without requiring SSH.
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
  echo "  ✓ Loaded .env"
else
  echo "  ⚠ No .env found — frontend will build without Supabase settings"
fi

# ── 2. Build the React frontend ───────────────────────────
echo ""
echo "[2/5] Building frontend..."
cd "$PROJECT_DIR/artifacts/ochola-supernet"
"${PNPM_CMD[@]}" run build:vps
cd "$PROJECT_DIR"

# ── 3. Build the API server ───────────────────────────────
echo ""
echo "[3/5] Building API server..."
cd "$PROJECT_DIR/artifacts/api-server"
"${PNPM_CMD[@]}" run build
cd "$PROJECT_DIR"

# ── 4. Sync built frontend → public_html/ ─────────────────
# CyberPanel's web server (OLS) serves files from public_html/.
# We copy the React build output there so the domain loads the app.
echo ""
echo "[4/5] Syncing frontend to public_html/..."
if [ -n "${PUBLIC_HTML:-}" ]; then
  :
elif [ "$(basename "$PROJECT_DIR")" = "public_html" ]; then
  PUBLIC_HTML="$PROJECT_DIR"
else
  PUBLIC_HTML="$PROJECT_DIR/public_html"
fi

if [ ! -d "$PUBLIC_HTML" ]; then
  echo "  ✗ public_html directory not found: $PUBLIC_HTML"
  echo "    Set PUBLIC_HTML in CyberPanel Git Manager if your site uses another path."
  exit 1
fi

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    "$PROJECT_DIR/artifacts/ochola-supernet/dist/public/" \
    "$PUBLIC_HTML/"
else
  find "$PUBLIC_HTML" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$PROJECT_DIR/artifacts/ochola-supernet/dist/public/." "$PUBLIC_HTML/"
fi
echo "  ✓ Synced to $PUBLIC_HTML"

# ── 5. Restart the API process via PM2 ───────────────────
echo ""
echo "[5/5] Restarting PM2..."
mkdir -p logs

if command -v pm2 >/dev/null 2>&1; then
  API_RUNNER="PM2"
  if pm2 list 2>/dev/null | grep -q "ocholanet-api"; then
    pm2 reload ecosystem.config.cjs --env production --update-env
  else
    pm2 start ecosystem.config.cjs --env production
    pm2 save
  fi
  echo "  ✓ API managed by PM2"
else
  API_RUNNER="background Node process"
  # Git Manager can still launch the API when neither PM2 nor the Node.js Apps
  # panel is available. The PID file lets later Git pulls replace the old
  # process with the newly built bundle.
  API_PID_FILE="$PROJECT_DIR/logs/api.pid"
  if [ -f "$API_PID_FILE" ]; then
    OLD_PID="$(cat "$API_PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 1
      done
    fi
    rm -f "$API_PID_FILE"
  fi

  API_PORT="${APP_PORT:-${PORT:-8080}}"
  NODE_ENV=production PORT="$API_PORT" SERVE_STATIC=false \
    nohup node "$PROJECT_DIR/artifacts/api-server/dist/index.mjs" \
    >> "$PROJECT_DIR/logs/api-combined.log" 2>&1 &
  API_PID=$!
  echo "$API_PID" > "$API_PID_FILE"
  echo "  ✓ API started in background (PID $API_PID, port $API_PORT)"
  echo "    Configure the CyberPanel vHost proxy for /api/ → 127.0.0.1:$API_PORT"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  ✓  Deploy complete!"
echo "  Site  → https://isplatty.org"
echo "  API   → $API_RUNNER on port ${API_PORT:-8080}"
echo "  Files → $PUBLIC_HTML"
echo "══════════════════════════════════════════════"
echo ""
