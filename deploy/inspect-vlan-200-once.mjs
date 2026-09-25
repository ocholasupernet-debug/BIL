import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const markerPath = process.argv[2];
if (!markerPath) throw new Error("A one-time VLAN inspection marker path is required.");

const marker = JSON.parse(readFileSync(markerPath, "utf8"));
const markerId = String(marker.id ?? "");
const adminId = Number(marker.adminId);
const vlanTag = Number(marker.vlanTag);
if (!/^[a-z0-9-]{1,80}$/.test(markerId)) {
  throw new Error("The VLAN inspection marker has an invalid ID.");
}
if (!Number.isSafeInteger(adminId) || adminId < 1) {
  throw new Error("The VLAN inspection marker has an invalid ISP account ID.");
}
if (!Number.isSafeInteger(vlanTag) || vlanTag < 1 || vlanTag > 4094) {
  throw new Error("The VLAN tag must be between 1 and 4094.");
}

const stateDirectory = process.env.OCHOLA_DEPLOY_STATE_DIR || "/var/lib/ocholasupernet";
const completionPath = join(stateDirectory, `vlan-inspection-${markerId}.done`);
if (existsSync(completionPath)) {
  console.log("::notice title=VLAN live inspection::This one-time read-only inspection already completed; skipping.");
  process.exit(0);
}

function recordCompletion(state) {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o750 });
  const temporaryPath = `${completionPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify({
    id: markerId,
    completedAt: new Date().toISOString(),
    ...state,
  }), { mode: 0o640 });
  renameSync(temporaryPath, completionPath);
}

function routerBoolean(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (value === true || ["true", "yes", "1"].includes(normalized)) return true;
  if (value === false || ["false", "no", "0"].includes(normalized)) return false;
  return null;
}

function interfaceRows(rows, fields) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])));
}

try {
  const signingSecret = process.env.TOKEN_SIGNING_SECRET || process.env.SESSION_SECRET;
  if (!signingSecret) throw new Error("The production admin token signing secret is not available.");

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `a.${adminId}.${issuedAt}`;
  const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
  const token = `${payload}.${signature}`;
  const apiOrigin = "https://come.isplatty.org";
  const headers = { authorization: `Bearer ${token}` };

  const inventoryResponse = await fetch(`${apiOrigin}/api/admin/resellers`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!inventoryResponse.ok) {
    throw new Error(`The production tenant inventory returned HTTP ${inventoryResponse.status}.`);
  }
  const inventory = await inventoryResponse.json();
  if (inventory.ok !== true || !Array.isArray(inventory.ports)) {
    throw new Error("The production tenant inventory response was incomplete.");
  }

  const matchingPorts = inventory.ports.filter(port => Number(port.vlan_tag) === vlanTag);
  const candidates = matchingPorts
    .filter(port => String(port.handoff_mode ?? "").toLowerCase() === "vlan_services")
    .slice(0, 5);
  const results = [];

  for (const port of candidates) {
    const result = {
      portId: port.id,
      routerId: port.router_id,
      handoffMode: port.handoff_mode,
      status: port.status ?? null,
      linkStatus: port.link_status ?? null,
      linkDetected: port.link_detected ?? null,
      lastLinkCheckedAt: port.last_link_checked_at ?? null,
      handoffInterface: port.handoff_interface ?? null,
      routerApiReachable: false,
      online: null,
    };

    try {
      const response = await fetch(
        `${apiOrigin}/api/admin/reseller-handoffs/${encodeURIComponent(port.id)}/diagnostics`,
        { headers, signal: AbortSignal.timeout(120_000) },
      );
      if (!response.ok) {
        result.diagnosticsHttpStatus = response.status;
        results.push(result);
        continue;
      }

      const diagnostics = await response.json();
      if (diagnostics.ok !== true) {
        result.diagnosticsHttpStatus = 502;
        results.push(result);
        continue;
      }

      result.routerApiReachable = true;
      result.serviceSubnet = diagnostics.assignment?.subnet ?? port.subnet_range ?? null;
      result.serviceGateway = diagnostics.assignment?.gateway ?? null;
      result.vlanInterfaceAddresses = Array.isArray(diagnostics.addresses)
        ? diagnostics.addresses.map(row => ({
          address: row.address ?? null,
          interface: row.interface ?? null,
          disabled: row.disabled ?? null,
        }))
        : [];
      const dhcpServer = Array.isArray(diagnostics.dhcpServers) ? diagnostics.dhcpServers[0] : undefined;
      result.dhcpServer = dhcpServer ? {
        name: dhcpServer.name ?? null,
        interface: dhcpServer.interface ?? null,
        addressPool: dhcpServer["address-pool"] ?? dhcpServer.address_pool ?? null,
        disabled: dhcpServer.disabled ?? null,
        running: dhcpServer.running ?? null,
      } : null;
      const dhcpNetwork = Array.isArray(diagnostics.dhcpNetworks) ? diagnostics.dhcpNetworks[0] : undefined;
      result.dhcpNetwork = dhcpNetwork ? {
        address: dhcpNetwork.address ?? null,
        gateway: dhcpNetwork.gateway ?? null,
        dnsServer: dhcpNetwork["dns-server"] ?? dhcpNetwork.dns_server ?? null,
      } : null;
      result.boundLeaseCount = Array.isArray(diagnostics.leases)
        ? diagnostics.leases.filter(row => String(row.status ?? "").toLowerCase() === "bound").length
        : null;
      result.hotspotHostCount = Array.isArray(diagnostics.hotspotHosts) ? diagnostics.hotspotHosts.length : null;
      result.arpEntryCount = Array.isArray(diagnostics.arp) ? diagnostics.arp.length : null;
      const bridge = (diagnostics.bridge ?? []).find(row =>
        row.name === diagnostics.assignment?.parentBridge,
      );
      const vlanInterface = (diagnostics.vlanInterfaces ?? []).find(row =>
        row.name === diagnostics.assignment?.vlanInterface
        || Number(row["vlan-id"] ?? row.vlan_id) === vlanTag,
      );
      const handoffName = String(port.handoff_interface ?? "").trim();
      const handoffPort = handoffName
        ? (diagnostics.bridgePorts ?? []).find(row => row.interface === handoffName)
        : undefined;
      const handoffLink = diagnostics.handoffLink;
      const tagRows = (diagnostics.bridgeVlans ?? []).filter(row =>
        String(row["vlan-ids"] ?? row.vlan_ids ?? "")
          .split(/[,\s]+/)
          .includes(String(vlanTag)),
      );

      result.bridgeRunning = bridge ? routerBoolean(bridge.running) : null;
      result.vlanInterface = vlanInterface?.name ?? diagnostics.assignment?.vlanInterface ?? null;
      result.vlanInterfaceRunning = vlanInterface ? routerBoolean(vlanInterface.running) : null;
      const actualVlanTag = Number(vlanInterface?.["vlan-id"] ?? vlanInterface?.vlan_id);
      result.routerVlanTag = Number.isSafeInteger(actualVlanTag) ? actualVlanTag : null;
      result.bridgeHandoffPortRunning = handoffPort ? routerBoolean(handoffPort.running) : null;
      result.handoffInterfaceExists = typeof handoffLink?.exists === "boolean" ? handoffLink.exists : null;
      result.handoffLinkRunning = handoffLink?.exists === true && typeof handoffLink.running === "boolean"
        ? handoffLink.running
        : null;
      result.handoffInterfaceDisabled = handoffLink?.exists === true && typeof handoffLink.disabled === "boolean"
        ? handoffLink.disabled
        : null;
      result.handoffInterfaceCheckError = handoffLink?.error
        ? (String(handoffLink.error).toLowerCase().includes("not found") ? "interface_not_found" : "check_failed")
        : null;
      result.bridgeVlanConfigured = tagRows.length > 0;
      const bridgeVlanFiltering = bridge ? routerBoolean(bridge["vlan-filtering"]) : null;
      if (
        result.bridgeRunning === false
        || result.vlanInterfaceRunning === false
        || result.handoffLinkRunning === false
        || result.handoffInterfaceDisabled === true
        || (result.handoffInterfaceExists === false && result.handoffInterfaceCheckError === "interface_not_found")
        || (result.routerVlanTag !== null && result.routerVlanTag !== vlanTag)
      ) {
        result.online = false;
      } else if (
        result.bridgeRunning === null
        || result.vlanInterfaceRunning === null
        || result.routerVlanTag === null
        || result.handoffInterfaceExists !== true
        || result.handoffLinkRunning === null
        || bridgeVlanFiltering === null
        || (bridgeVlanFiltering === true && !result.bridgeVlanConfigured)
      ) {
        result.online = null;
      } else {
        result.online = true;
      }
      result.bridgeVlanFiltering = bridgeVlanFiltering;
      result.liveBridgePorts = interfaceRows(diagnostics.bridgePorts, ["interface", "running", "disabled"]);
    } catch {
      result.diagnosticsHttpStatus = 0;
    }

    results.push(result);
  }

  const summary = {
    vlanTag,
    matchingAssignmentCount: matchingPorts.length,
    vlanServiceAssignmentCount: candidates.length,
    inspectedCount: results.length,
    inspectionLimit: 5,
    assignments: matchingPorts.slice(0, 10).map(port => ({
      portId: port.id,
      routerId: port.router_id,
      handoffMode: port.handoff_mode ?? null,
      status: port.status ?? null,
      linkStatus: port.link_status ?? null,
      linkDetected: port.link_detected ?? null,
      lastLinkCheckedAt: port.last_link_checked_at ?? null,
      handoffInterface: port.handoff_interface ?? null,
      subnetRange: port.subnet_range ?? null,
    })),
    routerDiagnostics: results,
  };
  console.log(`::notice title=VLAN 200 read-only inspection::${JSON.stringify(summary).slice(0, 4000)}`);
  recordCompletion({ status: "inspected", matchingAssignmentCount: matchingPorts.length });
} catch (error) {
  const detail = String(error instanceof Error ? error.message : error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 700);
  console.log(`::warning title=VLAN 200 read-only inspection::${detail}`);
  recordCompletion({ status: "warning", message: detail });
}