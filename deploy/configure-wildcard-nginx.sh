#!/bin/bash
##############################################################
# Configure the wildcard ISP-host vhost after a DNS-01 wildcard
# Let's Encrypt certificate has been issued, and install the renewal hook.
#
# This helper is deliberately strict: a successful deployment must have
# one certificate covering both the apex and every first-level ISP host.
##############################################################
set -euo pipefail

DOMAIN="${DOMAIN:-isplatty.org}"
PROJECT_DIR="${PROJECT_DIR:-/var/www/ocholasupernet}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/$DOMAIN}"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
WILDCARD_CONF="${WILDCARD_CONF:-/etc/nginx/conf.d/${DOMAIN}-wildcard.conf}"
RENEWAL_HOOK_DIR="${RENEWAL_HOOK_DIR:-/etc/letsencrypt/renewal-hooks/deploy}"
RENEWAL_HOOK="${RENEWAL_HOOK:-$RENEWAL_HOOK_DIR/${DOMAIN}-wildcard.sh}"
RENEWAL_SCRIPT="${RENEWAL_SCRIPT:-$PROJECT_DIR/deploy/renew-wildcard-certificate.sh}"
RENEWAL_CONFIG="${RENEWAL_CONFIG:-/etc/letsencrypt/renewal/${DOMAIN}.conf}"

if [ ! -r "$CERT_FILE" ] || [ ! -r "$KEY_FILE" ]; then
  echo "  ✗ Wildcard vhost cannot be enabled: certificate files are not available."
  echo "    Issue a DNS-01 certificate for ${DOMAIN} and *.${DOMAIN}, then deploy again."
  exit 1
fi

certificate_has_dns_name() {
  local name="$1"
  openssl x509 -in "$CERT_FILE" -noout -ext subjectAltName 2>/dev/null \
    | tr ',' '\n' \
    | tr -s '[:space:]' '\n' \
    | grep -Fxq "DNS:${name}"
}

if ! certificate_has_dns_name "$DOMAIN" ||
   ! certificate_has_dns_name "*.${DOMAIN}"; then
  echo "  ✗ Wildcard vhost cannot be enabled: $CERT_FILE must contain both:"
  echo "      DNS:${DOMAIN}"
  echo "      DNS:*.${DOMAIN}"
  echo "    Issue a DNS-01 certificate for both names, then deploy again."
  exit 1
fi

if [ ! -r "$RENEWAL_CONFIG" ] ||
   ! grep -Eq '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*dns-[[:alnum:]_-]+[[:space:]]*$' \
     "$RENEWAL_CONFIG"; then
  echo "  ✗ Automatic renewal is not configured for $DOMAIN."
  echo "    Bootstrap the certificate with deploy/renew-wildcard-certificate.sh"
  echo "    and an installed Certbot DNS plugin before enabling wildcard routing."
  exit 1
fi

install_renewal_hook() {
  local quoted_domain quoted_project quoted_cert_dir quoted_configure

  if [ ! -f "$RENEWAL_SCRIPT" ]; then
    echo "  ✗ Automatic renewal cannot be installed: $RENEWAL_SCRIPT is missing."
    exit 1
  fi

  quoted_domain=$(printf '%q' "$DOMAIN")
  quoted_project=$(printf '%q' "$PROJECT_DIR")
  quoted_cert_dir=$(printf '%q' "$CERT_DIR")
  quoted_configure=$(printf '%q' "$PROJECT_DIR/deploy/configure-wildcard-nginx.sh")

  install -d -m 0755 "$RENEWAL_HOOK_DIR"
  cat > "$RENEWAL_HOOK" <<HOOK
#!/bin/bash
set -euo pipefail

# Certbot runs deploy hooks after it has switched the live certificate symlink.
# The configure helper validates the renewed certificate before touching nginx.
RENEWED_LINEAGE="\${RENEWED_LINEAGE:-}"
if [ -n "\$RENEWED_LINEAGE" ] && [ "\$RENEWED_LINEAGE" != "$CERT_DIR" ]; then
  exit 0
fi

exec env DOMAIN=$quoted_domain PROJECT_DIR=$quoted_project CERT_DIR=$quoted_cert_dir \\
  bash $quoted_configure
HOOK
  chmod 0755 "$RENEWAL_HOOK"
  echo "  ✓ Certbot deploy hook installed at $RENEWAL_HOOK"
}

ensure_certbot_timer() {
  local timer

  for timer in certbot.timer snap.certbot.renew.timer; do
    if systemctl list-unit-files "$timer" >/dev/null 2>&1 &&
       systemctl enable --now "$timer" >/dev/null 2>&1; then
      echo "  ✓ Automatic Certbot renewal enabled via $timer"
      return
    fi
  done

  echo "  ✗ Certbot renewal hook is installed, but no Certbot systemd timer could be enabled."
  echo "    Enable certbot.timer (or snap.certbot.renew.timer) so DNS-01 renewal runs automatically."
  exit 1
}

install_renewal_hook
ensure_certbot_timer

cat > "$WILDCARD_CONF" <<NGINX
# Managed by OcholaSupernet deployment. Do not edit manually.
server {
    listen 80;
    listen [::]:80;
    server_name *.${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name *.${DOMAIN};

    ssl_certificate     ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    root ${PROJECT_DIR}/artifacts/ochola-supernet/dist/public;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

nginx -t
systemctl reload nginx

# Check the loaded configuration, not only the file we just generated.
# This catches include-order and syntax mistakes that could otherwise leave
# the old apex-only/default vhost serving ISP hostnames.
if ! nginx -T 2>/dev/null | grep -Fq "server_name *.${DOMAIN};"; then
  echo "  ✗ Wildcard vhost was written but is not active in nginx."
  exit 1
fi

echo "  ✓ Wildcard Nginx vhost enabled for *.${DOMAIN}"
