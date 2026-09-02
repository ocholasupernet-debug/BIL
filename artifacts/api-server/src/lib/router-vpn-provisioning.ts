import { randomBytes } from "crypto";
import { generateRouterIpsecClientScript, generateRouterWireGuardClientScript } from "./mikrotik.js";
import { generateWireGuardKeyPair } from "./vpn-management-service.js";
import {
  ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP,
  routerManagementBackupIp,
  type RouterManagementVpnRole,
} from "./router-management-vpn.js";
import { ensureRouterManagementOvpnCredentials } from "./router-management-credentials.js";
import { encryptVpnSecret, decryptVpnSecret, type EncryptedSecret } from "./vpn-crypto.js";
import { runVpsScript, vpsSshConfigured } from "./vps-ssh.js";
import { generateVpsOvpnSetupScript } from "./vpn-utils.js";

type Technology = "wireguard" | "ipsec";
type FallbackRow = {
  id: number;
  admin_id: number;
  router_id: number;
  technology: Technology;
  endpoint: string;
  endpoint_port: number | null;
  assigned_ip: string;
  server_public_key: string | null;
  client_public_key: string | null;
  server_reference: string | null;
  status: "pending" | "provisioning" | "ready" | "failed";
  last_error: string | null;
  status_json: Record<string, unknown>;
};
type SecretRow = EncryptedSecret & { secret_type: "private_key" | "psk" };

const rawSupabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_URL = rawSupabaseUrl
  ? (rawSupabaseUrl.startsWith("http") ? rawSupabaseUrl : `https://${rawSupabaseUrl}`).replace(/\/+$/, "")
  : "";
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || ""
).trim();
const locks = new Map<number, Promise<RouterVpnProvisioningResult>>();

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

async function sb<T>(table: string, query: string, init: RequestInit = {}): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase service credentials are required for VPN provisioning.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    ...init,
    headers: headers(init.headers as Record<string, string> | undefined),
  });
  if (!response.ok) throw new Error(`VPN state persistence failed (HTTP ${response.status}).`);
  const text = await response.text();
  if (!text) return [];
  return JSON.parse(text) as T[];
}

function endpointHost(): string {
  const value = (
    process.env.ROUTER_OPENVPN_ENDPOINT
    || process.env.VPS_HOST
    || ""
  ).trim().replace(/^https?:\/\//i, "").split("/")[0].replace(/:\d+$/, "");
  if (!value || !/^[A-Za-z0-9:._-]+$/.test(value)) {
    throw new Error("ROUTER_OPENVPN_ENDPOINT or VPS_HOST must identify the VPS endpoint.");
  }
  return value;
}

function endpointPort(): number {
  const value = Number.parseInt(process.env.ROUTER_WIREGUARD_PORT || "51820", 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("ROUTER_WIREGUARD_PORT must be an integer between 1 and 65535.");
  }
  return value;
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function validRouterIp(value: string, tunnelBase: string = ROUTER_MANAGEMENT_VPN.tunnelBase): boolean {
  return new RegExp(`^${tunnelBase}\\.(?:[2-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-4])$`).test(value);
}

function safeFailure(result: { stderr: string; stdout: string; error?: string }, secrets: string[]): string {
  const clean = (value: string): string => value
    .replace(/[.+*]{8,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let message = result.error
    ? clean(result.error)
    : [clean(result.stderr.slice(-220)), clean(result.stdout.slice(-220))]
      .filter(Boolean)
      .join(" | ") || "VPS reconciliation failed.";
  for (const secret of secrets.filter(Boolean)) {
    message = message.split(secret).join("[redacted]");
    message = message.split(b64(secret)).join("[redacted]");
  }
  return message.slice(0, 500) || "VPS reconciliation failed.";
}

async function loadFallbacks(routerId: number): Promise<FallbackRow[]> {
  return sb<FallbackRow>("router_vpn_fallbacks", `?router_id=eq.${routerId}&select=*`);
}

async function loadSecret(fallbackId: number): Promise<SecretRow | null> {
  const rows = await sb<SecretRow>(
    "router_vpn_fallback_secrets",
    `?fallback_id=eq.${fallbackId}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

async function upsertFallback(values: Record<string, unknown>): Promise<FallbackRow> {
  const rows = await sb<FallbackRow>(
    "router_vpn_fallbacks?on_conflict=router_id,technology",
    "",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(values),
    },
  );
  if (!rows[0]) throw new Error("VPN fallback state was not returned after persistence.");
  return rows[0];
}

async function upsertSecret(fallbackId: number, secretType: SecretRow["secret_type"], value: string): Promise<void> {
  const encrypted = encryptVpnSecret(value);
  await sb(
    "router_vpn_fallback_secrets?on_conflict=fallback_id",
    "",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        fallback_id: fallbackId,
        secret_type: secretType,
        ...encrypted,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

async function updateFallback(id: number, values: Record<string, unknown>): Promise<void> {
  await sb(
    "router_vpn_fallbacks",
    `?id=eq.${id}`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }) },
  );
}

export function generateVpsReconciliationScript(input: {
  routerId: number;
  routerIp: string;
  endpoint: string;
  wireGuardPort: number;
  wireGuardClientPublicKey: string;
  ipsecPsk: string;
  openVpnUsername: string;
  openVpnPassword: string;
}): string {
  const ovpn = generateVpsOvpnSetupScript({
    vpsPublicIp: input.endpoint,
    vpnPort: ROUTER_MANAGEMENT_VPN.port,
    vpnUsername: input.openVpnUsername,
    vpnPassword: input.openVpnPassword,
    tunnelBase: ROUTER_MANAGEMENT_VPN.tunnelBase,
    routerTunnelIp: input.routerIp,
    routerId: input.routerId,
  });
  const id = String(input.routerId);
  const wgName = "ochola-router";
  const wgConfig = `/etc/wireguard/${wgName}.conf`;
  const wgPeerDir = `/etc/wireguard/${wgName}.d`;
  const ipsecConf = `/etc/ipsec.d/ochola-router-${id}.conf`;
  const ipsecSecret = `/etc/ipsec.secrets.d/ochola-router-${id}.secrets`;
  const autoInstall = process.env.ROUTER_VPN_AUTO_INSTALL_PACKAGES !== "false";

  return `${ovpn}

# OcholaSupernet permanent router-management fallback reconciliation
set -euo pipefail
exec 9>/run/ochola-router-vpn.lock
flock -n 9 || { echo "Another router VPN reconciliation is already running."; exit 75; }

ROUTER_ID_B64='${b64(id)}'
ROUTER_IP_B64='${b64(input.routerIp)}'
WG_CLIENT_PUBLIC_B64='${b64(input.wireGuardClientPublicKey)}'
IPSEC_PSK_B64='${b64(input.ipsecPsk)}'
ROUTER_ID="$(printf '%s' "$ROUTER_ID_B64" | base64 -d)"
ROUTER_IP="$(printf '%s' "$ROUTER_IP_B64" | base64 -d)"
WG_CLIENT_PUBLIC="$(printf '%s' "$WG_CLIENT_PUBLIC_B64" | base64 -d)"
IPSEC_PSK="$(printf '%s' "$IPSEC_PSK_B64" | base64 -d)"
WG_NAME="${wgName}"
WG_CONFIG="${wgConfig}"
WG_PEER_DIR="${wgPeerDir}"
IPSEC_CONF="${ipsecConf}"
IPSEC_SECRET="${ipsecSecret}"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

if [ -r /etc/os-release ]; then . /etc/os-release; else echo "Unsupported VPS: /etc/os-release is missing."; exit 1; fi
case "\${ID:-}" in
  ubuntu|debian) ;;
  *) echo "Unsupported VPS operating system: \${ID:-unknown}. Use Debian or Ubuntu."; exit 1 ;;
esac

missing=""
command -v wg >/dev/null 2>&1 || missing="$missing wireguard-tools"
command -v ipsec >/dev/null 2>&1 || missing="$missing strongswan"
if [ -n "$missing" ]; then
  ${autoInstall ? `$SUDO apt-get update -qq
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard-tools strongswan strongswan-starter iptables-persistent` : `echo "Required VPS packages are missing:$missing. Set ROUTER_VPN_AUTO_INSTALL_PACKAGES=true and retry."; exit 1`}
fi

$SUDO install -d -m 700 /etc/wireguard "$WG_PEER_DIR" /etc/ipsec.d /etc/ipsec.secrets.d
$SUDO install -d -m 755 /etc/openvpn/server/ochola-router-ccd

# The dedicated WireGuard interface owns only 10.8.5.0/24. Peer fragments
# make retries additive, so an existing router peer is updated in place.
WG_SERVER_KEY="$WG_CONFIG.server.key"
if ! $SUDO test -s "$WG_SERVER_KEY"; then
  $SUDO sh -c "umask 077; wg genkey > '$WG_SERVER_KEY'"
fi
WG_SERVER_PRIVATE="$($SUDO cat "$WG_SERVER_KEY")"
WG_SERVER_PUBLIC="$(printf '%s' "$WG_SERVER_PRIVATE" | wg pubkey)"
$SUDO sh -c "umask 077; cat > '$WG_PEER_DIR/router-$ROUTER_ID.conf.tmp' <<EOF
[Peer]
PublicKey = $WG_CLIENT_PUBLIC
AllowedIPs = $ROUTER_IP/32
PersistentKeepalive = 25
EOF
mv '$WG_PEER_DIR/router-$ROUTER_ID.conf.tmp' '$WG_PEER_DIR/router-$ROUTER_ID.conf'"
$SUDO sh -c "{
  printf '%s\\\\n' '[Interface]' 'Address = ${ROUTER_MANAGEMENT_VPN.gateway}/24' 'ListenPort = ${input.wireGuardPort}' 'PrivateKey = '$WG_SERVER_PRIVATE
  for peer in '$WG_PEER_DIR'/*.conf; do [ -f \\"\\$peer\\" ] && cat \\"\\$peer\\"; done
} > '$WG_CONFIG.tmp' && chmod 600 '$WG_CONFIG.tmp' && mv '$WG_CONFIG.tmp' '$WG_CONFIG'"
if $SUDO systemctl is-active --quiet "wg-quick@$WG_NAME"; then
  $SUDO wg syncconf "$WG_NAME" <($SUDO wg-quick strip "$WG_NAME")
else
  $SUDO systemctl enable --now "wg-quick@$WG_NAME"
fi

# Enable forwarding and only the dedicated fallback ports/interfaces. Do not
# edit customer OpenVPN (1194/10.8.0.x) or migration VPN (temporary leases).
$SUDO sh -c 'printf "net.ipv4.ip_forward=1\\\\n" > /etc/sysctl.d/99-ochola-router-vpn.conf'
$SUDO sysctl -q -p /etc/sysctl.d/99-ochola-router-vpn.conf
$SUDO iptables -C INPUT -p udp --dport ${input.wireGuardPort} -m comment --comment ochola-router-wireguard -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT -p udp --dport ${input.wireGuardPort} -m comment --comment ochola-router-wireguard -j ACCEPT
$SUDO iptables -C FORWARD -i "$WG_NAME" -m comment --comment ochola-router-wireguard-forward -j ACCEPT 2>/dev/null || $SUDO iptables -I FORWARD -i "$WG_NAME" -m comment --comment ochola-router-wireguard-forward -j ACCEPT
$SUDO iptables -C FORWARD -o "$WG_NAME" -m comment --comment ochola-router-wireguard-forward -j ACCEPT 2>/dev/null || $SUDO iptables -I FORWARD -o "$WG_NAME" -m comment --comment ochola-router-wireguard-forward -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi

# strongSwan fragments are isolated per router and require the standard
# include hooks; no global customer IPsec connection is overwritten.
if ! $SUDO grep -Eq '^[[:space:]]*include[[:space:]]+/etc/ipsec.d/\\*\\.conf' /etc/ipsec.conf 2>/dev/null; then
  $SUDO sh -c 'printf "\\ninclude /etc/ipsec.d/*.conf\\n" >> /etc/ipsec.conf'
fi
if ! $SUDO grep -Eq '^[[:space:]]*include[[:space:]]+/etc/ipsec.secrets.d/\\*\\.secrets' /etc/ipsec.secrets 2>/dev/null; then
  $SUDO sh -c 'printf "\\ninclude /etc/ipsec.secrets.d/*.secrets\\n" >> /etc/ipsec.secrets'
fi
if ! $SUDO grep -Eq '^[[:space:]]*include[[:space:]]+/etc/ipsec.d/\\*\\.conf' /etc/ipsec.conf 2>/dev/null; then
  echo "strongSwan does not include /etc/ipsec.d/*.conf; refusing to modify the global IPsec configuration."
  exit 1
fi
if ! $SUDO grep -Eq '^[[:space:]]*include[[:space:]]+/etc/ipsec.secrets.d/\\*\\.secrets' /etc/ipsec.secrets 2>/dev/null; then
  echo "strongSwan does not include /etc/ipsec.secrets.d/*.secrets; refusing to write a peer secret."
  exit 1
fi
$SUDO sh -c "cat > '$IPSEC_CONF.tmp' <<EOF
conn ochola-router-$ROUTER_ID
  keyexchange=ikev2
  type=tunnel
  authby=psk
  left=%defaultroute
  leftid=@ochola-router-$ROUTER_ID-server
  leftsubnet=${ROUTER_MANAGEMENT_VPN.gateway}/32
  right=%any
  rightid=@router-$ROUTER_ID
  rightsubnet=$ROUTER_IP/32
  ike=aes256-sha256-modp2048
  esp=aes256-sha256
  auto=add
EOF
chmod 600 '$IPSEC_CONF.tmp' && mv '$IPSEC_CONF.tmp' '$IPSEC_CONF'"
$SUDO sh -c "umask 077; printf '@ochola-router-%s-server @router-%s : PSK \\"%s\\"\\\\n' \\"$ROUTER_ID\\" \\"$ROUTER_ID\\" \\"$IPSEC_PSK\\" > '$IPSEC_SECRET.tmp'; mv '$IPSEC_SECRET.tmp' '$IPSEC_SECRET'"
$SUDO iptables -C INPUT -p udp --dport 500 -m comment --comment ochola-router-ipsec -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT -p udp --dport 500 -m comment --comment ochola-router-ipsec -j ACCEPT
$SUDO iptables -C INPUT -p udp --dport 4500 -m comment --comment ochola-router-ipsec -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT -p udp --dport 4500 -m comment --comment ochola-router-ipsec -j ACCEPT
$SUDO iptables -C FORWARD -s "$ROUTER_IP/32" -m comment --comment ochola-router-ipsec-forward -j ACCEPT 2>/dev/null || $SUDO iptables -I FORWARD -s "$ROUTER_IP/32" -m comment --comment ochola-router-ipsec-forward -j ACCEPT
$SUDO iptables -C FORWARD -d "$ROUTER_IP/32" -m comment --comment ochola-router-ipsec-forward -j ACCEPT 2>/dev/null || $SUDO iptables -I FORWARD -d "$ROUTER_IP/32" -m comment --comment ochola-router-ipsec-forward -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi
$SUDO systemctl enable --now strongswan-starter 2>/dev/null || $SUDO systemctl enable --now strongswan 2>/dev/null || true
IPSEC_RELOAD="$($SUDO ipsec reload 2>&1 || true)"
IPSEC_REREAD="$($SUDO ipsec rereadall 2>&1 || true)"
IPSEC_STATUS="$($SUDO ipsec statusall 2>&1 || true)"
printf '%s\n' "$IPSEC_STATUS" | grep -q "ochola-router-$ROUTER_ID" || {
  echo "strongSwan did not load ochola-router-$ROUTER_ID."
  printf '%s\n' "$IPSEC_RELOAD" | tail -n 40
  printf '%s\n' "$IPSEC_REREAD" | tail -n 40
  printf '%s\n' "$IPSEC_STATUS" | tail -n 40
  $SUDO ipsec listconns 2>&1 | tail -n 40 || true
  exit 1
}

if ! $SUDO systemctl is-active --quiet openvpn-server@ochola-router 2>/dev/null && ! $SUDO systemctl is-active --quiet openvpn@ochola-router 2>/dev/null; then
  echo "Dedicated OpenVPN router-management service is not active."
  exit 1
fi
printf 'OCHOLA_WG_SERVER_PUBLIC_KEY=%s\\n' "$WG_SERVER_PUBLIC"
printf 'OCHOLA_WG_INTERFACE=%s\\n' "$WG_NAME"
printf 'OCHOLA_IPSEC_CONNECTION=ochola-router-%s\\n' "$ROUTER_ID"
printf 'OCHOLA_OPENVPN_READY=true\\n'
printf 'OCHOLA_VPN_READY=true\\n'
`;
}

export interface RouterVpnProvisioningResult {
  ready: boolean;
  endpoint: string;
  wireguard: { ready: boolean; serverPublicKey: string | null; assignedIp: string; error?: string };
  ipsec: { ready: boolean; assignedIp: string; error?: string };
  openvpn: { ready: boolean; error?: string };
}

async function reconcileRouterVpn(
  input: { adminId: number; routerId: number; routerName: string; routerIp: string },
): Promise<RouterVpnProvisioningResult> {
  if (!validRouterIp(input.routerIp)) throw new Error(`Router VPN address is outside the isolated ${ROUTER_MANAGEMENT_VPN.network} pool.`);
  if (!vpsSshConfigured()) throw new Error("VPS SSH deployment is not configured; set VPS_HOST, VPS_USER, and a VPS deployment key.");
  const endpoint = endpointHost();
  const wgPort = endpointPort();
  const existing = await loadFallbacks(input.routerId);
  const existingWg = existing.find(row => row.technology === "wireguard");
  const existingIpsec = existing.find(row => row.technology === "ipsec");

  let wgPrivate = "";
  let wgPublic = existingWg?.client_public_key || "";
  if (existingWg) {
    const secret = await loadSecret(existingWg.id);
    if (secret?.secret_type === "private_key") {
      wgPrivate = decryptVpnSecret(secret);
    }
  }
  if (!wgPrivate || !wgPublic) {
    const pair = generateWireGuardKeyPair();
    wgPrivate = pair.privateKey;
    wgPublic = pair.publicKey;
  }

  let ipsecPsk = "";
  if (existingIpsec) {
    const secret = await loadSecret(existingIpsec.id);
    if (secret?.secret_type === "psk") ipsecPsk = decryptVpnSecret(secret);
  }
  if (!ipsecPsk) ipsecPsk = randomBytes(32).toString("base64url");

  const common = {
    admin_id: input.adminId,
    router_id: input.routerId,
    endpoint,
    assigned_ip: input.routerIp,
    status: "provisioning",
    last_error: null,
    status_json: { source: "self-install", requestedProtocols: ["openvpn", "wireguard", "ipsec"] },
  };
  const wg = await upsertFallback({
    ...common,
    technology: "wireguard",
    endpoint_port: wgPort,
    client_public_key: wgPublic,
  });
  await upsertSecret(wg.id, "private_key", wgPrivate);
  const ipsec = await upsertFallback({
    ...common,
    technology: "ipsec",
    endpoint_port: null,
    client_public_key: null,
  });
  await upsertSecret(ipsec.id, "psk", ipsecPsk);

  const openVpnCredentials = await ensureRouterManagementOvpnCredentials({
    routerId: input.routerId,
    adminId: input.adminId,
    routerName: input.routerName,
  });
  const script = generateVpsReconciliationScript({
    routerId: input.routerId,
    routerIp: input.routerIp,
    endpoint,
    wireGuardPort: wgPort,
    wireGuardClientPublicKey: wgPublic,
    ipsecPsk,
    openVpnUsername: openVpnCredentials.username,
    openVpnPassword: openVpnCredentials.password,
  });
  const result = await runVpsScript(script, { timeoutMs: 180_000 });
  const serverPublicKey = result.stdout.match(/^OCHOLA_WG_SERVER_PUBLIC_KEY=([A-Za-z0-9+/=]+)$/m)?.[1] ?? null;
  const readyMarker = /^OCHOLA_VPN_READY=true$/m.test(result.stdout);

  if (!result.ok || !serverPublicKey || !readyMarker) {
    const markerFailure = result.ok
      ? `VPS command completed without readiness markers (wireguard=${serverPublicKey ? "present" : "missing"}, vpn=${readyMarker ? "present" : "missing"}).`
      : "";
    const error = markerFailure || safeFailure(result, [openVpnCredentials.password, wgPrivate, ipsecPsk]);
    await Promise.all([
      updateFallback(wg.id, { status: "failed", last_error: error, status_json: { stage: "vps-reconciliation" } }),
      updateFallback(ipsec.id, { status: "failed", last_error: error, status_json: { stage: "vps-reconciliation" } }),
    ]);
    throw new Error(`VPS router-management VPN provisioning failed: ${error}`);
  }

  await Promise.all([
    updateFallback(wg.id, {
      status: "ready",
      server_public_key: serverPublicKey,
      server_reference: "ochola-router",
      status_json: { interface: "ochola-router", verified: true },
    }),
    updateFallback(ipsec.id, {
      status: "ready",
      server_reference: `ochola-router-${input.routerId}`,
      status_json: { connection: `ochola-router-${input.routerId}`, verified: true },
    }),
  ]);
  return {
    ready: true,
    endpoint,
    wireguard: { ready: true, serverPublicKey, assignedIp: input.routerIp },
    ipsec: { ready: true, assignedIp: input.routerIp },
    openvpn: { ready: true },
  };
}

export async function provisionRouterManagementVpn(input: {
  adminId: number;
  routerId: number;
  routerName: string;
  routerIp: string;
}): Promise<RouterVpnProvisioningResult> {
  const existing = locks.get(input.routerId);
  if (existing) return existing;
  const operation = reconcileRouterVpn(input).finally(() => locks.delete(input.routerId));
  locks.set(input.routerId, operation);
  return operation;
}

const openVpnLocks = new Map<string, Promise<{
  ready: true;
  endpoint: string;
  assignedIp: string;
  username: string;
}>>();

/**
 * Reconcile only the dedicated router-management OpenVPN service.
 * This intentionally avoids changing any other VPN technology.
 */
export async function provisionRouterManagementOpenVpn(input: {
  adminId: number;
  routerId: number;
  routerName: string;
  routerIp: string;
}): Promise<{
  ready: true;
  endpoint: string;
  assignedIp: string;
  username: string;
}> {
  return provisionRouterManagementOpenVpnInstance(input, "primary");
}

export async function provisionRouterManagementOpenVpnBackup(input: {
  adminId: number;
  routerId: number;
  routerName: string;
  routerIp: string;
}): Promise<{
  ready: true;
  endpoint: string;
  assignedIp: string;
  username: string;
}> {
  return provisionRouterManagementOpenVpnInstance(input, "backup");
}

async function provisionRouterManagementOpenVpnInstance(input: {
  adminId: number;
  routerId: number;
  routerName: string;
  routerIp: string;
}, vpnRole: RouterManagementVpnRole): Promise<{
  ready: true;
  endpoint: string;
  assignedIp: string;
  username: string;
}> {
  const contract = vpnRole === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
  const assignedIp = vpnRole === "backup" ? routerManagementBackupIp(input.routerIp) : input.routerIp;
  const lockKey = `${input.routerId}:${vpnRole}`;
  const existing = openVpnLocks.get(lockKey);
  if (existing) return existing;

  const operation = (async () => {
    if (!validRouterIp(assignedIp, contract.tunnelBase)) {
      throw new Error(`Router VPN address is outside the isolated ${contract.network} pool.`);
    }
    if (!vpsSshConfigured()) {
      throw new Error("VPS SSH deployment is not configured; set VPS_HOST, VPS_USER, and a VPS deployment key.");
    }

    const endpoint = endpointHost();
    const credentials = await ensureRouterManagementOvpnCredentials({
      routerId: input.routerId,
      adminId: input.adminId,
      routerName: input.routerName,
    });
    const script = generateVpsOvpnSetupScript({
      vpsPublicIp: endpoint,
      vpnPort: contract.port,
      vpnUsername: credentials.username,
      vpnPassword: credentials.password,
      tunnelBase: contract.tunnelBase,
      routerTunnelIp: assignedIp,
      routerId: input.routerId,
      vpnRole,
    });
    const result = await runVpsScript(script, { timeoutMs: 180_000 });
    if (!result.ok) {
      throw new Error(`VPS router-management OpenVPN provisioning failed: ${safeFailure(result, [credentials.password])}`);
    }
    return {
      ready: true as const,
      endpoint,
      assignedIp,
      username: credentials.username,
    };
  })().finally(() => openVpnLocks.delete(lockKey));

  openVpnLocks.set(lockKey, operation);
  return operation;
}

export async function routerFallbackMaterial(
  routerId: number,
  technology: Technology,
): Promise<{ endpoint: string; endpointPort?: number; assignedIp: string; serverPublicKey?: string; secret: string } | null> {
  try {
    const rows = await loadFallbacks(routerId);
    const fallback = rows.find(row => row.technology === technology && row.status === "ready");
    if (!fallback) return null;
    const secret = await loadSecret(fallback.id);
    if (!secret || secret.secret_type !== (technology === "wireguard" ? "private_key" : "psk")) return null;
    return {
      endpoint: fallback.endpoint,
      ...(fallback.endpoint_port ? { endpointPort: fallback.endpoint_port } : {}),
      assignedIp: fallback.assigned_ip,
      ...(fallback.server_public_key ? { serverPublicKey: fallback.server_public_key } : {}),
      secret: decryptVpnSecret(secret),
    };
  } catch {
    /* Keep the pre-existing environment fallback usable during migration
       rollout. Provisioning itself remains strict and reports persistence
       failures to the installer. */
    return null;
  }
}

export function generatedRouterVpnChildScript(
  technology: Technology,
  routerId: number,
  material: { endpoint: string; endpointPort?: number; assignedIp: string; serverPublicKey?: string; secret: string },
  routerOsMajor = 6,
  installationMode: "coexist" | "takeover" = "takeover",
): string {
  if (technology === "wireguard") {
    if (!material.serverPublicKey) throw new Error("WireGuard server public key is missing.");
    return generateRouterWireGuardClientScript({
      endpoint: material.endpoint,
      endpointPort: material.endpointPort,
      serverPublicKey: material.serverPublicKey,
      clientPrivateKey: material.secret,
      tunnelRouterIp: material.assignedIp,
      tunnelVpsIp: ROUTER_MANAGEMENT_VPN.gateway,
      routerId,
      installationMode,
    });
  }
  return generateRouterIpsecClientScript({
    endpoint: material.endpoint,
    preSharedKey: material.secret,
    tunnelRouterIp: material.assignedIp,
    tunnelVpsIp: ROUTER_MANAGEMENT_VPN.gateway,
    routerId,
    installationMode,
    routerOsMajor,
  });
}
