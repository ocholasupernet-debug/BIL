import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { chmodSync, unlinkSync as unlinkTemp } from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

export const MIGRATION_TUNNEL_TTL_MS = 60 * 60 * 1000;
export const MIGRATION_TUNNEL_NETWORK = "10.8.0";
export const MIGRATION_TUNNEL_SERVER_IP = "10.8.0.1";

export interface MigrationTunnelScriptOptions {
  endpoint: string;
  port: number;
  username: string;
  password: string;
  tunnelIp: string;
  serverIp?: string;
  interfaceName: string;
  firewallComment: string;
  schedulerName: string;
}

function rscEscape(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/**
 * The source router receives its tunnel address from the OpenVPN server. The
 * expected address is deliberately embedded in a local variable and status
 * output so an administrator can confirm the management path being used.
 */
export function buildMigrationTunnelScript(options: MigrationTunnelScriptOptions): string {
  const endpoint = rscEscape(options.endpoint);
  const username = rscEscape(options.username);
  const password = rscEscape(options.password);
  const tunnelIp = rscEscape(options.tunnelIp);
  const serverIp = rscEscape(options.serverIp ?? MIGRATION_TUNNEL_SERVER_IP);
  const interfaceName = rscEscape(options.interfaceName);
  const firewallComment = rscEscape(options.firewallComment);
  const schedulerName = rscEscape(options.schedulerName);
  const cleanup = [
    `:do { /interface ovpn-client disable [find name=\\\"${interfaceName}\\\"] } on-error={}`,
    `:do { /ip firewall filter remove [find comment=\\\"${firewallComment}\\\"] } on-error={}`,
    `:do { /interface ovpn-client remove [find name=\\\"${interfaceName}\\\"] } on-error={}`,
    `:do { /system scheduler remove [find name=\\\"${schedulerName}\\\"] } on-error={}`,
  ].join("; ");

  return `# OcholaSupernet one-hour migration management tunnel
# Transport: OpenVPN TCP client
# Expected router tunnel address: ${tunnelIp}
# VPS tunnel address: ${serverIp}
# This temporary client is separate from the permanent OcholaSupernet VPN.
# It is removed automatically after one hour and must not be reused later.
:local migrationTunnelIp "${tunnelIp}"
:put ("OcholaSupernet: starting migration tunnel; expected address " . $migrationTunnelIp)
:do { /system scheduler remove [find name="${schedulerName}"] } on-error={}
:do { /ip firewall filter remove [find comment="${firewallComment}"] } on-error={}
:do { /interface ovpn-client remove [find name="${interfaceName}"] } on-error={}
/interface ovpn-client add name="${interfaceName}" connect-to="${endpoint}" port=${options.port} mode=ip user="${username}" password="${password}" cipher=aes256 auth=sha1 add-default-route=no disabled=no comment="${firewallComment}"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=${serverIp} comment="${firewallComment}"
/ip firewall filter add chain=input action=accept protocol=icmp src-address=${serverIp} comment="${firewallComment}"
/system scheduler add name="${schedulerName}" interval=1h on-event="${cleanup}"
:put ("OcholaSupernet: migration tunnel configured; management address " . $migrationTunnelIp)
:put "OcholaSupernet: the migration tunnel will self-destruct after one hour."
`;
}

const DEFAULT_AUTH_FILE = "/etc/openvpn/passwd";
const DEFAULT_CCD_DIR = "/etc/openvpn/ccd";

function authFile(): string {
  return process.env.OPENVPN_MIGRATION_AUTH_FILE?.trim() || DEFAULT_AUTH_FILE;
}

function ccdDir(): string {
  return process.env.OPENVPN_MIGRATION_CCD_DIR?.trim() || DEFAULT_CCD_DIR;
}

function safeLeaseName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

/**
 * The current VPS setup reads username/password credentials from a local auth
 * file and assigns static addresses through client-config-dir. These helpers
 * are intentionally best-effort in development, where the OpenVPN paths do
 * not exist; production VPS deployments can point them at their live paths.
 */
function localProvision(username: string, password: string, tunnelIp: string): boolean {
  try {
    const passPath = authFile();
    const dir = ccdDir();
    mkdirSync(path.dirname(passPath), { recursive: true });
    mkdirSync(dir, { recursive: true });
    const existing = existsSync(passPath) ? readFileSync(passPath, "utf8") : "";
    const lines = existing.split("\n").filter(line => line.trim() && !line.startsWith(`${username}:`));
    lines.push(`${username}:${password}`);
    writeFileSync(passPath, `${lines.join("\n")}\n`, { mode: 0o600 });
    writeFileSync(path.join(dir, safeLeaseName(username)), `ifconfig-push ${tunnelIp} ${MIGRATION_TUNNEL_SERVER_IP}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function localRevoke(username: string): boolean {
  try {
    const passPath = authFile();
    if (existsSync(passPath)) {
      const existing = readFileSync(passPath, "utf8");
      const lines = existing.split("\n").filter(line => line.trim() && !line.startsWith(`${username}:`));
      writeFileSync(passPath, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
    }
    const ccdPath = path.join(ccdDir(), safeLeaseName(username));
    if (existsSync(ccdPath)) unlinkSync(ccdPath);
    return true;
  } catch {
    return false;
  }
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

async function runVpsCommand(script: string): Promise<boolean> {
  const host = process.env.VPS_HOST?.trim();
  const user = process.env.VPS_USER?.trim();
  const key = (process.env.VPS_SSH_KEY || process.env.VPS_DEPLOYMENT_KEY_V3 || process.env.VPS_DEPLOYMENT_KEY_V2 || process.env.VPS_DEPLOYMENT_KEY || "").trim();
  if (!host || !user || !key) return false;

  const keyPath = `/tmp/ochola-migration-key-${randomUUID()}`;
  const askPassPath = `/tmp/ochola-migration-askpass-${randomUUID()}`;
  try {
    writeFileSync(keyPath, key, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    const passphrase = process.env.VPS_SSH_PASSPHRASE || "";
    const args = [
      "-i", keyPath,
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      "-o", "PasswordAuthentication=no",
      `${user}@${host}`,
      "sh",
      "-s",
    ];
    const env = { ...process.env };
    if (passphrase) {
      writeFileSync(askPassPath, `#!/bin/sh\nprintf '%s' '${b64(passphrase)}' | base64 -d\n`, { mode: 0o700 });
      chmodSync(askPassPath, 0o700);
      args.unshift("-o", "BatchMode=no");
      env.SSH_ASKPASS = askPassPath;
      env.SSH_ASKPASS_REQUIRE = "force";
      env.DISPLAY = env.DISPLAY || "none";
    } else {
      args.unshift("-o", "BatchMode=yes");
    }
    return await new Promise(resolve => {
      const child = spawn("ssh", args, { env, stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("close", code => resolve(code === 0));
      child.stdin.end(script);
    });
  } finally {
    try { unlinkTemp(keyPath); } catch { /* best effort cleanup */ }
    try { unlinkTemp(askPassPath); } catch { /* best effort cleanup */ }
  }
}

function remoteConfigured(): boolean {
  const host = process.env.VPS_HOST?.trim() || "";
  const local = host === "localhost" || host === "127.0.0.1";
  return Boolean(host && !local);
}

export async function provisionMigrationOpenVpnLease(username: string, password: string, tunnelIp: string): Promise<boolean> {
  if (process.env.VPS_SSH_KEY || process.env.VPS_DEPLOYMENT_KEY_V3 || process.env.VPS_DEPLOYMENT_KEY_V2 || process.env.VPS_DEPLOYMENT_KEY) {
    const script = `set -eu
USER_B64='${b64(username)}'
PASSWORD_B64='${b64(password)}'
IP_B64='${b64(tunnelIp)}'
USER="$(printf '%s' "$USER_B64" | base64 -d)"
PASSWORD="$(printf '%s' "$PASSWORD_B64" | base64 -d)"
IP="$(printf '%s' "$IP_B64" | base64 -d)"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
$SUDO mkdir -p /etc/openvpn/ccd
$SUDO touch /etc/openvpn/passwd
$SUDO chmod 600 /etc/openvpn/passwd
$SUDO sh -c 'awk -F: -v u="$1" "$1 != u" /etc/openvpn/passwd > /tmp/ochola-passwd.$$ || true; printf "%s:%s\\n" "$1" "$2" >> /tmp/ochola-passwd.$$; install -m 600 /tmp/ochola-passwd.$$ /etc/openvpn/passwd; rm -f /tmp/ochola-passwd.$$' sh "$USER" "$PASSWORD"
$SUDO sh -c 'printf "ifconfig-push %s 10.8.0.1\\n" "$2" > /tmp/ochola-ccd.$$; install -m 600 /tmp/ochola-ccd.$$ "/etc/openvpn/ccd/$1"; rm -f /tmp/ochola-ccd.$$' sh "$USER" "$IP"
`;
    return runVpsCommand(script);
  }
  if (remoteConfigured()) return false;
  return Promise.resolve(localProvision(username, password, tunnelIp));
}

export async function revokeMigrationOpenVpnLease(username: string): Promise<boolean> {
  if (process.env.VPS_SSH_KEY || process.env.VPS_DEPLOYMENT_KEY_V3 || process.env.VPS_DEPLOYMENT_KEY_V2 || process.env.VPS_DEPLOYMENT_KEY) {
    const script = `set -eu
USER_B64='${b64(username)}'
USER="$(printf '%s' "$USER_B64" | base64 -d)"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
$SUDO sh -c 'awk -F: -v u="$1" "$1 != u" /etc/openvpn/passwd > /tmp/ochola-passwd.$$ || true; install -m 600 /tmp/ochola-passwd.$$ /etc/openvpn/passwd; rm -f /tmp/ochola-passwd.$$' sh "$USER"
$SUDO rm -f "/etc/openvpn/ccd/$USER"
`;
    return runVpsCommand(script);
  }
  if (remoteConfigured()) return false;
  return Promise.resolve(localRevoke(username));
}