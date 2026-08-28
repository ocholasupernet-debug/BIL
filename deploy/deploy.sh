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

  # The current VPS uses nginx as a full reverse proxy to PM2. Detect this
  # active topology first so stale CyberPanel directories can never win.
  if systemctl is-active --quiet nginx 2>/dev/null; then
    for nginx_conf in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
      [ -r "$nginx_conf" ] || continue
      grep -Eq 'server_name[^;]*isplatty\.org' "$nginx_conf" || continue

      if grep -Eq 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):8080' "$nginx_conf"; then
        printf '%s\n' "$PROJECT_DIR/artifacts/ochola-supernet/dist/public"
        return
      fi

      doc_root=$(awk '$1 == "root" { gsub(/;/, "", $2); print $2; exit }' "$nginx_conf")
      if [ -n "$doc_root" ]; then
        printf '%s\n' "$doc_root"
        return
      fi
    done
  fi

  # Only use a LiteSpeed root when LiteSpeed is active and the exact
  # isplatty.org vhost configuration exists.
  if ! systemctl is-active --quiet lsws 2>/dev/null &&
     ! systemctl is-active --quiet openlitespeed 2>/dev/null
  then
    return
  fi
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
echo "[2/7] Installing dependencies..."
pnpm install --no-frozen-lockfile

# Load deployment values from the VPS environment before database checks and
# builds. The workflow writes the values into .env before calling this script.
load_deploy_env() {
  if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
    set +a
  fi
}

apply_supabase_migration() {
  local migration_file="$PROJECT_DIR/artifacts/api-server/migrations/2026_admin_initial_password_setup.sql"
  local database_url="${SUPABASE_DB_URL:-${SUPABASE_DATABASE_URL:-}}"

  [ -f "$migration_file" ] || {
    echo "      ✗ Migration file not found: $migration_file"
    exit 1
  }

  if [ -n "$database_url" ]; then
    echo "      Applying admin password setup migration..."
    (
      cd "$PROJECT_DIR/artifacts/api-server"
      SUPABASE_DB_URL="$database_url" node scripts/apply-admin-password-migration.mjs
    )
    echo "      ✓ Supabase migration applied"
    return
  fi

  # A direct Postgres URL is intentionally required for DDL. If the VPS only
  # has REST credentials, verify that this one-time migration is already
  # applied instead of pretending REST can execute arbitrary SQL.
  local supabase_url="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
  local service_key="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_KEY:-}}"
  if [ -z "$supabase_url" ] || [ -z "$service_key" ]; then
    echo "      ✗ Set SUPABASE_DB_URL to apply the Supabase migration, or provide"
    echo "        VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to verify it."
    exit 1
  fi

  local schema_status
  schema_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 \
    -H "apikey: $service_key" \
    -H "Authorization: Bearer $service_key" \
    "$supabase_url/rest/v1/isp_admins?select=must_change_password&limit=1")
  case "$schema_status" in
    2??)
      echo "      ✓ Supabase migration already applied (must_change_password is queryable)"
      ;;
    *)
      echo "      ✗ Supabase migration is not applied (REST check returned HTTP $schema_status)"
      echo "        Configure SUPABASE_DB_URL so deployment can apply it safely."
      exit 1
      ;;
  esac
}

load_deploy_env

# 3. Apply the one-time schema migration before building or restarting the API.
echo "[3/7] Applying Supabase schema migration..."
apply_supabase_migration

# 4. Build the frontend (VPS config — no Replit plugins)
#    .env has already been loaded so VITE_SUPABASE_URL / VITE_SUPABASE_KEY are embedded at build time
echo "[4/7] Building frontend..."
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
  echo "      ✓ Sourced .env (VITE_SUPABASE_URL=${VITE_SUPABASE_URL:+set})"
else
  echo "      ⚠ No .env found — Supabase env vars may be missing"
fi
cd "$PROJECT_DIR/artifacts/ochola-supernet"
BASE_PATH="/" pnpm run build:vps
cd "$PROJECT_DIR"

# 5. Build the API server
echo "[5/7] Building API server..."
cd "$PROJECT_DIR/artifacts/api-server"
pnpm run build
cd "$PROJECT_DIR"

# 6. Publish frontend build → the active web root
echo "[6/7] Publishing frontend to the active web root..."
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

# 6b. Require and enable DNS-01 wildcard subdomain routing without replacing
#     the existing Certbot-managed apex configuration. The helper also checks
#     that the generated vhost is present in nginx's loaded configuration and
#     installs the deploy hook used after unattended certificate renewal.
echo "[6b/7] Configuring wildcard subdomain routing..."
if command -v nginx >/dev/null 2>&1 &&
   systemctl is-active --quiet nginx 2>/dev/null &&
   [ -f "$PROJECT_DIR/deploy/configure-wildcard-nginx.sh" ]; then
  DOMAIN="isplatty.org" PROJECT_DIR="$PROJECT_DIR" \
    bash "$PROJECT_DIR/deploy/configure-wildcard-nginx.sh"
else
  echo "      ⚠ Nginx wildcard helper skipped (nginx is not active)"
fi

# 7. Restart API via PM2
#    .env was already sourced in step 3 (set -a), so VITE_SUPABASE_* are in the shell env.
#    Explicitly unset SUPABASE_SERVICE_KEY after sourcing so PM2 doesn't inherit
#    a stale legacy value that could mask the canonical service-role key.
echo "[7/7] Restarting PM2..."
mkdir -p logs
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi
# Clear old key name; export the canonical name so PM2 picks it up.
unset SUPABASE_SERVICE_KEY
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
