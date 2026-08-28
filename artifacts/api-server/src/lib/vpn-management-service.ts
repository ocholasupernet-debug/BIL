import { generateKeyPairSync } from "crypto";
import { isIP } from "net";
import { runRouterCommand, type RouterCredentials } from "./mikrotik.js";

export type VpnTechnology = "wireguard" | "openvpn" | "ipsec";
export type VpnOperation = "create" | "update" | "delete" | "disable" | "status";

export interface VpnRouter extends RouterCredentials {
  id: number;
  adminId: number;
  identity?: string;
  rosVersion?: string | null;
}

export interface VpnCapabilities {
  routerOsVersion: string;
  major: number;
  wireguard: boolean;
  openvpn: boolean;
  ipsec: boolean;
  reasons: Partial<Record<VpnTechnology, string>>;
}

export interface VpnInput {
  technology: VpnTechnology;
  operation: VpnOperation;
  name: string;
  interfaceName?: string;
  listenPort?: number;
  address?: string;
  allowedIps?: string[];
  endpoint?: string;
  routerRef?: string;
  enabled?: boolean;
  profile?: string;
  peerAddress?: string;
  exchangeMode?: string;
  authMethod?: string;
  proposal?: string;
  secret?: string;
}

export interface VpnPlan {
  technology: VpnTechnology;
  operation: VpnOperation;
  commands: string[][];
  verifyCommands: string[][];
  rollbackCommands: string[][];
  redactedInput: Record<string, unknown>;
}

export interface VpnServerInput {
  technology: VpnTechnology;
  name: string;
  interfaceName?: string;
  listenPort?: number;
  address?: string;
  enabled?: boolean;
}

export interface VpnExecutionResult {
  stage: "planned" | "applied" | "verified" | "failed";
  dryRun: boolean;
  outputs: Record<string, string>[];
  verification: Record<string, string>[];
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const ROUTER_REF_RE = /^\*?[0-9A-Za-z]+$/;
const CIDR_RE = /^(.*)\/([0-9]{1,3})$/;

function safeName(value: unknown, field: string): string {
  const name = String(value ?? "").trim();
  if (!NAME_RE.test(name)) {
    throw new Error(`${field} must contain only letters, numbers, dots, underscores, and hyphens`);
  }
  return name;
}

export function validateVpnInput(input: VpnInput): VpnInput {
  if (!["wireguard", "openvpn", "ipsec"].includes(input.technology)) {
    throw new Error("Unsupported VPN technology");
  }
  if (!["create", "update", "delete", "disable", "status"].includes(input.operation)) {
    throw new Error("Unsupported VPN operation");
  }
  const normalized: VpnInput = {
    ...input,
    name: safeName(input.name, "name"),
    interfaceName: input.interfaceName ? safeName(input.interfaceName, "interfaceName") : undefined,
    profile: input.profile ? safeName(input.profile, "profile") : undefined,
    routerRef: input.routerRef ? String(input.routerRef).trim() : undefined,
    endpoint: input.endpoint ? String(input.endpoint).trim() : undefined,
    exchangeMode: input.exchangeMode ? String(input.exchangeMode).trim() : undefined,
    authMethod: input.authMethod ? String(input.authMethod).trim() : undefined,
    proposal: input.proposal ? String(input.proposal).trim() : undefined,
  };

  if (normalized.routerRef && !ROUTER_REF_RE.test(normalized.routerRef)) {
    throw new Error("routerRef is not a valid RouterOS item reference");
  }
  if (normalized.listenPort !== undefined &&
      (!Number.isInteger(normalized.listenPort) || normalized.listenPort < 1 || normalized.listenPort > 65535)) {
    throw new Error("listenPort must be an integer between 1 and 65535");
  }
  if (normalized.address && !isValidAddress(normalized.address)) {
    throw new Error("address must be a valid IPv4/IPv6 address or CIDR");
  }
  if (normalized.peerAddress && !isValidAddress(normalized.peerAddress)) {
    throw new Error("peerAddress must be a valid IPv4/IPv6 address or CIDR");
  }
  const allowedIps = normalized.allowedIps?.map(value => String(value).trim()).filter(Boolean);
  if (allowedIps?.some(value => !isValidAddress(value))) {
    throw new Error("allowedIps contains an invalid address");
  }
  normalized.allowedIps = allowedIps;
  if (normalized.endpoint && normalized.endpoint.length > 253) throw new Error("endpoint is too long");
  if (normalized.operation !== "status" && normalized.operation !== "delete" && input.enabled !== undefined &&
      typeof input.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return normalized;
}

function isValidAddress(value: string): boolean {
  const trimmed = value.trim();
  const match = trimmed.match(CIDR_RE);
  const host = match?.[1] ?? trimmed;
  if (!isIP(host)) return false;
  if (!match) return true;
  const bits = Number(match[2]);
  return bits >= 0 && bits <= (isIP(host) === 6 ? 128 : 32);
}

export function generateWireGuardKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519", {
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  /* RFC 8410 DER wrappers: the final 32 bytes are the raw X25519 keys. */
  return {
    privateKey: privateKey.subarray(-32).toString("base64"),
    publicKey: publicKey.subarray(-32).toString("base64"),
  };
}

function routerCommand(path: string, properties: Record<string, string | number | boolean | undefined>): string[] {
  return [
    path,
    ...Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `=${key}=${String(value)}`),
  ];
}

export async function detectVpnCapabilities(router: VpnRouter): Promise<VpnCapabilities> {
  let resource: Record<string, string>[] = [];
  try {
    resource = await runRouterCommand(router, ["/system/resource/print"]);
  } catch (error) {
    throw new Error(`Router capability check failed: ${(error as Error).message}`);
  }
  const version = resource[0]?.version ?? router.rosVersion ?? "";
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10) || 0;
  const reasons: Partial<Record<VpnTechnology, string>> = {};

  const probe = async (technology: VpnTechnology, command: string[]): Promise<boolean> => {
    try {
      await runRouterCommand(router, command);
      return true;
    } catch (error) {
      reasons[technology] = (error as Error).message.replace(/\s+/g, " ").slice(0, 180);
      return false;
    }
  };

  const wireguard = major >= 7 && await probe("wireguard", ["/interface/wireguard/print"]);
  if (major < 7) reasons.wireguard = "WireGuard requires RouterOS 7 or newer";
  const openvpn = await probe("openvpn", ["/interface/ovpn-server/server/print"]);
  const ipsec = await probe("ipsec", ["/ip/ipsec/peer/print"]);
  return { routerOsVersion: version || "unknown", major, wireguard, openvpn, ipsec, reasons };
}

export function assertCapability(capabilities: VpnCapabilities, technology: VpnTechnology): void {
  if (!capabilities[technology]) {
    throw new Error(`${technology} is not available on RouterOS ${capabilities.routerOsVersion}${capabilities.reasons[technology] ? `: ${capabilities.reasons[technology]}` : ""}`);
  }
}

export function buildVpnPlan(input: VpnInput): VpnPlan {
  const normalized = validateVpnInput(input);
  if (normalized.operation !== "create" && normalized.operation !== "status" && !normalized.routerRef) {
    throw new Error("RouterOS resource reference is required for this operation");
  }
  const enabled = normalized.enabled !== false;
  const allowed = (normalized.allowedIps?.length ? normalized.allowedIps : [normalized.address ?? "0.0.0.0/0"]).join(",");
  const ref = normalized.routerRef;
  const interfaceName = normalized.interfaceName || `wg-${normalized.name}`;
  const commands: string[][] = [];
  const verifyCommands: string[][] = [];
  const rollbackCommands: string[][] = [];

  if (normalized.technology === "wireguard") {
    if (normalized.operation === "create") {
      commands.push(routerCommand("/interface/wireguard/add", {
        name: interfaceName,
        "listen-port": normalized.listenPort ?? 13231,
        disabled: !enabled,
      }));
      if (normalized.address) {
        commands.push(routerCommand("/ip/address/add", { address: normalized.address, interface: interfaceName }));
      }
      commands.push(routerCommand("/interface/wireguard/peers/add", {
        interface: interfaceName,
        "public-key": normalized.secret,
        "allowed-address": allowed,
        endpoint: normalized.endpoint,
        disabled: !enabled,
        comment: normalized.name,
      }));
      verifyCommands.push(["/interface/wireguard/peers/print", `?comment=${normalized.name}`]);
    } else if (normalized.operation === "delete") {
      commands.push(routerCommand("/interface/wireguard/peers/remove", { ".id": ref }));
      verifyCommands.push(["/interface/wireguard/peers/print", `?comment=${normalized.name}`]);
    } else if (normalized.operation === "disable" || normalized.operation === "update") {
      commands.push(routerCommand("/interface/wireguard/peers/set", {
        ".id": ref,
        disabled: normalized.operation === "disable" ? true : !enabled,
        "allowed-address": normalized.operation === "update" ? allowed : undefined,
        endpoint: normalized.operation === "update" ? normalized.endpoint : undefined,
      }));
      verifyCommands.push(["/interface/wireguard/peers/print", `?comment=${normalized.name}`]);
    } else {
      verifyCommands.push(["/interface/wireguard/peers/print", `?comment=${normalized.name}`]);
    }
  } else if (normalized.technology === "openvpn") {
    if (normalized.operation === "create") {
      commands.push(routerCommand("/ppp/secret/add", {
        name: normalized.name,
        password: normalized.secret,
        service: "ovpn",
        profile: normalized.profile,
        disabled: !enabled,
        comment: normalized.endpoint,
      }));
      verifyCommands.push(["/ppp/secret/print", `?name=${normalized.name}`]);
    } else if (normalized.operation === "delete") {
      commands.push(routerCommand("/ppp/secret/remove", { ".id": ref }));
      verifyCommands.push(["/ppp/secret/print", `?name=${normalized.name}`]);
    } else {
      commands.push(routerCommand("/ppp/secret/set", {
        ".id": ref,
        disabled: normalized.operation === "disable" ? true : !enabled,
        profile: normalized.profile,
        password: normalized.operation === "update" ? normalized.secret : undefined,
      }));
      verifyCommands.push(["/ppp/secret/print", `?name=${normalized.name}`]);
    }
  } else {
    if (normalized.operation === "create") {
      commands.push(routerCommand("/ip/ipsec/peer/add", {
        address: normalized.peerAddress,
        "exchange-mode": normalized.exchangeMode ?? "ike2",
        "send-initial-contact": true,
        disabled: !enabled,
        comment: normalized.name,
      }));
      if (normalized.secret) {
        commands.push(routerCommand("/ip/ipsec/identity/add", {
          peer: normalized.name,
          "auth-method": normalized.authMethod ?? "pre-shared-key",
          secret: normalized.secret,
          comment: normalized.name,
        }));
      }
      if (normalized.proposal) {
        commands.push(routerCommand("/ip/ipsec/policy/add", {
          peer: normalized.name,
          proposal: normalized.proposal,
          tunnel: true,
          comment: normalized.name,
        }));
      }
      verifyCommands.push(["/ip/ipsec/peer/print", `?comment=${normalized.name}`]);
    } else if (normalized.operation === "delete") {
      commands.push(routerCommand("/ip/ipsec/peer/remove", { ".id": ref }));
      verifyCommands.push(["/ip/ipsec/peer/print", `?comment=${normalized.name}`]);
    } else {
      commands.push(routerCommand("/ip/ipsec/peer/set", {
        ".id": ref,
        disabled: normalized.operation === "disable" ? true : !enabled,
        address: normalized.operation === "update" ? normalized.peerAddress : undefined,
        "exchange-mode": normalized.operation === "update" ? normalized.exchangeMode : undefined,
      }));
      verifyCommands.push(["/ip/ipsec/peer/print", `?comment=${normalized.name}`]);
    }
  }

  const redactedInput = { ...normalized };
  delete redactedInput.secret;
  return { technology: normalized.technology, operation: normalized.operation, commands, verifyCommands, rollbackCommands, redactedInput };
}

export function buildVpnServerPlan(input: VpnServerInput): VpnPlan {
  const name = safeName(input.name, "name");
  const interfaceName = input.interfaceName ? safeName(input.interfaceName, "interfaceName") : `wg-${name}`;
  if (input.listenPort !== undefined &&
      (!Number.isInteger(input.listenPort) || input.listenPort < 1 || input.listenPort > 65535)) {
    throw new Error("listenPort must be an integer between 1 and 65535");
  }
  if (input.address && !isValidAddress(input.address)) throw new Error("address must be a valid IP or CIDR");
  const enabled = input.enabled !== false;
  const commands: string[][] = [];
  const verifyCommands: string[][] = [];
  const rollbackCommands: string[][] = [];
  if (input.technology === "wireguard") {
    commands.push(routerCommand("/interface/wireguard/add", {
      name: interfaceName,
      "listen-port": input.listenPort ?? 13231,
      disabled: !enabled,
    }));
    if (input.address) commands.push(routerCommand("/ip/address/add", { address: input.address, interface: interfaceName }));
    verifyCommands.push(["/interface/wireguard/print", `?name=${interfaceName}`]);
    rollbackCommands.push(routerCommand("/interface/wireguard/remove", { numbers: interfaceName }));
  }
  return {
    technology: input.technology,
    operation: "create",
    commands,
    verifyCommands,
    rollbackCommands,
    redactedInput: { ...input, interfaceName },
  };
}

export async function executeVpnPlan(
  router: VpnRouter,
  plan: VpnPlan,
  dryRun: boolean,
): Promise<VpnExecutionResult> {
  if (dryRun) {
    return { stage: "planned", dryRun: true, outputs: [], verification: [], rollbackAttempted: false, rollbackSucceeded: false };
  }
  const outputs: Record<string, string>[] = [];
  const verification: Record<string, string>[] = [];
  try {
    for (const command of plan.commands) {
      outputs.push(...await runRouterCommand(router, command));
    }
    for (const command of plan.verifyCommands) {
      verification.push(...await runRouterCommand(router, command));
    }
    if (plan.operation === "delete" && verification.length > 0) {
      throw new Error("Router verification found the deleted resource still present");
    }
    return { stage: "verified", dryRun: false, outputs, verification, rollbackAttempted: false, rollbackSucceeded: false };
  } catch (error) {
    let rollbackSucceeded = true;
    if (plan.rollbackCommands.length) {
      for (const command of plan.rollbackCommands) {
        try { await runRouterCommand(router, command); } catch { rollbackSucceeded = false; }
      }
    }
    const failure = new Error((error as Error).message);
    Object.assign(failure, { stage: "failed", rollbackAttempted: plan.rollbackCommands.length > 0, rollbackSucceeded });
    throw failure;
  }
}

export function buildClientConfig(
  technology: VpnTechnology,
  name: string,
  secret: string,
  options: { serverPublicKey?: string; endpoint?: string; assignedIp?: string; allowedIps?: string[]; dns?: string[] } = {},
): string {
  if (technology === "wireguard") {
    return [
      `[Interface]`,
      `PrivateKey = ${secret}`,
      options.assignedIp ? `Address = ${options.assignedIp}` : "",
      options.dns?.length ? `DNS = ${options.dns.join(", ")}` : "",
      "",
      `[Peer]`,
      `PublicKey = ${options.serverPublicKey ?? "<server-public-key>"}`,
      `AllowedIPs = ${(options.allowedIps?.length ? options.allowedIps : ["0.0.0.0/0"]).join(", ")}`,
      options.endpoint ? `Endpoint = ${options.endpoint}` : "",
      `PersistentKeepalive = 25`,
      `# ${name}`,
    ].filter(Boolean).join("\n") + "\n";
  }
  return [
    `client`,
    `dev tun`,
    `proto tcp-client`,
    options.endpoint ? `remote ${options.endpoint}` : `# Set the RouterOS OpenVPN server endpoint`,
    `auth-user-pass`,
    `# Username: ${name}`,
    `# Password is delivered separately and never stored in this file`,
  ].join("\n") + "\n";
}