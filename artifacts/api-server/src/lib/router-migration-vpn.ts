import { runVpsScript } from "./vps-ssh.js";
import { ROUTER_MANAGEMENT_VPN_BACKUP } from "./router-management-vpn.js";
import { routerVpnPeerIp } from "./router-vpn-ip.js";

export interface MigrationVpnClient {
  username: string;
  password: string;
  assignedIp: string;
}

function requireSafeUsername(value: string): string {
  const username = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(username)) {
    throw new Error("Invalid temporary migration VPN username.");
  }
  return username;
}

function requireSafePassword(value: string): string {
  const password = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(password)) {
    throw new Error("Invalid temporary migration VPN password.");
  }
  return password;
}

function requireSafeAddress(value: string): string {
  const ip = String(value ?? "").trim();
  if (!/^10\.8\.6\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-3])$/.test(ip)) {
    throw new Error("Temporary migration VPN addresses must be in the dedicated 10.8.6.x pool.");
  }
  return ip;
}

export function buildRouterMigrationVpnProvisionScript(client: MigrationVpnClient): string {
  const username = requireSafeUsername(client.username);
  const password = requireSafePassword(client.password);
  const assignedIp = requireSafeAddress(client.assignedIp);
  const peerIp = routerVpnPeerIp(assignedIp);
  const profile = ROUTER_MANAGEMENT_VPN_BACKUP;
  return `set -euo pipefail
umask 077
lock=/run/lock/ochola-router-migration-vpn.lock
sudo -n install -d -o root -g root -m 0755 /run/lock
sudo -n flock -x "$lock" bash -s <<'OCHOLA_ROOT_SCRIPT'
set -euo pipefail
umask 077
config=${JSON.stringify(profile.configPath)}
auth=${JSON.stringify(profile.authFilePath)}
ccd=${JSON.stringify(profile.ccdPath)}
username=${JSON.stringify(username)}
password=${JSON.stringify(password)}
assigned_ip=${JSON.stringify(assignedIp)}
peer_ip=${JSON.stringify(peerIp)}
test -f "$config" && test -f "$auth" && test -d "$ccd"
grep -Eq '^port[[:space:]]+${profile.port}$' "$config"
grep -Eq '^dev[[:space:]]+${profile.interfaceName}$' "$config"
grep -Eq '^server[[:space:]]+10\\.8\\.6\\.0[[:space:]]+255\\.255\\.255\\.0$' "$config"
grep -Eq '^topology[[:space:]]+net30$' "$config"
grep -Fqx 'client-config-dir ${profile.ccdPath}' "$config"
grep -Fqx 'ifconfig-pool-persist ${profile.ippPath}' "$config"
 grep -Fqx 'auth-user-pass-verify ${profile.authScriptPath} ${profile.authFilePath} via-env' "$config"
if awk -F: -v name="$username" '$1 == name { found=1 } END { exit !found }' "$auth"; then
  echo "Temporary migration username already exists." >&2
  exit 21
fi
if test -e "$ccd/$username"; then
  echo "Temporary migration CCD entry already exists." >&2
  exit 22
fi
if grep -R -Fq "ifconfig-push $assigned_ip " "$ccd"; then
  echo "Temporary migration address is already assigned." >&2
  exit 23
fi
if grep -R -Fq "ifconfig-push $peer_ip " "$ccd"; then
  echo "Temporary migration peer address is already assigned." >&2
  exit 24
fi
revoke_script=/usr/local/sbin/ochola-revoke-router-migration-vpn
cat > "$revoke_script" <<'OCHOLA_REVOKE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
umask 077
username="\${1:-}"
if ! [[ "$username" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]]; then exit 2; fi
exec 9>/run/lock/ochola-router-migration-vpn.lock
flock -x 9
auth=${profile.authFilePath}
ccd=${profile.ccdPath}
auth_tmp=$(mktemp "$auth.migration.XXXXXX")
awk -F: -v name="$username" '$1 != name' "$auth" > "$auth_tmp"
chown root:root "$auth_tmp"
chmod 0600 "$auth_tmp"
mv "$auth_tmp" "$auth"
rm -f -- "$ccd/$username"
OCHOLA_REVOKE_SCRIPT
chown root:root "$revoke_script"
chmod 0700 "$revoke_script"
unit="ochola-router-migration-expire-$username"
systemd-run --quiet --unit="$unit" --on-active=60m --timer-property=AccuracySec=1s --collect "$revoke_script" "$username"
ccd_tmp=$(mktemp "$ccd/.migration.XXXXXX")
printf 'ifconfig-push %s %s\\n' "$assigned_ip" "$peer_ip" > "$ccd_tmp"
chown root:root "$ccd_tmp"
chmod 0600 "$ccd_tmp"
mv "$ccd_tmp" "$ccd/$username"
auth_tmp=$(mktemp "$auth.migration.XXXXXX")
cp -- "$auth" "$auth_tmp"
printf '%s:%s\\n' "$username" "$password" >> "$auth_tmp"
chown root:root "$auth_tmp"
chmod 0600 "$auth_tmp"
mv "$auth_tmp" "$auth"
if ! grep -Fqx "$username:$password" "$auth" || ! grep -Fqx "ifconfig-push $assigned_ip $peer_ip" "$ccd/$username"; then
  auth_tmp=$(mktemp "$auth.migration.XXXXXX")
  awk -F: -v name="$username" '$1 != name' "$auth" > "$auth_tmp"
  chown root:root "$auth_tmp"
  chmod 0600 "$auth_tmp"
  mv "$auth_tmp" "$auth"
  rm -f -- "$ccd/$username"
  echo "Temporary migration VPN client verification failed." >&2
  exit 25
fi
echo "temporary migration VPN client provisioned"
OCHOLA_ROOT_SCRIPT`;
}

function revokeScript(usernameValue: string): string {
  const username = requireSafeUsername(usernameValue);
  const profile = ROUTER_MANAGEMENT_VPN_BACKUP;
  return `set -euo pipefail
umask 077
sudo -n install -d -o root -g root -m 0755 /run/lock
sudo -n flock -x /run/lock/ochola-router-migration-vpn.lock bash -s <<'OCHOLA_ROOT_SCRIPT'
set -euo pipefail
umask 077
auth=${JSON.stringify(profile.authFilePath)}
ccd=${JSON.stringify(profile.ccdPath)}
username=${JSON.stringify(username)}
test -f "$auth" && test -d "$ccd"
auth_tmp=$(mktemp "$auth.migration.XXXXXX")
awk -F: -v name="$username" '$1 != name' "$auth" > "$auth_tmp"
chown root:root "$auth_tmp"
chmod 0600 "$auth_tmp"
mv "$auth_tmp" "$auth"
rm -f -- "$ccd/$username"
if awk -F: -v name="$username" '$1 == name { found=1 } END { exit !found }' "$auth"; then
  echo "Temporary migration credential removal failed." >&2
  exit 26
fi
test ! -e "$ccd/$username"
echo "temporary migration VPN client revoked"
OCHOLA_ROOT_SCRIPT`;
}

async function runProtectedScript(script: string): Promise<void> {
  const result = await runVpsScript(script, { timeoutMs: 60_000 });
  if (!result.ok) {
    // Never include bounded stdout/stderr: the remote auth file can contain
    // other users' credentials if a command accidentally prints its contents.
    throw new Error(result.error || "Temporary management VPN provisioning failed.");
  }
}

export async function provisionRouterMigrationVpnClient(client: MigrationVpnClient): Promise<void> {
  await runProtectedScript(buildRouterMigrationVpnProvisionScript(client));
}

export async function revokeRouterMigrationVpnClient(username: string): Promise<void> {
  await runProtectedScript(revokeScript(username));
}