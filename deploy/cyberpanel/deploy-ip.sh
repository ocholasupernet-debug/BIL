#!/usr/bin/env bash
##############################################################
# OcholaSupernet — CyberPanel / IP-only deployment
#
# Run from the project root on the VPS:
#   PUBLIC_IP=102.203.116.204 bash deploy/cyberpanel/deploy-ip.sh
#
# This mode intentionally serves the built frontend and API from the
# same PM2 process on port 8080. It does not use CyberPanel's
# public_html directory and does not require a domain name.
##############################################################
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLIC_IP="${PUBLIC_IP:-102.203.116.204}"
APP_PORT="${APP_PORT:-8080}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"

cd "$PROJECT_DIR"

echo "══════════════════════════════════════════════"
echo "  OcholaSupernet — IP-only VPS deployment"
echo "  Project: $PROJECT_DIR"
echo "  URL:     http://${PUBLIC_IP}:${APP_PORT}"
echo "══════════════════════════════════════════════"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE is missing."
  echo "Create it from .env.example and fill in the required Supabase/server values."
  exit 1
fi

echo "[1/5] Loading server environment..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export NODE_ENV=production
export PORT="$APP_PORT"
export SERVE_STATIC=true

echo "[2/5] Installing dependencies..."
pnpm install --frozen-lockfile

echo "[3/5] Building frontend for root hosting..."
(
  cd "$PROJECT_DIR/artifacts/ochola-supernet"
  BASE_PATH=/ pnpm run build:vps
)

echo "[4/5] Building API server..."
(
  cd "$PROJECT_DIR/artifacts/api-server"
  pnpm run build
)

echo "[5/5] Starting combined app with PM2..."
mkdir -p "$PROJECT_DIR/logs"
if pm2 list 2>/dev/null | grep -q "ocholanet-api"; then
  pm2 reload "$PROJECT_DIR/ecosystem.config.cjs" --env standalone --update-env
else
  pm2 start "$PROJECT_DIR/ecosystem.config.cjs" --env standalone
fi
pm2 save

echo ""
echo "✓ Deployment complete."
echo "  Open:  http://${PUBLIC_IP}:${APP_PORT}"
echo "  Check: pm2 status ocholanet-api"
echo "  Logs:  pm2 logs ocholanet-api"
echo ""
echo "If the URL is unreachable, allow TCP ${APP_PORT} in CyberPanel/CSF and the VPS firewall."