import { runVpsScript, vpsSshConfigured } from "./vps-ssh.js";
import {
  ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP,
  routerManagementBackupIp,
  routerManagementOvpnCredentials,
  routerManagementVpnPortForRouter,
} from "./router-management-vpn.js";

export interface RouterFailoverServiceState {
  active: boolean;
  listening: boolean;
  clientTunnelIp: string | null;
}

export interface RouterFailoverSnapshot {
  ok: boolean;
  source: "vps";
  checkedAt: string;
  error?: string;
  primary: RouterFailoverServiceState;
  backup: RouterFailoverServiceState;
}

export interface RouterFailoverRun {
  ok: boolean;
  source: "server_staged";
  startedAt: string;
  finishedAt: string;
  primaryTunnelIp: string | null;
  backupTunnelIp: string | null;
  steps: Array<{
    id: "primary_connection" | "primary_outage" | "backup_connection" | "primary_restore";
    status: "passed" | "failed" | "skipped";
    detail: string;
  }>;
  error?: string;
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function marker(text: string, key: string): string {
  const match = new RegExp(`^OCHOLA_DIAG ${key}=([^\\n]*)$`, "m").exec(text);
  return match?.[1]?.trim() ?? "";
}

function yes(value: string): boolean {
  return value === "yes" || value === "active" || value === "passed";
}

function safeTunnelIp(value: string): string | null {
  return /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(value) ? value : null;
}

function endpointForRemote(): string {
  return (process.env.ROUTER_OPENVPN_ENDPOINT?.trim() || process.env.VPS_HOST?.trim() || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/:\d+$/, "")
    .trim();
}

function snapshotScript(routerName: string): string {
  const nameB64 = b64(routerName);
  return `#!/usr/bin/env bash
set -u
ROUTER_NAME="$(printf '%s' '${nameB64}' | base64 -d)"
state() {
  local service="$1" port="$2" status_file="$3"
  local active listening client_ip
  active="$(systemctl is-active "$service" 2>/dev/null || true)"
  listening="$(ss -ltnH 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" { found=1 } END { print found ? "yes" : "no" }')"
  client_ip="$(awk -F, -v n="$ROUTER_NAME" '$2 == n { print $1; exit }' "$status_file" 2>/dev/null || true)"
  printf '%s %s %s\\n' "$active" "$listening" "$client_ip"
}
read -r primary_active primary_listening primary_ip < <(state 'openvpn-server@ochola-router' '${ROUTER_MANAGEMENT_VPN.port}' '${ROUTER_MANAGEMENT_VPN.statusPath}')
read -r backup_active backup_listening backup_ip < <(state 'openvpn-server@ochola-router-backup' '${ROUTER_MANAGEMENT_VPN_BACKUP.port}' '${ROUTER_MANAGEMENT_VPN_BACKUP.statusPath}')
printf 'OCHOLA_DIAG primary_active=%s\\n' "$primary_active"
printf 'OCHOLA_DIAG primary_listening=%s\\n' "$primary_listening"
printf 'OCHOLA_DIAG primary_ip=%s\\n' "$primary_ip"
printf 'OCHOLA_DIAG backup_active=%s\\n' "$backup_active"
printf 'OCHOLA_DIAG backup_listening=%s\\n' "$backup_listening"
printf 'OCHOLA_DIAG backup_ip=%s\\n' "$backup_ip"
`;
}

export async function readRouterFailoverSnapshot(routerName: string): Promise<RouterFailoverSnapshot> {
  const checkedAt = new Date().toISOString();
  const empty = (): RouterFailoverSnapshot => ({
    ok: false,
    source: "vps",
    checkedAt,
    primary: { active: false, listening: false, clientTunnelIp: null },
    backup: { active: false, listening: false, clientTunnelIp: null },
  });
  if (!vpsSshConfigured()) {
    return { ...empty(), error: "The VPS SSH diagnostic channel is not configured." };
  }

  const result = await runVpsScript(snapshotScript(routerName), { timeoutMs: 20_000 });
  const snapshot = empty();
  snapshot.primary = {
    active: marker(result.stdout, "primary_active") === "active",
    listening: marker(result.stdout, "primary_listening") === "yes",
    clientTunnelIp: safeTunnelIp(marker(result.stdout, "primary_ip")),
  };
  snapshot.backup = {
    active: marker(result.stdout, "backup_active") === "active",
    listening: marker(result.stdout, "backup_listening") === "yes",
    clientTunnelIp: safeTunnelIp(marker(result.stdout, "backup_ip")),
  };
  snapshot.ok = result.ok && snapshot.primary.active && snapshot.backup.active;
  if (!result.ok) snapshot.error = "The VPS could not return the management VPN state.";
  return snapshot;
}

function stagedRunScript(routerId: number, routerName: string, primaryIp: string): string {
  const nameB64 = b64(routerName);
  const primaryExpected = primaryIp;
  const backupExpected = routerManagementBackupIp(primaryIp);
  const primaryDev = `ofdpri${routerId}`;
  const backupDev = `ofdback${routerId}`;
  return `#!/usr/bin/env bash
set -Eeuo pipefail
WORK="$(mktemp -d /run/ochola-failover-diagnostic.XXXXXX)"
PRIMARY_PID=""
BACKUP_PID=""
ROUTER_NAME="$(printf '%s' '${nameB64}' | base64 -d)"
PRIMARY_EXPECTED='${primaryExpected}'
BACKUP_EXPECTED='${backupExpected}'
PRIMARY_DEV='${primaryDev}'
BACKUP_DEV='${backupDev}'
cleanup() {
  set +e
  [ -n "$PRIMARY_PID" ] && kill "$PRIMARY_PID" 2>/dev/null || true
  [ -n "$BACKUP_PID" ] && kill "$BACKUP_PID" 2>/dev/null || true
  [ -n "$PRIMARY_PID" ] && wait "$PRIMARY_PID" 2>/dev/null || true
  [ -n "$BACKUP_PID" ] && wait "$BACKUP_PID" 2>/dev/null || true
  rm -rf "$WORK"
  systemctl start openvpn-server@ochola-router >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  printf 'OCHOLA_DIAG result=failed\\n'
  printf 'OCHOLA_DIAG failure=%s\\n' "$1"
  exit 10
}
systemctl is-active --quiet openvpn-server@ochola-router || fail primary_service_unavailable
systemctl is-active --quiet openvpn-server@ochola-router-backup || fail backup_service_unavailable
command -v openvpn >/dev/null 2>&1 || fail openvpn_binary_unavailable
printf '%s\\n%s\\n' "$ROUTER_NAME" "$ROUTER_NAME" > "$WORK/auth"
chmod 600 "$WORK/auth"
cat > "$WORK/client.conf" <<CFG
client
proto tcp-client
nobind
persist-key
persist-tun
connect-timeout 5
connect-retry 2 5
auth-user-pass $WORK/auth
auth-nocache
ca /etc/openvpn/easy-rsa/pki/ca.crt
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
verb 1
CFG
wait_for_ready() {
  local dev="$1" expected="$2" log="$3"
  for _ in $(seq 1 20); do
    if grep -q 'Initialization Sequence Completed' "$log" 2>/dev/null &&
       ip -4 addr show dev "$dev" 2>/dev/null | grep -E -q "inet[[:space:]]+$expected[[:space:]]"; then
      return 0
    fi
    sleep 1
  done
  return 1
}
openvpn --config "$WORK/client.conf" --dev "$PRIMARY_DEV" --remote 127.0.0.1 ${ROUTER_MANAGEMENT_VPN.port} --log "$WORK/primary.log" --writepid "$WORK/primary.pid" >/dev/null 2>&1 &
PRIMARY_PID=$!
if ! wait_for_ready "$PRIMARY_DEV" "$PRIMARY_EXPECTED" "$WORK/primary.log"; then
  fail primary_client_did_not_initialize
fi
printf 'OCHOLA_DIAG primary_connection=passed\\n'
printf 'OCHOLA_DIAG primary_ip=%s\\n' "$PRIMARY_EXPECTED"
kill "$PRIMARY_PID" 2>/dev/null || true
wait "$PRIMARY_PID" 2>/dev/null || true
PRIMARY_PID=""
systemctl stop openvpn-server@ochola-router >/dev/null 2>&1 || fail primary_service_stop_failed
for _ in $(seq 1 10); do
  systemctl is-active --quiet openvpn-server@ochola-router || break
  sleep 1
done
systemctl is-active --quiet openvpn-server@ochola-router && fail primary_service_remained_active
printf 'OCHOLA_DIAG primary_outage=passed\\n'
openvpn --config "$WORK/client.conf" --dev "$BACKUP_DEV" --remote 127.0.0.1 ${ROUTER_MANAGEMENT_VPN_BACKUP.port} --log "$WORK/backup.log" --writepid "$WORK/backup.pid" >/dev/null 2>&1 &
BACKUP_PID=$!
if ! wait_for_ready "$BACKUP_DEV" "$BACKUP_EXPECTED" "$WORK/backup.log"; then
  fail backup_client_did_not_initialize
fi
printf 'OCHOLA_DIAG backup_connection=passed\\n'
printf 'OCHOLA_DIAG backup_ip=%s\\n' "$BACKUP_EXPECTED"
kill "$BACKUP_PID" 2>/dev/null || true
wait "$BACKUP_PID" 2>/dev/null || true
BACKUP_PID=""
systemctl start openvpn-server@ochola-router >/dev/null 2>&1 || fail primary_service_restore_failed
for _ in $(seq 1 20); do
  systemctl is-active --quiet openvpn-server@ochola-router && break
  sleep 1
done
systemctl is-active --quiet openvpn-server@ochola-router || fail primary_service_not_active_after_restore
printf 'OCHOLA_DIAG primary_restore=passed\\n'
printf 'OCHOLA_DIAG result=passed\\n'
`;
}

function runState(text: string, key: string): "passed" | "failed" | "skipped" {
  const value = marker(text, key);
  return value === "passed" ? "passed" : value === "failed" ? "failed" : "skipped";
}

export async function runStagedRouterFailover(
  routerId: number,
  routerName: string,
  primaryIp: string,
): Promise<RouterFailoverRun> {
  const startedAt = new Date().toISOString();
  const result = await runVpsScript(stagedRunScript(routerId, routerName, primaryIp), { timeoutMs: 100_000 });
  const finishedAt = new Date().toISOString();
  const output = result.stdout;
  const failure = marker(output, "failure") || (result.error ? "vps_diagnostic_failed" : "");
  const steps: RouterFailoverRun["steps"] = [
    {
      id: "primary_connection",
      status: runState(output, "primary_connection"),
      detail: runState(output, "primary_connection") === "passed"
        ? "Staged client initialized through the primary management listener."
        : "The staged client did not initialize through the primary listener.",
    },
    {
      id: "primary_outage",
      status: runState(output, "primary_outage"),
      detail: runState(output, "primary_outage") === "passed"
        ? "Primary management service was stopped for the controlled test."
        : "The primary management service was not stopped cleanly.",
    },
    {
      id: "backup_connection",
      status: runState(output, "backup_connection"),
      detail: runState(output, "backup_connection") === "passed"
        ? "Staged client initialized through the backup management listener."
        : "The staged client did not initialize through the backup listener.",
    },
    {
      id: "primary_restore",
      status: runState(output, "primary_restore"),
      detail: runState(output, "primary_restore") === "passed"
        ? "Primary management service was restored before the check ended."
        : "Primary management service restoration was not confirmed.",
    },
  ];
  return {
    ok: result.ok && marker(output, "result") === "passed" && steps.every(step => step.status === "passed"),
    source: "server_staged",
    startedAt,
    finishedAt,
    primaryTunnelIp: safeTunnelIp(marker(output, "primary_ip")),
    backupTunnelIp: safeTunnelIp(marker(output, "backup_ip")),
    steps,
    ...(failure ? { error: failure } : {}),
  };
}

export function routerFailoverEndpoints(routerId: number, primaryIp: string): {
  endpoint: string | null;
  primary: { port: number; network: string; tunnelIp: string; gateway: string };
  backup: { port: number; network: string; tunnelIp: string; gateway: string };
} {
  const endpoint = endpointForRemote() || null;
  const backupIp = routerManagementBackupIp(primaryIp);
  return {
    endpoint,
    primary: {
      port: routerManagementVpnPortForRouter(routerId),
      network: ROUTER_MANAGEMENT_VPN.network,
      tunnelIp: primaryIp,
      gateway: ROUTER_MANAGEMENT_VPN.gateway,
    },
    backup: {
      port: ROUTER_MANAGEMENT_VPN_BACKUP.port,
      network: ROUTER_MANAGEMENT_VPN_BACKUP.network,
      tunnelIp: backupIp,
      gateway: ROUTER_MANAGEMENT_VPN_BACKUP.gateway,
    },
  };
}

export function routerFailoverCredentialsAreValid(routerName: string): boolean {
  try {
    routerManagementOvpnCredentials(routerName);
    return true;
  } catch {
    return false;
  }
}