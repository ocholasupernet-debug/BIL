#!/bin/bash
##############################################################
# Configure the wildcard ISP-host vhost after a wildcard
# Let's Encrypt certificate has been issued.
#
# This is intentionally a no-op until the certificate contains
# DNS:*.isplatty.org. That prevents a deployment from routing
# wildcard HTTPS traffic through an apex-only certificate.
##############################################################
set -euo pipefail

DOMAIN="${DOMAIN:-isplatty.org}"
PROJECT_DIR="${PROJECT_DIR:-/var/www/ocholasupernet}"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
WILDCARD_CONF="/etc/nginx/conf.d/${DOMAIN}-wildcard.conf"

if [ ! -r "$CERT_FILE" ] || [ ! -r "$KEY_FILE" ]; then
  echo "  ⚠ Wildcard vhost skipped: certificate files are not available."
  exit 0
fi

if ! openssl x509 -in "$CERT_FILE" -noout -ext subjectAltName 2>/dev/null \
  | grep -Fq "DNS:*.${DOMAIN}"; then
  echo "  ⚠ Wildcard vhost skipped: $CERT_FILE does not contain DNS:*.${DOMAIN}."
  echo "    Issue a DNS-01 wildcard certificate, then run deployment again."
  exit 0
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
echo "  ✓ Wildcard Nginx vhost enabled for *.${DOMAIN}"