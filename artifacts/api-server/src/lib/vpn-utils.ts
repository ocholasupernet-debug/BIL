/**
 * VPS-side OpenVPN server utilities for OcholaSupernet.
 * Generates bash scripts to prepare the existing VPS OpenVPN server
 * to accept connections from MikroTik routers as OVPN clients.
 */
import {
  ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP,
  type RouterManagementVpnRole,
} from "./router-management-vpn.js";
import { routerVpnPeerIp } from "./router-vpn-ip.js";
import { ISRG_ROOT_X1_PEM, ROUTER_HTTPS_CERTIFICATE_NAME } from "./router-https-trust.js";

export interface VpsOvpnSetupOptions {
  /** VPS public IP (shown to the user as the endpoint) */
  vpsPublicIp: string;
  /** OpenVPN server port (default 1196; customer VPN remains on 1194) */
  vpnPort?: number;
  /** Unique username to add for the router. */
  vpnUsername: string;
  /** Unique password for the VPN user. */
  vpnPassword: string;
  /** Tunnel IP pool base — first 3 octets (default "10.8.5") */
  tunnelBase?: string;
  /** IP to assign to the router inside the tunnel. */
  routerTunnelIp: string;
  /** Router ID (for labelling) */
  routerId?: number;
  /** Select the isolated backup management OpenVPN instance. */
  vpnRole?: RouterManagementVpnRole;
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
    vpnPort,
    vpnUsername,
    vpnPassword,
    tunnelBase,
    routerTunnelIp,
    routerId,
    vpnRole = "primary",
  } = opts;

  const contract = vpnRole === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
  const serviceStem = vpnRole === "backup" ? "ochola-router-backup" : "ochola-router";
  const selectedVpnPort = vpnPort ?? contract.port;
  const selectedTunnelBase = tunnelBase ?? contract.tunnelBase;
  if (!vpnUsername || /[\u0000-\u001F\u007F:]/.test(vpnUsername)) {
    throw new Error("VPS OpenVPN username is required and must not contain control characters or ':'.");
  }
  if (!vpnPassword || /[\u0000-\u001F\u007F]/.test(vpnPassword)) {
    throw new Error("VPS OpenVPN password is required and must not contain control characters.");
  }
  if (vpnUsername === vpnPassword) {
    throw new Error("VPS OpenVPN username and password must be different.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(vpnUsername)) {
    throw new Error("VPS OpenVPN username must contain only letters, numbers, '_' or '-'.");
  }
  if (selectedTunnelBase !== contract.tunnelBase) {
    throw new Error(`VPS OpenVPN tunnel base must remain the isolated ${contract.tunnelBase}.0/24 network.`);
  }
  if (!new RegExp(`^${contract.tunnelBase.replace(/\./g, "\\.")}\\.(?:[2-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-3])$`).test(routerTunnelIp)) {
    throw new Error(`Router tunnel IP must be a valid host in ${contract.tunnelBase}.0/24.`);
  }
  const selectedRouterTunnelIp = routerTunnelIp;
  const tag       = routerId ? `router${routerId}` : "router";
  const serverNet = `${selectedTunnelBase}.0`;
  const serverGw  = `${selectedTunnelBase}.1`;
  const routerPeerIp = routerVpnPeerIp(selectedRouterTunnelIp);
  const usernameB64 = base64(vpnUsername);
  const passwordB64 = base64(vpnPassword);
  const managedCaB64 = base64(ISRG_ROOT_X1_PEM);

  return `#!/usr/bin/env bash
# ===============================================================
# OcholaSupernet - VPS OpenVPN Server Setup for MikroTik Clients
# Generated : ${new Date().toISOString()}
# VPS IP    : ${vpsPublicIp}
# VPN Port  : ${selectedVpnPort}/tcp
# VPN User  : ${vpnUsername}  (router client account)
# Router IP : ${selectedRouterTunnelIp}  (assigned inside tunnel)
#
# This script prepares the EXISTING OpenVPN server on this VPS to
# accept connections from a MikroTik router acting as an OVPN client.
#
# USAGE:
#   chmod +x vps-ovpn-setup.sh
#   sudo bash vps-ovpn-setup.sh
# ===============================================================
set -euo pipefail

BASE_OVPN_CONF="/etc/openvpn/server.conf"
OVPN_CONF="${contract.configPath}"
OVPN_DIR="/etc/openvpn"
CCDDIR="${contract.ccdPath}" # isolated router client IPs
AUTHFILE="${contract.authFilePath}" # username:password auth file
AUTHSCRIPT="${contract.authScriptPath}"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

echo "--------------------------------------------------------------"
echo " OcholaSupernet: Configuring OVPN server for MikroTik client"
echo "--------------------------------------------------------------"

# 1. Detect the legacy server config without changing it
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
  echo "[1] No existing OpenVPN config found."
  echo "ERROR: An existing OpenVPN server with a publicly trusted certificate is required."
  echo "       Configure the VPS certificate first, then download this setup again."
  exit 1
fi

# 3. Patch: ensure proto tcp
echo "[3] Creating isolated router-management server on ${selectedTunnelBase}.0:${selectedVpnPort}..."
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
MANAGEMENT_CA_FILE="$OVPN_DIR/${ROUTER_HTTPS_CERTIFICATE_NAME}.pem"
$SUDO sh -c "printf '%s' '${managedCaB64}' | base64 -d > '$MANAGEMENT_CA_FILE'"
$SUDO chmod 644 "$MANAGEMENT_CA_FILE"
echo "    RouterOS trust contract: ${ROUTER_HTTPS_CERTIFICATE_NAME} (ISRG Root X1)"
echo "[2] Checking system time before certificate validation..."
if command -v timedatectl >/dev/null 2>&1; then
  if ! timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -qx "yes"; then
    echo "ERROR: System time is not synchronized. Enable NTP before starting OpenVPN."
    exit 1
  fi
elif command -v chronyc >/dev/null 2>&1; then
  if ! chronyc tracking 2>/dev/null | grep -q "Leap status.*Normal"; then
    echo "ERROR: chrony does not report a synchronized system clock."
    exit 1
  fi
else
  echo "WARNING: timedatectl/chronyc is unavailable; verify NTP manually before continuing."
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to validate the public OpenVPN server certificate."
  exit 1
fi
CERT_TMP="$(mktemp -d)"
trap 'rm -rf "$CERT_TMP"' EXIT
awk 'BEGIN { n=0 } /-----BEGIN CERTIFICATE-----/ { n++ } n == 1 { print } /-----END CERTIFICATE-----/ && n == 1 { exit }' "$CERT_FILE" > "$CERT_TMP/leaf.pem"
awk 'BEGIN { n=0 } /-----BEGIN CERTIFICATE-----/ { n++ } n >= 2 { print }' "$CERT_FILE" > "$CERT_TMP/chain.pem"
if grep -q "BEGIN CERTIFICATE" "$CERT_TMP/chain.pem"; then
  CERT_VERIFY_ARGS=(-untrusted "$CERT_TMP/chain.pem")
else
  CERT_VERIFY_ARGS=()
fi
if ! openssl verify -CAfile "$MANAGEMENT_CA_FILE" "\${CERT_VERIFY_ARGS[@]}" "$CERT_TMP/leaf.pem" >/dev/null 2>&1; then
  echo "ERROR: The OpenVPN server certificate must chain to ISRG Root X1."
  echo "       The RouterOS client will refuse an untrusted server certificate."
  exit 1
fi
echo "    OpenVPN server certificate chains to ISRG Root X1."
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
  echo "port ${selectedVpnPort}"
  echo "proto tcp-server"
  echo "dev ${contract.interfaceName}"
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
   echo "ifconfig-pool-persist ${contract.ippPath}"
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
  echo "status ${contract.statusPath}"
  echo "verb 3"
} > "$OVPN_CONF"
echo "    Dedicated config written: $OVPN_CONF"

# 4. Patch: disable tls-auth / tls-crypt
echo "[4] Disabling tls-auth / tls-crypt (not supported by MikroTik)..."
echo "    Dedicated config does not include tls-auth or tls-crypt."

# 5. Patch: set cipher and auth compatible with MikroTik
echo "[5] Setting cipher=AES-128-CBC auth=SHA1..."
echo "    Dedicated config uses cipher=AES-128-CBC auth=SHA1."

# 6. Enable username/password authentication
echo "[6] Enabling username/password auth..."

# Create auth verification script
cat > "$AUTHSCRIPT" << 'AUTHEOF'
#!/usr/bin/env bash
# Simple username:password verifier for OpenVPN
PASSFILE="${contract.authFilePath}"
username="\${username:-\${1:-}}"
password="\${password:-\${2:-}}"
[ -f "$PASSFILE" ] || exit 1
grep -Fqx "\${username}:\${password}" "$PASSFILE" && exit 0 || exit 1
AUTHEOF
chmod 700 "$AUTHSCRIPT"

# 7. Add the VPN user (${vpnUsername})
VPN_USERNAME="$(printf '%s' '${usernameB64}' | base64 -d)"
VPN_PASSWORD="$(printf '%s' '${passwordB64}' | base64 -d)"
echo "[7] Adding VPN user '${vpnUsername}'..."
touch "$AUTHFILE"
chmod 600 "$AUTHFILE"

# Remove existing entry for this user and re-add
sed -i "/^\${VPN_USERNAME}:/d" "$AUTHFILE"
printf '%s:%s\n' "$VPN_USERNAME" "$VPN_PASSWORD" >> "$AUTHFILE"
echo "    User '${vpnUsername}' added to $AUTHFILE"

# 8. Enable client-config-dir for the assigned management address
echo "[8] Configuring the assigned management IP for router (${selectedRouterTunnelIp})..."
mkdir -p "$CCDDIR"

if ! grep -q "^client-config-dir" "$OVPN_CONF"; then
  echo "client-config-dir $CCDDIR" >> "$OVPN_CONF"
fi
if ! grep -q "^ifconfig-pool-persist" "$OVPN_CONF"; then
   echo "ifconfig-pool-persist ${contract.ippPath}" >> "$OVPN_CONF"
fi

# Static IP for the router client
cat > "$CCDDIR/${vpnUsername}" << CCDEOF
# Static tunnel IP and net30 peer for MikroTik router (${tag})
ifconfig-push ${selectedRouterTunnelIp} ${routerPeerIp}
CCDEOF
echo "    Static IP ${selectedRouterTunnelIp} assigned to '${vpnUsername}'"

# 9. Firewall: allow VPN port and API access from tunnel
echo "[9] Opening firewall rules..."
# Allow incoming OVPN connections
iptables -I INPUT -p tcp --dport ${selectedVpnPort} -j ACCEPT 2>/dev/null || true
# Allow forwarding from the isolated router tunnel to enable API traffic
iptables -I FORWARD -i ${contract.interfaceName} -j ACCEPT 2>/dev/null || true
iptables -I FORWARD -o ${contract.interfaceName} -j ACCEPT 2>/dev/null || true

# Persist iptables rules (Ubuntu/Debian)
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save || true
elif command -v iptables-save &>/dev/null; then
  iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
fi

# 9b. Validate RouterOS compatibility requirements
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

# 10. Restart only the dedicated router-management instance
echo "[10] Starting dedicated router-management OpenVPN..."
$SUDO ln -sfn "$OVPN_CONF" "$OVPN_DIR/${serviceStem}.conf"
service_started=false
if $SUDO systemctl restart openvpn-server@${serviceStem} 2>/dev/null || $SUDO systemctl enable --now openvpn-server@${serviceStem} 2>/dev/null; then
  service_started=true
elif $SUDO systemctl restart openvpn@${serviceStem} 2>/dev/null || $SUDO systemctl enable --now openvpn@${serviceStem} 2>/dev/null; then
  service_started=true
fi
if [ "$service_started" != "true" ]; then
  echo "ERROR: Could not start the dedicated router-management OpenVPN service."
  $SUDO systemctl status openvpn-server@${serviceStem} --no-pager 2>&1 | tail -n 40 || true
  $SUDO systemctl status openvpn@${serviceStem} --no-pager 2>&1 | tail -n 40 || true
  exit 1
fi

sleep 2
if ! $SUDO systemctl is-active --quiet openvpn-server@${serviceStem} 2>/dev/null && ! $SUDO systemctl is-active --quiet openvpn@${serviceStem} 2>/dev/null; then
  echo "ERROR: The dedicated router-management OpenVPN service is not active after startup."
  $SUDO journalctl -u openvpn-server@${serviceStem} -u openvpn@${serviceStem} -n 60 --no-pager 2>&1 || true
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ! $SUDO ss -ltnH | awk '$4 ~ /:'"${selectedVpnPort}"'$/ { found=1 } END { exit(found ? 0 : 1) }'; then
  echo "ERROR: OpenVPN service is active but TCP port ${selectedVpnPort} is not listening."
  $SUDO journalctl -u openvpn-server@${serviceStem} -u openvpn@${serviceStem} -n 60 --no-pager 2>&1 || true
  exit 1
fi
echo ""
echo "=============================================================="
echo " Setup complete. Verify:"
echo "   systemctl status openvpn-server@${serviceStem}"
echo "   ip addr show ${contract.interfaceName}    # should show ${serverGw}"
echo ""
echo " Now import the RouterOS client script on the router:"
echo "   /import router-as-client${routerId ?? ""}.rsc"
echo ""
echo " After router connects, verify from this VPS:"
echo "   ping ${selectedRouterTunnelIp}                    # router tunnel IP"
echo "   nc -vz -w 3 ${selectedRouterTunnelIp} 8728          # API port reachability"
echo "   journalctl -u openvpn-server@${serviceStem} -n 60 --no-pager"
echo ""
echo "   MIKROTIK_BRIDGE_IP=${selectedRouterTunnelIp}"
echo "=============================================================="
`;
}

/**
 * Returns a summary JSON of the VPN architecture for the given setup,
 * useful for displaying in the admin UI.
 */
export function describeVpnArchitecture(
  opts: Omit<VpsOvpnSetupOptions, "vpnUsername" | "vpnPassword"> & { vpnUsername?: string },
) {
  const {
    vpsPublicIp,
    vpnPort,
    vpnUsername     = "admin",
    tunnelBase,
    routerTunnelIp,
    routerId,
    vpnRole = "primary",
  } = opts;
  const contract = vpnRole === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
  const selectedVpnPort = vpnPort ?? contract.port;
  const selectedTunnelBase = tunnelBase ?? contract.tunnelBase;
  const selectedRouterTunnelIp = routerTunnelIp ?? `${contract.tunnelBase}.2`;

  return {
    architecture: "router-as-client",
    description:
      "VPS runs the OpenVPN SERVER. The MikroTik router connects as a CLIENT. " +
      "The backend API server uses the router's tunnel IP to reach the RouterOS API.",
    vpsServer: {
      publicIp:   vpsPublicIp,
      port:       selectedVpnPort,
      protocol:   "TCP",
      tunnelIp:   `${selectedTunnelBase}.1`,
      role:       "OpenVPN SERVER (already running)",
    },
    routerClient: {
      vpnUser:    vpnUsername,
      tunnelIp:   selectedRouterTunnelIp,
      role:       "OpenVPN CLIENT (connects to VPS)",
      routerId,
    },
    backendConfig: {
      MIKROTIK_BRIDGE_IP:  selectedRouterTunnelIp,
      MIKROTIK_PORT:       "8728",
      MIKROTIK_USE_SSL:    "false",
    },
    steps: [
      `1. Run vps-ovpn-setup.sh on the VPS (${vpsPublicIp}) as root`,
      `2. Download router-as-client${routerId ?? ""}.rsc from the API`,
      `3. Import the script on the router: /import router-as-client${routerId ?? ""}.rsc`,
      `4. Verify: ping ${selectedRouterTunnelIp} from the VPS`,
      `5. Set MIKROTIK_BRIDGE_IP=${selectedRouterTunnelIp} in OcholaSupernet`,
    ],
  };
}
