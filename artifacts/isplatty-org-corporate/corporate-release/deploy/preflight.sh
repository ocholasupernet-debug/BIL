#!/usr/bin/env bash
# Read-only checks, to be run manually by the owner on the intended VPS.
# Does NOT connect to a VPS, install software, alter Nginx/PM2/DNS or read secrets.
set -euo pipefail
PORT="${1:-8091}"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 && PORT != 8080 )) || {
  echo "Choose a valid unused unprivileged port; 8080 belongs to BIL."; exit 1;
}
failed=0
echo "Checking proposed corporate port $PORT (BIL port 8080 will not be changed)."
if ss -H -ltn "sport = :$PORT" | grep -q .; then
  echo "STOP: port $PORT is already listening. Choose another corporate port."; failed=1
fi
for domain in isplatty.org chrisphine3.isplatty.org; do
  # Reports filenames only, not contents or existing credentials/configuration.
  if grep -RIlE "server_name[^;]*[[:space:]]${domain//./\\.}([[:space:];]|$)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
    echo "STOP: $domain may already have a live virtual host. Owner must review ownership."; failed=1
  fi
  echo "DNS currently resolving for $domain:"
  getent ahosts "$domain" | awk '{print $1}' | sort -u || true
done
for target in /var/www/isplatty-org/current /etc/nginx/sites-enabled/isplatty-org-corporate.conf; do
  if [[ -e "$target" || -L "$target" ]]; then
    echo "STOP: corporate target already exists: $target. Treat as an upgrade; do not overwrite."; failed=1
  fi
done
if [[ -d /var/www/isplatty-org && ! -O /var/www/isplatty-org ]]; then
  echo "Confirm /var/www/isplatty-org belongs to the dedicated corporate OS user before proceeding."
fi
echo "Check available capacity before sharing this VPS:"
df -h /var/www 2>/dev/null || df -h /
free -h
echo "Check Node 24, pnpm and PM2 availability; no service commands have been executed."
node --version || failed=1
pnpm --version || failed=1
command -v pm2 >/dev/null || failed=1
exit "$failed"
