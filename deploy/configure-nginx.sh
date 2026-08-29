#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="isplatty.org"
CERT_NAME="${DOMAIN}-wildcard"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
has_wildcard_certificate() {
  [ -r "${CERT_DIR}/fullchain.pem" ] &&
    [ -r "${CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:*.${DOMAIN}" &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:${DOMAIN}"
}

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  install -d -m 0700 /etc/letsencrypt
  printf '%s' "$CLOUDFLARE_API_TOKEN" > /etc/letsencrypt/cloudflare-api-token
  chmod 600 /etc/letsencrypt/cloudflare-api-token
fi

if ! has_wildcard_certificate; then
  : "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required to issue or renew the wildcard certificate}"

  if ! python3 "${PROJECT_DIR}/deploy/cloudflare-dns-hook.py" verify; then
    if systemctl is-active --quiet nginx && nginx -t; then
      echo "Cloudflare cannot manage ${DOMAIN}; preserving the active Nginx/TLS configuration." >&2
      echo "Application deployment will continue without changing certificates." >&2
      exit 0
    fi
    echo "Cloudflare cannot manage ${DOMAIN}, and no healthy Nginx service is available." >&2
    exit 1
  fi

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
    -d "*.${DOMAIN}"
fi

if ! has_wildcard_certificate; then
  echo "A valid wildcard certificate for *.${DOMAIN} was not issued." >&2
  exit 1
fi

install -m 0644 "${PROJECT_DIR}/deploy/nginx.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "Wildcard Nginx routing is active for *.${DOMAIN}."