#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PUBLIC_HTML="${PUBLIC_HTML:-}"
cd "$PROJECT_DIR"

if [ "${DEPLOY_FROM_ARCHIVE:-0}" != "1" ]; then
  echo "Application-only release requires an archive delivered by the deployment workflow." >&2
  exit 1
fi
if [ ! -s "$PROJECT_DIR/.env" ] || [ -L "$PROJECT_DIR/.env" ]; then
  echo "Application-only release requires the existing VPS .env." >&2
  exit 1
fi
if [ ! -s "$PROJECT_DIR/artifacts/ochola-supernet/dist/public/index.html" ] ||
   [ ! -s "$PROJECT_DIR/artifacts/api-server/dist/index.mjs" ]; then
  echo "Application-only release is missing a prebuilt application artifact." >&2
  exit 1
fi
if [ -z "$PUBLIC_HTML" ] || [ ! -d "$PUBLIC_HTML" ]; then
  echo "Application-only release could not resolve the existing web root." >&2
  exit 1
fi
if ! pm2 describe ocholanet-api >/dev/null 2>&1; then
  echo "Application-only release requires the existing PM2 process." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/logs"
if [ "${DEPLOY_REFRESH_PM2_ENV:-false}" = "true" ]; then
  pm2 reload ecosystem.config.cjs --env standalone --update-env
else
  pm2 reload ocholanet-api
fi

api_ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:8080/api/healthz >/dev/null
  then
    api_ready=true
    break
  fi
  sleep 2
done
if [ "$api_ready" != "true" ]; then
  echo "Application-only release API health check failed." >&2
  pm2 status || true
  exit 1
fi

if [ "${DEPLOY_VERIFY_SUPABASE_TARGET:-false}" = "true" ]; then
  node "$PROJECT_DIR/deploy/verify-supabase-runtime-target.mjs"
fi

BUILD_OUTPUT="$PROJECT_DIR/artifacts/ochola-supernet/dist/public"
if [ "$(readlink -f "$BUILD_OUTPUT")" != "$(readlink -f "$PUBLIC_HTML")" ]; then
  rsync -a --delete "$BUILD_OUTPUT/" "$PUBLIC_HTML/"
fi
curl --fail --silent --show-error --max-time 5 \
  http://127.0.0.1:8080/ >/dev/null

echo "Application-only release passed API, static-page, and configured target checks."
