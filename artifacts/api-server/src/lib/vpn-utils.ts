/**
 * VPS-side OpenVPN server utilities for OcholaSupernet.
 * Generates bash scripts to prepare the existing VPS OpenVPN server
 * to accept connections from MikroTik routers as OVPN clients.
 */
import { ROUTER_MANAGEMENT_VPN } from "./router-management-vpn.js";

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
 *   - AES-128/192/256 + SHA1 cipher/auth only
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
if [ ! -f "$BASE_OVPN_CONF" ]; then
  echo "ERROR: Could not find the existing OpenVPN server config."
  exit 1
fi
mkdir -p "$(dirname "$OVPN_CONF")"
echo "[1] Reading existing config: $BASE_OVPN_CONF"
echo "    Legacy end-user VPN configuration will not be modified."

# ── 2. Patch: ensure proto tcp ───────────────────────────────────────────────
echo "[2] Creating isolated router-management server on ${tunnelBase}.0:${vpnPort}..."
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
if [ -z "$CA_FILE" ] || [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
  echo "ERROR: The existing OpenVPN config does not expose reusable CA/cert/key paths."
  exit 1
fi
{
  echo "port ${vpnPort}"
  echo "proto tcp-server"
  echo "dev tun-router"
  echo "server ${serverNet} 255.255.255.0"
  echo "topology subnet"
  echo "ca $CA_FILE"
  echo "cert $CERT_FILE"
  echo "key $KEY_FILE"
  [ -n "$DH_FILE" ] && echo "dh $DH_FILE"
  echo "client-config-dir $CCDDIR"
  echo "ifconfig-pool-persist ${ROUTER_MANAGEMENT_VPN.ippPath}"
  echo "keepalive 10 60"
  echo "persist-key"
  echo "persist-tun"
  echo "script-security 3"
  echo "auth-user-pass-verify $AUTHSCRIPT via-env"
  echo "username-as-common-name"
  echo "cipher AES-128-CBC"
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
grep -qF "\${username}:\${password}" "$PASSFILE" && exit 0 || exit 1
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
# Static tunnel IP for MikroTik router (${tag})
ifconfig-push ${routerTunnelIp} ${serverGw}
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

# ── 9. Restart only the dedicated router-management instance ────────────────
echo "[9] Starting dedicated router-management OpenVPN..."
systemctl enable --now openvpn-server@ochola-router 2>/dev/null || \\
  systemctl restart openvpn@ochola-router 2>/dev/null || \\
  echo "    WARNING: Could not start the router-management instance — start it manually"

sleep 2
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
