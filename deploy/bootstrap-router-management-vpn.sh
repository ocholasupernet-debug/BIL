#!/usr/bin/env bash
#
# Bootstrap the isolated MikroTik management OpenVPN services.
#
# This intentionally does not modify the legacy customer/proxy OpenVPN
# instances. The router-management plane uses its own configs, auth files,
# tunnel devices, and ports:
#   primary: TCP 1196, 10.8.5.0/24, tun-router
#   backup:  TCP 1197, 10.8.6.0/24, tun-router-bkp
#
# Run as root or through sudo from the VPS deployment.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo -n"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "ERROR: OpenVPN bootstrap currently requires an apt-based VPS." >&2
  exit 1
fi

echo "[vpn-bootstrap] Installing OpenVPN and Easy-RSA..."
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  openvpn easy-rsa iptables-persistent

OVPN_DIR="/etc/openvpn"
SERVER_DIR="${OVPN_DIR}/server"
CERT_DIR=""
CERT_FILE=""
KEY_FILE=""
CA_FILE=""

# Prefer the wildcard certificate when it exists. The production zone is
# currently not Cloudflare-managed, so configure-nginx.sh may instead issue
# the exact-name HTTP-01 certificate that covers vpn.isplatty.org.
for candidate in \
  "/etc/letsencrypt/live/isplatty.org-wildcard" \
  "/etc/letsencrypt/live/isplatty.org-required-hosts"
do
  if [ -s "${candidate}/fullchain.pem" ] &&
     [ -s "${candidate}/privkey.pem" ] &&
     [ -s "${candidate}/chain.pem" ] &&
     openssl x509 -in "${candidate}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null |
       grep -Fq "DNS:vpn.isplatty.org"
  then
    CERT_DIR="$candidate"
    CERT_FILE="${candidate}/fullchain.pem"
    KEY_FILE="${candidate}/privkey.pem"
    CA_FILE="${candidate}/chain.pem"
    break
  fi
done

if [ -z "$CERT_DIR" ]; then
  cat >&2 <<EOF
ERROR: A public certificate for vpn.isplatty.org is not ready.
Expected either:
  /etc/letsencrypt/live/isplatty.org-wildcard/{fullchain.pem,privkey.pem,chain.pem}
or:
  /etc/letsencrypt/live/isplatty.org-required-hosts/{fullchain.pem,privkey.pem,chain.pem}

The MikroTik profile verifies the OpenVPN server against the public ISRG
Root X1 trust anchor. Run deploy/configure-nginx.sh to reconcile the
host-specific vpn.isplatty.org certificate, then run this bootstrap again.
EOF
  exit 1
fi

echo "[vpn-bootstrap] Using public certificate from ${CERT_DIR}"

$SUDO install -d -m 700 "$SERVER_DIR"
$SUDO install -d -m 755 /var/log/openvpn
$SUDO install -d -m 700 "${SERVER_DIR}/ochola-router-ccd"
$SUDO install -d -m 700 "${SERVER_DIR}/ochola-router-backup-ccd"

# The API readiness check uses this path for Easy-RSA. Debian packages it
# under /usr/share/easy-rsa, so expose the expected stable path without
# copying or changing the package-managed files.
if [ ! -e "${OVPN_DIR}/easy-rsa" ] && [ -d "/usr/share/easy-rsa" ]; then
  $SUDO ln -s "/usr/share/easy-rsa" "${OVPN_DIR}/easy-rsa"
fi

AUTH_SCRIPT="${OVPN_DIR}/verify-router-pass.sh"
if [ ! -s "$AUTH_SCRIPT" ]; then
  $SUDO tee "$AUTH_SCRIPT" >/dev/null <<'AUTHEOF'
#!/usr/bin/env bash
set -euo pipefail

PASSFILE="${1:?credentials file is required}"
USERNAME="${username:-}"
PASSWORD="${password:-}"

[ -n "$USERNAME" ] || exit 1
[ -n "$PASSWORD" ] || exit 1
[ -r "$PASSFILE" ] || exit 1

grep -Fqx "${USERNAME}:${PASSWORD}" "$PASSFILE"
AUTHEOF
  $SUDO chmod 700 "$AUTH_SCRIPT"
fi

write_empty_auth_file() {
  local path="$1"
  if [ ! -e "$path" ]; then
    $SUDO install -m 600 /dev/null "$path"
  else
    $SUDO chmod 600 "$path"
  fi
}

write_empty_auth_file "${OVPN_DIR}/router-passwd"
write_empty_auth_file "${OVPN_DIR}/router-backup-passwd"

write_config() {
  local config="$1"
  local port="$2"
  local device="$3"
  local network="$4"
  local ccd="$5"
  local ipp="$6"
  local status="$7"
  local authfile="$8"

  if [ -s "$config" ]; then
    echo "[vpn-bootstrap] Checking existing dedicated config ${config}"
  else
    echo "[vpn-bootstrap] Creating dedicated config ${config}"
  fi

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  cat > "$tmp" <<EOF
port ${port}
proto tcp-server
dev ${device}
server ${network} 255.255.255.0
topology net30
ca ${CA_FILE}
cert ${CERT_FILE}
key ${KEY_FILE}
dh none
ecdh-curve prime256v1
client-config-dir ${ccd}
ifconfig-pool-persist ${ipp}
keepalive 10 60
persist-key
persist-tun
script-security 3
verify-client-cert none
auth-user-pass-verify ${AUTH_SCRIPT} via-env
username-as-common-name
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
status ${status}
verb 3
EOF
  CONFIG_CHANGED=0
  if $SUDO cmp -s "$tmp" "$config"; then
    echo "[vpn-bootstrap] Configuration is unchanged."
  else
    $SUDO install -m 600 "$tmp" "$config"
    CONFIG_CHANGED=1
    echo "[vpn-bootstrap] Updated configuration."
  fi
  rm -f "$tmp"
  trap - RETURN
}

CONFIG_CHANGED=0
write_config \
  "${SERVER_DIR}/ochola-router.conf" \
  "1196" \
  "tun-router" \
  "10.8.5.0" \
  "${SERVER_DIR}/ochola-router-ccd" \
  "${OVPN_DIR}/router-ipp.txt" \
  "/var/log/openvpn/ochola-router-status.log" \
  "${OVPN_DIR}/router-passwd"
PRIMARY_CONFIG_CHANGED="$CONFIG_CHANGED"

write_config \
  "${SERVER_DIR}/ochola-router-backup.conf" \
  "1197" \
  "tun-router-bkp" \
  "10.8.6.0" \
  "${SERVER_DIR}/ochola-router-backup-ccd" \
  "${OVPN_DIR}/router-backup-ipp.txt" \
  "/var/log/openvpn/ochola-router-backup-status.log" \
  "${OVPN_DIR}/router-backup-passwd"
BACKUP_CONFIG_CHANGED="$CONFIG_CHANGED"

$SUDO systemctl daemon-reload

# Debian exposes both openvpn@ and openvpn-server@ unit families. Older
# installations may still have a runtime openvpn@ instance holding the same
# tun device. Keep the already-running service for that device, stop only its
# failed duplicate, and let the persistent openvpn-server@ unit take over on
# the next boot. Never launch both unit families against one TUN interface.
reconcile_management_service() {
  local stem="$1"
  local interface="$2"
  local config_changed="$3"
  local preferred="openvpn-server@${stem}"
  local compatibility="openvpn@${stem}"
  local preferred_state=""
  local compatibility_state=""
  local selected=""
  local already_active=0
  local attempt

  $SUDO systemctl enable "$preferred" >/dev/null
  preferred_state="$($SUDO systemctl show "$preferred" -p ActiveState --value 2>/dev/null || true)"
  compatibility_state="$($SUDO systemctl show "$compatibility" -p ActiveState --value 2>/dev/null || true)"

  if [ "$preferred_state" = "active" ] && [ "$compatibility_state" = "active" ]; then
    echo "ERROR: Both ${preferred} and ${compatibility} are active for ${interface}." >&2
    echo "       Refusing to restart either service while they may share the TUN device." >&2
    return 1
  elif [ "$preferred_state" = "active" ]; then
    selected="$preferred"
    already_active=1
    $SUDO systemctl stop "$compatibility" >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed "$compatibility" >/dev/null 2>&1 || true
  elif [ "$compatibility_state" = "active" ]; then
    selected="$compatibility"
    already_active=1
    $SUDO systemctl stop "$preferred" >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed "$preferred" >/dev/null 2>&1 || true
    echo "[vpn-bootstrap] Keeping the already-running compatibility unit ${compatibility}."
  else
    if $SUDO ip link show dev "$interface" >/dev/null 2>&1; then
      echo "ERROR: ${interface} exists, but neither ${preferred} nor ${compatibility} is active." >&2
      echo "       Refusing to attach another process to an unverified TUN device." >&2
      return 1
    fi
    selected="$preferred"
    $SUDO systemctl stop "$compatibility" >/dev/null 2>&1 || true
    $SUDO systemctl stop "$preferred" >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed "$compatibility" >/dev/null 2>&1 || true
    $SUDO systemctl reset-failed "$preferred" >/dev/null 2>&1 || true
  fi

  # Keep the compatibility process alive if it owns the active tunnel, but
  # remove both runtime and persistent enablement. The canonical server unit
  # is enabled above and will own the interface after a reboot.
  $SUDO systemctl disable --runtime "$compatibility" >/dev/null 2>&1 || true
  $SUDO systemctl disable "$compatibility" >/dev/null 2>&1 || true

  if [ "$already_active" = "1" ]; then
    if [ "$config_changed" = "1" ]; then
      echo "[vpn-bootstrap] Applying the changed config by restarting ${selected}..."
      $SUDO systemctl restart "$selected"
    fi
  else
    echo "[vpn-bootstrap] Starting ${selected}..."
    $SUDO systemctl start "$selected"
  fi

  if ! $SUDO ip link show dev "$interface" >/dev/null 2>&1; then
    echo "[vpn-bootstrap] ${interface} is absent; restarting ${selected} once..."
    $SUDO systemctl restart "$selected"
  fi

  for attempt in $(seq 1 15); do
    if [ "$($SUDO systemctl show "$selected" -p ActiveState --value 2>/dev/null || true)" = "active" ] &&
       $SUDO ip link show dev "$interface" >/dev/null 2>&1; then
      echo "[vpn-bootstrap] ${selected} is active on ${interface}."
      return 0
    fi
    sleep 1
  done

  echo "ERROR: ${selected} did not become active on ${interface}." >&2
  $SUDO systemctl status "$selected" --no-pager >&2 || true
  $SUDO journalctl -u "$selected" -n 60 --no-pager >&2 || true
  return 1
}

reconcile_management_service "ochola-router" "tun-router" "$PRIMARY_CONFIG_CHANGED"
reconcile_management_service "ochola-router-backup" "tun-router-bkp" "$BACKUP_CONFIG_CHANGED"

# Permit the two shared listeners and the stable per-router public range.
$SUDO iptables -C INPUT -p tcp --dport 1196 -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I INPUT -p tcp --dport 1196 -j ACCEPT
$SUDO iptables -C INPUT -p tcp --dport 1197 -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I INPUT -p tcp --dport 1197 -j ACCEPT
$SUDO iptables -C FORWARD -i tun-router -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I FORWARD -i tun-router -j ACCEPT
$SUDO iptables -C FORWARD -o tun-router -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I FORWARD -o tun-router -j ACCEPT
$SUDO iptables -C FORWARD -i tun-router-bkp -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I FORWARD -i tun-router-bkp -j ACCEPT
$SUDO iptables -C FORWARD -o tun-router-bkp -j ACCEPT 2>/dev/null || \
  $SUDO iptables -I FORWARD -o tun-router-bkp -j ACCEPT

if command -v iptables-save >/dev/null 2>&1 && [ -d /etc/iptables ]; then
  $SUDO iptables-save | $SUDO tee /etc/iptables/rules.v4 >/dev/null
fi

echo "[vpn-bootstrap] Primary OpenVPN: TCP 1196 on 10.8.5.0/24"
echo "[vpn-bootstrap] Backup OpenVPN:  TCP 1197 on 10.8.6.0/24"
echo "[vpn-bootstrap] Legacy customer/proxy OpenVPN services were not modified."