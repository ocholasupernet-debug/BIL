#!/usr/bin/env bash
#
# Keep HTTPS tenant vhosts aligned with active ISP admin subdomains.
#
# This intentionally uses host-specific certificates. The production
# isplatty.org zone is not managed by the Cloudflare hook, so a wildcard
# certificate cannot be assumed to exist.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/ocholasupernet}"
BASE_DOMAIN="${PUBLIC_BASE_DOMAIN:-isplatty.org}"
CERT_EMAIL="${CERTBOT_EMAIL:-admin@isplatty.org}"
WEBROOT="${TENANT_ACME_WEBROOT:-/var/www/letsencrypt}"
VHOST_DIR="${TENANT_VHOST_DIR:-/etc/nginx/tenant-sites.d}"
REQUESTED_SUBDOMAIN="${1:-}"

if [[ ! "$BASE_DOMAIN" =~ ^[a-z0-9.-]+$ ]]; then
  echo "Invalid PUBLIC_BASE_DOMAIN: $BASE_DOMAIN" >&2
  exit 1
fi
if [[ -n "$REQUESTED_SUBDOMAIN" ]] &&
   [[ ! "$REQUESTED_SUBDOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  echo "Invalid requested tenant subdomain: $REQUESTED_SUBDOMAIN" >&2
  exit 1
fi
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Deployment environment file not found: $PROJECT_DIR/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$PROJECT_DIR/.env"
set +a

SUPABASE_URL="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_KEY:-}}"
if [[ -z "$SUPABASE_URL" || -z "$SERVICE_KEY" ]]; then
  echo "VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required." >&2
  exit 1
fi

mkdir -p "$WEBROOT/.well-known/acme-challenge" "$VHOST_DIR"
chmod 0755 "$WEBROOT" "$WEBROOT/.well-known" "$WEBROOT/.well-known/acme-challenge"

admin_json="$(mktemp)"
trap 'rm -f "$admin_json"' EXIT
export SUPABASE_URL SERVICE_KEY ADMIN_JSON="$admin_json"
python3 - <<'PY'
import json
import os
import urllib.request

url = (
    os.environ["SUPABASE_URL"].rstrip("/")
    + "/rest/v1/isp_admins?select=subdomain&is_active=eq.true"
      "&subdomain=not.is.null&order=id.asc"
)
key = os.environ["SERVICE_KEY"]
request = urllib.request.Request(
    url,
    headers={"apikey": key, "Authorization": "Bearer " + key},
)
with urllib.request.urlopen(request, timeout=30) as response:
    with open(os.environ["ADMIN_JSON"], "wb") as output:
        output.write(response.read())
PY

mapfile -t subdomains < <(
  python3 - "$admin_json" <<'PY'
import json
import re
import sys

reserved = {"www", "api", "vpn", "bil", "register", "latex", "proxyvpn", "mail", "admin"}
pattern = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
print("register")
print("latex")
print("vpn")
print("bil")
with open(sys.argv[1], encoding="utf-8") as source:
    rows = json.load(source)
for row in rows:
    value = str(row.get("subdomain") or "").strip().lower()
    if value and pattern.fullmatch(value) and value not in reserved:
        print(value)
PY
)

if [[ -n "$REQUESTED_SUBDOMAIN" ]]; then
  if ! printf '%s\n' "${subdomains[@]}" | grep -Fxq "$REQUESTED_SUBDOMAIN"; then
    echo "Requested tenant subdomain is not active: $REQUESTED_SUBDOMAIN" >&2
    exit 1
  fi
  subdomains=("$REQUESTED_SUBDOMAIN")
fi

rm -f "$VHOST_DIR/bil.isplatty.org.conf"

if [[ "${#subdomains[@]}" -eq 0 ]]; then
  echo "No active tenant subdomains found."
  exit 0
fi

failed=0
for subdomain in "${subdomains[@]}"; do
  host="${subdomain}.${BASE_DOMAIN}"
  cert_dir="/etc/letsencrypt/live/$host"
  snippet="$VHOST_DIR/$host.conf"

  certificate_valid=false
  if [[ -r "$cert_dir/fullchain.pem" && -r "$cert_dir/privkey.pem" ]] &&
     openssl x509 -in "$cert_dir/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
       grep -Fq "DNS:${host}"; then
    certificate_valid=true
  fi

  if [[ "$certificate_valid" != true ]]; then
    echo "Issuing certificate for $host..."
    if ! certbot certonly \
      --webroot \
      --webroot-path "$WEBROOT" \
      --non-interactive \
      --agree-tos \
      --email "$CERT_EMAIL" \
      --preferred-challenges http \
      --keep-until-expiring \
      --cert-name "$host" \
      -d "$host"
    then
      echo "Certificate issuance failed for $host." >&2
      failed=1
      continue
    fi
  else
    echo "Certificate already present for $host."
  fi

  temporary="$(mktemp "$VHOST_DIR/.tenant.XXXXXX")"
  cat > "$temporary" <<NGINX
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $host;

    ssl_certificate     $cert_dir/fullchain.pem;
    ssl_certificate_key $cert_dir/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
    add_header          Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              \$http_host;
        proxy_set_header   X-Forwarded-Host  \$http_host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;
    }
}
NGINX
  install -m 0644 "$temporary" "$snippet"
  rm -f "$temporary"
done

if ! nginx -t; then
  echo "Nginx rejected the generated tenant configuration." >&2
  exit 1
fi
systemctl reload nginx

if [[ "$failed" -ne 0 ]]; then
  echo "One or more tenant certificates failed; successful routes were reloaded." >&2
  exit 1
fi

echo "Tenant HTTPS synchronization complete (${#subdomains[@]} active tenants)."