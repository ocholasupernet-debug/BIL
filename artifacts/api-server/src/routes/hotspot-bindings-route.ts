import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";

const router: IRouter = Router();
const QUERY_BATCH_SIZE = 100;

interface DbCustomer {
  id: number;
  admin_id: number;
  name: string | null;
  username: string | null;
  pppoe_username: string | null;
  mac_address: string | null;
  ip_address: string | null;
  type: string | null;
  status: string;
  expires_at: string | null;
}

interface OwnedBypass {
  id: number;
  username: string;
  mac_address: string;
  ip_address: string | null;
}

interface RouterLite {
  id: number;
  name: string;
  host: string;
  status: string;
}

interface RadiusSession {
  radacctid: number;
  username: string;
  nasipaddress: string | null;
  callingstationid: string | null;
  framedipaddress: string | null;
  acctstarttime: string | null;
  acctstoptime: string | null;
  acctinputoctets: number | string | null;
  acctoutputoctets: number | string | null;
  acctsessiontime: number | string | null;
  acctterminatecause: string | null;
}

function requestedAdminId(req: Request, res: Response): number | null {
  const requested = req.query.adminId ?? req.body?.adminId;
  const adminId = authenticatedAdminId(req, requested);
  if (adminId <= 0) {
    res.status(403).json({ error: "This account cannot access another account's hotspot bindings." });
    return null;
  }
  return adminId;
}

function inFilter(column: string, values: string[]): string {
  return `${column}=in.(${values.map(value => encodeURIComponent(value)).join(",")})`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.replace(/[^0-9A-F]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every(part =>
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
  );
}

function radiusUsername(customer: DbCustomer): string | null {
  const username = customer.type === "pppoe"
    ? customer.pppoe_username || customer.username
    : customer.username;
  return username?.trim() || null;
}

async function ensureNoOtherAccountOwnsRadiusUsername(
  username: string,
  adminId: number,
): Promise<boolean> {
  const value = encodeURIComponent(username);
  const [usernameOwners, pppoeOwners] = await Promise.all([
    sbSelectStrict<{ id: number }>(
      "isp_customers",
      `admin_id=neq.${adminId}&username=eq.${value}&select=id&limit=1`,
    ),
    sbSelectStrict<{ id: number }>(
      "isp_customers",
      `admin_id=neq.${adminId}&pppoe_username=eq.${value}&select=id&limit=1`,
    ),
  ]);
  return usernameOwners.length > 0 || pppoeOwners.length > 0;
}

async function ownedSessionUsernames(adminId: number): Promise<string[]> {
  const [customers, bypasses] = await Promise.all([
    sbSelectStrict<DbCustomer>(
      "isp_customers",
      `admin_id=eq.${adminId}&select=id,admin_id,name,username,pppoe_username,mac_address,ip_address,type,status,expires_at&limit=10000`,
    ),
    sbSelectStrict<OwnedBypass>(
      "isp_hotspot_mac_bypasses",
      `admin_id=eq.${adminId}&select=id,username,mac_address,ip_address&limit=10000`,
    ),
  ]);

  const candidateUsernames = [...new Set([
    ...customers.flatMap(customer => [customer.username, customer.pppoe_username]),
    ...bypasses.map(bypass => bypass.username),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(value => value.trim()))];
  const ownCustomerNames = new Set(candidateUsernames);
  const ambiguousNames = new Set<string>();

  for (const batch of chunks(candidateUsernames, QUERY_BATCH_SIZE)) {
    const [usernameOwners, pppoeOwners] = await Promise.all([
      sbSelectStrict<{ username: string | null }>(
        "isp_customers",
        `${inFilter("username", batch)}&admin_id=neq.${adminId}&select=username&limit=10000`,
      ),
      sbSelectStrict<{ pppoe_username: string | null }>(
        "isp_customers",
        `${inFilter("pppoe_username", batch)}&admin_id=neq.${adminId}&select=pppoe_username&limit=10000`,
      ),
    ]);
    usernameOwners.forEach(row => { if (row.username) ambiguousNames.add(row.username.trim()); });
    pppoeOwners.forEach(row => { if (row.pppoe_username) ambiguousNames.add(row.pppoe_username.trim()); });
  }

  return [...ownCustomerNames].filter(username => !ambiguousNames.has(username));
}

router.get("/hotspot-bindings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;

  try {
    const [allCustomers, bypassRows, routers] = await Promise.all([
      sbSelectStrict<DbCustomer>(
        "isp_customers",
        `admin_id=eq.${adminId}&select=id,admin_id,name,username,pppoe_username,mac_address,ip_address,type,status,expires_at&order=name.asc&limit=10000`,
      ),
      sbSelectStrict<OwnedBypass>(
        "isp_hotspot_mac_bypasses",
        `admin_id=eq.${adminId}&select=id,username,mac_address,ip_address&order=created_at.desc&limit=10000`,
      ),
      sbSelectStrict<RouterLite>(
        "isp_routers",
        `admin_id=eq.${adminId}&status=not.in.(setup,awaiting_ports,awaiting_sync,awaiting_connection)&select=id,name,host,status&order=name.asc`,
      ),
    ]);

    res.json({
      customers: allCustomers.filter(customer => Boolean(customer.mac_address)),
      allCustomers,
      bypasses: bypassRows.map(row => ({
        id: Number(row.id),
        username: row.username,
        attribute: "Auth-Type",
        op: ":=",
        value: "Accept",
      })),
      bypassIps: bypassRows.filter(row => row.ip_address).map(row => ({
        id: Number(row.id),
        username: row.username,
        attribute: "Framed-IP-Address",
        op: ":=",
        value: row.ip_address,
      })),
      routers: routers.map(item => ({ ...item, id: Number(item.id) })),
    });
  } catch {
    res.status(500).json({ error: "Hotspot bindings could not be loaded for this account." });
  }
});

router.get("/hotspot-bindings/sessions", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  const active = req.query.active === "true";
  if (req.query.active !== "true" && req.query.active !== "false") {
    res.status(400).json({ error: "active must be true or false." });
    return;
  }

  try {
    const scopedUsernames = await ownedSessionUsernames(adminId);

    const sessions: RadiusSession[] = [];
    for (const batch of chunks(scopedUsernames, QUERY_BATCH_SIZE)) {
      const rows = await sbSelectStrict<RadiusSession>(
        "radacct",
        `${inFilter("username", batch)}&select=radacctid,username,nasipaddress,callingstationid,framedipaddress,acctstarttime,acctstoptime,acctinputoctets,acctoutputoctets,acctsessiontime,acctterminatecause&acctstoptime=${active ? "is.null" : "not.is.null"}&order=acctstarttime.desc&limit=100`,
      );
      sessions.push(...rows);
    }

    res.json(sessions
      .sort((left, right) => Date.parse(right.acctstarttime ?? "") - Date.parse(left.acctstarttime ?? ""))
      .slice(0, 100)
      .map(session => ({
        ...session,
        radacctid: Number(session.radacctid),
        acctinputoctets: Number(session.acctinputoctets ?? 0),
        acctoutputoctets: Number(session.acctoutputoctets ?? 0),
        acctsessiontime: Number(session.acctsessiontime ?? 0),
        nasipaddress: session.nasipaddress ?? "",
        callingstationid: session.callingstationid ?? "",
        framedipaddress: session.framedipaddress ?? "",
        acctterminatecause: session.acctterminatecause ?? "",
      })));
  } catch {
    res.status(500).json({ error: "Hotspot sessions could not be loaded for this account." });
  }
});

router.post("/hotspot-bindings/user", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  const customerId = Number(req.body?.customerId);
  const mac = normalizeMac(req.body?.mac);
  if (!Number.isSafeInteger(customerId) || customerId <= 0 || !mac) {
    res.status(400).json({ error: "A valid customer and MAC address are required." });
    return;
  }

  try {
    const [customer] = await sbSelectStrict<DbCustomer>(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${adminId}&select=id,admin_id,name,username,pppoe_username,mac_address,ip_address,type,status,expires_at&limit=1`,
    );
    if (!customer) {
      res.status(404).json({ error: "Customer not found for this account." });
      return;
    }
    const username = radiusUsername(customer);
    if (!username) {
      res.status(400).json({ error: "The selected customer has no RADIUS username." });
      return;
    }
    if (await ensureNoOtherAccountOwnsRadiusUsername(username, adminId)) {
      res.status(409).json({ error: "This RADIUS username is also used by another account, so its MAC binding cannot be changed safely." });
      return;
    }

    const radiusFilter = `username=eq.${encodeURIComponent(username)}&attribute=eq.Calling-Station-Id`;
    const existing = await sbSelectStrict<{ id: number }>(
      "radcheck",
      `${radiusFilter}&select=id&limit=1`,
    );
    if (existing.length > 0) {
      await sbUpdateStrict("radcheck", radiusFilter, { value: mac });
    } else {
      await sbInsertStrict("radcheck", [{
        username,
        attribute: "Calling-Station-Id",
        op: ":=",
        value: mac,
      }]);
    }
    await sbUpdateStrict(
      "isp_customers",
      `id=eq.${customerId}&admin_id=eq.${adminId}`,
      { mac_address: mac, updated_at: new Date().toISOString() },
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "The customer MAC binding could not be saved." });
  }
});

router.post("/hotspot-bindings/bypass", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  const mac = normalizeMac(req.body?.mac);
  const ipValue = typeof req.body?.ip === "string" ? req.body.ip.trim() : "";
  const ip = ipValue || null;
  if (!mac || (ip !== null && !isValidIpv4(ip))) {
    res.status(400).json({ error: "Provide a valid MAC address and, if set, a valid IPv4 address." });
    return;
  }

  const username = `bypass:${mac.replace(/:/g, "-")}`;
  try {
    const encodedUsername = encodeURIComponent(username);
    const [customerUsernames, customerPppoeUsernames] = await Promise.all([
      sbSelectStrict<{ id: number }>(
        "isp_customers",
        `username=eq.${encodedUsername}&select=id&limit=1`,
      ),
      sbSelectStrict<{ id: number }>(
        "isp_customers",
        `pppoe_username=eq.${encodedUsername}&select=id&limit=1`,
      ),
    ]);
    if (customerUsernames.length > 0 || customerPppoeUsernames.length > 0) {
      res.status(409).json({ error: "This MAC bypass key conflicts with a customer RADIUS username." });
      return;
    }

    const [existingOwner] = await sbSelectStrict<OwnedBypass>(
      "isp_hotspot_mac_bypasses",
      `username=eq.${encodedUsername}&select=id,username,mac_address,ip_address&limit=1`,
    );
    if (existingOwner) {
      res.status(409).json({ error: "A bypass binding for this MAC already exists." });
      return;
    }
    const existingRadiusRows = await sbSelectStrict<{ id: number }>(
      "radcheck",
      `username=eq.${encodeURIComponent(username)}&select=id&limit=1`,
    );
    if (existingRadiusRows.length > 0) {
      res.status(409).json({ error: "A legacy bypass for this MAC has no verified account owner and cannot be claimed automatically." });
      return;
    }

    await sbInsertStrict("isp_hotspot_mac_bypasses", [{
      admin_id: adminId,
      username,
      mac_address: mac,
      ip_address: ip,
    }]);
    try {
      const rows: Record<string, unknown>[] = [
        { username, attribute: "Auth-Type", op: ":=", value: "Accept" },
      ];
      if (ip) rows.push({ username, attribute: "Framed-IP-Address", op: ":=", value: ip });
      await sbInsertStrict("radcheck", rows);
    } catch {
      await sbDeleteStrict("isp_hotspot_mac_bypasses", `admin_id=eq.${adminId}&username=eq.${encodeURIComponent(username)}`);
      throw new Error("The RADIUS bypass entry could not be created.");
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "The bypass binding could not be saved." });
  }
});

router.delete("/hotspot-bindings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = requestedAdminId(req, res);
  if (!adminId) return;
  const source = req.body?.source;

  try {
    if (source === "isp_customers") {
      const customerId = Number(req.body?.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        res.status(400).json({ error: "A valid customer is required." });
        return;
      }
      const [customer] = await sbSelectStrict<DbCustomer>(
        "isp_customers",
        `id=eq.${customerId}&admin_id=eq.${adminId}&select=id,admin_id,name,username,pppoe_username,mac_address,ip_address,type,status,expires_at&limit=1`,
      );
      if (!customer) {
        res.status(404).json({ error: "Customer not found for this account." });
        return;
      }
      const username = radiusUsername(customer);
      if (username && await ensureNoOtherAccountOwnsRadiusUsername(username, adminId)) {
        res.status(409).json({ error: "This RADIUS username is also used by another account, so its binding cannot be removed safely." });
        return;
      }
      if (username) {
        await sbDeleteStrict(
          "radcheck",
          `username=eq.${encodeURIComponent(username)}&attribute=eq.Calling-Station-Id`,
        );
      }
      await sbUpdateStrict(
        "isp_customers",
        `id=eq.${customerId}&admin_id=eq.${adminId}`,
        { mac_address: null, updated_at: new Date().toISOString() },
      );
      res.sendStatus(204);
      return;
    }

    if (source === "radcheck") {
      const mac = normalizeMac(req.body?.mac);
      if (!mac) {
        res.status(400).json({ error: "A valid MAC address is required." });
        return;
      }
      const username = `bypass:${mac.replace(/:/g, "-")}`;
      const encodedUsername = encodeURIComponent(username);
      const [customerUsernames, customerPppoeUsernames] = await Promise.all([
        sbSelectStrict<{ id: number }>(
          "isp_customers",
          `username=eq.${encodedUsername}&select=id&limit=1`,
        ),
        sbSelectStrict<{ id: number }>(
          "isp_customers",
          `pppoe_username=eq.${encodedUsername}&select=id&limit=1`,
        ),
      ]);
      if (customerUsernames.length > 0 || customerPppoeUsernames.length > 0) {
        res.status(409).json({ error: "This bypass key conflicts with a customer RADIUS username and cannot be removed safely." });
        return;
      }
      const [owned] = await sbSelectStrict<OwnedBypass>(
        "isp_hotspot_mac_bypasses",
        `admin_id=eq.${adminId}&username=eq.${encodedUsername}&select=id,username,mac_address,ip_address&limit=1`,
      );
      if (!owned) {
        res.status(404).json({ error: "Bypass binding not found for this account." });
        return;
      }
      await sbDeleteStrict("radcheck", `username=eq.${encodedUsername}`);
      await sbDeleteStrict(
        "isp_hotspot_mac_bypasses",
        `admin_id=eq.${adminId}&username=eq.${encodedUsername}`,
      );
      res.sendStatus(204);
      return;
    }

    res.status(400).json({ error: "The binding type is invalid." });
  } catch {
    res.status(500).json({ error: "The hotspot binding could not be removed." });
  }
});

export default router;