export type OpenVpnProtocol = "udp" | "tcp";

export type OpenVpnClientRecord = {
  name: string;
  comment: string;
  disabled: boolean;
  running: boolean;
};

export type GeneratedOpenVpnProfileInput = {
  server: unknown;
  port: unknown;
  protocol: unknown;
  caCertificate: unknown;
  clientCertificate?: unknown;
  clientKey?: unknown;
  keyPassphrase?: unknown;
};

export type GeneratedOpenVpnProfile = {
  profileText: string;
  server: string;
  port: number;
  protocol: OpenVpnProtocol;
  caCertificate: string;
  clientCertificate: string;
  clientKey: string;
};

const MANAGEMENT_OVPN_IDENTITY = /mainbillingvpn|ochola.*management|vps tunnel|do not delete.*management vpn/i;
const MAX_PROFILE_BYTES = 300_000;

export function isProtectedManagementOvpn(name: string, comment: string): boolean {
  return MANAGEMENT_OVPN_IDENTITY.test(`${name} ${comment}`);
}

export function hasActiveCustomerOvpnClient(clients: readonly OpenVpnClientRecord[]): boolean {
  return clients.some(client =>
    client.running
    && !client.disabled
    && !isProtectedManagementOvpn(client.name, client.comment),
  );
}

function validateServer(value: unknown): string {
  const server = String(value ?? "").trim();
  if (server.length > 253 || !server || /[\s/:@?#\\]/.test(server)) {
    throw new Error("Enter an IPv4 address or hostname for the VPN server.");
  }

  if (/^\d+(?:\.\d+){3}$/.test(server)) {
    const octets = server.split(".").map(Number);
    if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      throw new Error("The VPN server IPv4 address is invalid.");
    }
    return server;
  }

  const labels = server.replace(/\.$/, "").split(".");
  if (labels.some(label =>
    !label
    || label.length > 63
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  )) {
    throw new Error("Enter a valid VPN server hostname or IPv4 address.");
  }
  return server.replace(/\.$/, "");
}

function certificateBundle(value: unknown, label: string, required: boolean): string {
  const source = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source && !required) return "";
  const pattern = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
  const blocks = source.match(pattern) ?? [];
  const remainder = source.replace(pattern, "").trim();
  if (!blocks.length || remainder) {
    throw new Error(`${label} must contain one or more PEM certificate blocks.`);
  }
  return blocks.join("\n");
}

function privateKey(value: unknown): string {
  const source = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!source) return "";
  const start = source.match(/^-----BEGIN ((?:ENCRYPTED )?PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/);
  if (!start || !source.endsWith(`-----END ${start[1]}-----`)) {
    throw new Error("The client private key must be a PEM private-key block.");
  }
  return source;
}

export function buildOpenVpnProviderProfile(input: GeneratedOpenVpnProfileInput): GeneratedOpenVpnProfile {
  const server = validateServer(input.server);
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The VPN server port must be an integer from 1 to 65535.");
  }
  const protocol = String(input.protocol ?? "").trim().toLowerCase();
  if (protocol !== "udp" && protocol !== "tcp") {
    throw new Error("Choose UDP or TCP for the VPN transport.");
  }
  const caCertificate = certificateBundle(input.caCertificate, "CA certificate", true);
  const clientCertificate = certificateBundle(input.clientCertificate, "Client certificate", false);
  const clientKey = privateKey(input.clientKey);
  const keyPassphrase = String(input.keyPassphrase ?? "");
  if (Boolean(clientCertificate) !== Boolean(clientKey)) {
    throw new Error("A client certificate and private key must be provided together.");
  }
  if (
    clientKey
    && (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(clientKey) || /Proc-Type:\s*4,ENCRYPTED/i.test(clientKey))
    && !keyPassphrase
  ) {
    throw new Error("Enter the passphrase for the encrypted client private key.");
  }

  const lines = [
    "client",
    "dev tun",
    `proto ${protocol === "tcp" ? "tcp-client" : "udp"}`,
    `remote ${server} ${port}`,
    "resolv-retry infinite",
    "nobind",
    "persist-key",
    "persist-tun",
    "remote-cert-tls server",
    "auth-user-pass",
    "auth-nocache",
    "verb 3",
    "<ca>",
    caCertificate,
    "</ca>",
  ];
  if (clientCertificate && clientKey) {
    lines.push("<cert>", clientCertificate, "</cert>", "<key>", clientKey, "</key>");
  }
  const profileText = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(profileText, "utf8") > MAX_PROFILE_BYTES) {
    throw new Error("The generated OpenVPN profile is too large (maximum 300 KB).");
  }

  return {
    profileText,
    server,
    port,
    protocol,
    caCertificate,
    clientCertificate,
    clientKey,
  };
}