export interface MigrationTunnelOptions {
  endpoint: string;
  port: number;
  username: string;
  password: string;
  tunnelIp: string;
  interfaceName: string;
  firewallComment: string;
  schedulerName: string;
  apiUsername?: string;
  apiPassword?: string;
  caCertificatePem?: string;
}

function safeToken(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(normalized)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, and hyphens.`);
  }
  return normalized;
}

function safeEndpoint(value: string): string {
  const endpoint = String(value ?? "").trim();
  if (!/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(endpoint)) {
    throw new Error("A valid OpenVPN hostname or IPv4 address is required.");
  }
  return endpoint;
}

function safeTunnelIp(value: string): string {
  const ip = String(value ?? "").trim();
  const match = /^10\.8\.6\.(\d{1,3})$/.exec(ip);
  const host = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(host) || host < 2 || host > 253) {
    throw new Error("Migration tunnels must use an assigned 10.8.6.x management address.");
  }
  return ip;
}

function rosString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Produces a temporary, address-bound management tunnel. It does not create
 * routes or alter the router's service/bridge configuration. The local
 * scheduler removes the tunnel, API exception, and temporary API account.
 */
export function buildMigrationTunnelScript(options: MigrationTunnelOptions): string {
  const endpoint = safeEndpoint(options.endpoint);
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("The migration OpenVPN port is invalid.");
  }
  const username = safeToken(options.username, "OpenVPN username");
  const password = safeToken(options.password, "OpenVPN password");
  const tunnelIp = safeTunnelIp(options.tunnelIp);
  const interfaceName = safeToken(options.interfaceName, "Tunnel interface name");
  const firewallComment = safeToken(options.firewallComment, "Firewall comment");
  const schedulerName = safeToken(options.schedulerName, "Expiry scheduler name");
  const apiUsername = options.apiUsername ? safeToken(options.apiUsername, "API username") : "";
  const apiPassword = options.apiPassword ? safeToken(options.apiPassword, "API password") : "";
  if (Boolean(apiUsername) !== Boolean(apiPassword)) {
    throw new Error("Both temporary API username and password are required.");
  }
  const caPem = String(options.caCertificatePem ?? "").trim();
  if (caPem && !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(caPem)) {
    throw new Error("The management VPN CA certificate is invalid.");
  }
  const caLiteral = caPem ? rosString(caPem) : "";
  const apiCreate = apiUsername
    ? `/user remove [find where name=${rosString(apiUsername)}]
/user add name=${rosString(apiUsername)} group=full password=${rosString(apiPassword)} comment=${rosString(`temporary migration access ${schedulerName}`)}`
    : "";
  const apiRemove = apiUsername
    ? `:set migrationCleanup ($migrationCleanup . ${rosString(` /user remove [find where name="${apiUsername}"];`)})`
    : "";
  const certificateSetup = caPem
    ? `:local migrationCaFile ${rosString(`ochola-migration-ca-${schedulerName}.crt`)}
:do {
  /file remove [find where name=$migrationCaFile]
} on-error={}
/file add name=$migrationCaFile contents=${caLiteral}
/certificate import file-name=$migrationCaFile passphrase=""
/file remove [find where name=$migrationCaFile]
:local migrationCa [/certificate find where name~"ochola-management"]
:if ([:len $migrationCa] > 0) do={ /certificate set $migrationCa trusted=yes }`
    : "";
  const certificateVerify = caPem
    ? `:if ($migrationRosMajor = "7") do={
  :execute [:parse ("/interface ovpn-client set [find where name=\\"" . $migrationTunnelInterfaceName . "\\"] verify-server-certificate=yes")]
}`
    : "";

  return `# Temporary OcholaSupernet source-copy tunnel. Expires automatically after one hour.
# This script does not add routes, change bridges, or configure customer services.
:local migrationRosVersion [/system resource get version]
:local migrationRosMajor [:pick $migrationRosVersion 0 1]
:if (($migrationRosMajor != "6") && ($migrationRosMajor != "7")) do={ :error "RouterOS 6 or 7 is required for the migration tunnel." }
:local migrationCipher "aes128"
:if ($migrationRosMajor = "7") do={ :set migrationCipher "aes128-cbc" }
${certificateSetup}
:local migrationTunnelInterfaceName ${rosString(interfaceName)}
:local migrationFirewallComment ${rosString(firewallComment)}
:local migrationSchedulerName ${rosString(schedulerName)}
:local migrationApiWasDisabled "false"
:local migrationApiService [/ip service find where name="api"]
:if ([:len $migrationApiService] = 0) do={ :error "RouterOS API service is unavailable; enable API before migration." }
:set migrationApiWasDisabled [/ip service get $migrationApiService disabled]
/interface ovpn-client remove [find where name=$migrationTunnelInterfaceName]
/ip firewall filter remove [find where comment=$migrationFirewallComment]
/system scheduler remove [find where name=$migrationSchedulerName]
:local migrationCleanup ("/interface ovpn-client remove [find where name=\\"" . $migrationTunnelInterfaceName . "\\"]; /ip firewall filter remove [find where comment=\\"" . $migrationFirewallComment . "\\"];")
${apiRemove}
:if ($migrationApiWasDisabled = "true") do={ :set migrationCleanup ($migrationCleanup . " /ip service disable [find where name=api];") }
:set migrationCleanup ($migrationCleanup . " /system scheduler remove [find where name=\\"" . $migrationSchedulerName . "\\"];")
/system scheduler add name=$migrationSchedulerName interval=1h on-event=$migrationCleanup comment=${rosString(`one-hour migration tunnel expiry ${schedulerName}`)}
${apiCreate}
/interface ovpn-client add name=$migrationTunnelInterfaceName connect-to=${rosString(endpoint)} port=${port} mode=ip user=${rosString(username)} password=${rosString(password)} profile=default-encryption auth=sha1 cipher=$migrationCipher add-default-route=no use-peer-dns=no comment=${rosString(`ochola-migration:${schedulerName}`)}
${certificateVerify}
:local migrationDeadline 60
:while (($migrationDeadline > 0) && ([/interface ovpn-client get $migrationTunnelInterfaceName running] != true)) do={
  :delay 1s
  :set migrationDeadline ($migrationDeadline - 1)
}
:if ([/interface ovpn-client get $migrationTunnelInterfaceName running] != true) do={
  /interface ovpn-client remove [find where name=$migrationTunnelInterfaceName]
  :error "Temporary migration VPN did not connect."
}
:local migrationAssignedAddress [/ip address find where interface=$migrationTunnelInterfaceName]
:if ([:len $migrationAssignedAddress] = 0) do={ :error "The migration VPN connected without an address." }
:local migrationExpectedTunnelIp ${rosString(tunnelIp)}
:if ([:pick [/ip address get $migrationAssignedAddress address] 0 [:find [/ip address get $migrationAssignedAddress address] "/"]] != $migrationExpectedTunnelIp) do={
  :error ("Expected router tunnel address: " . $migrationExpectedTunnelIp)
}
:put ("Expected router tunnel address: " . $migrationExpectedTunnelIp)
/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.8.6.1 in-interface=$migrationTunnelInterfaceName place-before=0 comment=$migrationFirewallComment
:if ($migrationApiWasDisabled = "true") do={ /ip service enable $migrationApiService }
:put "Temporary migration tunnel is connected. It will remove itself after one hour."
`;
}