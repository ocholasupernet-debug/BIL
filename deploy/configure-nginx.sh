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
      grep -Fq "DNS:*.${DOMAIN}"
}

if ! has_wildcard_certificate; then
  : "${NAMECHEAP_API_USER:?NAMECHEAP_API_USER is required to issue the wildcard certificate}"
  : "${NAMECHEAP_API_KEY:?NAMECHEAP_API_KEY is required to issue the wildcard certificate}"
  export NAMECHEAP_CLIENT_IP="${NAMECHEAP_CLIENT_IP:-102.203.116.204}"

  certbot certonly \
    --non-interactive \
    --agree-tos \
    --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
    --manual \
    --preferred-challenges dns \
    --manual-auth-hook "python3 ${PROJECT_DIR}/deploy/namecheap-dns-hook.py auth" \
    --manual-cleanup-hook "python3 ${PROJECT_DIR}/deploy/namecheap-dns-hook.py cleanup" \
    --cert-name "${CERT_NAME}" \
    --keep-until-expiring \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
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