#!/usr/bin/env bash
#
# Read-only production gate for the isolated router-management VPN.
# This deliberately checks the live VPS rather than inferring readiness from
# source code or externally reachable TCP ports.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: router-management verification must run as root." >&2
  exit 1
fi

PRIMARY_CONF="/etc/openvpn/server/ochola-router.conf"
BACKUP_CONF="/etc/openvpn/server/ochola-router-backup.conf"
PRIMARY_AUTH="/etc/openvpn/router-passwd"
BACKUP_AUTH="/etc/openvpn/router-backup-passwd"
PRIMARY_CCD="/etc/openvpn/server/ochola-router-ccd"
BACKUP_CCD="/etc/openvpn/server/ochola-router-backup-ccd"
PRIMARY_STATUS="/var/log/openvpn/ochola-router-status.log"
BACKUP_STATUS="/var/log/openvpn/ochola-router-backup-status.log"

echo "=== SSH identity ==="
id -un

echo "=== OpenVPN services ==="
service_unit() {
  local stem="$1"
  if systemctl is-active --quiet "openvpn-server@${stem}" 2>/dev/null; then
    printf 'openvpn-server@%s\n' "$stem"
    return 0
  fi
  if systemctl is-active --quiet "openvpn@${stem}" 2>/dev/null; then
    printf 'openvpn@%s\n' "$stem"
    return 0
  fi
  echo "ERROR: no active OpenVPN service found for ${stem}." >&2
  return 1
}
PRIMARY_SERVICE="$(service_unit ochola-router)"
BACKUP_SERVICE="$(service_unit ochola-router-backup)"
echo "primary service: ${PRIMARY_SERVICE}"
echo "backup service: ${BACKUP_SERVICE}"
systemctl --no-pager --plain --full status \
  "$PRIMARY_SERVICE" "$BACKUP_SERVICE" |
  sed -n '1,24p'

echo "=== OpenVPN configuration contract ==="
test -s "$PRIMARY_CONF"
test -s "$BACKUP_CONF"
grep -Eq '^port 1196$' "$PRIMARY_CONF"
grep -Eq '^proto tcp-server$' "$PRIMARY_CONF"
grep -Eq '^server 10\.8\.5\.0 255\.255\.255\.0$' "$PRIMARY_CONF"
grep -Eq '^port 1197$' "$BACKUP_CONF"
grep -Eq '^proto tcp-server$' "$BACKUP_CONF"
grep -Eq '^server 10\.8\.6\.0 255\.255\.255\.0$' "$BACKUP_CONF"
echo "primary: 1196/tcp on 10.8.5.0/24"
echo "backup: 1197/tcp on 10.8.6.0/24"

echo "=== Router-management authentication ==="
test -s "$PRIMARY_AUTH"
test -s "$BACKUP_AUTH"
if grep -Eq '^come27:' "$PRIMARY_AUTH"; then
  echo "primary auth identity come27: present"
else
  echo "ERROR: primary auth identity come27 is missing." >&2
  exit 1
fi

echo "=== CCD/static address configuration ==="
test -d "$PRIMARY_CCD"
test -d "$BACKUP_CCD"
if [ -f "$PRIMARY_CCD/come27" ]; then
  echo "primary CCD come27:"
  grep -E '^ifconfig-push ' "$PRIMARY_CCD/come27" || true
else
  echo "primary CCD come27: absent; dynamic pool assignment is in use."
fi
echo "primary CCD entries: $(find "$PRIMARY_CCD" -maxdepth 1 -type f | wc -l)"
echo "backup CCD entries: $(find "$BACKUP_CCD" -maxdepth 1 -type f | wc -l)"

echo "=== Actual OpenVPN listeners and tunnel interfaces ==="
ss -lntp | grep -E ':(1196|1197)\b'
ip -4 addr show dev tun-router
ip -4 addr show dev tun-router-backup

echo "=== Router 83 forwarding contract ==="
iptables -t nat -S PREROUTING |
  grep -Eq -- '--dport 11960:12959 .*--to-ports 1196'
echo "12042/tcp is within 11960-12959 and redirects to 1196/tcp."

echo "=== Forwarding, NAT, and firewall ==="
iptables -S FORWARD | grep -E 'tun-router|tun-router-backup|10\.8\.[56]\.0/24' || true
iptables -t nat -S | grep -E '10\.8\.[56]\.0/24|11960:12959' || true
ufw status verbose | sed -n '1,40p'

echo "=== OpenVPN status files and recent logs ==="
test -e "$PRIMARY_STATUS"
test -e "$BACKUP_STATUS"
tail -n 5 "$PRIMARY_STATUS" || true
journalctl -u "$PRIMARY_SERVICE" -n 20 --no-pager
journalctl -u "$BACKUP_SERVICE" -n 20 --no-pager

echo "=== Router-management VPS verification passed ==="