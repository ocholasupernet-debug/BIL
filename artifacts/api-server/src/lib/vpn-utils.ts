/**
 * VPS-side OpenVPN server utilities for OcholaSupernet.
 * Generates bash scripts to prepare the existing VPS OpenVPN server
 * to accept connections from MikroTik routers as OVPN clients.
 */
import { ROUTER_MANAGEMENT_VPN } from "./router-management-vpn.js";
import { routerVpnPeerIp } from "./router-vpn-ip.js";

export interface VpsOvpnSetupOptions {
  /** VPS public IP (shown to the user as the endpoint) */
  vpsPublicIp: string;
  /** OpenVPN server port (default 1196; customer VPN remains on 1194) */
  vpnPort?: number;
  /** Username to add for the router (default "admin") */
  vpnUsername?: string;
  /** Password for the VPN user (default "ochola") */
  vpnPassword?: string;
  /** Tunnel IP pool base — first 3 octets (default "10.8.5") */
  tunnelBase?: string;
  /** Static IP to assign to the router inside the tunnel (default "10.8.5.2") */
  routerTunnelIp?: string;
  /** Router ID (for labelling) */
  routerId?: number;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * Generates a bash script to run on the VPS that:
 *  1. Patches the existing OpenVPN server config to support MikroTik clients
 *     (proto tcp, no tls-auth, user/pass auth via a simple script)
 *  2. Adds the admin/ochola user with a static tunnel IP for the router
 *  3. Restarts OpenVPN to apply changes
 *
 * MikroTik OVPN client limitations:
 *   - TCP only (no UDP)
 *   - No tls-auth / tls-crypt support
 *   - Supports username+password OR certificate auth (not both simultaneously)
 *   - AES-128-CBC + SHA1 cipher/auth only
 */
export function generateVpsOvpnSetupScript(opts: VpsOvpnSetupOptions): string {
  const {
    vpsPublicIp,
    vpnPort       = ROUTER_MANAGEMENT_VPN.port,
    vpnUsername   = "admin",
    vpnPassword   = "ochola",
    tunnelBase    = ROUTER_MANAGEMENT_VPN.tunnelBase,
    routerTunnelIp = `${ROUTER_MANAGEMENT_VPN.tunnelBase}.2`,
    routerId,
  } = opts;

  const tag       = routerId ? `router${routerId}` : "router";
  const serverNet = `${tunnelBase}.0`;
  const serverGw  = `${tunnelBase}.1`;
  const routerPeerIp = routerVpnPeerIp(routerTunnelIp);
  const usernameB64 = base64(vpnUsername);
  const passwordB64 = base64(vpnPassword);

  return `#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# OcholaSupernet — VPS OpenVPN Server Setup for MikroTik Clients
# Generated : ${new Date().toISOString()}
# VPS IP    : ${vpsPublicIp}
# VPN Port  : ${vpnPort}/tcp
# VPN User  : ${vpnUsername}  (router client account)
# Router IP : ${routerTunnelIp}  (assigned inside tunnel)
#
# This script prepares the EXISTING OpenVPN server on this VPS to
# accept connections from a MikroTik router acting as an OVPN client.
#
# USAGE:
#   chmod +x vps-ovpn-setup.sh
#   sudo bash vps-ovpn-setup.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

BASE_OVPN_CONF="/etc/openvpn/server.conf"
OVPN_CONF="${ROUTER_MANAGEMENT_VPN.configPath}"
OVPN_DIR="/etc/openvpn"
CCDDIR="${ROUTER_MANAGEMENT_VPN.ccdPath}" # isolated router client IPs
AUTHFILE="${ROUTER_MANAGEMENT_VPN.authFilePath}" # username:password auth file
AUTHSCRIPT="${ROUTER_MANAGEMENT_VPN.authScriptPath}"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

echo "──────────────────────────────────────────────────────────────"
echo " OcholaSupernet: Configuring OVPN server for MikroTik client"
echo "──────────────────────────────────────────────────────────────"

# ── 1. Detect the legacy server config without changing it ──────────────────
if [ ! -f "$BASE_OVPN_CONF" ]; then
  # Try common alternative locations
  for f in /etc/openvpn/server/*.conf /etc/openvpn/*.conf; do
    [ -f "$f" ] && [ "$f" != "$OVPN_CONF" ] && BASE_OVPN_CONF="$f" && break
  done
fi
mkdir -p "$(dirname "$OVPN_CONF")"
if [ -f "$BASE_OVPN_CONF" ]; then
  echo "[1] Reading existing config: $BASE_OVPN_CONF"
  echo "    Legacy end-user VPN configuration will not be modified."
else
  echo "[1] No existing OpenVPN config found; bootstrapping an isolated management PKI."
  echo "    No legacy customer VPN configuration will be created or changed."
  $SUDO apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openvpn easy-rsa
  EASYRSA_DIR="/etc/openvpn/easy-rsa"
  $SUDO install -d -m 700 "$EASYRSA_DIR"
  if [ ! -x "$EASYRSA_DIR/easyrsa" ]; then
    if [ ! -x /usr/share/easy-rsa/easyrsa ]; then
      echo "ERROR: easy-rsa was installed but its easyrsa command is unavailable."
      exit 1
    fi
    $SUDO cp -a /usr/share/easy-rsa/. "$EASYRSA_DIR/"
  fi
  if [ ! -d "$EASYRSA_DIR/pki" ]; then
    $SUDO sh -c "cd '$EASYRSA_DIR' && EASYRSA_BATCH=1 ./easyrsa init-pki"
  fi
  if [ ! -f "$EASYRSA_DIR/pki/ca.crt" ]; then
    $SUDO sh -c "cd '$EASYRSA_DIR' && EASYRSA_BATCH=1 EASYRSA_REQ_CN='OcholaSupernet-CA' ./easyrsa build-ca nopass"
  fi
  if [ ! -f "$EASYRSA_DIR/pki/issued/ochola-router-server.crt" ] || [ ! -f "$EASYRSA_DIR/pki/private/ochola-router-server.key" ]; then
    $SUDO sh -c "cd '$EASYRSA_DIR' && EASYRSA_BATCH=1 ./easyrsa build-server-full ochola-router-server nopass"
  fi
  CA_FILE="$EASYRSA_DIR/pki/ca.crt"
  CERT_FILE="$EASYRSA_DIR/pki/issued/ochola-router-server.crt"
  KEY_FILE="$EASYRSA_DIR/pki/private/ochola-router-server.key"
  # Avoid a slow DH parameter generation on a fresh VPS. OpenVPN negotiates
  # modern ECDH when dh is set to none; existing configs keep their own DH.
  DH_FILE="none"
fi

# ── 2. Patch: ensure proto tcp ───────────────────────────────────────────────
echo "[2] Creating isolated router-management server on ${tunnelBase}.0:${vpnPort}..."
if [ -f "$BASE_OVPN_CONF" ]; then
  conf_value() { awk -v key="$1" '$1 == key { print $2; exit }' "$BASE_OVPN_CONF"; }
  CA_FILE="$(conf_value ca)"
  CERT_FILE="$(conf_value cert)"
  KEY_FILE="$(conf_value key)"
  DH_FILE="$(conf_value dh)"
  for f in CA_FILE CERT_FILE KEY_FILE DH_FILE; do
    value="$(eval "printf '%s' \"\${$f}\"")"
    if [ -n "$value" ] && [ "\${value#/}" = "$value" ]; then
      eval "$f=\"$(dirname "$BASE_OVPN_CONF")/$value\""
    fi
  done
fi
if [ -z "$CA_FILE" ] || [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
  echo "ERROR: OpenVPN CA/cert/key paths are unavailable."
  exit 1
fi
OPENVPN_VERSION="$(openvpn --version 2>/dev/null | awk 'NR == 1 { print $2 }')"
OPENVPN_MAJOR="$(printf '%s' "$OPENVPN_VERSION" | cut -d. -f1)"
OPENVPN_MINOR="$(printf '%s' "$OPENVPN_VERSION" | cut -d. -f2)"
printf '%s' "$OPENVPN_MAJOR" | grep -Eq '^[0-9]+$' || OPENVPN_MAJOR=0
printf '%s' "$OPENVPN_MINOR" | grep -Eq '^[0-9]+$' || OPENVPN_MINOR=0
OPENVPN_SUPPORTS_VERIFY_CLIENT_CERT=false
OPENVPN_SUPPORTS_DATA_CIPHERS=false
if [ "$OPENVPN_MAJOR" -gt 2 ] || { [ "$OPENVPN_MAJOR" -eq 2 ] && [ "$OPENVPN_MINOR" -ge 4 ]; }; then
  OPENVPN_SUPPORTS_VERIFY_CLIENT_CERT=true
fi
if [ "$OPENVPN_MAJOR" -gt 2 ] || { [ "$OPENVPN_MAJOR" -eq 2 ] && [ "$OPENVPN_MINOR" -ge 5 ]; }; then
  OPENVPN_SUPPORTS_DATA_CIPHERS=true
fi
{
  echo "port ${vpnPort}"
  echo "proto tcp-server"
  echo "dev tun-router"
  echo "server ${serverNet} 255.255.255.0"
  # RouterOS 6 expects the net30 point-to-point address form. The subnet
  # topology makes it interpret the pushed peer address as a /0 netmask.
  echo "topology net30"
  echo "ca $CA_FILE"
  echo "cert $CERT_FILE"
  echo "key $KEY_FILE"
  [ -n "$DH_FILE" ] && echo "dh $DH_FILE"
  [ "$DH_FILE" = "none" ] && echo "ecdh-curve prime256v1"
  echo "client-config-dir $CCDDIR"
  echo "ifconfig-pool-persist ${ROUTER_MANAGEMENT_VPN.ippPath}"
  echo "keepalive 10 60"
  echo "persist-key"
  echo "persist-tun"
  echo "script-security 3"
   # MikroTik supplies username/password but no client certificate. OpenVPN
   # 2.4+ calls this verify-client-cert; older releases use the legacy
   # client-cert-not-required spelling. Do not emit both: unknown directives
   # prevent the dedicated service from starting.
   if [ "$OPENVPN_SUPPORTS_VERIFY_CLIENT_CERT" = true ]; then
     echo "verify-client-cert none"
   else
     echo "client-cert-not-required"
   fi
  echo "auth-user-pass-verify $AUTHSCRIPT via-env"
  echo "username-as-common-name"
  echo "cipher AES-128-CBC"
   if [ "$OPENVPN_SUPPORTS_DATA_CIPHERS" = true ]; then
    echo "data-ciphers AES-128-CBC"
    echo "data-ciphers-fallback AES-128-CBC"
  else
     echo "# OpenVPN does not support data-ciphers; using legacy cipher only."
  fi
  echo "auth SHA1"
  echo "status ${ROUTER_MANAGEMENT_VPN.statusPath}"
  echo "verb 3"
} > "$OVPN_CONF"
echo "    Dedicated config written: $OVPN_CONF"

# ── 3. Patch: disable tls-auth / tls-crypt ───────────────────────────────────
echo "[3] Disabling tls-auth / tls-crypt (not supported by MikroTik)..."
echo "    Dedicated config does not include tls-auth or tls-crypt."

# ── 4. Patch: set cipher and auth compatible with MikroTik ──────────────────
echo "[4] Setting cipher=AES-128-CBC auth=SHA1..."
echo "    Dedicated config uses cipher=AES-128-CBC auth=SHA1."

# ── 5. Enable username/password authentication ───────────────────────────────
echo "[5] Enabling username/password auth..."

# Create auth verification script
cat > "$AUTHSCRIPT" << 'AUTHEOF'
#!/usr/bin/env bash
# Simple username:password verifier for OpenVPN
PASSFILE="${ROUTER_MANAGEMENT_VPN.authFilePath}"
username="\${username:-\${1:-}}"
password="\${password:-\${2:-}}"
[ -f "$PASSFILE" ] || exit 1
grep -Fqx "\${username}:\${password}" "$PASSFILE" && exit 0 || exit 1
AUTHEOF
chmod 700 "$AUTHSCRIPT"

# ── 6. Add the VPN user (${vpnUsername}) ────────────────────────────────────
VPN_USERNAME="$(printf '%s' '${usernameB64}' | base64 -d)"
VPN_PASSWORD="$(printf '%s' '${passwordB64}' | base64 -d)"
echo "[6] Adding VPN user '${vpnUsername}'..."
touch "$AUTHFILE"
chmod 600 "$AUTHFILE"

# Remove existing entry for this user and re-add
sed -i "/^\${VPN_USERNAME}:/d" "$AUTHFILE"
printf '%s:%s\n' "$VPN_USERNAME" "$VPN_PASSWORD" >> "$AUTHFILE"
echo "    User '${vpnUsername}' added to $AUTHFILE"

# ── 7. Enable client-config-dir for static IP assignment ────────────────────
echo "[7] Configuring static IP for router (${routerTunnelIp})..."
mkdir -p "$CCDDIR"

if ! grep -q "^client-config-dir" "$OVPN_CONF"; then
  echo "client-config-dir $CCDDIR" >> "$OVPN_CONF"
fi
if ! grep -q "^ifconfig-pool-persist" "$OVPN_CONF"; then
  echo "ifconfig-pool-persist ${ROUTER_MANAGEMENT_VPN.ippPath}" >> "$OVPN_CONF"
fi

# Static IP for the router client
cat > "$CCDDIR/${vpnUsername}" << CCDEOF
# Static tunnel IP and net30 peer for MikroTik router (${tag})
ifconfig-push ${routerTunnelIp} ${routerPeerIp}
CCDEOF
echo "    Static IP ${routerTunnelIp} assigned to '${vpnUsername}'"

# ── 8. Firewall: allow VPN port and API access from tunnel ──────────────────
echo "[8] Opening firewall rules..."
# Allow incoming OVPN connections
iptables -I INPUT -p tcp --dport ${vpnPort} -j ACCEPT 2>/dev/null || true
# Allow forwarding from the isolated router tunnel to enable API traffic
iptables -I FORWARD -i tun-router -j ACCEPT 2>/dev/null || true
iptables -I FORWARD -o tun-router -j ACCEPT 2>/dev/null || true

# Persist iptables rules (Ubuntu/Debian)
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save || true
elif command -v iptables-save &>/dev/null; then
  iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
fi

# ── 8b. Validate the two RouterOS compatibility requirements ──────────────────
# A subnet-topology server pushes an address form that RouterOS can interpret
# as a /0 netmask. The dedicated service must stay net30 and must not require a
# client certificate because MikroTik authenticates with username/password.
if ! grep -Eq '^[[:space:]]*topology[[:space:]]+net30([[:space:]]|$)' "$OVPN_CONF"; then
  echo "ERROR: Dedicated router-management OpenVPN must use topology net30."
  exit 1
fi
if ! grep -Eq '^[[:space:]]*(verify-client-cert[[:space:]]+none|client-cert-not-required)([[:space:]]|$)' "$OVPN_CONF"; then
  echo "ERROR: Dedicated router-management OpenVPN must allow username/password clients without a certificate."
  exit 1
fi
if grep -Eq '^[[:space:]]*(topology[[:space:]]+subnet|tls-auth|tls-crypt|tls-crypt-v2)([[:space:]]|$)' "$OVPN_CONF"; then
  echo "ERROR: Dedicated router-management OpenVPN contains an incompatible subnet topology or TLS wrapper."
  exit 1
fi

# ── 9. Restart only the dedicated router-management instance ────────────────
echo "[9] Starting dedicated router-management OpenVPN..."
$SUDO ln -sfn "$OVPN_CONF" "$OVPN_DIR/ochola-router.conf"
service_started=false
if $SUDO systemctl restart openvpn-server@ochola-router 2>/dev/null || $SUDO systemctl enable --now openvpn-server@ochola-router 2>/dev/null; then
  service_started=true
elif $SUDO systemctl restart openvpn@ochola-router 2>/dev/null || $SUDO systemctl enable --now openvpn@ochola-router 2>/dev/null; then
  service_started=true
fi
if [ "$service_started" != "true" ]; then
  echo "ERROR: Could not start the dedicated router-management OpenVPN service."
  $SUDO systemctl status openvpn-server@ochola-router --no-pager 2>&1 | tail -n 40 || true
  $SUDO systemctl status openvpn@ochola-router --no-pager 2>&1 | tail -n 40 || true
  exit 1
fi

sleep 2
if ! $SUDO systemctl is-active --quiet openvpn-server@ochola-router 2>/dev/null && ! $SUDO systemctl is-active --quiet openvpn@ochola-router 2>/dev/null; then
  echo "ERROR: The dedicated router-management OpenVPN service is not active after startup."
  $SUDO journalctl -u openvpn-server@ochola-router -u openvpn@ochola-router -n 60 --no-pager 2>&1 || true
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ! $SUDO ss -ltnH | awk '$4 ~ /:'"${vpnPort}"'$/ { found=1 } END { exit(found ? 0 : 1) }'; then
  echo "ERROR: OpenVPN service is active but TCP port ${vpnPort} is not listening."
  $SUDO journalctl -u openvpn-server@ochola-router -u openvpn@ochola-router -n 60 --no-pager 2>&1 || true
  exit 1
fi
echo ""
echo "══════════════════════════════════════════════════════════════"
echo " Setup complete. Verify:"
echo "   systemctl status openvpn-server@ochola-router"
echo "   ip addr show tun-router    # should show ${serverGw}"
echo ""
echo " Now import the RouterOS client script on the router:"
echo "   /import router-as-client${routerId ?? ""}.rsc"
echo ""
echo " After router connects, verify from this VPS:"
echo "   ping ${routerTunnelIp}                    # router tunnel IP"
echo "   curl -s http://${routerTunnelIp}:8728      # router API"
echo ""
echo " Set in OcholaSupernet backend:"
echo "   MIKROTIK_BRIDGE_IP=${routerTunnelIp}"
echo "══════════════════════════════════════════════════════════════"
`;
}

/**
 * Returns a summary JSON of the VPN architecture for the given setup,
 * useful for displaying in the admin UI.
 */
export function describeVpnArchitecture(opts: VpsOvpnSetupOptions) {
  const {
    vpsPublicIp,
    vpnPort         = ROUTER_MANAGEMENT_VPN.port,
    vpnUsername     = "admin",
    tunnelBase      = ROUTER_MANAGEMENT_VPN.tunnelBase,
    routerTunnelIp  = `${ROUTER_MANAGEMENT_VPN.tunnelBase}.2`,
    routerId,
  } = opts;

  return {
    architecture: "router-as-client",
    description:
      "VPS runs the OpenVPN SERVER. The MikroTik router connects as a CLIENT. " +
      "The backend API server uses the router's tunnel IP to reach the RouterOS API.",
    vpsServer: {
      publicIp:   vpsPublicIp,
      port:       vpnPort,
      protocol:   "TCP",
      tunnelIp:   `${tunnelBase}.1`,
      role:       "OpenVPN SERVER (already running)",
    },
    routerClient: {
      vpnUser:    vpnUsername,
      tunnelIp:   routerTunnelIp,
      role:       "OpenVPN CLIENT (connects to VPS)",
      routerId,
    },
    backendConfig: {
      MIKROTIK_BRIDGE_IP:  routerTunnelIp,
      MIKROTIK_PORT:       "8728",
      MIKROTIK_USE_SSL:    "false",
    },
    steps: [
      `1. Run vps-ovpn-setup.sh on the VPS (${vpsPublicIp}) as root`,
      `2. Download router-as-client${routerId ?? ""}.rsc from the API`,
      `3. Import the script on the router: /import router-as-client${routerId ?? ""}.rsc`,
      `4. Verify: ping ${routerTunnelIp} from the VPS`,
      `5. Set MIKROTIK_BRIDGE_IP=${routerTunnelIp} in OcholaSupernet`,
    ],
  };
}
