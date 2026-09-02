#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="isplatty.org"
CERT_NAME="${DOMAIN}-wildcard"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
REQUIRED_CERT_NAME="${DOMAIN}-required-hosts"
REQUIRED_CERT_DIR="/etc/letsencrypt/live/${REQUIRED_CERT_NAME}"
APEX_CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
TENANT_VHOST_DIR="/etc/nginx/tenant-sites.d"
has_wildcard_certificate() {
  [ -r "${CERT_DIR}/fullchain.pem" ] &&
    [ -r "${CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:*.${DOMAIN}" &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:${DOMAIN}"
}

has_required_host_certificate() {
  [ -r "${REQUIRED_CERT_DIR}/fullchain.pem" ] &&
    [ -r "${REQUIRED_CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${REQUIRED_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:bil.${DOMAIN}" &&
    openssl x509 -in "${REQUIRED_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:vpn.${DOMAIN}"
}

has_apex_certificate() {
  [ -r "${APEX_CERT_DIR}/fullchain.pem" ] &&
    [ -r "${APEX_CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${APEX_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:${DOMAIN}"
}

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  install -d -m 0700 /etc/letsencrypt
  printf '%s' "$CLOUDFLARE_API_TOKEN" > /etc/letsencrypt/cloudflare-api-token
  chmod 600 /etc/letsencrypt/cloudflare-api-token
fi

if ! has_wildcard_certificate; then
  # Cloudflare DNS-01 is preferred when the zone is actually managed there.
  # Never preserve an apex-only certificate: router installers require the
  # exact tenant and VPN hostnames to pass normal TLS validation.
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] &&
     python3 "${PROJECT_DIR}/deploy/cloudflare-dns-hook.py" verify; then
    certbot certonly \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
      --manual \
      --preferred-challenges dns \
      --manual-public-ip-logging-ok \
      --manual-auth-hook "python3 ${PROJECT_DIR}/deploy/cloudflare-dns-hook.py auth" \
      --manual-cleanup-hook "python3 ${PROJECT_DIR}/deploy/cloudflare-dns-hook.py cleanup" \
      --cert-name "${CERT_NAME}" \
      --expand \
      --keep-until-expiring \
      -d "${DOMAIN}" \
      -d "*.${DOMAIN}" || true
  fi
fi

if has_wildcard_certificate; then
  install -d -m 0755 "${TENANT_VHOST_DIR}" /var/www/letsencrypt/.well-known/acme-challenge
  install -m 0644 "${PROJECT_DIR}/deploy/nginx.conf" "${NGINX_SITE}"
else
  # Namecheap-managed DNS cannot use the Cloudflare DNS hook. Use a single
  # short-lived HTTP-01 certificate for the two mandatory non-wildcard hosts.
  # Nginx is stopped only while certbot binds port 80 and is always restarted
  # before this script returns.
  if ! has_required_host_certificate; then
    nginx_was_active=false
    if systemctl is-active --quiet nginx; then
      systemctl stop nginx
      nginx_was_active=true
    fi
    certbot_status=0
    certbot certonly \
      --standalone \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
      --preferred-challenges http \
      --http-01-port 80 \
      --keep-until-expiring \
      --cert-name "${REQUIRED_CERT_NAME}" \
      -d "bil.${DOMAIN}" \
      -d "vpn.${DOMAIN}" || certbot_status=$?
    if [ "$nginx_was_active" = true ]; then
      systemctl start nginx
    fi
    if [ "$certbot_status" -ne 0 ]; then
      echo "Unable to issue certificates for bil.${DOMAIN} and vpn.${DOMAIN}." >&2
      exit "$certbot_status"
    fi
  fi

  if ! has_required_host_certificate || ! has_apex_certificate; then
    echo "Required apex, tenant, or VPN certificate is missing or has invalid SANs." >&2
    exit 1
  fi

  install -d -m 0755 "${TENANT_VHOST_DIR}" /var/www/letsencrypt/.well-known/acme-challenge
  install -m 0644 "${PROJECT_DIR}/deploy/nginx-host-specific.conf" "${NGINX_SITE}"

  for host in "bil.${DOMAIN}" "vpn.${DOMAIN}"; do
    temporary="$(mktemp "${TENANT_VHOST_DIR}/.required.XXXXXX")"
    cat > "$temporary" <<NGINX
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${host};

    ssl_certificate     ${REQUIRED_CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${REQUIRED_CERT_DIR}/privkey.pem;
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
    install -m 0644 "$temporary" "${TENANT_VHOST_DIR}/${host}.conf"
    rm -f "$temporary"
  done
fi

ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "Wildcard Nginx routing is active for *.${DOMAIN}."