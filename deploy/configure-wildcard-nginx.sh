#!/bin/bash
##############################################################
# Configure the wildcard ISP-host vhost after a DNS-01 wildcard
# Let's Encrypt certificate has been issued.
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
