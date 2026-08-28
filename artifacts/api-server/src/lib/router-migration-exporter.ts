import type { RouterCredentials } from "./mikrotik.js";

export const MANUAL = "REQUIRES_MANUAL_CONFIGURATION";
export type RouterCommandRunner = (command: string[]) => Promise<Record<string, string>[]>;

/** This is intentionally a literal allowlist: source migration has no generic
 * command API and therefore cannot be expanded by request input. */
export const SOURCE_PRINT_COMMANDS = [
  "/system/identity/print", "/system/resource/print", "/system/routerboard/print", "/system/license/print",
  "/interface/print", "/interface/bridge/print",
  "/interface/bridge/port/print", "/interface/vlan/print", "/ip/address/print", "/ip/pool/print",
  "/ip/dhcp-server/print", "/ip/dhcp-server/network/print", "/ip/dns/print", "/ip/route/print",
  "/ip/firewall/filter/print", "/ip/firewall/nat/print", "/ip/firewall/mangle/print",
  "/ip/firewall/address-list/print", "/ip/service/print", "/interface/list/print",
  "/interface/list/member/print", "/queue/simple/print", "/queue/tree/print", "/ppp/profile/print",
  "/ppp/secret/print", "/ppp/active/print", "/ppp/aaa/print", "/interface/pppoe-server/server/print",
  "/ip/hotspot/print", "/ip/hotspot/profile/print", "/ip/hotspot/user/print",
  "/ip/hotspot/ip-binding/print", "/ip/hotspot/active/print", "/radius/print",
  "/interface/wireguard/print", "/interface/ovpn-server/server/print", "/ip/ipsec/peer/print",
  "/ip/ipsec/proposal/print", "/system/script/print", "/system/scheduler/print", "/tool/netwatch/print",
] as const;

const forbidden = /(^|\/)(file|add|set|remove|enable|disable|reset|reboot|import|export)(\/|$)/i;
const sensitive = /(password|secret|private[-_]?key|preshared[-_]?key|token)/i;

export function assertSourceCommand(command: string): void {
  if (forbidden.test(command) || !command.endsWith("/print") ||
      !(SOURCE_PRINT_COMMANDS as readonly string[]).includes(command)) {
    throw new Error("Source migration command rejected: read-only allowlist only.");
  }
}

export function redactMigrationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMigrationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    [key, sensitive.test(key) ? MANUAL : redactMigrationValue(item)]));
}

const sectionFor: Record<string, string> = {
  "/system/identity/print": "router_info", "/system/resource/print": "router_resource",
  "/system/routerboard/print": "routerboard", "/system/license/print": "router_license",
  "/interface/print": "interfaces", "/interface/bridge/print": "bridges", "/interface/bridge/port/print": "bridge_ports",
  "/interface/vlan/print": "vlans", "/ip/address/print": "ip_addresses", "/ip/pool/print": "ip_pools",
  "/ip/dhcp-server/print": "dhcp_servers", "/ip/dhcp-server/network/print": "dhcp_networks", "/ip/dns/print": "dns",
  "/ip/route/print": "routes", "/ip/firewall/filter/print": "firewall_filter", "/ip/firewall/nat/print": "firewall_nat",
  "/ip/firewall/mangle/print": "firewall_mangle", "/ip/firewall/address-list/print": "address_lists",
  "/ip/service/print": "services", "/interface/list/print": "interface_lists", "/interface/list/member/print": "interface_list_members",
  "/queue/simple/print": "queues", "/queue/tree/print": "queue_trees", "/ppp/profile/print": "ppp_profiles",
  "/ppp/secret/print": "ppp_secrets", "/ppp/active/print": "ppp_active", "/ppp/aaa/print": "ppp_settings",
  "/interface/pppoe-server/server/print": "pppoe_servers", "/ip/hotspot/print": "hotspot_servers",
  "/ip/hotspot/profile/print": "hotspot_profiles", "/ip/hotspot/user/print": "hotspot_users",
  "/ip/hotspot/ip-binding/print": "hotspot_bindings", "/ip/hotspot/active/print": "hotspot_active", "/radius/print": "radius",
  "/interface/wireguard/print": "wireguard", "/interface/ovpn-server/server/print": "openvpn",
  "/ip/ipsec/peer/print": "ipsec_peers", "/ip/ipsec/proposal/print": "ipsec_proposals",
  "/system/script/print": "scripts_metadata", "/system/scheduler/print": "schedulers", "/tool/netwatch/print": "netwatch",
};

export async function exportRouterMigration(creds: RouterCredentials, injectedRunner?: RouterCommandRunner) {
  // Keep the source exporter testable without opening a connection. The actual
  // runner is loaded only for real exports and remains the shared connector.
  const run = injectedRunner ?? ((async (command: string[]) => {
    const { runRouterCommand } = await import("./mikrotik.js");
    return runRouterCommand(creds, command);
  }) as RouterCommandRunner);
  const data: Record<string, unknown> = {
    metadata: { format: "routeros-migration-v1", exported_at: new Date().toISOString(), read_only: true },
    warnings: ["RouterOS files are deliberately excluded. Secrets and cryptographic material require manual configuration."],
    manual_configuration_required: [],
  };
  for (const command of SOURCE_PRINT_COMMANDS) {
    assertSourceCommand(command);
    let rows: Record<string, string>[];
    try { rows = await run([command]); }
    catch (error) {
      /* Older RouterOS releases legitimately lack some read-only paths.  A
       * transport/authentication failure is never hidden. */
      const message = error instanceof Error ? error.message : String(error);
      if (/no such command|unknown command|not implemented|bad command/i.test(message)) {
        (data.warnings as string[]).push(`${command} is unsupported by this RouterOS version.`);
        continue;
      }
      throw error;
    }
    const section = sectionFor[command]!;
    // Scripts are metadata only; source must never be returned or persisted.
    data[section] = redactMigrationValue(rows.map(row => {
      if (command === "/system/script/print") return Object.fromEntries(Object.entries(row).filter(([k]) => !/source|script|body/i.test(k)));
      if (command === "/system/scheduler/print") return Object.fromEntries(Object.entries(row).filter(([k]) => !/on-event|script|source|body/i.test(k)));
      if (command === "/tool/netwatch/print") return Object.fromEntries(Object.entries(row).filter(([k]) => !/up-script|down-script|test-script|script|source|body/i.test(k)));
      return row;
    }));
  }
  return data;
}