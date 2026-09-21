import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { authenticatedAccount, authenticatedTenantAdminId, requireAdmin } from "../lib/api-auth.js";
import { encryptVpnSecret } from "../lib/vpn-crypto.js";
import { deployRouterFile, runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { sbSelectStrict, sbUpdateStrict, sbUpsertStrict } from "../lib/supabase-client.js";
import { getDeployableSource } from "../lib/portal-assets.js";
import { getRouterCreds } from "./mikrotik-route.js";
import { validatePortAccess } from "./reseller-route.js";

const router: IRouter = Router();

type PortServiceRow = {
  id: number;
  admin_id: number;
  reseller_id: number | null;
  assigned_reseller_id: number | null;
  router_id: number;
  interface_name: string;
  bridge_name: string | null;
  hotspot_enabled: boolean;
  hotspot_template_path: string | null;
  hotspot_folder_path: string | null;
  pppoe_enabled: boolean;
  pppoe_folder_path: string | null;
  reseller_bandwidth_cap: number | null;
  bandwidth_cap_mbps: number;
  subnet_range: string | null;
  status: string;
};

type SourceEntry = { content: Buffer; contentType: string; fileName: string; expiresAt: number };
const sourceEntries = new Map<string, SourceEntry>();
const SOURCE_TTL_MS = 5 * 60 * 1000;

function requestOrigin(req: Request): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(clean)) return null;
  return clean;
}

function safeSegment(value: string, fallback: string): string {
  const result = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return result.slice(0, 48) || fallback;
}

type PortServiceNetwork = {
  bridgeName: string;
  network: string;
  gateway: string;
  poolRange: string;
};

function portServiceNetwork(port: PortServiceRow): PortServiceNetwork {
  const bridgeName = safeSegment(
    port.bridge_name ?? `ochola-port-${port.id}`,
    `ochola-port-${port.id}`,
  );
  const fallbackOctet = (port.id % 200) + 1;
  const rawNetwork = port.subnet_range?.trim() || `10.250.${fallbackOctet}.0/24`;
  const [rawAddress, rawPrefix] = rawNetwork.split("/");
  const octets = rawAddress?.split(".").map(Number) ?? [];
  const prefix = Number(rawPrefix);
  const privateNetwork = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (
    !privateNetwork
    || octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    || prefix !== 24
    || octets[3] !== 0
  ) {
    throw new Error(`Port ${port.interface_name} requires a private network address ending in .0/24.`);
  }
  const network = `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  const gateway = `${octets[0]}.${octets[1]}.${octets[2]}.1`;
  return {
    bridgeName,
    network,
    gateway,
    poolRange: `${octets[0]}.${octets[1]}.${octets[2]}.10-${octets[0]}.${octets[1]}.${octets[2]}.254`,
  };
}

function validPortalHostname(value: string | undefined): string | null {
  const hostname = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(hostname) ? hostname : null;
}

function portFromLocals(res: { locals: Record<string, unknown> }): PortServiceRow {
  return res.locals.resellerPort as PortServiceRow;
}

function activeResellerId(port: PortServiceRow): number | null {
  return port.assigned_reseller_id ?? port.reseller_id;
}

function sourceNameFromPath(path: string): string {
  return path.split("/").pop() ?? path;
}

async function deployApprovedSource(
  creds: RouterCredentials,
  req: Request,
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = getDeployableSource("hotspot", sourcePath);
  if (!source) throw new Error(`Approved asset "${sourcePath}" could not be found.`);
  const token = randomBytes(24).toString("hex");
  sourceEntries.set(token, {
    content: source.content,
    contentType: "text/html; charset=utf-8",
    fileName: sourceNameFromPath(source.source.name),
    expiresAt: Date.now() + SOURCE_TTL_MS,
  });
  try {
    await deployRouterFile(creds, {
      destinationPath,
      sourceUrl: `${requestOrigin(req)}/api/port-service-source/${token}`,
      overwrite: true,
      uploadId: token.slice(0, 16),
    });
  } finally {
    sourceEntries.delete(token);
  }
}

export function buildDualServiceCommands(
  port: PortServiceRow,
  hotspotPath: string | null,
  pppoePath: string | null,
  routerAddress: string,
  options: { portalHostname?: string } = {},
): string[][] {
  const portName = safeSegment(port.interface_name, `port_${port.id}`);
  if (!/^(ether|sfp|combo|wlan|lte|bridge|vlan)[a-zA-Z0-9._-]*$/i.test(port.interface_name.trim())) {
    throw new Error(`The assigned interface "${port.interface_name}" is not a valid RouterOS interface.`);
  }
  const network = portServiceNetwork(port);
  const hotspotProfile = `HS_${portName}`;
  const pppoeLandingProfile = `PPPOE_ALERT_${portName}`;
  const pppoeService = `PPPoE_${portName}`;
  const parentQueue = `RESELLER_ROOT_${portName}`;
  const cap = port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps;
  const commands: string[][] = [];

  /* A Hotspot server is bound to an interface. Give every assigned port its
     own bridge so two ports on one router can have different captive pages
     and cannot leak users into each other's service network. */
  commands.push(
    ["/interface/bridge/add", `=name=${network.bridgeName}`, `=comment=OcholaSupernet_${portName}_service_bridge`],
    ["/interface/bridge/port/add", `=bridge=${network.bridgeName}`, `=interface=${port.interface_name}`, `=comment=OcholaSupernet_${portName}_service_port`],
  );

  if (hotspotPath) {
    commands.push(
      ["/ip/address/add", `=address=${network.gateway}/24`, `=interface=${network.bridgeName}`, `=comment=OcholaSupernet_${portName}_hotspot_gateway`],
      ["/ip/pool/add", `=name=HS_POOL_${portName}`, `=ranges=${network.poolRange}`, `=comment=OcholaSupernet_${portName}_hotspot_pool`],
      ["/ip/dhcp-server/network/add", `=address=${network.network}`, `=gateway=${network.gateway}`, `=dns-server=${network.gateway},8.8.8.8`, `=comment=OcholaSupernet_${portName}_hotspot_network`],
      ["/ip/dhcp-server/add", `=name=HS_DHCP_${portName}`, `=interface=${network.bridgeName}`, `=address-pool=HS_POOL_${portName}`, "=disabled=no"],
      ["/ip/hotspot/profile/add", `=name=${hotspotProfile}`, `=html-directory=${hotspotPath}`, "=login-by=http-chap,http-pap", `=comment=OcholaSupernet_${portName}_hotspot`],
      ["/ip/hotspot/add", `=name=HS_${portName}`, `=interface=${network.bridgeName}`, `=profile=${hotspotProfile}`, `=address-pool=HS_POOL_${portName}`, "=disabled=no", `=comment=OcholaSupernet_${portName}_hotspot`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=OcholaSupernet_${portName}_hotspot_nat`],
    );
    const portalHostname = validPortalHostname(options.portalHostname);
    if (portalHostname) {
      commands.push([
        "/ip/hotspot/walled-garden/ip/add",
        `=dst-host=${portalHostname}`,
        "=action=accept",
        `=comment=OcholaSupernet_${portName}_walled_garden`,
      ]);
    }
  }
  if (hotspotPath || pppoePath) {
    commands.push([
      "/queue/simple/add",
      `=name=${parentQueue}`,
      `=target=${network.bridgeName}`,
      `=max-limit=${cap}M/${cap}M`,
      "=priority=2/2",
      `=comment=OcholaSupernet_${portName}_parent_queue`,
    ]);
  }
  if (pppoePath) {
    commands.push(
      ["/interface/pppoe-server/server/add", `=service-name=${pppoeService}`, `=interface=${network.bridgeName}`, "=disabled=no", "=one-session-per-host=yes", `=comment=OcholaSupernet_${portName}_pppoe`],
      ["/ip/hotspot/profile/add", `=name=${pppoeLandingProfile}`, `=html-directory=${pppoePath}`, "=login-by=http-chap,http-pap", `=comment=OcholaSupernet_${portName}_pppoe_landing`],
      ["/queue/simple/add", `=name=PPPOE_PREMIUM_${portName}`, `=target=${network.bridgeName}`, `=parent=${parentQueue}`, `=max-limit=${cap}M/${cap}M`, "=priority=1/1", `=comment=OcholaSupernet_${portName}_pppoe_premium`],
      ["/ip/firewall/nat/add", "=chain=srcnat", "=action=masquerade", `=src-address=${network.network}`, "=out-interface-list=WAN", `=comment=OcholaSupernet_${portName}_pppoe_nat`],
      ["/ip/firewall/nat/add", "=chain=dstnat", `=in-interface=${network.bridgeName}`, "=protocol=tcp", "=dst-port=80", "=action=dst-nat", `=to-addresses=${network.gateway || routerAddress}`, "=to-ports=80", `=comment=OcholaSupernet_${portName}_pppoe_billing_redirect`],
    );
  }
  if (hotspotPath) {
    commands.push([
      "/queue/simple/add",
      `=name=HOTSPOT_TRANSIT_${portName}`,
      `=target=${network.network}`,
      `=parent=${parentQueue}`,
      `=max-limit=${cap}M/${cap}M`,
      "=priority=8/8",
      `=comment=OcholaSupernet_${portName}_hotspot_transit`,
    ]);
  }
  return commands;
}

async function executeIdempotentRouterCommand(creds: RouterCredentials, command: string[]): Promise<void> {
  const addPath = command[0];
  const propertyByPath: Record<string, string> = {
    "/interface/bridge/add": "name",
    "/ip/hotspot/profile/add": "name",
    "/ip/hotspot/add": "name",
    "/interface/pppoe-server/server/add": "service-name",
    "/ip/address/add": "address",
    "/ip/pool/add": "name",
    "/ip/dhcp-server/network/add": "address",
    "/ip/dhcp-server/add": "name",
    "/queue/simple/add": "name",
    "/ip/hotspot/walled-garden/ip/add": "comment",
    "/ip/firewall/nat/add": "comment",
  };

  if (addPath === "/interface/bridge/port/add") {
    const bridgeArg = command.find((arg) => arg.startsWith("=bridge="));
    const interfaceArg = command.find((arg) => arg.startsWith("=interface="));
    const bridgeName = bridgeArg?.slice("=bridge=".length);
    const interfaceName = interfaceArg?.slice("=interface=".length);
    if (!bridgeName || !interfaceName) throw new Error("A port-service bridge binding is incomplete.");
    const rows = await runRouterCommand(creds, [
      "/interface/bridge/port/print",
      "=.proplist=.id,bridge,interface",
      `?interface=${interfaceName}`,
    ]);
    const existing = rows.find((row) => row.interface === interfaceName);
    if (existing) {
      if (existing.bridge !== bridgeName) {
        throw new Error(`Interface ${interfaceName} is already assigned to foreign bridge ${existing.bridge}.`);
      }
      return;
    }
    await runRouterCommand(creds, command);
    return;
  }

  const property = propertyByPath[addPath];
  const propertyArg = command.find((arg) => arg.startsWith(`=${property}=`));
  if (!property || !propertyArg) {
    await runRouterCommand(creds, command);
    return;
  }
  const printPath = addPath.replace(/\/add$/, "/print");
  const proplist = addPath === "/ip/address/add"
    ? "=.proplist=.id,address,interface"
    : `=.proplist=.id,${property}`;
  const rows = await runRouterCommand(creds, [printPath, proplist]).catch(() => []);
  const existing = rows.find((row) => row[property] === propertyArg.slice(property.length + 2));
  if (existing?.[".id"]) {
    if (
      addPath === "/ip/address/add"
      && existing.interface
      && existing.interface !== command.find((arg) => arg.startsWith("=interface="))?.slice("=interface=".length)
    ) {
      throw new Error(`Address ${propertyArg.slice(property.length + 2)} is already assigned to foreign interface ${existing.interface}.`);
    }
    await runRouterCommand(creds, [
      addPath.replace(/\/add$/, "/set"),
      `=.id=${existing[".id"]}`,
      ...command.slice(1).filter((arg) => !arg.startsWith(`=${property}=`)),
    ]);
    return;
  }
  await runRouterCommand(creds, command);
}

router.get("/port-service-source/:token", (req, res): void => {
  const entry = sourceEntries.get(String(req.params.token));
  if (!entry || entry.expiresAt < Date.now()) {
    sourceEntries.delete(String(req.params.token));
    res.status(404).end();
    return;
  }
  sourceEntries.delete(String(req.params.token));
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Content-Length", String(entry.content.length));
  res.setHeader("Cache-Control", "no-store");
  res.send(entry.content);
});

router.get("/admin/port-services", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const tenantId = await authenticatedTenantAdminId(req);
    const account = await authenticatedAccount(req);
    if (!tenantId || !account) {
      res.status(403).json({ ok: false, error: "A valid signed-in ISP account is required." });
      return;
    }
    const routerId = String(req.query.routerId ?? "").trim();
    const rows = await sbSelectStrict<PortServiceRow>(
      "isp_reseller_ports",
      `admin_id=eq.${tenantId}${routerId && /^\d+$/.test(routerId) ? `&router_id=eq.${routerId}` : ""}&select=*&order=interface_name.asc`,
    );
    const visible = account.role === "reseller"
      ? rows.filter((row) => activeResellerId(row) === account.id)
      : rows;
    res.json({ ok: true, ports: visible });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load port services." });
  }
});

router.put("/admin/port-services/:portId", requireAdmin(), validatePortAccess, async (req, res): Promise<void> => {
  try {
    const port = portFromLocals(res);
    const hotspotFolderPath = req.body?.hotspotFolderPath === "" ? null : cleanPath(req.body?.hotspotFolderPath);
    const pppoeFolderPath = req.body?.pppoeFolderPath === "" ? null : cleanPath(req.body?.pppoeFolderPath);
    const hotspotEnabled = req.body?.hotspotEnabled === true;
    const pppoeEnabled = req.body?.pppoeEnabled === true;
    if (hotspotEnabled && !hotspotFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved Hotspot asset before enabling the Hotspot portal." });
      return;
    }
    if (pppoeEnabled && !pppoeFolderPath) {
      res.status(400).json({ ok: false, error: "Select an approved PPPoE landing asset before enabling the PPPoE landing page." });
      return;
    }
    const updated = await sbUpdateStrict<PortServiceRow>(
      "isp_reseller_ports",
      `id=eq.${port.id}&admin_id=eq.${port.admin_id}`,
      {
        hotspot_enabled: hotspotEnabled,
        hotspot_folder_path: hotspotFolderPath,
        hotspot_template_path: hotspotFolderPath,
        pppoe_enabled: pppoeEnabled,
        pppoe_folder_path: pppoeFolderPath,
        updated_at: new Date().toISOString(),
      },
    );
    res.json({ ok: true, port: updated[0] ?? null });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save port service bindings." });
  }
});

router.post("/admin/port-services/:portId/deploy", requireAdmin(), validatePortAccess, async (req, res): Promise<void> => {
  try {
    const port = portFromLocals(res);
    if (!port.hotspot_enabled && !port.pppoe_enabled) {
      res.status(400).json({ ok: false, error: "Enable at least one service before deploying this port." });
      return;
    }
    const hotspotSource = port.hotspot_enabled ? cleanPath(port.hotspot_folder_path ?? port.hotspot_template_path) : null;
    const pppoeSource = port.pppoe_enabled ? cleanPath(port.pppoe_folder_path) : null;
    if ((port.hotspot_enabled && !hotspotSource) || (port.pppoe_enabled && !pppoeSource)) {
      res.status(409).json({ ok: false, error: "Both enabled services must have an approved asset binding." });
      return;
    }
    const found = await getRouterCreds(port.router_id, port.admin_id);
    if (!found) {
      res.status(404).json({ ok: false, error: "Router credentials are unavailable for this port." });
      return;
    }
    const portName = safeSegment(port.interface_name, `port_${port.id}`);
    const hotspotDestination = hotspotSource ? `flash/hotspot/hs_${portName}/${sourceNameFromPath(hotspotSource)}` : null;
    const pppoeDestination = pppoeSource ? `flash/hotspot/pppoe_${portName}/${sourceNameFromPath(pppoeSource)}` : null;
    for (const directory of [`flash/hotspot/hs_${portName}`, `flash/hotspot/pppoe_${portName}`]) {
      await runRouterCommand(found.creds, ["/file/make-dir", `=dir-name=${directory}`]).catch(() => undefined);
    }
    if (hotspotSource && hotspotDestination) await deployApprovedSource(found.creds, req, hotspotSource, hotspotDestination);
    if (pppoeSource && pppoeDestination) await deployApprovedSource(found.creds, req, pppoeSource, pppoeDestination);
    const hotspotPath = hotspotDestination ? `flash/hotspot/hs_${portName}` : null;
    const pppoePath = pppoeDestination ? `flash/hotspot/pppoe_${portName}` : null;
    const portalHostname = new URL(requestOrigin(req)).hostname;
    const commands = buildDualServiceCommands(
      port,
      hotspotPath,
      pppoePath,
      found.row.bridge_ip || found.row.vpn_ip || "127.0.0.1",
      { portalHostname },
    );
    for (const command of commands) await executeIdempotentRouterCommand(found.creds, command);
    const scriptPayload = [
      `# OcholaSupernet dual-service deployment for ${port.interface_name}`,
      ...commands.map(([path, ...args]) => `${path.replaceAll("/", " ")} ${args.join(" ")}`),
    ].join("\n");
    res.status(201).json({ ok: true, portId: port.id, hotspotDestination, pppoeDestination, scriptPayload });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Dual-service deployment failed." });
  }
});

router.get("/admin/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await authenticatedAccount(req);
    if (!account) {
      res.status(403).json({ ok: false, error: "A valid signed-in account is required." });
      return;
    }
    const rows = await sbSelectStrict<{ id: number; gateway_type: string; is_active: boolean; updated_at: string }>(
      "payment_gateways",
      `user_id=eq.${account.id}&select=id,gateway_type,is_active,updated_at&order=gateway_type.asc`,
    );
    res.json({ ok: true, gateways: rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load payment gateways." });
  }
});

router.put("/admin/payment-gateways", requireAdmin(), async (req, res): Promise<void> => {
  try {
    const account = await authenticatedAccount(req);
    const gatewayType = typeof req.body?.gatewayType === "string" ? req.body.gatewayType.trim().toLowerCase() : "";
    const config = req.body?.config;
    if (!account || !["stripe", "paypal", "mpesa"].includes(gatewayType) || !config || typeof config !== "object" || Array.isArray(config)) {
      res.status(400).json({ ok: false, error: "Choose Stripe, PayPal, or M-Pesa and provide gateway credentials." });
      return;
    }
    const cleanConfig = Object.fromEntries(Object.entries(config as Record<string, unknown>)
      .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && typeof value === "string")
      .map(([key, value]) => [key, String(value).slice(0, 500)]));
    await sbUpsertStrict("payment_gateways", "user_id,gateway_type", {
      user_id: account.id,
      gateway_type: gatewayType,
      api_keys_json: JSON.stringify(encryptVpnSecret(JSON.stringify(cleanConfig))),
      is_active: req.body?.isActive !== false,
      updated_at: new Date().toISOString(),
    });
    res.json({ ok: true, gateway: { gatewayType, isActive: req.body?.isActive !== false } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save payment gateway." });
  }
});

export default router;