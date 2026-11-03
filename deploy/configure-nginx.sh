#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="isplatty.org"
CERT_NAME="${DOMAIN}-wildcard"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
COM_DOMAIN="isplatty.com"
COM_CERT_NAME="isplatty-com-origin"
COM_CERT_DIR="/etc/letsencrypt/live/${COM_CERT_NAME}"
REQUIRED_CERT_NAME="${DOMAIN}-required-hosts"
REQUIRED_CERT_DIR="/etc/letsencrypt/live/${REQUIRED_CERT_NAME}"
APEX_CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
TENANT_VHOST_DIR="/etc/nginx/tenant-sites.d"
NGINX_BACKUP_DIR=""
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

has_com_origin_certificate() {
  [ -r "${COM_CERT_DIR}/fullchain.pem" ] &&
    [ -r "${COM_CERT_DIR}/privkey.pem" ] &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:${COM_DOMAIN}" &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:www.${COM_DOMAIN}" &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:api.${COM_DOMAIN}" &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:admin.${COM_DOMAIN}" &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:come.${COM_DOMAIN}" &&
    openssl x509 -in "${COM_CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
      grep -Fq "DNS:register.${COM_DOMAIN}"
}

ensure_com_origin_certificate() {
  install -d -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
  if has_com_origin_certificate; then
    return
  fi
  echo "Requesting an HTTP-01 certificate for ${COM_DOMAIN}, www, and api..."
  certbot certonly \
    --webroot \
    --webroot-path /var/www/letsencrypt \
    --non-interactive \
    --agree-tos \
    --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
    --preferred-challenges http \
    --keep-until-expiring \
    --cert-name "${COM_CERT_NAME}" \
    -d "${COM_DOMAIN}" \
    -d "www.${COM_DOMAIN}" \
    -d "api.${COM_DOMAIN}" \
    -d "admin.${COM_DOMAIN}" \
    -d "come.${COM_DOMAIN}" \
    -d "register.${COM_DOMAIN}"
}

backup_nginx_configuration() {
  NGINX_BACKUP_DIR="/var/backups/ocholasupernet/nginx/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$NGINX_BACKUP_DIR"
  if [ -e "$NGINX_SITE" ]; then
    cp -a "$NGINX_SITE" "${NGINX_BACKUP_DIR}/$(basename "$NGINX_SITE")"
  fi
  if [ -d "$TENANT_VHOST_DIR" ]; then
    cp -a "$TENANT_VHOST_DIR" "${NGINX_BACKUP_DIR}/tenant-sites"
  fi
  if [ -e /etc/nginx/sites-enabled/default ] || [ -L /etc/nginx/sites-enabled/default ]; then
    cp -a /etc/nginx/sites-enabled/default "${NGINX_BACKUP_DIR}/enabled-default"
  fi
  echo "Backed up existing Nginx configuration to ${NGINX_BACKUP_DIR}."
}

restore_nginx_configuration() {
  local previous_site="${NGINX_BACKUP_DIR}/$(basename "$NGINX_SITE")"
  if [ -e "$previous_site" ]; then
    cp -a "$previous_site" "$NGINX_SITE"
  else
    rm -f "$NGINX_SITE"
  fi
  if [ -e "${NGINX_BACKUP_DIR}/enabled-default" ] || [ -L "${NGINX_BACKUP_DIR}/enabled-default" ]; then
    cp -a "${NGINX_BACKUP_DIR}/enabled-default" /etc/nginx/sites-enabled/default
  fi
  ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
  echo "Restored the previous Nginx site configuration." >&2
}

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  install -d -m 0700 /etc/letsencrypt
  printf '%s' "$CLOUDFLARE_API_TOKEN" > /etc/letsencrypt/cloudflare-api-token
  chmod 600 /etc/letsencrypt/cloudflare-api-token
fi

ensure_com_origin_certificate

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
  backup_nginx_configuration
  install -m 0644 "${PROJECT_DIR}/deploy/nginx.conf" "${NGINX_SITE}"
else
  # Namecheap-managed DNS cannot use the Cloudflare DNS hook. Use HTTP-01
  # through the existing webroot so issuance does not stop Nginx or interrupt
  # the already-working .org hosts.
  if ! has_required_host_certificate; then
    certbot_status=0
    certbot certonly \
      --webroot \
      --webroot-path /var/www/letsencrypt \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
      --preferred-challenges http \
      --keep-until-expiring \
      --cert-name "${REQUIRED_CERT_NAME}" \
      -d "bil.${DOMAIN}" \
      -d "vpn.${DOMAIN}" || certbot_status=$?
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
  backup_nginx_configuration
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
    install -m 0644 "$temporary" "${TENANT_VHOST_DIR}/${host}.conf"
    rm -f "$temporary"
  done
fi

ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
if ! nginx -t; then
  restore_nginx_configuration
  nginx -t
  exit 1
fi
systemctl reload nginx
echo "Wildcard Nginx routing is active for *.${DOMAIN}."