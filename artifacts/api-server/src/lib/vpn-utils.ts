/**
 * VPS-side OpenVPN server utilities for OcholaSupernet.
 * Generates bash scripts to prepare the existing VPS OpenVPN server
 * to accept connections from MikroTik routers as OVPN clients.
 */

export interface VpsOvpnSetupOptions {
  /** VPS public IP (shown to the user as the endpoint) */
  vpsPublicIp: string;
  /** OpenVPN server port (default 1194) */
  vpnPort?: number;
  /** Username to add for the router (default "admin") */
  vpnUsername?: string;
  /** Password for the VPN user (default "ochola") */
  vpnPassword?: string;
  /** Tunnel IP pool base — first 3 octets (default "10.8.0") */
  tunnelBase?: string;
  /** Static IP to assign to the router inside the tunnel (default "10.8.0.2") */
  routerTunnelIp?: string;
  /** Router ID (for labelling) */
  routerId?: number;
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
    vpnPort       = 1194,
    vpnUsername   = "admin",
    vpnPassword   = "ochola",
    tunnelBase    = "10.8.0",
    routerTunnelIp = "10.8.0.2",
    routerId,
  } = opts;

  const tag       = routerId ? `router${routerId}` : "router";
  const serverNet = `${tunnelBase}.0`;
  const serverGw  = `${tunnelBase}.1`;

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

OVPN_CONF="/etc/openvpn/server.conf"
OVPN_DIR="/etc/openvpn"
CCDDIR="/etc/openvpn/ccd"          # client-config-dir for static IPs
AUTHFILE="$OVPN_DIR/passwd"         # username:password auth file
AUTHSCRIPT="$OVPN_DIR/verify-pass.sh"

echo "──────────────────────────────────────────────────────────────"
echo " OcholaSupernet: Configuring OVPN server for MikroTik client"
echo "──────────────────────────────────────────────────────────────"

# ── 1. Detect the active server config ──────────────────────────────────────
if [ ! -f "$OVPN_CONF" ]; then
  # Try common alternative locations
  for f in /etc/openvpn/server/*.conf /etc/openvpn/*.conf; do
    [ -f "$f" ] && OVPN_CONF="$f" && break
  done
fi
echo "[1] Using config: $OVPN_CONF"
cp "$OVPN_CONF" "${OVPN_CONF}.bak.$(date +%s)"
echo "    Backup saved: ${OVPN_CONF}.bak.*"

# ── 2. Patch: ensure proto tcp ───────────────────────────────────────────────
echo "[2] Ensuring proto tcp (MikroTik OVPN client requires TCP)..."
sed -i 's/^proto udp.*/proto tcp/' "$OVPN_CONF"
if ! grep -q "^proto tcp" "$OVPN_CONF"; then
  echo "proto tcp" >> "$OVPN_CONF"
fi

# ── 3. Patch: disable tls-auth / tls-crypt ───────────────────────────────────
echo "[3] Disabling tls-auth / tls-crypt (not supported by MikroTik)..."
sed -i 's/^tls-auth/;tls-auth/'   "$OVPN_CONF"
sed -i 's/^tls-crypt/;tls-crypt/' "$OVPN_CONF"

# ── 4. Patch: set cipher and auth compatible with MikroTik ──────────────────
echo "[4] Setting cipher=AES-128-CBC auth=SHA1..."
sed -i '/^cipher/d'  "$OVPN_CONF"
sed -i '/^auth /d'   "$OVPN_CONF"
echo "cipher AES-128-CBC" >> "$OVPN_CONF"
echo "auth SHA1"          >> "$OVPN_CONF"

# ── 5. Enable username/password authentication ───────────────────────────────
echo "[5] Enabling username/password auth..."

# Create auth verification script
cat > "$AUTHSCRIPT" << 'AUTHEOF'
#!/usr/bin/env bash
# Simple username:password verifier for OpenVPN
PASSFILE="/etc/openvpn/passwd"
username="$1"
password="$2"
[ -f "$PASSFILE" ] || exit 1
grep -qF "${username}:${password}" "$PASSFILE" && exit 0 || exit 1
AUTHEOF
chmod 700 "$AUTHSCRIPT"

# Add auth-user-pass-verify to server config if not already there
if ! grep -q "auth-user-pass-verify" "$OVPN_CONF"; then
  echo "auth-user-pass-verify $AUTHSCRIPT via-env" >> "$OVPN_CONF"
  echo "script-security 2"                          >> "$OVPN_CONF"
  echo "username-as-common-name"                    >> "$OVPN_CONF"
fi

# ── 6. Add the VPN user (${vpnUsername} / ${vpnPassword}) ──────────────────
echo "[6] Adding VPN user '${vpnUsername}'..."
touch "$AUTHFILE"
chmod 600 "$AUTHFILE"

# Remove existing entry for this user and re-add
sed -i '/^${vpnUsername}:/d' "$AUTHFILE"
echo "${vpnUsername}:${vpnPassword}" >> "$AUTHFILE"
echo "    User '${vpnUsername}' added to $AUTHFILE"

# ── 7. Enable client-config-dir for static IP assignment ────────────────────
echo "[7] Configuring static IP for router (${routerTunnelIp})..."
mkdir -p "$CCDDIR"

if ! grep -q "^client-config-dir" "$OVPN_CONF"; then
  echo "client-config-dir $CCDDIR" >> "$OVPN_CONF"
fi
if ! grep -q "^ifconfig-pool-persist" "$OVPN_CONF"; then
  echo "ifconfig-pool-persist /etc/openvpn/ipp.txt" >> "$OVPN_CONF"
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
# Allow forwarding from tun0 to enable routing
iptables -I FORWARD -i tun0 -j ACCEPT 2>/dev/null || true
iptables -I FORWARD -o tun0 -j ACCEPT 2>/dev/null || true

# Persist iptables rules (Ubuntu/Debian)
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save || true
elif command -v iptables-save &>/dev/null; then
  iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
fi

# ── 9. Restart OpenVPN ───────────────────────────────────────────────────────
echo "[9] Restarting OpenVPN..."
systemctl restart openvpn@server 2>/dev/null || \\
  systemctl restart openvpn       2>/dev/null || \\
  service openvpn restart         2>/dev/null || \\
  echo "    WARNING: Could not restart OpenVPN — restart manually"

sleep 2
echo ""
echo "══════════════════════════════════════════════════════════════"
echo " Setup complete. Verify:"
echo "   systemctl status openvpn@server"
echo "   ip addr show tun0    # should show ${serverGw}"
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
    vpnPort         = 1194,
    vpnUsername     = "admin",
    tunnelBase      = "10.8.0",
    routerTunnelIp  = "10.8.0.2",
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
