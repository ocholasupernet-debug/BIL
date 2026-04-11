import { sbSelect, sbInsert, sbUpdate, sbDelete, supabaseConfigured } from "./supabase-client";

export interface RadCheckRow {
  id?: number;
  username: string;
  attribute: string;
  op: string;
  value: string;
}

export interface RadReplyRow {
  id?: number;
  username: string;
  attribute: string;
  op: string;
  value: string;
}

export interface RadGroupReplyRow {
  id?: number;
  groupname: string;
  attribute: string;
  op: string;
  value: string;
  plan_id?: number;
}

export interface RadUserGroupRow {
  id?: number;
  username: string;
  groupname: string;
  priority: number;
}

export interface RadAcctRow {
  radacctid?: number;
  username: string;
  nasipaddress: string;
  framedipaddress: string;
  acctstoptime: string | null;
  acctsessiontime: number;
  acctinputoctets: number;
  acctoutputoctets: number;
}

export interface NasRow {
  id?: number;
  nasname: string;
  shortname: string;
  type: string;
  ports: string;
  secret: string;
  description: string;
  server: string | null;
  community: string | null;
  routers: string;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

export async function upsertRadCheck(
  username: string,
  attribute: string,
  value: string,
  op = ":=",
): Promise<void> {
  if (!supabaseConfigured) return;
  const existing = await sbSelect<RadCheckRow>(
    "radcheck",
    `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}&select=id`,
  );
  if (existing.length > 0 && existing[0].id) {
    await sbUpdate("radcheck", `id=eq.${existing[0].id}`, { value, op });
  } else {
    await sbInsert("radcheck", { username, attribute, op, value });
  }
}

export async function deleteRadCheck(
  username: string,
  attribute: string,
): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radcheck", `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}`);
}

export async function upsertRadReply(
  username: string,
  attribute: string,
  value: string,
  op = ":=",
): Promise<void> {
  if (!supabaseConfigured) return;
  const existing = await sbSelect<RadReplyRow>(
    "radreply",
    `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}&select=id`,
  );
  if (existing.length > 0 && existing[0].id) {
    await sbUpdate("radreply", `id=eq.${existing[0].id}`, { value, op });
  } else {
    await sbInsert("radreply", { username, attribute, op, value });
  }
}

export async function deleteRadReply(
  username: string,
  attribute: string,
): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radreply", `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}`);
}

export async function upsertRadGroupReply(
  planId: number,
  attribute: string,
  value: string,
  op = ":=",
): Promise<void> {
  if (!supabaseConfigured) return;
  const groupname = `plan_${planId}`;
  const existing = await sbSelect<RadGroupReplyRow>(
    "radgroupreply",
    `plan_id=eq.${planId}&attribute=eq.${enc(attribute)}&select=id`,
  );
  if (existing.length > 0 && existing[0].id) {
    await sbUpdate("radgroupreply", `id=eq.${existing[0].id}`, { value, op, groupname });
  } else {
    await sbInsert("radgroupreply", { groupname, plan_id: planId, attribute, op, value });
  }
}

export async function deleteRadGroupReply(planId: number): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radgroupreply", `plan_id=eq.${planId}`);
}

export async function setUserGroup(
  username: string,
  groupname: string,
  priority = 1,
): Promise<void> {
  if (!supabaseConfigured) return;
  const existing = await sbSelect<RadUserGroupRow>(
    "radusergroup",
    `username=eq.${enc(username)}&select=id`,
  );
  if (existing.length > 0 && existing[0].id) {
    await sbUpdate("radusergroup", `id=eq.${existing[0].id}`, { groupname, priority });
  } else {
    await sbInsert("radusergroup", { username, groupname, priority });
  }
}

export async function removeUserGroup(username: string): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radusergroup", `username=eq.${enc(username)}`);
}

function rateUnitToSuffix(unit: string): string {
  return unit === "Kbps" ? "K" : "M";
}

function stringToInteger(str: string): string {
  return str.replace(/G/g, "000000000").replace(/M/g, "000000").replace(/K/g, "000");
}

export interface RadiusPlanOpts {
  planId: number;
  rateUp: number;
  rateUpUnit: string;
  rateDown: number;
  rateDownUnit: string;
  burst?: string;
}

export async function addRadiusPlan(opts: RadiusPlanOpts): Promise<void> {
  const unitUp = rateUnitToSuffix(opts.rateUpUnit);
  const unitDown = rateUnitToSuffix(opts.rateDownUnit);
  const rate = `${opts.rateUp}${unitUp}/${opts.rateDown}${unitDown}`;

  let ratos = rate;
  if (opts.burst && opts.burst.trim()) {
    ratos = `${rate} ${opts.burst.trim()}`;
  }

  const downPart = `${opts.rateDown}${unitDown}`;
  const upPart = `${opts.rateUp}${unitUp}`;

  await Promise.all([
    upsertRadGroupReply(opts.planId, "Ascend-Data-Rate", stringToInteger(downPart), ":="),
    upsertRadGroupReply(opts.planId, "Ascend-Xmit-Rate", stringToInteger(upPart), ":="),
    upsertRadGroupReply(opts.planId, "Mikrotik-Rate-Limit", ratos, ":="),
  ]);
}

export async function removeRadiusPlan(planId: number): Promise<void> {
  await deleteRadGroupReply(planId);
  if (!supabaseConfigured) return;
  const users = await sbSelect<RadUserGroupRow>(
    "radusergroup",
    `groupname=eq.plan_${planId}&select=id,username`,
  );
  for (const u of users) {
    if (u.id) {
      await sbUpdate("radusergroup", `id=eq.${u.id}`, { groupname: "" });
    }
  }
}

export interface RadiusCustomerOpts {
  username: string;
  password: string;
  planId: number;
  planType: "hotspot" | "pppoe";
  sharedUsers?: number;
  fullname?: string;
  pppoePassword?: string;
  pppoeIp?: string;
  pool?: string;
  limitType?: "Time_Limit" | "Data_Limit" | "Both_Limit";
  timeLimit?: number;
  timeUnit?: "Hrs" | "Mins";
  dataLimit?: number;
  dataUnit?: "GB" | "MB";
  expiration?: string;
  rateUp?: number;
  rateUpUnit?: string;
  rateDown?: number;
  rateDownUnit?: string;
  burst?: string;
}

export async function addRadiusCustomer(opts: RadiusCustomerOpts): Promise<boolean> {
  const pw = opts.planType === "pppoe" && opts.pppoePassword ? opts.pppoePassword : opts.password;
  await upsertRadCheck(opts.username, "Cleartext-Password", pw);
  const simUse = opts.planType === "pppoe" ? 1 : (opts.sharedUsers ?? 1);
  await upsertRadCheck(opts.username, "Simultaneous-Use", String(simUse));
  await upsertRadCheck(opts.username, "Port-Limit", String(simUse));
  if (opts.fullname) {
    await upsertRadCheck(opts.username, "Mikrotik-Wireless-Comment", opts.fullname);
  }

  await setUserGroup(opts.username, `plan_${opts.planId}`);

  await deleteRadCheck(opts.username, "Max-All-Session");
  await deleteRadCheck(opts.username, "Max-Data");
  await deleteRadCheck(opts.username, "Mikrotik-Rate-Limit");
  await deleteRadCheck(opts.username, "WISPr-Session-Terminate-Time");
  await deleteRadCheck(opts.username, "Expiration");
  await deleteRadCheck(opts.username, "access-period");
  await deleteRadCheck(opts.username, "Max-Volume");

  if (opts.rateUp && opts.rateDown) {
    const unitUp = rateUnitToSuffix(opts.rateUpUnit ?? "Mbps");
    const unitDown = rateUnitToSuffix(opts.rateDownUnit ?? "Mbps");
    let rl = `${opts.rateUp}${unitUp}/${opts.rateDown}${unitDown}`;
    if (opts.burst && opts.burst.trim()) {
      rl = `${rl} ${opts.burst.trim()}`;
    }
    await upsertRadCheck(opts.username, "Mikrotik-Rate-Limit", rl);
  }

  if (opts.planType === "hotspot" && opts.limitType) {
    if (opts.limitType === "Time_Limit" || opts.limitType === "Both_Limit") {
      const secs = opts.timeUnit === "Hrs"
        ? (opts.timeLimit ?? 0) * 3600
        : (opts.timeLimit ?? 0) * 60;
      await upsertRadCheck(opts.username, "Max-All-Session", String(secs));
    }
    if (opts.limitType === "Data_Limit" || opts.limitType === "Both_Limit") {
      const bytes = opts.dataUnit === "GB"
        ? `${opts.dataLimit ?? 0}000000000`
        : `${opts.dataLimit ?? 0}000000`;
      await upsertRadCheck(opts.username, "Max-Data", bytes);
    }
  }

  if (opts.expiration) {
    const expDate = new Date(opts.expiration);
    const maxSession = Math.max(0, Math.floor((expDate.getTime() - Date.now()) / 1000));
    await upsertRadCheck(opts.username, "Max-All-Session", String(maxSession));
    await upsertRadCheck(
      opts.username,
      "Expiration",
      expDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        + " " + expDate.toTimeString().slice(0, 8),
    );
    const isoTerminate = expDate.toISOString().replace(/\.\d+Z$/, "+00:00").replace(/Z$/, "+00:00");
    const wispr = isoTerminate.slice(0, 10) + "T" + isoTerminate.slice(11, 19) + "+00:00";
    await upsertRadCheck(opts.username, "WISPr-Session-Terminate-Time", wispr);
  }

  if (opts.planType === "pppoe" && opts.pool) {
    await upsertRadReply(opts.username, "Framed-Pool", opts.pool, ":=");
    await upsertRadReply(opts.username, "Framed-IP-Address", opts.pppoeIp || "0.0.0.0", ":=");
    await upsertRadReply(opts.username, "Framed-IP-Netmask", "255.255.255.0", ":=");
  } else {
    await deleteRadReply(opts.username, "Framed-Pool");
    await deleteRadReply(opts.username, "Framed-IP-Address");
    await deleteRadReply(opts.username, "Framed-IP-Netmask");
  }

  await clearRadAcct(opts.username);
  return true;
}

export async function removeRadiusCustomer(username: string): Promise<void> {
  await sbDelete("radcheck", `username=eq.${enc(username)}`);
  await removeUserGroup(username);
  await sbDelete("radreply", `username=eq.${enc(username)}`);
}

export async function deactivateRadiusCustomer(username: string): Promise<void> {
  const deactivatedPw = `deactivated_${Date.now()}_${username}`;
  await upsertRadCheck(username, "Cleartext-Password", deactivatedPw);
}

export async function changeRadiusUsername(fromName: string, toName: string): Promise<void> {
  if (!supabaseConfigured) return;
  const checks = await sbSelect<RadCheckRow>("radcheck", `username=eq.${enc(fromName)}&select=id`);
  for (const c of checks) {
    if (c.id) await sbUpdate("radcheck", `id=eq.${c.id}`, { username: toName });
  }
  const groups = await sbSelect<RadUserGroupRow>("radusergroup", `username=eq.${enc(fromName)}&select=id`);
  for (const g of groups) {
    if (g.id) await sbUpdate("radusergroup", `id=eq.${g.id}`, { username: toName });
  }
  const replies = await sbSelect<RadReplyRow>("radreply", `username=eq.${enc(fromName)}&select=id`);
  for (const r of replies) {
    if (r.id) await sbUpdate("radreply", `id=eq.${r.id}`, { username: toName });
  }
}

export async function clearRadAcct(username: string): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radacct", `username=eq.${enc(username)}`);
}

export async function fetchRadAcct(username: string): Promise<RadAcctRow[]> {
  return sbSelect<RadAcctRow>("radacct", `username=eq.${enc(username)}&select=*&order=radacctid.desc&limit=50`);
}

export async function addNas(opts: {
  nasname: string; shortname: string; secret: string;
  ports?: string; type?: string; description?: string;
  server?: string; community?: string; routers?: string;
}): Promise<NasRow[]> {
  return sbInsert<NasRow>("nas", {
    nasname:     opts.nasname,
    shortname:   opts.shortname,
    type:        opts.type ?? "other",
    ports:       opts.ports ?? "",
    secret:      opts.secret,
    description: opts.description ?? "",
    server:      opts.server ?? null,
    community:   opts.community ?? null,
    routers:     opts.routers ?? "",
  });
}

export async function updateNas(
  id: number,
  fields: Partial<Omit<NasRow, "id">>,
): Promise<NasRow[]> {
  return sbUpdate<NasRow>("nas", `id=eq.${id}`, fields as Record<string, unknown>);
}

export async function removeNas(id: number): Promise<void> {
  await sbDelete("nas", `id=eq.${id}`);
}

export async function fetchNas(): Promise<NasRow[]> {
  return sbSelect<NasRow>("nas", "select=*&order=id.asc");
}

export async function fetchRadCheckForUser(username: string): Promise<RadCheckRow[]> {
  return sbSelect<RadCheckRow>("radcheck", `username=eq.${enc(username)}&select=*`);
}

export async function fetchRadReplyForUser(username: string): Promise<RadReplyRow[]> {
  return sbSelect<RadReplyRow>("radreply", `username=eq.${enc(username)}&select=*`);
}

export async function fetchUserGroup(username: string): Promise<RadUserGroupRow | null> {
  const rows = await sbSelect<RadUserGroupRow>("radusergroup", `username=eq.${enc(username)}&select=*&limit=1`);
  return rows[0] ?? null;
}

export async function fetchRadGroupReplyForPlan(planId: number): Promise<RadGroupReplyRow[]> {
  return sbSelect<RadGroupReplyRow>("radgroupreply", `plan_id=eq.${planId}&select=*`);
}
