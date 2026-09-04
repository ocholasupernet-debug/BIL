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
FAILURES=()

check() {
  local label="$1"
  shift
  if "$@"; then
    echo "PASS: ${label}"
  else
    echo "FAIL: ${label}"
    FAILURES+=("$label")
  fi
}

check_primary_listener() {
  ss -lntp | grep -Eq ':(1196)\b'
}

check_backup_listener() {
  ss -lntp | grep -Eq ':(1197)\b'
}

check_primary_tunnel() {
  ip -4 addr show dev tun-router | grep -Eq 'inet 10\.8\.5\.1([/ ]|$)'
}

check_backup_tunnel() {
  ip -4 addr show dev tun-router-bkp | grep -Eq 'inet 10\.8\.6\.1([/ ]|$)'
}

check_router_port_redirect() {
  iptables -t nat -S PREROUTING |
    grep -Eq -- '--dport 11960:12959 .*--to-ports 1196'
}

check_router_port_filter() {
  iptables -C INPUT -p tcp --dport 11960:12959 -j ACCEPT
}

check_management_forwarding() {
  iptables -S FORWARD |
    grep -Eq 'tun-router|tun-router-bkp|10\.8\.[56]\.0/24'
}

check_management_nat() {
  iptables -t nat -S |
    grep -Eq '10\.8\.[56]\.0/24|11960:12959'
}

resolve_ufw() {
  UFW_BIN="$(command -v ufw 2>/dev/null || true)"
  if [ -z "$UFW_BIN" ]; then
    for candidate in /usr/sbin/ufw /usr/bin/ufw /sbin/ufw /bin/ufw; do
      if [ -x "$candidate" ]; then
        UFW_BIN="$candidate"
        break
      fi
    done
  fi
  if [ -z "$UFW_BIN" ]; then
    UFW_BIN="$(sudo sh -c 'command -v ufw' 2>/dev/null || true)"
  fi
}

resolve_ufw
check_firewall() {
  if [ -n "$UFW_BIN" ]; then
    "$UFW_BIN" status verbose | grep -Eq '^Status: active'
  else
    sudo ufw status verbose | grep -Eq '^Status: active'
  fi
}

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
PRIMARY_SERVICE=""
BACKUP_SERVICE=""
if PRIMARY_SERVICE="$(service_unit ochola-router)"; then
  echo "primary service: ${PRIMARY_SERVICE}"
else
  echo "FAIL: primary OpenVPN service is not active"
  FAILURES+=("primary OpenVPN service is active")
fi
if BACKUP_SERVICE="$(service_unit ochola-router-backup)"; then
  echo "backup service: ${BACKUP_SERVICE}"
else
  echo "FAIL: backup OpenVPN service is not active"
  FAILURES+=("backup OpenVPN service is active")
fi
if [ -n "$PRIMARY_SERVICE" ] && [ -n "$BACKUP_SERVICE" ]; then
  if systemctl --no-pager --plain --full status \
    "$PRIMARY_SERVICE" "$BACKUP_SERVICE" | sed -n '1,24p'; then
    echo "PASS: OpenVPN service status is readable"
  else
    echo "FAIL: OpenVPN service status is readable"
    FAILURES+=("OpenVPN service status is readable")
  fi
fi

echo "=== OpenVPN configuration contract ==="
check "primary config exists" test -s "$PRIMARY_CONF"
check "backup config exists" test -s "$BACKUP_CONF"
check "primary port is 1196/tcp" grep -Eq '^port 1196$' "$PRIMARY_CONF"
check "primary protocol is tcp-server" grep -Eq '^proto tcp-server$' "$PRIMARY_CONF"
check "primary network is 10.8.5.0/24" grep -Eq '^server 10\.8\.5\.0 255\.255\.255\.0$' "$PRIMARY_CONF"
check "backup port is 1197/tcp" grep -Eq '^port 1197$' "$BACKUP_CONF"
check "backup protocol is tcp-server" grep -Eq '^proto tcp-server$' "$BACKUP_CONF"
check "backup network is 10.8.6.0/24" grep -Eq '^server 10\.8\.6\.0 255\.255\.255\.0$' "$BACKUP_CONF"
echo "primary: 1196/tcp on 10.8.5.0/24"
echo "backup: 1197/tcp on 10.8.6.0/24"

echo "=== Router-management authentication ==="
check "primary auth file exists" test -s "$PRIMARY_AUTH"
check "backup auth file exists" test -s "$BACKUP_AUTH"
PRIMARY_IDENTITY=""
if [ -s "$PRIMARY_AUTH" ]; then
  PRIMARY_IDENTITY="$(awk -F: '/^[A-Za-z0-9][A-Za-z0-9._-]*:[^:]*$/ { print $1; exit }' "$PRIMARY_AUTH")"
fi
check "primary auth identity is present" test -n "$PRIMARY_IDENTITY"

echo "=== CCD/static address configuration ==="
check "primary CCD directory exists" test -d "$PRIMARY_CCD"
check "backup CCD directory exists" test -d "$BACKUP_CCD"
if [ -n "$PRIMARY_IDENTITY" ] && [ -f "$PRIMARY_CCD/$PRIMARY_IDENTITY" ]; then
  echo "primary CCD ${PRIMARY_IDENTITY}:"
  grep -E '^ifconfig-push ' "$PRIMARY_CCD/$PRIMARY_IDENTITY" || true
else
  echo "primary CCD ${PRIMARY_IDENTITY:-none}: absent; dynamic pool assignment is in use."
fi
if [ -d "$PRIMARY_CCD" ]; then
  echo "primary CCD entries: $(find "$PRIMARY_CCD" -maxdepth 1 -type f | wc -l)"
fi
if [ -d "$BACKUP_CCD" ]; then
  echo "backup CCD entries: $(find "$BACKUP_CCD" -maxdepth 1 -type f | wc -l)"
fi

echo "=== Actual OpenVPN listeners and tunnel interfaces ==="
check "primary listener is bound to 1196/tcp" check_primary_listener
check "backup listener is bound to 1197/tcp" check_backup_listener
check "primary tunnel interface has 10.8.5.1" check_primary_tunnel
check "backup tunnel interface has 10.8.6.1" check_backup_tunnel

echo "=== Router 83 forwarding contract ==="
check "router public ports redirect to 1196" check_router_port_redirect
check "router public ports are accepted by INPUT" check_router_port_filter
echo "12042/tcp is within 11960-12959 and redirects to 1196/tcp."

echo "=== Forwarding, NAT, and firewall ==="
check "management tunnel forwarding rules exist" check_management_forwarding
check "management NAT rules exist" check_management_nat
if check_firewall; then
  echo "PASS: firewall is active"
else
  echo "FAIL: firewall is active"
  FAILURES+=("firewall is active")
fi
if [ -n "$UFW_BIN" ]; then
  "$UFW_BIN" status verbose | sed -n '1,40p' || true
else
  sudo ufw status verbose | sed -n '1,40p' || true
fi

echo "=== OpenVPN status files and recent logs ==="
check "primary status file exists" test -e "$PRIMARY_STATUS"
check "backup status file exists" test -e "$BACKUP_STATUS"
if [ -e "$PRIMARY_STATUS" ]; then
  tail -n 5 "$PRIMARY_STATUS" || true
fi
if [ -n "$PRIMARY_SERVICE" ]; then
  check "primary journal is readable" journalctl -u "$PRIMARY_SERVICE" -n 20 --no-pager
fi
if [ -n "$BACKUP_SERVICE" ]; then
  check "backup journal is readable" journalctl -u "$BACKUP_SERVICE" -n 20 --no-pager
fi

if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo "=== Router-management VPS verification failed ===" >&2
  for failure in "${FAILURES[@]}"; do
    printf 'FAILED CHECK: %s\n' "$failure" >&2
    printf '::error title=Router-management VPS readiness::%s\n' "$failure"
  done
  exit 1
fi

echo "=== Router-management VPS verification passed ==="