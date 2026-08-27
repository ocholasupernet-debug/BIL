#!/bin/bash
##############################################################
# OcholaSupernet — VPS Deployment Script
# Run from the project root:  bash deploy/deploy.sh
##############################################################
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Resolve the document root used by the active isplatty.org web server.
# PUBLIC_HTML remains an explicit override for non-standard installations.
resolve_ols_path() {
  local path="$1"
  local vh_root="${2:-}"
  path="${path//\$SERVER_ROOT/\/usr\/local\/lsws}"
  path="${path//\$VH_ROOT/$vh_root}"
  readlink -f "$path" 2>/dev/null || printf '%s\n' "${path%/}"
}

find_public_html() {
  local vhost_conf doc_root vh_root main_conf nginx_conf

  for vhost_conf in \
    /usr/local/lsws/conf/vhosts/isplatty.org/vhost.conf \
    /usr/local/lsws/conf/vhosts/isplatty.org/vhconf.conf
  do
    [ -r "$vhost_conf" ] || continue
    doc_root=$(awk '$1 == "docRoot" { print $2; exit }' "$vhost_conf")
    [ -n "$doc_root" ] || continue

    vh_root=$(awk '$1 == "vhRoot" { print $2; exit }' "$vhost_conf")
    if [ -z "$vh_root" ]; then
      for main_conf in /usr/local/lsws/conf/httpd_config.conf /usr/local/lsws/conf/httpd_config.xml; do
        [ -r "$main_conf" ] || continue
        vh_root=$(awk '
          $1 == "virtualhost" && $2 == "isplatty.org" { in_vhost=1; next }
          in_vhost && $1 == "vhRoot" { print $2; exit }
          in_vhost && /^}/ { exit }
        ' "$main_conf")
        [ -n "$vh_root" ] && break
      done
    fi

    vh_root=$(resolve_ols_path "${vh_root:-$(dirname "$vhost_conf")}")
    resolve_ols_path "$doc_root" "$vh_root"
    return
  done

  for doc_root in \
    /home/isplatty.org/public_html \
    /home/ocholasupernet/public_html \
    /usr/local/lsws/Example/html
  do
    [ -d "$doc_root" ] && printf '%s\n' "$doc_root" && return
  done

  doc_root=$(find /home /usr/local/lsws -maxdepth 5 -type d -name public_html 2>/dev/null | head -1)
  if [ -n "$doc_root" ]; then
    printf '%s\n' "$doc_root"
    return
  fi

  # The current VPS uses nginx as a full reverse proxy to PM2. In standalone
  # mode the API serves the frontend directly from the build output directory,
  # making that directory the active document root.
  for nginx_conf in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -r "$nginx_conf" ] || continue
    if grep -Eq 'server_name[^;]*isplatty\.org' "$nginx_conf" &&
       grep -Eq 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):8080' "$nginx_conf"
    then
      printf '%s\n' "$PROJECT_DIR/artifacts/ochola-supernet/dist/public"
      return
    fi
  done
}

PUBLIC_HTML="${PUBLIC_HTML:-$(find_public_html)}"

echo "══════════════════════════════════════════"
echo "  OcholaSupernet — Deploying to VPS"
echo "  Dir:         $PROJECT_DIR"
echo "  web root:    ${PUBLIC_HTML:-NOT FOUND}"
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

# 5. Publish frontend build → the active web root
echo "[5/6] Publishing frontend to the active web root..."
if [ -z "$PUBLIC_HTML" ] || [ ! -d "$PUBLIC_HTML" ]; then
  echo "      ✗ Active web root not found: ${PUBLIC_HTML:-NOT FOUND}"
  exit 1
fi
BUILD_OUTPUT="$PROJECT_DIR/artifacts/ochola-supernet/dist/public"
if [ "$(readlink -f "$BUILD_OUTPUT")" = "$(readlink -f "$PUBLIC_HTML")" ]; then
  echo "      ✓ Build output is the active web root: $PUBLIC_HTML"
else
  rsync -a --delete \
    "$BUILD_OUTPUT/" \
    "$PUBLIC_HTML/"
  echo "      ✓ Synced to $PUBLIC_HTML"
fi

# 6. Restart API via PM2
#    .env was already sourced in step 3 (set -a), so VITE_SUPABASE_* are in the shell env.
#    Explicitly unset SUPABASE_SERVICE_KEY so PM2 doesn't inherit a stale empty-string
#    value from a previous deploy — ecosystem.config.cjs only injects it when non-empty.
echo "[6/6] Restarting PM2..."
mkdir -p logs
# Clear old key name; export the canonical name so PM2 picks it up
unset SUPABASE_SERVICE_KEY
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi
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
