#!/usr/bin/env bash
set -euo pipefail

# Restores the legacy OcholaSuper-Proxy OpenVPN instance only.
# This deliberately does not touch the router-management instances on 1196/1197.

SERVICE_STEM="ocholasuperproxy"
PORT="${LEGACY_PROXY_VPN_PORT:-1195}"
TUNNEL_NETWORK="${LEGACY_PROXY_VPN_NETWORK:-10.9.0.0}"
TUNNEL_DEVICE="${LEGACY_PROXY_VPN_DEVICE:-tun1}"
OVPN_DIR="/etc/openvpn"
SERVER_DIR="${OVPN_DIR}/server"
EASYRSA_DIR="${OVPN_DIR}/easy-rsa"
CONFIG="${SERVER_DIR}/${SERVICE_STEM}.conf"
CA_FILE="${EASYRSA_DIR}/pki/ca.crt"
CERT_FILE="${EASYRSA_DIR}/pki/issued/ochola-proxy-server.crt"
KEY_FILE="${EASYRSA_DIR}/pki/private/ochola-proxy-server.key"
AUTH_FILE="${OVPN_DIR}/users.db"
AUTH_SCRIPT="${OVPN_DIR}/check-auth.sh"
CCDDIR="${SERVER_DIR}/${SERVICE_STEM}-ccd"
IPP_FILE="${OVPN_DIR}/proxy-ipp.txt"
STATUS_FILE="/var/log/openvpn/${SERVICE_STEM}-status.log"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this script as root." >&2
  exit 1
fi

command -v openvpn >/dev/null 2>&1 || {
  echo "ERROR: openvpn is not installed." >&2
  exit 1
}
[ -x "${EASYRSA_DIR}/easyrsa" ] || {
  echo "ERROR: Easy-RSA is unavailable at ${EASYRSA_DIR}." >&2
  exit 1
}
[ -f "$CA_FILE" ] || {
  echo "ERROR: existing OpenVPN CA is missing." >&2
  exit 1
}

install -d -m 700 "$SERVER_DIR" "$CCDDIR"
install -d -m 755 /var/log/openvpn

# Use a separate server certificate instead of reusing either management
# instance's private key. This changes only the Easy-RSA certificate index and
# creates the proxy service key locally on the VPS.
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  (
    cd "$EASYRSA_DIR"
    EASYRSA_BATCH=1 ./easyrsa build-server-full ochola-proxy-server nopass
  )
fi

[ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ] || {
  echo "ERROR: proxy server certificate generation did not complete." >&2
  exit 1
}

if [ ! -f "$AUTH_FILE" ]; then
  install -m 600 /dev/null "$AUTH_FILE"
else
  chmod 600 "$AUTH_FILE"
fi
cat > "$AUTH_SCRIPT" <<'AUTHEOF'
#!/usr/bin/env bash
set -euo pipefail
CREDS_FILE="${1:?credentials file is required}"
USERNAME="$(sed -n '1p' "$CREDS_FILE")"
PASSWORD="$(sed -n '2p' "$CREDS_FILE")"
HASH="$(printf '%s' "${USERNAME}:${PASSWORD}" | sha256sum | awk '{print $1}')"
grep -qF "${USERNAME}:${HASH}" /etc/openvpn/users.db
AUTHEOF
chmod 700 "$AUTH_SCRIPT"

tmp_config="$(mktemp "${CONFIG}.tmp.XXXXXX")"
trap 'rm -f "$tmp_config"' EXIT
cat > "$tmp_config" <<EOF
port ${PORT}
proto tcp-server
dev ${TUNNEL_DEVICE}
topology net30
server ${TUNNEL_NETWORK} 255.255.255.0
ca ${CA_FILE}
cert ${CERT_FILE}
key ${KEY_FILE}
dh none
ecdh-curve prime256v1
client-config-dir ${CCDDIR}
ifconfig-pool-persist ${IPP_FILE}
keepalive 10 60
persist-key
persist-tun
script-security 3
verify-client-cert none
auth-user-pass-verify ${AUTH_SCRIPT} via-file
username-as-common-name
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
status ${STATUS_FILE}
verb 3
EOF
chmod 600 "$tmp_config"

if [ -f "$CONFIG" ]; then
  backup="${CONFIG}.backup.$(date +%Y%m%d%H%M%S)"
  cp -a "$CONFIG" "$backup"
  echo "Existing proxy config backed up to ${backup}."
fi
mv -f "$tmp_config" "$CONFIG"
trap - EXIT
chmod 600 "$CONFIG"

# Validate before enabling the service. OpenVPN has no general TLS
# "parse-only" mode, so start this config as a short-lived foreground daemon,
# verify that it stays alive, then stop only that temporary process. This
# validates directives, certificate/key paths, and tunnel-device creation
# without touching either management service.
validation_pid_file="$(mktemp)"
validation_log="$(mktemp)"
cleanup_validation() {
  if [ -s "$validation_pid_file" ]; then
    validation_pid="$(cat "$validation_pid_file")"
    kill "$validation_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$validation_pid" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$validation_pid_file" "$validation_log"
}
trap cleanup_validation EXIT
openvpn --config "$CONFIG" --daemon --writepid "$validation_pid_file" --log "$validation_log"
sleep 2
if [ ! -s "$validation_pid_file" ] || ! kill -0 "$(cat "$validation_pid_file")" 2>/dev/null; then
  cat "$validation_log" >&2 || true
  echo "ERROR: proxy OpenVPN configuration did not pass temporary startup validation." >&2
  exit 1
fi
cleanup_validation
trap - EXIT

iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
elif command -v iptables-save >/dev/null 2>&1 && [ -d /etc/iptables ]; then
  iptables-save > /etc/iptables/rules.v4
fi

systemctl daemon-reload
systemctl enable --now "openvpn-server@${SERVICE_STEM}"

sleep 2
systemctl is-active --quiet "openvpn-server@${SERVICE_STEM}" || {
  echo "ERROR: proxy OpenVPN service is not active." >&2
  journalctl -u "openvpn-server@${SERVICE_STEM}" -n 80 --no-pager >&2 || true
  exit 1
}

if command -v ss >/dev/null 2>&1; then
  ss -ltnH | awk -v port=":${PORT}" '$4 ~ port "$" { found=1 } END { exit(found ? 0 : 1) }' || {
    echo "ERROR: proxy OpenVPN service is active but TCP ${PORT} is not listening." >&2
    journalctl -u "openvpn-server@${SERVICE_STEM}" -n 80 --no-pager >&2 || true
    exit 1
  }
fi

echo "Legacy proxy OpenVPN is active on TCP ${PORT} (${TUNNEL_NETWORK}/24, ${TUNNEL_DEVICE})."