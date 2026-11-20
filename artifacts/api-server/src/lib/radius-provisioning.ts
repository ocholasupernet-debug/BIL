import { createHash } from "node:crypto";

export interface RadiusRouterClient {
  routerId: number;
  name: string;
  adminId: number;
  vpnIp: string;
}

export type RadiusSyncResult =
  | { routerId: number; status: "added" | "already-synced"; vpnIp: string }
  | { routerId: number; status: "conflict" | "failed"; vpnIp: string; error: string };

export function normalizeRadiusClientIp(value: unknown): string {
  const ip = typeof value === "string" ? value.trim() : "";
  const match = /^10\.8\.5\.(\d{1,3})$/.exec(ip);
  const host = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(host) || host < 2 || host > 254) {
    throw new Error("Router needs a saved 10.8.5.x management VPN address before RADIUS enrollment.");
  }
  return `10.8.5.${host}`;
}

export function buildManagedRadiusClientFile(
  router: Pick<RadiusRouterClient, "routerId" | "vpnIp">,
  secret: string,
): string {
  if (!Number.isSafeInteger(router.routerId) || router.routerId < 1) {
    throw new Error("Invalid router id for RADIUS client provisioning.");
  }
  if (!secret || /[\u0000-\u001F\u007F]/u.test(secret)) {
    throw new Error("RADIUS shared secret is invalid.");
  }
  const ip = normalizeRadiusClientIp(router.vpnIp);
  const escapedSecret = secret.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  return [
    `# Managed by OcholaSupernet for router ${router.routerId}`,
    `client ochola_router_${router.routerId} {`,
    `  ipaddr = ${ip}`,
    `  secret = "${escapedSecret}"`,
    "}",
    "",
  ].join("\n");
}

export function radiusClientFileDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildRadiusClientFileProvisionScript(input: {
  routerId: number;
  content: string;
  replaceManaged: boolean;
  configRoot: "/etc/freeradius/3.0" | "/etc/freeradius" | "/etc/raddb";
}): string {
  if (!["/etc/freeradius/3.0", "/etc/freeradius", "/etc/raddb"].includes(input.configRoot)) {
    throw new Error("Unsupported FreeRADIUS configuration directory.");
  }
  const expectedDigest = radiusClientFileDigest(input.content);
  const contentBase64 = Buffer.from(input.content, "utf8").toString("base64");
  const destination = `${input.configRoot}/clients.d/ochola-router-${input.routerId}.conf`;
  const includeLine = `$INCLUDE clients.d/ochola-router-${input.routerId}.conf`;
  const configFile = `${input.configRoot}/radiusd.conf`;
  const serviceName = input.configRoot === "/etc/raddb" ? "radiusd" : "freeradius";
  const replace = input.replaceManaged ? "true" : "false";
  return `set -e
dest='${destination}'
conf='${configFile}'
include_line='${includeLine}'
expected='${expectedDigest}'
replace_managed='${replace}'
content_b64='${contentBase64}'
if ! sudo -n true 2>/dev/null; then echo 'error=sudo_unavailable'; exit 20; fi
if ! sudo -n test -r "$conf"; then echo 'error=radius_config_missing'; exit 21; fi
sudo -n mkdir -p '${input.configRoot}/clients.d'
if sudo -n test -f "$dest"; then
  current=$(sudo -n sha256sum "$dest" | awk '{print $1}')
  if [ "$current" = "$expected" ] && sudo -n grep -Fqx "$include_line" "$conf"; then echo 'status=already_synced'; exit 0; fi
  if [ "$current" != "$expected" ] && { [ "$replace_managed" != true ] || ! sudo -n head -n 1 "$dest" | grep -Fxq '# Managed by OcholaSupernet for router ${input.routerId}'; }; then
    echo 'error=managed_file_conflict'; exit 23
  fi
fi
tmp="\${dest%.conf}.tmp-$$.conf"
conf_backup="\${conf}.ochola-tmp-$$"
dest_backup="\${dest}.ochola-tmp-$$"
had_dest=false
sudo -n cp -a "$conf" "$conf_backup"
if sudo -n test -f "$dest"; then sudo -n cp -a "$dest" "$dest_backup"; had_dest=true; fi
printf '%s' "$content_b64" | base64 -d | sudo -n tee "$tmp" >/dev/null
sudo -n chmod 0640 "$tmp"
sudo -n mv "$tmp" "$dest"
if ! sudo -n grep -Fqx "$include_line" "$conf"; then
  printf '\\n%s\\n' "$include_line" | sudo -n tee -a "$conf" >/dev/null
fi
radius_bin=$(command -v freeradius || command -v radiusd || true)
if [ -z "$radius_bin" ] || ! sudo -n "$radius_bin" -XC >/dev/null 2>&1; then
  sudo -n cp -a "$conf_backup" "$conf"
  if [ "$had_dest" = true ]; then sudo -n cp -a "$dest_backup" "$dest"; else sudo -n rm -f "$dest"; fi
  sudo -n rm -f "$tmp" "$conf_backup" "$dest_backup"
  echo 'error=configuration_rejected'; exit 24
fi
if ! sudo -n systemctl reload '${serviceName}' >/dev/null 2>&1; then
  sudo -n cp -a "$conf_backup" "$conf"
  if [ "$had_dest" = true ]; then sudo -n cp -a "$dest_backup" "$dest"; else sudo -n rm -f "$dest"; fi
  sudo -n rm -f "$tmp" "$conf_backup" "$dest_backup"
  sudo -n systemctl reload '${serviceName}' >/dev/null 2>&1 || true
  echo 'error=reload_failed'; exit 25
fi
sudo -n rm -f "$conf_backup" "$dest_backup"
echo 'status=added'
`;
}
