#!/usr/bin/env bash
#
# Keep HTTPS tenant vhosts aligned with active ISP admin subdomains and
# externally configured Hotspot portal hostnames.
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
import sys
import time
import urllib.error
import urllib.request

key = os.environ["SERVICE_KEY"]
base_url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"

def fetch_rows(table, query, optional=False):
    url = base_url + table + "?" + query
    request = urllib.request.Request(
        url,
        headers={"apikey": key, "Authorization": "Bearer " + key},
    )
    last_error = "unknown error"
    max_attempts = 4
    for attempt in range(1, max_attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                rows = json.loads(response.read())
            if not isinstance(rows, list):
                raise SystemExit(f"Supabase {table} lookup returned invalid data.")
            return rows
        except urllib.error.HTTPError as error:
            if optional and error.code == 404:
                print(
                    f"Supabase {table} is unavailable; custom portal hosts will be skipped.",
                    file=sys.stderr,
                )
                return []
            if error.code not in (408, 429) and error.code < 500:
                raise SystemExit(
                    f"Supabase {table} lookup returned HTTP {error.code}."
                ) from None
            last_error = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = type(error).__name__

        if attempt < max_attempts:
            delay = 2 ** (attempt - 1)
            print(
                f"Supabase {table} lookup failed ({last_error}); "
                f"retrying in {delay}s ({attempt}/{max_attempts}).",
                file=sys.stderr,
            )
            time.sleep(delay)

    raise SystemExit(
        f"Supabase {table} lookup failed after {max_attempts} attempts "
        f"({last_error})."
    )

admins = fetch_rows(
    "isp_admins",
    "select=id,subdomain&is_active=eq.true&order=id.asc",
)
branding = fetch_rows(
    "isp_hotspot_branding",
    "select=admin_id,portal_hostname&portal_hostname=not.is.null&order=admin_id.asc",
    optional=True,
)
with open(os.environ["ADMIN_JSON"], "wb") as output:
    output.write(json.dumps({"admins": admins, "branding": branding}).encode("utf-8"))
PY

mapfile -t subdomains < <(
  python3 - "$admin_json" <<'PY'
import json
import re
import sys

reserved = {"www", "api", "vpn", "bil", "register", "latex", "proxyvpn", "mail", "admin"}
pattern = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
# Reserved API hostname still needs an exact certificate when wildcard TLS is
# unavailable; its API vhost will be generated below like other service hosts.
print("api")
print("register")
print("latex")
print("vpn")
with open(sys.argv[1], encoding="utf-8") as source:
    payload = json.load(source)
for row in payload.get("admins", []):
    value = str(row.get("subdomain") or "").strip().lower()
    if value and pattern.fullmatch(value) and value not in reserved:
        print(value)
PY
)

mapfile -t custom_hosts < <(
  python3 "$PROJECT_DIR/deploy/tenant_portal_hosts.py" "$admin_json" "$BASE_DOMAIN"
)

if [[ -n "$REQUESTED_SUBDOMAIN" ]]; then
  if ! printf '%s\n' "${subdomains[@]}" | grep -Fxq "$REQUESTED_SUBDOMAIN"; then
    echo "Requested tenant subdomain is not active: $REQUESTED_SUBDOMAIN" >&2
    exit 1
  fi
  subdomains=("$REQUESTED_SUBDOMAIN")
  custom_hosts=()
fi

rm -f "$VHOST_DIR/bil.isplatty.org.conf"

route_hosts=()
for subdomain in "${subdomains[@]}"; do
  route_hosts+=("${subdomain}.${BASE_DOMAIN}")
done
for host in "${custom_hosts[@]}"; do
  route_hosts+=("$host")
done

if [[ "${#route_hosts[@]}" -eq 0 ]]; then
  echo "No active tenant or custom portal hosts found."
  exit 0
fi

resolve_ipv4_set() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u
}

reference_ipv4="$(resolve_ipv4_set "$BASE_DOMAIN" || true)"
failed=0
for host in "${route_hosts[@]}"; do
  if [[ "$host" != *".${BASE_DOMAIN}" ]]; then
    host_ipv4="$(resolve_ipv4_set "$host" || true)"
    if [[ -z "$host_ipv4" ]]; then
      echo "Skipping custom portal hostname $host: it has no public IPv4 DNS record."
      continue
    fi
    if [[ -z "$reference_ipv4" || "$host_ipv4" != "$reference_ipv4" ]]; then
      echo "Skipping custom portal hostname $host: its IPv4 DNS must match $BASE_DOMAIN."
      continue
    fi
  fi

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

    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css text/javascript application/javascript;

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
        # RouterOS service deployments can take several minutes.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
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

echo "Tenant HTTPS synchronization complete (${#route_hosts[@]} tenant and custom portal hosts)."