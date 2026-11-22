#!/usr/bin/env bash
# Install the Staff page and host-specific origin TLS without touching BIL runtime state.
# Run by the pinned, manual Staff-host repair workflow.
set -euo pipefail
umask 077

host=staff.isplatty.com
cert_name=isplatty-staff
cert_dir="/etc/letsencrypt/live/$cert_name"
site="/etc/nginx/tenant-sites.d/$host.conf"
challenge_dir=/var/www/letsencrypt/.well-known/acme-challenge
project=/var/www/ocholasupernet
public="$project/artifacts/ochola-supernet/dist/public"
archive=/tmp/staff-host-assets.tgz

[[ "${STAFF_HOST_REPAIR:-}" == "true" ]] || {
  echo "Staff host repair requires its explicit workflow guard." >&2
  exit 1
}
[[ "$(id -u)" == "0" ]] || {
  echo "Staff host repair requires the configured root deployment account." >&2
  exit 1
}

exec 9>/run/lock/bil-staff-host-https.lock
flock -n 9 || { echo "Staff host HTTPS repair is already running." >&2; exit 1; }

fail() { echo "$1" >&2; exit 1; }
probe_bil() {
  curl -fSs --max-time 8 http://127.0.0.1:8080/api/healthz >/dev/null
}
probe_staff_origin() {
  curl --noproxy '*' -fSs --max-time 8 \
    --resolve "$host:443:127.0.0.1" "https://$host/api/healthz" >/dev/null
}
has_current_certificate() {
  [[ -r "$cert_dir/fullchain.pem" && -r "$cert_dir/privkey.pem" ]] &&
    openssl x509 -in "$cert_dir/fullchain.pem" -checkend 86400 -noout >/dev/null &&
    [[ "$(openssl x509 -in "$cert_dir/fullchain.pem" -checkhost "$host" -noout)" == *"does match certificate"* ]]
}

probe_bil || fail "Existing BIL API is not healthy; no Staff host changes made."
[[ -s "$archive" && -d "$public" && ! -L "$public" ]] ||
  fail "The reviewed Staff page archive or current static site is missing."
if probe_staff_origin 2>/dev/null; then
  echo "Staff origin already passes strict HTTPS and BIL health checks; preserving its existing vhost."
  origin_ready=true
else
  origin_ready=false
  [[ -d /etc/nginx/tenant-sites.d && -d "$challenge_dir" && ! -L "$challenge_dir" ]] ||
    fail "Expected BIL Nginx include directory or Certbot webroot is missing."
  [[ ! -e "$site" && ! -L "$site" ]] ||
    fail "A Staff vhost already exists and failed verification; refusing to overwrite it."

  nginx_config=$(nginx -T 2>/dev/null) || fail "Existing Nginx configuration did not pass validation."
  [[ "$nginx_config" == *"include /etc/nginx/tenant-sites.d/*.conf;"* ]] ||
    fail "The active Nginx configuration does not include the BIL tenant vhost directory."
  if grep -Eq '^[[:space:]]*server_name[[:space:]][^;]*staff\.isplatty\.com([[:space:];]|$)' <<<"$nginx_config"; then
    fail "Nginx already declares staff.isplatty.com; refusing to create a duplicate vhost."
  fi
  unset nginx_config
fi

probe_file=
staged=
installed=false
asset_backup=
assets_replaced=false
cleanup() {
  local status=$?
  trap - EXIT
  [[ -z "$probe_file" ]] || rm -f -- "$probe_file"
  [[ -z "$staged" ]] || rm -rf -- "$staged"
  if [[ "$status" -ne 0 ]]; then
    if [[ "$assets_replaced" == true && -n "$asset_backup" ]]; then
      rsync -a --delete --delay-updates "$asset_backup/" "$public/" ||
        echo "Warning: static-file rollback needs inspection." >&2
    fi
    if [[ "$installed" == true ]]; then
      rm -f -- "$site"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx ||
        echo "Warning: inspect Nginx after removing the unverified Staff vhost." >&2
    fi
  fi
  rm -f -- "$archive"
  exit "$status"
}
trap cleanup EXIT

if [[ "$origin_ready" != true ]]; then
  if ! has_current_certificate; then
    nonce=$(openssl rand -hex 24)
    probe_file="$challenge_dir/bil-$nonce"
    printf '%s' "$nonce" >"$probe_file"
    chmod 0644 "$probe_file"
    result=$(curl -fSs --max-time 15 "http://$host/.well-known/acme-challenge/bil-$nonce") ||
      fail "Public HTTP-01 validation did not reach the BIL webroot; no Nginx site was changed."
    [[ "$result" == "$nonce" ]] ||
      fail "Public HTTP-01 validation reached an unexpected response; no Nginx site was changed."
    rm -f -- "$probe_file"
    probe_file=
    certbot certonly --webroot -w /var/www/letsencrypt --non-interactive \
      --agree-tos --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
      --preferred-challenges http --keep-until-expiring \
      --cert-name "$cert_name" -d "$host"
    has_current_certificate || fail "Certbot did not issue a current certificate for staff.isplatty.com."
  fi

  staged=$(mktemp /etc/nginx/tenant-sites.d/.staff-host.XXXXXX)
  cat >"$staged" <<'NGINX'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name staff.isplatty.com;

    ssl_certificate /etc/letsencrypt/live/isplatty-staff/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/isplatty-staff/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
    }
}
NGINX
  chmod 0644 "$staged"
  ln -- "$staged" "$site" || fail "Another process created a Staff vhost; refusing to replace it."
  installed=true
  rm -f -- "$staged"
  staged=

  test_output=$(nginx -t 2>&1) || fail "The new Staff vhost did not pass nginx -t; rolling it back."
  [[ "$test_output" != *'conflicting server name "staff.isplatty.com"'* ]] ||
    fail "Nginx reports a conflicting Staff hostname; rolling back."
  systemctl reload nginx
fi

backup_root=/var/backups/ocholasupernet/staff-host
install -d -m 0750 "$backup_root"
asset_backup=$(mktemp -d "$backup_root/before.XXXXXX")
cp -a "$public/." "$asset_backup/"
staged=$(mktemp -d "$project/artifacts/ochola-supernet/.staff-public.XXXXXX")
tar -xzf "$archive" -C "$staged"
[[ -s "$staged/index.html" ]] ||
  fail "The Staff page archive has no index.html; rolling back."
grep -R -l -F "Staff sign-in is temporarily unavailable" "$staged/assets" >/dev/null ||
  fail "The Staff page bundle is missing its safe status page; rolling back."
assets_replaced=true
rsync -a --delete --delay-updates "$staged/" "$public/"

for attempt in 1 2 3 4 5; do
  if probe_staff_origin && probe_bil &&
    curl --noproxy '*' -fSs --max-time 8 --resolve "$host:443:127.0.0.1" \
      "https://$host/staff/login" >/dev/null; then
    echo "Staff page and API pass strict origin TLS checks; PM2 and the database were not changed."
    exit 0
  fi
  sleep 2
done
fail "Staff page HTTPS or BIL API check failed; rolling back the static files and any new Staff vhost."
