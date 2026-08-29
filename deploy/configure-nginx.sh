#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="isplatty.org"
CERT_NAME="${DOMAIN}-wildcard"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
TEMP_CERT_DIR=""

cleanup_temp_certificate() {
  if [ -n "$TEMP_CERT_DIR" ] && [ -d "$TEMP_CERT_DIR" ]; then
    rm -rf "$TEMP_CERT_DIR"
  fi
}
trap cleanup_temp_certificate EXIT

has_wildcard_certificate() {
  [ -r "${CERT_DIR}/fullchain.pem" ] &&
    [ -r "${CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:*.${DOMAIN}" &&
    openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:${DOMAIN}"
}

install_supplied_certificate() {
  : "${WILDCARD_CERT_B64:?WILDCARD_CERT_B64 is required}"
  : "${WILDCARD_CERT_KEY_B64:?WILDCARD_CERT_KEY_B64 is required}"

  TEMP_CERT_DIR="$(mktemp -d)"
  chmod 700 "$TEMP_CERT_DIR"
  printf '%s' "$WILDCARD_CERT_B64" | base64 --decode > "$TEMP_CERT_DIR/fullchain.pem"
  printf '%s' "$WILDCARD_CERT_KEY_B64" | base64 --decode > "$TEMP_CERT_DIR/privkey.pem"
  chmod 600 "$TEMP_CERT_DIR/privkey.pem"

  openssl x509 -in "$TEMP_CERT_DIR/fullchain.pem" -noout >/dev/null
  openssl pkey -in "$TEMP_CERT_DIR/privkey.pem" -noout >/dev/null
  openssl x509 -in "$TEMP_CERT_DIR/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
    grep -Fq "DNS:*.${DOMAIN}" ||
    { echo "Supplied certificate does not cover *.${DOMAIN}." >&2; exit 1; }
  openssl x509 -in "$TEMP_CERT_DIR/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
    grep -Fq "DNS:${DOMAIN}" ||
    { echo "Supplied certificate does not cover ${DOMAIN}." >&2; exit 1; }

  cert_public_key=$(
    openssl x509 -in "$TEMP_CERT_DIR/fullchain.pem" -pubkey -noout |
      openssl pkey -pubin -outform DER | sha256sum
  )
  key_public_key=$(
    openssl pkey -in "$TEMP_CERT_DIR/privkey.pem" -pubout -outform DER |
      sha256sum
  )
  [ "$cert_public_key" = "$key_public_key" ] ||
    { echo "Supplied certificate and private key do not match." >&2; exit 1; }

  install -d -m 0700 "$CERT_DIR"
  install -m 0644 "$TEMP_CERT_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
  install -m 0600 "$TEMP_CERT_DIR/privkey.pem" "$CERT_DIR/privkey.pem"
  echo "Installed the supplied wildcard certificate."
}

if [ -n "${WILDCARD_CERT_B64:-}" ] || [ -n "${WILDCARD_CERT_KEY_B64:-}" ]; then
  install_supplied_certificate
elif ! has_wildcard_certificate; then
  echo "No valid wildcard certificate is installed." >&2
  echo "Provide WILDCARD_CERT_B64 and WILDCARD_CERT_KEY_B64 to install one." >&2
  exit 1
fi

if ! has_wildcard_certificate; then
  echo "A valid wildcard certificate for *.${DOMAIN} is not installed." >&2
  exit 1
fi

install -m 0644 "${PROJECT_DIR}/deploy/nginx.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "Wildcard Nginx routing is active for *.${DOMAIN}."