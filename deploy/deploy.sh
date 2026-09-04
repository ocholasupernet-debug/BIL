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

# 1. Use the release delivered by GitHub Actions, or pull latest code when
#    this script is run manually on the VPS.
if [ "${DEPLOY_FROM_ARCHIVE:-0}" = "1" ]; then
  echo "[1/7] Using the release delivered by GitHub Actions..."
  if [ -n "${DEPLOY_SOURCE_COMMIT:-}" ]; then
    echo "      → Source commit: ${DEPLOY_SOURCE_COMMIT}"
  fi
else
  echo "[1/7] Pulling latest from GitHub..."
  git fetch --all
  git reset --hard origin/main
  echo "      → Now on: $(git log -1 --format='%h %s')"
fi

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
      SUPABASE_DB_URL="$database_url" node scripts/apply-deployment-migrations.mjs
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

# 7. Keep tenant HTTPS routes synchronized
#    The timer is intentionally short so a newly-created active admin becomes
#    reachable quickly without requiring a manual VPS command.
echo "[7/8] Installing tenant HTTPS synchronizer..."
install -m 0644 \
  "$PROJECT_DIR/deploy/systemd/ochola-tenant-certificates.service" \
  /etc/systemd/system/ochola-tenant-certificates.service
install -m 0644 \
  "$PROJECT_DIR/deploy/systemd/ochola-tenant-certificates.timer" \
  /etc/systemd/system/ochola-tenant-certificates.timer
systemctl daemon-reload
systemctl enable --now ochola-tenant-certificates.timer

disable_bil_host() {
  local vhost_dir="/etc/nginx/tenant-sites.d"
  local disabled_vhost="${vhost_dir}/00-disabled-bil.isplatty.org.conf"
  local wildcard_cert="/etc/letsencrypt/live/isplatty.org-wildcard"

  if [ ! -r "${wildcard_cert}/fullchain.pem" ] ||
     [ ! -r "${wildcard_cert}/privkey.pem" ]; then
    echo "ERROR: Cannot disable bil.isplatty.org without the active wildcard certificate." >&2
    return 1
  fi

  rm -f "${vhost_dir}/bil.isplatty.org.conf"
  cat > "$disabled_vhost" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name bil.isplatty.org;
    return 410;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name bil.isplatty.org;

    ssl_certificate     ${wildcard_cert}/fullchain.pem;
    ssl_certificate_key ${wildcard_cert}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    return 410;
}
NGINX
  chmod 0644 "$disabled_vhost"
  nginx -t
  systemctl reload nginx
  echo "      ✓ Disabled bil.isplatty.org at Nginx"
}

disable_bil_host
# Keep the public per-router VPN ports aligned with generated RouterOS
# profiles. The service is idempotent and survives VPS reboots.
if [ -f "$PROJECT_DIR/deploy/configure-router-management-ports.sh" ]; then
  echo "[8/9] Configuring per-router management VPN ports..."
  bash "$PROJECT_DIR/deploy/configure-router-management-ports.sh"
fi

normalize_management_interface() {
  local config="$1"
  local interface="$2"

  if [ ! -s "$config" ]; then
    echo "ERROR: Management OpenVPN config is missing: ${config}" >&2
    return 1
  fi
  if ! grep -Eq '^dev[[:space:]]+' "$config"; then
    echo "ERROR: Management OpenVPN config has no dev directive: ${config}" >&2
    return 1
  fi

  sed -i -E "s/^dev[[:space:]].*/dev ${interface}/" "$config"
}

normalize_management_interface \
  "/etc/openvpn/server/ochola-router.conf" "tun-router"
normalize_management_interface \
  "/etc/openvpn/server/ochola-router-backup.conf" "tun-router-bkp"
ensure_management_tunnel() {
  local stem="$1"
  local interface="$2"
  local unit=""
  local attempt

  if systemctl is-active --quiet "openvpn-server@${stem}" 2>/dev/null; then
    unit="openvpn-server@${stem}"
  elif systemctl is-active --quiet "openvpn@${stem}" 2>/dev/null; then
    unit="openvpn@${stem}"
  else
    echo "ERROR: OpenVPN service ${stem} is not active." >&2
    return 1
  fi

  if ! ip link show dev "$interface" >/dev/null 2>&1; then
    echo "  ! ${interface} is absent; restarting ${unit}..."
    systemctl restart "$unit"
  fi

  for attempt in $(seq 1 15); do
    if ip link show dev "$interface" >/dev/null 2>&1; then
      echo "  ✓ ${interface} is present"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: ${unit} is active but did not create ${interface}." >&2
  systemctl status "$unit" --no-pager || true
  journalctl -u "$unit" -n 60 --no-pager || true
  return 1
}

ensure_management_tunnel "ochola-router" "tun-router"
ensure_management_tunnel "ochola-router-backup" "tun-router-bkp"
# 9. Restart API via PM2
#    .env was already sourced in step 3 (set -a), so VITE_SUPABASE_* are in the shell env.
#    Explicitly unset SUPABASE_SERVICE_KEY after sourcing so PM2 doesn't inherit
#    a stale legacy value that could mask the canonical service-role key.
echo "[9/9] Restarting PM2..."
mkdir -p logs
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
  chmod 600 "$PROJECT_DIR/.env"
fi
# Clear old key name; export the canonical name so PM2 picks it up.
unset SUPABASE_SERVICE_KEY
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env standalone --update-env
else
  pm2 start ecosystem.config.cjs --env standalone
  pm2 save
fi

verify_public_health() {
  local host="$1"
  local attempts=30
  local attempt response

  for attempt in $(seq 1 "$attempts"); do
    response=$(curl --silent --show-error --output /dev/null \
      --write-out '%{http_code}' --max-time 15 \
      "https://${host}/api/healthz" 2>&1) || \
      response="curl failed: ${response:-unknown error}"

    if [[ "$response" =~ ^2[0-9][0-9]$ ]]; then
      echo "  ✓ HTTPS health check passed for ${host}"
      return 0
    fi

    echo "  ! HTTPS health check for ${host} returned ${response}; retrying (${attempt}/${attempts})..."
    sleep 2
  done

  echo "ERROR: TLS/API verification failed for ${host} after ${attempts} attempts." >&2
  pm2 status || true
  pm2 logs ocholanet-api --lines 80 --nostream || true
  return 1
}

for host in vpn.isplatty.org; do
  verify_public_health "$host" || exit 1
done

if [ -f "$PROJECT_DIR/deploy/verify-router-management-vps.sh" ]; then
  echo "[10/10] Verifying router-management OpenVPN state..."
  bash "$PROJECT_DIR/deploy/verify-router-management-vps.sh"
fi

echo ""
echo "✓ Deployment complete!"
echo "  Commit: $(git log -1 --format='%h — %s')"
echo "  Site:   https://isplatty.org"
echo "  API:    PM2 (ocholanet-api) port 8080"
echo ""
