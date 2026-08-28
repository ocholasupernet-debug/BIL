import { Router, type IRouter, type Request, type Response } from "express";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { requireAdmin } from "../lib/api-auth.js";
import { encryptVpnSecret } from "../lib/vpn-crypto.js";
import { runRouterCommand } from "../lib/mikrotik.js";
import {
  assertCapability,
  buildClientConfig,
  buildVpnPlan,
  buildVpnServerPlan,
  detectVpnCapabilities,
  executeVpnPlan,
  generateWireGuardKeyPair,
  type VpnCapabilities,
  type VpnInput,
  type VpnRouter,
  type VpnTechnology,
} from "../lib/vpn-management-service.js";

const router: IRouter = Router();
router.use("/vpn-management", requireAdmin());

type RouterRow = {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
  ros_version: string | null;
};
type ServerRow = {
  id: number;
  admin_id: number;
  router_id: number;
  technology: VpnTechnology;
  name: string;
  interface_name: string | null;
  listen_port: number | null;
  address_pool: string | null;
  endpoint: string | null;
  dns_servers: string[] | null;
  settings_json: Record<string, unknown>;
  is_active: boolean;
  last_status: string;
  last_status_json: Record<string, unknown>;
};
type PeerRow = {
  id: number;
  admin_id: number;
  server_id: number;
  customer_id: number | null;
  username: string;
  technology: VpnTechnology;
  router_ref: string | null;
  public_key: string | null;
  assigned_ip: string | null;
  allowed_ips: string[];
  endpoint: string | null;
  settings_json: Record<string, unknown>;
  is_active: boolean;
  expires_at: string | null;
  last_handshake_at: string | null;
  last_status: string;
  last_status_json: Record<string, unknown>;
};

function adminIdOf(req: Request): number {
  const value = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("A tenant administrator session is required");
  }
  return value;
}

function positiveInt(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function technology(value: unknown): VpnTechnology {
  if (value !== "wireguard" && value !== "openvpn" && value !== "ipsec") {
    throw new Error("technology must be wireguard, openvpn, or ipsec");
  }
  return value;
}

function routerCredentials(row: RouterRow, adminId: number): VpnRouter {
  return {
    id: row.id,
    adminId,
    host: row.host,
    bridgeIp: row.bridge_ip ?? undefined,
    port: 8728,
    username: row.router_username || "admin",
    password: row.router_secret ?? "",
    useSSL: false,
    rosVersion: row.ros_version,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

async function loadRouter(adminId: number, routerId: number): Promise<{ row: RouterRow; credentials: VpnRouter }> {
  const rows = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,bridge_ip,router_username,router_secret,ros_version&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("Router not found for this administrator");
  return { row, credentials: routerCredentials(row, adminId) };
}

async function loadServer(adminId: number, serverId: number): Promise<ServerRow> {
  const rows = await sbSelectStrict<ServerRow>(
    "isp_vpn_servers",
    `id=eq.${serverId}&admin_id=eq.${adminId}&select=*&limit=1`,
  );
  if (!rows[0]) throw new Error("VPN server not found for this administrator");
  return rows[0];
}

async function loadPeer(adminId: number, peerId: number): Promise<PeerRow> {
  const rows = await sbSelectStrict<PeerRow>(
    "isp_vpn_peers",
    `id=eq.${peerId}&admin_id=eq.${adminId}&select=*&limit=1`,
  );
  if (!rows[0]) throw new Error("VPN peer/user not found for this administrator");
  return rows[0];
}

async function operationStart(
  adminId: number,
  input: { routerId?: number; serverId?: number; peerId?: number; technology: VpnTechnology; operation: string; mode: "dry_run" | "apply"; request: Record<string, unknown> },
): Promise<number | null> {
  try {
    const rows = await sbInsertStrict<{ id: number }>("isp_vpn_operations", {
      admin_id: adminId,
      router_id: input.routerId ?? null,
      server_id: input.serverId ?? null,
      peer_id: input.peerId ?? null,
      technology: input.technology,
      operation: input.operation,
      mode: input.mode,
      stage: "requested",
      status: "started",
      request_json: input.request,
    });
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function operationFinish(id: number | null, values: Record<string, unknown>): Promise<void> {
  if (id === null) return;
  try {
    await sbUpdateStrict("isp_vpn_operations", `id=eq.${id}`, { ...values, completed_at: new Date().toISOString() });
  } catch { /* operational persistence must not hide the router result */ }
}

function redactRequest(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  for (const key of ["secret", "password", "privateKey", "private_key", "psk", "certificate"]) {
    if (key in copy) copy[key] = "[redacted]";
  }
  return copy;
}

function redactCommands(commands: string[][]): string[][] {
  return commands.map(command => command.map(token => {
    if (/^=(password|secret|private-key)=/i.test(token)) {
      return token.replace(/=.*/, "=[redacted]");
    }
    return token;
  }));
}

async function removeCreatedResource(router: VpnRouter, tech: VpnTechnology, routerRef: string): Promise<void> {
  const path = tech === "wireguard"
    ? "/interface/wireguard/peers/remove"
    : tech === "openvpn"
      ? "/ppp/secret/remove"
      : "/ip/ipsec/peer/remove";
  await runRouterCommand(router, [path, `=.id=${routerRef}`]);
}

function inputFromBody(body: Record<string, unknown>, operation: VpnInput["operation"]): VpnInput {
  return {
    technology: technology(body.technology),
    operation,
    name: String(body.name ?? body.username ?? "").trim(),
    interfaceName: body.interfaceName ? String(body.interfaceName) : undefined,
    listenPort: body.listenPort === undefined ? undefined : Number(body.listenPort),
    address: body.address ? String(body.address) : undefined,
    allowedIps: Array.isArray(body.allowedIps) ? body.allowedIps.map(String) : undefined,
    endpoint: body.endpoint ? String(body.endpoint) : undefined,
    routerRef: body.routerRef ? String(body.routerRef) : undefined,
    enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    profile: body.profile ? String(body.profile) : undefined,
    peerAddress: body.peerAddress ? String(body.peerAddress) : undefined,
    exchangeMode: body.exchangeMode ? String(body.exchangeMode) : undefined,
    authMethod: body.authMethod ? String(body.authMethod) : undefined,
    proposal: body.proposal ? String(body.proposal) : undefined,
    secret: body.secret ? String(body.secret) : undefined,
  };
}

async function capabilityFor(router: VpnRouter, cached?: string | null): Promise<VpnCapabilities> {
  const capabilities = await detectVpnCapabilities(router);
  if (cached && capabilities.routerOsVersion === "unknown") capabilities.routerOsVersion = cached;
  return capabilities;
}

function safeServer(server: ServerRow): Record<string, unknown> {
  return {
    id: server.id,
    router_id: server.router_id,
    technology: server.technology,
    name: server.name,
    interface_name: server.interface_name,
    listen_port: server.listen_port,
    address_pool: server.address_pool,
    endpoint: server.endpoint,
    dns_servers: server.dns_servers,
    settings_json: server.settings_json,
    is_active: server.is_active,
    last_status: server.last_status,
    last_status_json: server.last_status_json,
  };
}

function safePeer(peer: PeerRow): Record<string, unknown> {
  return {
    id: peer.id,
    server_id: peer.server_id,
    customer_id: peer.customer_id,
    username: peer.username,
    technology: peer.technology,
    public_key: peer.public_key,
    assigned_ip: peer.assigned_ip,
    allowed_ips: peer.allowed_ips,
    endpoint: peer.endpoint,
    settings_json: peer.settings_json,
    is_active: peer.is_active,
    expires_at: peer.expires_at,
    last_handshake_at: peer.last_handshake_at,
    last_status: peer.last_status,
    last_status_json: peer.last_status_json,
  };
}

router.get("/vpn-management/capabilities", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const routerId = positiveInt(req.query.routerId, "routerId");
    const { credentials } = await loadRouter(adminId, routerId);
    res.json({ ok: true, router_id: routerId, capabilities: await capabilityFor(credentials) });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.get("/vpn-management/routers", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const rows = await sbSelectStrict<Pick<RouterRow, "id" | "name" | "ros_version">>(
      "isp_routers",
      `admin_id=eq.${adminId}&select=id,name,ros_version&order=name.asc`,
    );
    res.json(rows);
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.get("/vpn-management/overview", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const servers = await sbSelectStrict<ServerRow>("isp_vpn_servers", `admin_id=eq.${adminId}&select=*&order=created_at.desc`);
    const peers = await sbSelectStrict<PeerRow>("isp_vpn_peers", `admin_id=eq.${adminId}&select=*&order=created_at.desc`);
    const operations = await sbSelectStrict("isp_vpn_operations", `admin_id=eq.${adminId}&select=id,technology,operation,mode,stage,status,error,created_at,completed_at&order=created_at.desc&limit=20`);
    res.json({
      ok: true,
      summary: {
        servers: servers.length,
        peers: peers.length,
        active: peers.filter(peer => peer.is_active && (!peer.expires_at || new Date(peer.expires_at) > new Date())).length,
        technologies: [...new Set(servers.map(server => server.technology))],
      },
      servers: servers.map(safeServer),
      peers: peers.map(safePeer),
      operations,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.get("/vpn-management/servers", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const routerFilter = req.query.routerId ? `&router_id=eq.${positiveInt(req.query.routerId, "routerId")}` : "";
    const rows = await sbSelectStrict<ServerRow>("isp_vpn_servers", `admin_id=eq.${adminId}${routerFilter}&select=*&order=created_at.desc`);
    res.json(rows.map(safeServer));
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.post("/vpn-management/servers", async (req, res): Promise<void> => {
  let operationId: number | null = null;
  try {
    const adminId = adminIdOf(req);
    const body = req.body as Record<string, unknown>;
    const routerId = positiveInt(body.routerId, "routerId");
    const tech = technology(body.technology);
    const name = String(body.name ?? "").trim();
    const interfaceName = body.interfaceName ? String(body.interfaceName) : undefined;
    const { credentials } = await loadRouter(adminId, routerId);
    const capabilities = await capabilityFor(credentials);
    assertCapability(capabilities, tech);
    const plan = buildVpnServerPlan({
      technology: tech,
      name,
      interfaceName,
      listenPort: body.listenPort === undefined ? undefined : Number(body.listenPort),
      address: body.address ? String(body.address) : undefined,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
    const dryRun = Boolean(body.dryRun);
    operationId = await operationStart(adminId, { routerId, technology: tech, operation: "server-create", mode: dryRun ? "dry_run" : "apply", request: redactRequest(body) });
    const result = await executeVpnPlan(credentials, plan, dryRun);
    await operationFinish(operationId, { stage: result.stage, status: "succeeded", result_json: { commands: redactCommands(plan.commands), verification: result.verification } });
    if (dryRun) {
      res.json({ ok: true, dryRun: true, operationId, capabilities, plan: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands } });
      return;
    }
    const publicKey = result.verification.find(row => row["public-key"])?.["public-key"] ?? null;
    const serverRef = result.verification.find(row => row[".id"])?.[".id"];
    const rows = await sbInsertStrict<ServerRow>("isp_vpn_servers", {
      admin_id: adminId,
      router_id: routerId,
      technology: tech,
      name,
      interface_name: interfaceName ?? (tech === "wireguard" ? `wg-${name}` : null),
      listen_port: body.listenPort ?? (tech === "wireguard" ? 13231 : null),
      address_pool: body.address ?? null,
      endpoint: body.endpoint ?? null,
      dns_servers: Array.isArray(body.dnsServers) ? body.dnsServers.map(String) : null,
      settings_json: publicKey ? { publicKey } : {},
    });
    if (!rows[0]) {
      if (serverRef) await runRouterCommand(credentials, ["/interface/wireguard/remove", `=.id=${serverRef}`]);
      throw new Error("Router change succeeded but VPN server state could not be saved");
    }
    void logActivity({ adminId, type: "vpn", action: "server_created", subject: name, details: { routerId, technology: tech, operationId } });
    res.status(201).json({ ok: true, operationId, capabilities, server: safeServer(rows[0]) });
  } catch (error) {
    await operationFinish(operationId, { stage: "failed", status: "failed", error: (error as Error).message });
    res.status(400).json({ ok: false, operationId, error: (error as Error).message });
  }
});

router.get("/vpn-management/peers", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const serverFilter = req.query.serverId ? `&server_id=eq.${positiveInt(req.query.serverId, "serverId")}` : "";
    const techFilter = req.query.technology ? `&technology=eq.${technology(req.query.technology)}` : "";
    const rows = await sbSelectStrict<PeerRow>("isp_vpn_peers", `admin_id=eq.${adminId}${serverFilter}${techFilter}&select=*&order=created_at.desc`);
    res.json(rows.map(safePeer));
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.post("/vpn-management/peers", async (req, res): Promise<void> => {
  let operationId: number | null = null;
  try {
    const adminId = adminIdOf(req);
    const body = req.body as Record<string, unknown>;
    const server = await loadServer(adminId, positiveInt(body.serverId, "serverId"));
    const { credentials } = await loadRouter(adminId, server.router_id);
    const capabilities = await capabilityFor(credentials);
    assertCapability(capabilities, server.technology);
    const pair = server.technology === "wireguard" ? generateWireGuardKeyPair() : null;
    const suppliedSecret = body.secret ? String(body.secret) : "";
    const secret = pair?.publicKey ?? suppliedSecret;
    if (!secret) throw new Error(`${server.technology === "ipsec" ? "secret (PSK)" : "secret (password)"} is required`);
    const input = inputFromBody({ ...body, technology: server.technology, secret }, "create");
    const plan = buildVpnPlan(input);
    const dryRun = Boolean(body.dryRun);
    operationId = await operationStart(adminId, { routerId: server.router_id, serverId: server.id, technology: server.technology, operation: "peer-create", mode: dryRun ? "dry_run" : "apply", request: redactRequest(body) });
    const result = await executeVpnPlan(credentials, plan, dryRun);
    await operationFinish(operationId, { stage: result.stage, status: "succeeded", result_json: { commands: redactCommands(plan.commands), verification: result.verification } });
    if (dryRun) {
      res.json({ ok: true, dryRun: true, operationId, capabilities, plan: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands }, generated: pair ? { publicKey: pair.publicKey } : undefined });
      return;
    }
    const routerRef = result.verification.find(row => row[".id"])?.[".id"] ?? null;
    if (!routerRef) throw new Error("Router change succeeded but the resource reference could not be verified");
    const base = {
      admin_id: adminId,
      server_id: server.id,
      customer_id: body.customerId === undefined ? null : positiveInt(body.customerId, "customerId"),
      username: input.name,
      technology: server.technology,
      router_ref: routerRef,
      public_key: pair?.publicKey ?? null,
      assigned_ip: body.address ?? null,
      allowed_ips: input.allowedIps ?? [],
      endpoint: input.endpoint ?? null,
      settings_json: { interfaceName: input.interfaceName ?? server.interface_name },
      is_active: input.enabled !== false,
      expires_at: body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null,
    };
    const peerRef = String(base.router_ref);
    let peer: PeerRow | undefined;
    try {
      const peerRows = await sbInsertStrict<PeerRow>("isp_vpn_peers", base);
      peer = peerRows[0];
      if (!peer) throw new Error("VPN peer state could not be saved");
      const encrypted = encryptVpnSecret(pair?.privateKey ?? suppliedSecret);
      await sbInsertStrict("isp_vpn_secrets", { peer_id: peer.id, secret_type: pair ? "private_key" : server.technology === "ipsec" ? "psk" : "password", ...encrypted });
    } catch (error) {
      if (peer?.id) {
        try { await sbDeleteStrict("isp_vpn_peers", `id=eq.${peer.id}&admin_id=eq.${adminId}`); } catch { /* continue to router compensation */ }
      }
      try { await removeCreatedResource(credentials, server.technology, peerRef); } catch { /* operation is reported as failed below */ }
      throw new Error(`Router change was compensated after VPN state persistence failed: ${(error as Error).message}`);
    }
    void logActivity({ adminId, type: "vpn", action: "peer_created", subject: input.name, details: { serverId: server.id, technology: server.technology, customerId: base.customer_id, operationId } });
    res.status(201).json({ ok: true, operationId, capabilities, peer: safePeer(peer), generated: pair ? { publicKey: pair.publicKey } : undefined });
  } catch (error) {
    await operationFinish(operationId, { stage: "failed", status: "failed", error: (error as Error).message });
    res.status(400).json({ ok: false, operationId, error: (error as Error).message });
  }
});

router.post("/vpn-management/peers/:id/dry-run", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const peer = await loadPeer(adminId, positiveInt(req.params.id, "peer id"));
    const server = await loadServer(adminId, peer.server_id);
    const { credentials } = await loadRouter(adminId, server.router_id);
    const capabilities = await capabilityFor(credentials);
    assertCapability(capabilities, peer.technology);
    const operation = req.body?.operation === "delete" ? "delete" : req.body?.operation === "disable" ? "disable" : "update";
    const input = inputFromBody({ ...peer, ...req.body, technology: peer.technology, name: peer.username, routerRef: peer.router_ref }, operation);
    const plan = buildVpnPlan(input);
    const operationId = await operationStart(adminId, { routerId: server.router_id, serverId: server.id, peerId: peer.id, technology: peer.technology, operation: `peer-${operation}`, mode: "dry_run", request: redactRequest(req.body ?? {}) });
    await operationFinish(operationId, { stage: "planned", status: "succeeded", result_json: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands } });
    res.json({ ok: true, dryRun: true, operationId, capabilities, plan: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands } });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.patch("/vpn-management/peers/:id", async (req, res): Promise<void> => {
  let operationId: number | null = null;
  try {
    const adminId = adminIdOf(req);
    const peer = await loadPeer(adminId, positiveInt(req.params.id, "peer id"));
    const server = await loadServer(adminId, peer.server_id);
    const { credentials } = await loadRouter(adminId, server.router_id);
    const capabilities = await capabilityFor(credentials);
    assertCapability(capabilities, peer.technology);
    const operation: VpnInput["operation"] = req.body?.enabled === false ? "disable" : "update";
    const input = inputFromBody({ ...peer, ...req.body, technology: peer.technology, name: peer.username, routerRef: peer.router_ref }, operation);
    const plan = buildVpnPlan(input);
    const dryRun = Boolean(req.body?.dryRun);
    operationId = await operationStart(adminId, { routerId: server.router_id, serverId: server.id, peerId: peer.id, technology: peer.technology, operation: `peer-${operation}`, mode: dryRun ? "dry_run" : "apply", request: redactRequest(req.body ?? {}) });
    const result = await executeVpnPlan(credentials, plan, dryRun);
    await operationFinish(operationId, { stage: result.stage, status: "succeeded", result_json: { commands: redactCommands(plan.commands), verification: result.verification } });
    if (dryRun) {
      res.json({ ok: true, dryRun: true, operationId, capabilities, plan: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands } });
      return;
    }
    const updates: Record<string, unknown> = {
      is_active: req.body?.enabled === undefined ? peer.is_active : Boolean(req.body.enabled),
      updated_at: new Date().toISOString(),
    };
    if (req.body?.allowedIps !== undefined) updates.allowed_ips = input.allowedIps ?? [];
    if (req.body?.endpoint !== undefined) updates.endpoint = input.endpoint ?? null;
    if (req.body?.expiresAt !== undefined) updates.expires_at = req.body.expiresAt ? new Date(String(req.body.expiresAt)).toISOString() : null;
    const rows = await sbUpdateStrict<PeerRow>("isp_vpn_peers", `id=eq.${peer.id}&admin_id=eq.${adminId}`, updates);
    void logActivity({ adminId, type: "vpn", action: "peer_updated", subject: peer.username, details: { serverId: server.id, technology: peer.technology, operationId } });
    res.json({ ok: true, operationId, capabilities, peer: rows[0] ? safePeer(rows[0]) : safePeer({ ...peer, ...updates } as PeerRow) });
  } catch (error) {
    await operationFinish(operationId, { stage: "failed", status: "failed", error: (error as Error).message });
    res.status(400).json({ ok: false, operationId, error: (error as Error).message });
  }
});

router.delete("/vpn-management/peers/:id", async (req, res): Promise<void> => {
  let operationId: number | null = null;
  try {
    const adminId = adminIdOf(req);
    const peer = await loadPeer(adminId, positiveInt(req.params.id, "peer id"));
    const server = await loadServer(adminId, peer.server_id);
    const { credentials } = await loadRouter(adminId, server.router_id);
    const capabilities = await capabilityFor(credentials);
    assertCapability(capabilities, peer.technology);
    const plan = buildVpnPlan(inputFromBody({ ...peer, technology: peer.technology, name: peer.username, routerRef: peer.router_ref }, "delete"));
    const dryRun = req.query.dryRun === "true";
    operationId = await operationStart(adminId, { routerId: server.router_id, serverId: server.id, peerId: peer.id, technology: peer.technology, operation: "peer-delete", mode: dryRun ? "dry_run" : "apply", request: {} });
    const result = await executeVpnPlan(credentials, plan, dryRun);
    await operationFinish(operationId, { stage: result.stage, status: "succeeded", result_json: { commands: redactCommands(plan.commands), verification: result.verification } });
    if (dryRun) {
      res.json({ ok: true, dryRun: true, operationId, capabilities, plan: { commands: redactCommands(plan.commands), verifyCommands: plan.verifyCommands } });
      return;
    }
    await sbDeleteStrict("isp_vpn_peers", `id=eq.${peer.id}&admin_id=eq.${adminId}`);
    void logActivity({ adminId, type: "vpn", action: "peer_deleted", subject: peer.username, details: { serverId: server.id, technology: peer.technology, operationId } });
    res.json({ ok: true, operationId });
  } catch (error) {
    await operationFinish(operationId, { stage: "failed", status: "failed", error: (error as Error).message });
    res.status(400).json({ ok: false, operationId, error: (error as Error).message });
  }
});

router.post("/vpn-management/reconcile", async (req, res): Promise<void> => {
  const results: Array<Record<string, unknown>> = [];
  try {
    const adminId = adminIdOf(req);
    const peers = await sbSelectStrict<PeerRow>("isp_vpn_peers", `admin_id=eq.${adminId}&customer_id=not.is.null&select=*&order=id.asc`);
    const customerIds = [...new Set(peers.map(peer => peer.customer_id).filter((id): id is number => !!id))];
    const customers = customerIds.length
      ? await sbSelectStrict<{ id: number; status: string; expires_at: string | null }>("isp_customers", `admin_id=eq.${adminId}&id=in.(${customerIds.join(",")})&select=id,status,expires_at`)
      : [];
    const customerById = new Map(customers.map(customer => [customer.id, customer]));

    for (const peer of peers) {
      const customer = customerById.get(peer.customer_id!);
      if (!customer) {
        results.push({ peerId: peer.id, username: peer.username, changed: false, error: "Linked customer is not owned by this administrator" });
        continue;
      }
      const customerActive = customer.status === "active" && (!customer.expires_at || new Date(customer.expires_at) > new Date());
      const peerActive = peer.is_active && (!peer.expires_at || new Date(peer.expires_at) > new Date());
      if (customerActive === peerActive) {
        results.push({ peerId: peer.id, username: peer.username, changed: false, enabled: peerActive, reason: "already in sync" });
        continue;
      }
      const server = await loadServer(adminId, peer.server_id);
      const { credentials } = await loadRouter(adminId, server.router_id);
      const capabilities = await capabilityFor(credentials);
      assertCapability(capabilities, peer.technology);
      const operation = customerActive ? "update" : "disable";
      const plan = buildVpnPlan(inputFromBody({ ...peer, technology: peer.technology, name: peer.username, routerRef: peer.router_ref, enabled: customerActive }, operation));
      const operationId = await operationStart(adminId, { routerId: server.router_id, serverId: server.id, peerId: peer.id, technology: peer.technology, operation: `subscription-${operation}`, mode: "apply", request: { customerId: peer.customer_id, desiredEnabled: customerActive } });
      try {
        const execution = await executeVpnPlan(credentials, plan, false);
        await sbUpdateStrict("isp_vpn_peers", `id=eq.${peer.id}&admin_id=eq.${adminId}`, { is_active: customerActive, updated_at: new Date().toISOString(), last_status: "verified", last_status_json: { source: "subscription_reconcile", customerStatus: customer.status } });
        await operationFinish(operationId, { stage: execution.stage, status: "succeeded", result_json: { verification: execution.verification } });
        void logActivity({ adminId, type: "vpn", action: "subscription_reconciled", subject: peer.username, details: { peerId: peer.id, customerId: peer.customer_id, enabled: customerActive, operationId } });
        results.push({ peerId: peer.id, username: peer.username, changed: true, enabled: customerActive });
      } catch (error) {
        await operationFinish(operationId, { stage: "failed", status: "failed", error: (error as Error).message });
        results.push({ peerId: peer.id, username: peer.username, changed: false, error: (error as Error).message });
      }
    }
    res.json({ ok: true, results, changed: results.filter(result => result.changed).length });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message, results });
  }
});

router.get("/vpn-management/peers/:id/config", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const peer = await loadPeer(adminId, positiveInt(req.params.id, "peer id"));
    const server = await loadServer(adminId, peer.server_id);
    const secretRows = await sbSelectStrict<{ secret_type: string; ciphertext: string; iv: string; auth_tag: string }>(
      "isp_vpn_secrets",
      `peer_id=eq.${peer.id}&select=secret_type,ciphertext,iv,auth_tag&limit=1`,
    );
    if (!secretRows[0]) throw new Error("Client secret is unavailable; regenerate the peer configuration");
    const { decryptVpnSecret } = await import("../lib/vpn-crypto.js");
    const secret = decryptVpnSecret(secretRows[0]);
    const config = buildClientConfig(peer.technology, peer.username, secret, {
      serverPublicKey: String(server.settings_json?.publicKey ?? ""),
      endpoint: server.endpoint ?? peer.endpoint ?? undefined,
      assignedIp: peer.assigned_ip ?? undefined,
      allowedIps: peer.allowed_ips,
      dns: server.dns_servers ?? undefined,
    });
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${peer.username}.${peer.technology === "wireguard" ? "conf" : "ovpn"}"`);
    res.set("Cache-Control", "no-store");
    res.send(config);
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.get("/vpn-management/peers/:id/qr-payload", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const peer = await loadPeer(adminId, positiveInt(req.params.id, "peer id"));
    if (peer.technology !== "wireguard") throw new Error("QR payloads are available for WireGuard peers only");
    const server = await loadServer(adminId, peer.server_id);
    const secretRows = await sbSelectStrict<{ ciphertext: string; iv: string; auth_tag: string }>("isp_vpn_secrets", `peer_id=eq.${peer.id}&select=ciphertext,iv,auth_tag&limit=1`);
    if (!secretRows[0]) throw new Error("Client secret is unavailable");
    const { decryptVpnSecret } = await import("../lib/vpn-crypto.js");
    const payload = buildClientConfig(peer.technology, peer.username, decryptVpnSecret(secretRows[0]), {
      serverPublicKey: String(server.settings_json?.publicKey ?? ""),
      endpoint: server.endpoint ?? peer.endpoint ?? undefined,
      assignedIp: peer.assigned_ip ?? undefined,
      allowedIps: peer.allowed_ips,
      dns: server.dns_servers ?? undefined,
    });
    res.json({ ok: true, peerId: peer.id, expires: new Date(Date.now() + 60_000).toISOString(), qrPayload: payload });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

router.get("/vpn-management/audit", async (req, res): Promise<void> => {
  try {
    const adminId = adminIdOf(req);
    const rows = await sbSelectStrict("isp_vpn_operations", `admin_id=eq.${adminId}&select=id,router_id,server_id,peer_id,technology,operation,mode,stage,status,result_json,error,created_at,completed_at&order=created_at.desc&limit=100`);
    res.json(rows);
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

export default router;