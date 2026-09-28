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

VPN_BOOTSTRAP_ROOT="${VPN_BOOTSTRAP_ROOT:-}"
if [ -n "$VPN_BOOTSTRAP_ROOT" ]; then
  case "$VPN_BOOTSTRAP_ROOT" in
    /*) ;;
    *)
      echo "ERROR: VPN_BOOTSTRAP_ROOT must be an absolute path." >&2
      exit 2
      ;;
  esac
  if [ "$VPN_BOOTSTRAP_ROOT" = "/" ]; then
    echo "ERROR: VPN_BOOTSTRAP_ROOT cannot be /." >&2
    exit 2
  fi
fi

rooted_path() {
  local path="$1"
  if [ -n "$VPN_BOOTSTRAP_ROOT" ]; then
    printf '%s%s\n' "${VPN_BOOTSTRAP_ROOT%/}" "$path"
  else
    printf '%s\n' "$path"
  fi
}

if ! command -v apt-get >/dev/null 2>&1; then
  echo "ERROR: OpenVPN bootstrap currently requires an apt-based VPS." >&2
  exit 1
fi

OVPN_DIR="$(rooted_path /etc/openvpn)"
SERVER_DIR="${OVPN_DIR}/server"

echo "[vpn-bootstrap] Installing OpenVPN and Easy-RSA..."
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  openvpn easy-rsa iptables-persistent

CERT_DIR=""
CERT_FILE=""
KEY_FILE=""
CA_FILE=""

# Prefer the wildcard certificate when it exists. The production zone is
# currently not Cloudflare-managed, so configure-nginx.sh may instead issue
# the exact-name HTTP-01 certificate that covers vpn.isplatty.org.
for candidate in \
  "$(rooted_path /etc/letsencrypt/live/isplatty.org-wildcard)" \
  "$(rooted_path /etc/letsencrypt/live/isplatty.org-required-hosts)"
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
$SUDO install -d -m 700 "$(rooted_path /var/lib/openvpn/ochola-router-management)"
$SUDO install -d -m 755 "$(rooted_path /var/log/openvpn)"
$SUDO install -d -m 700 "${SERVER_DIR}/ochola-router-ccd"
$SUDO install -d -m 700 "${SERVER_DIR}/ochola-router-backup-ccd"

CERT_FINGERPRINT="$(
  {
    $SUDO sha256sum "$CERT_FILE" | awk '{print $1}'
    $SUDO sha256sum "$KEY_FILE" | awk '{print $1}'
    $SUDO sha256sum "$CA_FILE" | awk '{print $1}'
  } | sha256sum | awk '{print $1}'
)"

# The API readiness check uses this path for Easy-RSA. Debian packages it
# under /usr/share/easy-rsa, so expose the expected stable path without
# copying or changing the package-managed files.
if [ ! -e "${OVPN_DIR}/easy-rsa" ] &&
   [ -d "$(rooted_path /usr/share/easy-rsa)" ]
then
  $SUDO ln -s "$(rooted_path /usr/share/easy-rsa)" "${OVPN_DIR}/easy-rsa"
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

  CONFIG_FINGERPRINT="$(sha256sum "$tmp" | awk '{print $1}')"
  if [ -s "$config" ] && $SUDO cmp -s "$tmp" "$config"; then
    echo "[vpn-bootstrap] Dedicated config is unchanged: ${config}"
    CONFIG_UNCHANGED=1
  else
    CONFIG_UNCHANGED=0
    if [ -s "$config" ]; then
      echo "[vpn-bootstrap] Updating dedicated config ${config}"
    else
      echo "[vpn-bootstrap] Creating dedicated config ${config}"
    fi
    $SUDO install -m 600 "$tmp" "$config"
  fi
  rm -f "$tmp"
  trap - RETURN
}

CONFIG_FINGERPRINT=""
CONFIG_UNCHANGED=0
write_config \
  "${SERVER_DIR}/ochola-router.conf" \
  "1196" \
  "tun-router" \
  "10.8.5.0" \
  "${SERVER_DIR}/ochola-router-ccd" \
  "${OVPN_DIR}/router-ipp.txt" \
  "/var/log/openvpn/ochola-router-status.log" \
  "${OVPN_DIR}/router-passwd"
PRIMARY_CONFIG_FINGERPRINT="$CONFIG_FINGERPRINT"
PRIMARY_CONFIG_UNCHANGED="$CONFIG_UNCHANGED"

write_config \
  "${SERVER_DIR}/ochola-router-backup.conf" \
  "1197" \
  "tun-router-bkp" \
  "10.8.6.0" \
  "${SERVER_DIR}/ochola-router-backup-ccd" \
  "${OVPN_DIR}/router-backup-ipp.txt" \
  "/var/log/openvpn/ochola-router-backup-status.log" \
  "${OVPN_DIR}/router-backup-passwd"
BACKUP_CONFIG_FINGERPRINT="$CONFIG_FINGERPRINT"
BACKUP_CONFIG_UNCHANGED="$CONFIG_UNCHANGED"

# Keep the dedicated services separate from any legacy OpenVPN instance.
$SUDO systemctl daemon-reload

unit_state() {
  $SUDO systemctl show --property=ActiveState --value "$1" 2>/dev/null || true
}

management_tunnel_ready() {
  local device="$1"
  local address="$2"
  local port="$3"

  $SUDO ip -4 addr show dev "$device" 2>/dev/null |
    awk -v address="$address" '$1 == "inet" && ($2 == address || index($2, address "/") == 1) { found=1 } END { exit !found }' &&
    $SUDO ss -H -lnt 2>/dev/null |
      awk -v port="$port" '$4 ~ (":" port "$") { found=1 } END { exit !found }'
}

wait_for_management_tunnel() {
  local device="$1"
  local address="$2"
  local port="$3"
  local attempt

  for attempt in $(seq 1 15); do
    if management_tunnel_ready "$device" "$address" "$port"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

save_applied_fingerprints() {
  local stem="$1"
  local config_fingerprint="$2"
  local state_file pending_file state_tmp

  state_file="$(rooted_path "/var/lib/openvpn/ochola-router-management/${stem}.sha256")"
  pending_file="$(rooted_path "/var/lib/openvpn/ochola-router-management/${stem}.pending")"
  state_tmp="$(mktemp)"
  printf '%s %s\n' "$config_fingerprint" "$CERT_FINGERPRINT" > "$state_tmp"
  $SUDO install -m 600 "$state_tmp" "$state_file"
  $SUDO rm -f "$pending_file"
  rm -f "$state_tmp"
}

save_pending_fingerprints() {
  local stem="$1"
  local config_fingerprint="$2"
  local pending_file pending_tmp

  pending_file="$(rooted_path "/var/lib/openvpn/ochola-router-management/${stem}.pending")"
  pending_tmp="$(mktemp)"
  printf '%s %s\n' "$config_fingerprint" "$CERT_FINGERPRINT" > "$pending_tmp"
  $SUDO install -m 600 "$pending_tmp" "$pending_file"
  rm -f "$pending_tmp"
}

certificate_may_be_newer_than_service() {
  local unit="$1"
  local started_at started_epoch file modified_epoch

  started_at="$($SUDO systemctl show --property=ExecMainStartTimestamp --value "$unit" 2>/dev/null || true)"
  if [ -z "$started_at" ]; then
    return 0
  fi
  started_epoch="$(date -d "$started_at" +%s 2>/dev/null)" || return 0

  for file in "$CERT_FILE" "$KEY_FILE" "$CA_FILE"; do
    modified_epoch="$($SUDO stat -c %Y "$file" 2>/dev/null)" || return 0
    if [ "$modified_epoch" -gt "$started_epoch" ]; then
      return 0
    fi
  done
  return 1
}

show_management_diagnostics() {
  local stem="$1"
  local device="$2"
  local modern="openvpn-server@${stem}"
  local legacy="openvpn@${stem}"

  echo "=== Read-only OpenVPN diagnostics for ${stem} ===" >&2
  $SUDO systemctl show -p LoadState,ActiveState,SubState,MainPID,NRestarts \
    "$modern" "$legacy" 2>&1 || true
  $SUDO ip -d -4 addr show dev "$device" 2>&1 || true
  $SUDO ss -H -lnt 2>&1 || true
  $SUDO fuser -v "$(rooted_path /dev/net/tun)" 2>&1 || true
  $SUDO journalctl -u "$modern" -u "$legacy" -n 30 --no-pager 2>&1 || true
}

ensure_management_service() {
  local stem="$1"
  local device="$2"
  local network="$3"
  local address="$4"
  local port="$5"
  local config_fingerprint="$6"
  local config_unchanged="$7"
  local modern="openvpn-server@${stem}"
  local legacy="openvpn@${stem}"
  local legacy_config="${OVPN_DIR}/${stem}.conf"
  local modern_state legacy_state state_file pending_file applied_config_fingerprint applied_cert_fingerprint

  modern_state="$(unit_state "$modern")"
  legacy_state="$(unit_state "$legacy")"

  if [ "$modern_state" = "active" ] && [ "$legacy_state" = "active" ]; then
    echo "ERROR: Both ${modern} and ${legacy} are active for ${device}." >&2
    echo "       Refusing to restart either service while they may share the TUN device." >&2
    show_management_diagnostics "$stem" "$device"
    return 1
  fi

  if [ "$legacy_state" = "active" ]; then
    if ! grep -Fxq "port ${port}" "$legacy_config" 2>/dev/null ||
       ! grep -Fxq "dev ${device}" "$legacy_config" 2>/dev/null ||
       ! grep -Fxq "server ${network} 255.255.255.0" "$legacy_config" 2>/dev/null ||
       ! wait_for_management_tunnel "$device" "$address" "$port"
    then
      echo "ERROR: ${legacy} is active, but its config or live tunnel does not match the isolated management network; refusing to start a duplicate." >&2
      show_management_diagnostics "$stem" "$device"
      return 1
    fi

    # Keep the verified compatibility process alive for this deployment,
    # but make the canonical unit own the tunnel after the next reboot.
    $SUDO systemctl enable "$modern"
    $SUDO systemctl stop "$modern" 2>/dev/null || true
    $SUDO systemctl reset-failed "$modern" 2>/dev/null || true
    $SUDO systemctl disable --runtime "$legacy" 2>/dev/null || true
    $SUDO systemctl disable "$legacy" 2>/dev/null || true
    echo "[vpn-bootstrap] Preserving active ${legacy}; it already owns the verified ${device} management tunnel."
    return 0
  fi

  if [ "$modern_state" = "active" ]; then
    $SUDO systemctl enable "$modern"
    state_file="$(rooted_path "/var/lib/openvpn/ochola-router-management/${stem}.sha256")"
    pending_file="$(rooted_path "/var/lib/openvpn/ochola-router-management/${stem}.pending")"
    applied_config_fingerprint=""
    applied_cert_fingerprint=""
    if $SUDO test -r "$state_file"; then
      read -r applied_config_fingerprint applied_cert_fingerprint \
        <<<"$($SUDO cat "$state_file" 2>/dev/null || true)"
    fi

    if ! $SUDO test -e "$pending_file" &&
       [ "$applied_config_fingerprint" = "$config_fingerprint" ] &&
       [ "$applied_cert_fingerprint" = "$CERT_FINGERPRINT" ] &&
       wait_for_management_tunnel "$device" "$address" "$port"
    then
      echo "[vpn-bootstrap] Preserving healthy ${modern}; config, certificate, address, and listener are unchanged."
      return 0
    fi

    if ! $SUDO test -e "$pending_file" &&
       [ -z "$applied_config_fingerprint" ] &&
       [ "$config_unchanged" = "1" ] &&
       ! certificate_may_be_newer_than_service "$modern" &&
       wait_for_management_tunnel "$device" "$address" "$port"
    then
      echo "[vpn-bootstrap] Adopting healthy ${modern}; its config and certificate predate the running service."
      save_applied_fingerprints "$stem" "$config_fingerprint"
      return 0
    fi

    save_pending_fingerprints "$stem" "$config_fingerprint"
    if ! $SUDO systemctl restart "$modern"; then
      echo "ERROR: Could not restart ${modern}." >&2
      show_management_diagnostics "$stem" "$device"
      return 1
    fi
    if ! wait_for_management_tunnel "$device" "$address" "$port"; then
      echo "ERROR: The management tunnel is not ready for ${stem}; expected ${device} (${address}) and TCP ${port}." >&2
      show_management_diagnostics "$stem" "$device"
      return 1
    fi
    save_applied_fingerprints "$stem" "$config_fingerprint"
    return 0
  fi

  if $SUDO ip link show dev "$device" >/dev/null 2>&1; then
    # The interface exists but neither supported unit is active. Do not try
    # to claim or delete it: an unmanaged process may still own /dev/net/tun.
    echo "ERROR: ${device} exists without an active ${modern} or ${legacy}; refusing to disturb its owner." >&2
    show_management_diagnostics "$stem" "$device"
    return 1
  fi

  # No existing service or interface owns this tunnel, so start the current
  # dedicated unit. Reset a prior failed state to avoid a stale restart loop.
  $SUDO systemctl stop "$legacy" 2>/dev/null || true
  $SUDO systemctl reset-failed "$legacy" 2>/dev/null || true
  $SUDO systemctl disable --runtime "$legacy" 2>/dev/null || true
  $SUDO systemctl disable "$legacy" 2>/dev/null || true
  $SUDO systemctl stop "$modern" 2>/dev/null || true
  $SUDO systemctl reset-failed "$modern" 2>/dev/null || true
  $SUDO systemctl enable "$modern"
  if ! $SUDO systemctl start "$modern"; then
    echo "ERROR: Could not start ${modern}." >&2
    show_management_diagnostics "$stem" "$device"
    return 1
  fi
  if ! wait_for_management_tunnel "$device" "$address" "$port"; then
    echo "ERROR: The management tunnel is not ready for ${stem}; expected ${device} (${address}) and TCP ${port}." >&2
    show_management_diagnostics "$stem" "$device"
    return 1
  fi
  save_applied_fingerprints "$stem" "$config_fingerprint"
}

ensure_management_service \
  "ochola-router" "tun-router" "10.8.5.0" "10.8.5.1" "1196" \
  "$PRIMARY_CONFIG_FINGERPRINT" "$PRIMARY_CONFIG_UNCHANGED"
ensure_management_service \
  "ochola-router-backup" "tun-router-bkp" "10.8.6.0" "10.8.6.1" "1197" \
  "$BACKUP_CONFIG_FINGERPRINT" "$BACKUP_CONFIG_UNCHANGED"

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

if command -v iptables-save >/dev/null 2>&1 &&
   [ -d "$(rooted_path /etc/iptables)" ]
then
  $SUDO iptables-save | $SUDO tee "$(rooted_path /etc/iptables/rules.v4)" >/dev/null
fi

for entry in \
  "ochola-router tun-router 10.8.5.1 1196" \
  "ochola-router-backup tun-router-bkp 10.8.6.1 1197"
do
  read -r stem device address port <<<"$entry"
  if [ "$(unit_state "openvpn-server@${stem}")" != "active" ] &&
     [ "$(unit_state "openvpn@${stem}")" != "active" ]
  then
    echo "ERROR: No supported OpenVPN service is active for ${stem}." >&2
    show_management_diagnostics "$stem" "$device"
    exit 1
  fi
  if ! management_tunnel_ready "$device" "$address" "$port"; then
    echo "ERROR: The verified management tunnel is not ready for ${stem}." >&2
    show_management_diagnostics "$stem" "$device"
    exit 1
  fi
done

echo "[vpn-bootstrap] Primary OpenVPN: TCP 1196 on 10.8.5.0/24"
echo "[vpn-bootstrap] Backup OpenVPN:  TCP 1197 on 10.8.6.0/24"
echo "[vpn-bootstrap] Legacy OpenVPN services were not modified."