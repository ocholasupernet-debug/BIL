#!/bin/bash
##############################################################
# OcholaSupernet — unattended DNS-01 wildcard certificate renewal
#
# Normal operation:
#   certbot renew --cert-name isplatty.org
#
# First-time setup for a certificate that was previously issued with
# Certbot's interactive --manual DNS challenge:
#   CERTBOT_DNS_PLUGIN=cloudflare \
#   CERTBOT_DNS_CREDENTIALS=/root/.secrets/certbot/cloudflare.ini \
#   CERTBOT_EMAIL=admin@example.com \
#   bash deploy/renew-wildcard-certificate.sh --bootstrap
#
# The DNS plugin and credentials file are deliberately supplied by the
# operator. DNS provider credentials must never be committed to the repo.
##############################################################
set -euo pipefail

DOMAIN="${DOMAIN:-isplatty.org}"
CERT_NAME="${CERT_NAME:-$DOMAIN}"
CERTBOT_BIN="${CERTBOT_BIN:-certbot}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RENEWAL_CONFIG="${RENEWAL_CONFIG:-/etc/letsencrypt/renewal/${CERT_NAME}.conf}"
CONFIGURE_SCRIPT="${CONFIGURE_SCRIPT:-$PROJECT_DIR/deploy/configure-wildcard-nginx.sh}"
DNS_PROPAGATION_SECONDS="${DNS_PROPAGATION_SECONDS:-60}"

usage() {
  cat <<USAGE
Usage:
  $0                 Renew the configured certificate unattended.
  $0 --bootstrap    Issue/migrate it using a Certbot DNS plugin, then configure nginx.

Bootstrap variables:
  CERTBOT_DNS_PLUGIN       Certbot plugin name, for example cloudflare
  CERTBOT_DNS_CREDENTIALS  Provider credentials file readable only by root
  CERTBOT_EMAIL            Let's Encrypt account email address
USAGE
}

has_dns_authenticator() {
  [ -r "$RENEWAL_CONFIG" ] &&
    grep -Eq '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*dns-[[:alnum:]_-]+[[:space:]]*$' \
      "$RENEWAL_CONFIG"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "✗ Required command not found: $1"
    exit 1
  }
}

bootstrap_certificate() {
  local plugin="${CERTBOT_DNS_PLUGIN:-}"
  local credentials="${CERTBOT_DNS_CREDENTIALS:-}"
  local email="${CERTBOT_EMAIL:-}"
  local propagation="${DNS_PROPAGATION_SECONDS}"
  local -a dns_args

  require_command "$CERTBOT_BIN"

  if [ -z "$plugin" ] || ! [[ "$plugin" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "✗ Set CERTBOT_DNS_PLUGIN to the installed Certbot DNS plugin name."
    exit 1
  fi
  if [ -z "$credentials" ] || [ ! -r "$credentials" ]; then
    echo "✗ CERTBOT_DNS_CREDENTIALS must point to a readable provider credentials file."
    exit 1
  fi
  if [ -z "$email" ]; then
    echo "✗ Set CERTBOT_EMAIL before bootstrapping the certificate."
    exit 1
  fi
  if ! [[ "$propagation" =~ ^[0-9]+$ ]]; then
    echo "✗ DNS_PROPAGATION_SECONDS must be a non-negative integer."
    exit 1
  fi

  dns_args=(
    "--dns-${plugin}"
    "--dns-${plugin}-credentials" "$credentials"
    "--dns-${plugin}-propagation-seconds" "$propagation"
  )

  echo "Issuing DNS-01 certificate for $DOMAIN and *.$DOMAIN..."
  "$CERTBOT_BIN" certonly \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --cert-name "$CERT_NAME" \
    --force-renewal \
    "${dns_args[@]}" \
    -d "$DOMAIN" \
    -d "*.$DOMAIN"

  DOMAIN="$DOMAIN" PROJECT_DIR="$PROJECT_DIR" \
    bash "$CONFIGURE_SCRIPT"
}

renew_certificate() {
  require_command "$CERTBOT_BIN"

  if ! has_dns_authenticator; then
    echo "✗ $RENEWAL_CONFIG is not configured for an unattended DNS-01 authenticator."
    echo "  Bootstrap once with CERTBOT_DNS_PLUGIN, CERTBOT_DNS_CREDENTIALS, and CERTBOT_EMAIL."
    exit 1
  fi

  echo "Checking DNS-01 renewal for $DOMAIN..."
  "$CERTBOT_BIN" renew \
    --cert-name "$CERT_NAME" \
    --non-interactive \
    --quiet
}

case "${1:-}" in
  --bootstrap)
    [ "$#" -eq 1 ] || { usage >&2; exit 2; }
    bootstrap_certificate
    ;;
  --help|-h)
    usage
    ;;
  "")
    renew_certificate
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac