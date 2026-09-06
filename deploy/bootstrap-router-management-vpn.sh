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
    echo "[vpn-bootstrap] Rewriting existing dedicated config ${config}"
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
  $SUDO install -m 600 "$tmp" "$config"
  rm -f "$tmp"
  trap - RETURN
}

write_config \
  "${SERVER_DIR}/ochola-router.conf" \
  "1196" \
  "tun-router" \
  "10.8.5.0" \
  "${SERVER_DIR}/ochola-router-ccd" \
  "${OVPN_DIR}/router-ipp.txt" \
  "/var/log/openvpn/ochola-router-status.log" \
  "${OVPN_DIR}/router-passwd"

write_config \
  "${SERVER_DIR}/ochola-router-backup.conf" \
  "1197" \
  "tun-router-bkp" \
  "10.8.6.0" \
  "${SERVER_DIR}/ochola-router-backup-ccd" \
  "${OVPN_DIR}/router-backup-ipp.txt" \
  "/var/log/openvpn/ochola-router-backup-status.log" \
  "${OVPN_DIR}/router-backup-passwd"

# Keep the dedicated services separate from any legacy OpenVPN instance.
$SUDO systemctl daemon-reload
$SUDO systemctl enable "openvpn-server@ochola-router" "openvpn-server@ochola-router-backup"
$SUDO systemctl restart "openvpn-server@ochola-router"
$SUDO systemctl restart "openvpn-server@ochola-router-backup"

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

for unit in openvpn-server@ochola-router openvpn-server@ochola-router-backup; do
  if ! $SUDO systemctl is-active --quiet "$unit"; then
    echo "ERROR: ${unit} is not active." >&2
    $SUDO journalctl -u "$unit" -n 80 --no-pager >&2 || true
    exit 1
  fi
done

echo "[vpn-bootstrap] Primary OpenVPN: TCP 1196 on 10.8.5.0/24"
echo "[vpn-bootstrap] Backup OpenVPN:  TCP 1197 on 10.8.6.0/24"
echo "[vpn-bootstrap] Legacy OpenVPN services were not modified."