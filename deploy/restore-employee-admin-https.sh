#!/usr/bin/env bash
# Run on the existing BIL VPS only, via its fingerprint-pinned release workflow.
set -euo pipefail
umask 077

host=employee1088.isplatty.com
cert_name=isplatty-employee1088
cert_dir="/etc/letsencrypt/live/$cert_name"
site="/etc/nginx/tenant-sites.d/$host.conf"
challenge_dir=/var/www/letsencrypt/.well-known/acme-challenge

exec 9>/run/lock/bil-employee-admin-https.lock
flock -n 9 || { echo 'Employee admin HTTPS repair is already running.' >&2; exit 1; }

fail() { echo "$1" >&2; exit 1; }
probe_bil() { curl -fSs --max-time 8 http://127.0.0.1:8080/api/healthz >/dev/null; }
probe_employee() {
  curl --noproxy '*' -fSs --max-time 8 \
    --resolve "$host:443:127.0.0.1" "https://$host/api/healthz" >/dev/null
}
probe_bil || fail 'Existing BIL API is not healthy; no changes made.'
if probe_employee 2>/dev/null; then
  echo 'The employee admin origin already passes strict HTTPS and BIL health checks.'
  exit 0
fi
[[ -d /etc/nginx/tenant-sites.d && -d "$challenge_dir" && ! -L "$challenge_dir" ]] ||
  fail 'Expected BIL Nginx include directory or Certbot webroot is missing.'
[[ ! -e "$site" && ! -L "$site" ]] ||
  fail 'An employee admin vhost already exists and did not pass verification; inspect it without overwriting it.'
nginx_config=$(nginx -T 2>/dev/null) || fail 'Existing Nginx configuration did not pass validation.'
[[ "$nginx_config" == *'include /etc/nginx/tenant-sites.d/*.conf;'* ]] ||
  fail 'The active Nginx configuration does not include the BIL tenant vhost directory.'
unset nginx_config

probe_file=
staged=
installed=false
committed=false
cleanup() {
  local status=$?
  if [[ -n "$probe_file" ]]; then rm -f -- "$probe_file"; fi
  if [[ -n "$staged" ]]; then rm -f -- "$staged"; fi
  if [[ "$installed" == true && "$committed" != true ]]; then
    rm -f -- "$site"
    if ! nginx -t && [[ "$status" -eq 0 ]]; then status=1; fi
    systemctl reload nginx || echo 'Check Nginx after removing the new employee vhost.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

has_current_certificate() {
  [[ -r "$cert_dir/fullchain.pem" && -r "$cert_dir/privkey.pem" ]] &&
    openssl x509 -in "$cert_dir/fullchain.pem" -checkend 86400 -noout >/dev/null &&
    [[ "$(openssl x509 -in "$cert_dir/fullchain.pem" -checkhost "$host" -noout)" == *'does match certificate'* ]]
}
if ! has_current_certificate; then
  nonce=$(openssl rand -hex 24)
  probe_file="$challenge_dir/bil-$nonce"
  printf '%s' "$nonce" > "$probe_file"
  chmod 0644 "$probe_file"
  result=$(curl -fSs --max-time 15 "http://$host/.well-known/acme-challenge/bil-$nonce") ||
    fail 'Public HTTP-01 verification failed; no Nginx site was changed.'
  [[ "$result" == "$nonce" ]] || fail 'HTTP-01 request did not reach the expected BIL webroot.'
  rm -f -- "$probe_file"
  probe_file=
  certbot certonly --webroot -w /var/www/letsencrypt --non-interactive \
    --agree-tos --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
    --keep-until-expiring --cert-name "$cert_name" -d "$host"
  has_current_certificate || fail 'Certbot did not deliver a current certificate for the exact admin hostname.'
fi

staged=$(mktemp /etc/nginx/tenant-sites.d/.employee-admin.XXXXXX)
cat > "$staged" <<'NGINX'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name employee1088.isplatty.com;
    ssl_certificate /etc/letsencrypt/live/isplatty-employee1088/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/isplatty-employee1088/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
NGINX
chmod 0644 "$staged"
ln -- "$staged" "$site" || fail 'Another process installed a vhost; refusing to replace it.'
installed=true
test_output=$(nginx -t 2>&1) || fail 'New vhost did not pass nginx -t; rolling it back.'
[[ "$test_output" != *'conflicting server name "employee1088.isplatty.com"'* ]] ||
  fail 'Nginx already declares this HTTPS hostname; rolling back the duplicate.'
systemctl reload nginx
for attempt in 1 2 3 4 5; do
  if probe_employee 2>/dev/null && probe_bil; then
    committed=true
    echo 'Employee admin origin serves valid HTTPS and the existing BIL API is healthy.'
    exit 0
  fi
  sleep 2
done
fail 'Strict origin HTTPS health check did not pass; rolling back the new vhost.'
