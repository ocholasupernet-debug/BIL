import {
  sbSelect,
  sbInsert,
  sbUpdate,
  sbDelete,
  sbSelectStrict,
  sbInsertStrict,
  sbUpdateStrict,
  sbDeleteStrict,
  supabaseConfigured,
} from "./supabase-client";

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

export interface RadiusCustomerSyncOpts {
  username: string;
  password?: string | null;
  planId: number;
  planType: "hotspot" | "pppoe";
  enabled: boolean;
  sharedUsers?: number;
  fullname?: string | null;
  rateUp?: number | null;
  rateUpUnit?: string | null;
  rateDown?: number | null;
  rateDownUnit?: string | null;
  burst?: string | null;
  dataLimitMb?: number | null;
  expiresAt?: string | null;
}

/**
 * Keep RADIUS authorization and reply attributes aligned with the live
 * RouterOS account after an admin edits a prepaid user. This intentionally
 * does not clear accounting rows: editing an expiry or rate must not erase
 * usage history.
 */
export async function syncRadiusCustomer(opts: RadiusCustomerSyncOpts): Promise<void> {
  if (!supabaseConfigured) return;

  if (opts.password) {
    await upsertRadCheck(opts.username, "Cleartext-Password", opts.password);
  }
  await upsertRadCheck(
    opts.username,
    "Simultaneous-Use",
    String(opts.planType === "pppoe" ? 1 : Math.max(1, opts.sharedUsers ?? 1)),
  );
  await upsertRadCheck(
    opts.username,
    "Port-Limit",
    String(opts.planType === "pppoe" ? 1 : Math.max(1, opts.sharedUsers ?? 1)),
  );
  await setUserGroup(opts.username, `plan_${opts.planId}`);

  await deleteRadCheck(opts.username, "Mikrotik-Rate-Limit");
  await deleteRadCheck(opts.username, "Max-Data");
  await deleteRadCheck(opts.username, "Max-All-Session");
  await deleteRadCheck(opts.username, "WISPr-Session-Terminate-Time");
  await deleteRadCheck(opts.username, "Expiration");

  const down = Number(opts.rateDown);
  const up = Number(opts.rateUp);
  if (Number.isFinite(down) && down > 0 && Number.isFinite(up) && up > 0) {
    const unitUp = rateUnitToSuffix(opts.rateUpUnit ?? "Mbps");
    const unitDown = rateUnitToSuffix(opts.rateDownUnit ?? "Mbps");
    let rate = `${up}${unitUp}/${down}${unitDown}`;
    if (opts.burst?.trim()) rate = `${rate} ${opts.burst.trim()}`;
    await upsertRadCheck(opts.username, "Mikrotik-Rate-Limit", rate);
  }

  const dataLimitMb = Number(opts.dataLimitMb);
  if (opts.planType === "hotspot" && Number.isFinite(dataLimitMb) && dataLimitMb > 0) {
    await upsertRadCheck(opts.username, "Max-Data", String(Math.floor(dataLimitMb * 1_000_000)));
  }

  if (opts.expiresAt) {
    const expiresAt = new Date(opts.expiresAt);
    if (!Number.isNaN(expiresAt.getTime())) {
      const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      await upsertRadCheck(opts.username, "Max-All-Session", String(remainingSeconds));
      await upsertRadCheck(
        opts.username,
        "Expiration",
        expiresAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          + " " + expiresAt.toTimeString().slice(0, 8),
      );
      const isoTerminate = expiresAt.toISOString().replace(/\.\d+Z$/, "+00:00").replace(/Z$/, "+00:00");
      await upsertRadCheck(
        opts.username,
        "WISPr-Session-Terminate-Time",
        `${isoTerminate.slice(0, 10)}T${isoTerminate.slice(11, 19)}+00:00`,
      );
    }
  }

  await deleteRadCheck(opts.username, "Auth-Type");
  if (!opts.enabled) {
    await upsertRadCheck(opts.username, "Auth-Type", "Reject");
  }
}

async function strictUpsertRadCheck(
  username: string,
  attribute: string,
  value: string,
  op = ":=",
): Promise<void> {
  const existing = await sbSelectStrict<RadCheckRow>(
    "radcheck",
    `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}&select=id`,
  );
  if (existing[0]?.id) {
    const updated = await sbUpdateStrict<RadCheckRow>(
      "radcheck",
      `id=eq.${existing[0].id}`,
      { value, op },
    );
    if (updated.length === 0) {
      throw new Error(`RADIUS radcheck ${attribute} update matched no rows.`);
    }
    return;
  }
  const inserted = await sbInsertStrict<RadCheckRow>("radcheck", { username, attribute, op, value });
  if (inserted.length === 0) {
    throw new Error(`RADIUS radcheck ${attribute} insert returned no rows.`);
  }
}

async function strictDeleteRadCheck(username: string, attribute: string): Promise<void> {
  await sbDeleteStrict("radcheck", `username=eq.${enc(username)}&attribute=eq.${enc(attribute)}`);
}

async function strictSetUserGroup(username: string, groupname: string, priority = 1): Promise<void> {
  const existing = await sbSelectStrict<RadUserGroupRow>(
    "radusergroup",
    `username=eq.${enc(username)}&select=id`,
  );
  if (existing[0]?.id) {
    const updated = await sbUpdateStrict<RadUserGroupRow>(
      "radusergroup",
      `id=eq.${existing[0].id}`,
      { groupname, priority },
    );
    if (updated.length === 0) {
      throw new Error("RADIUS radusergroup update matched no rows.");
    }
    return;
  }
  const inserted = await sbInsertStrict<RadUserGroupRow>("radusergroup", {
    username,
    groupname,
    priority,
  });
  if (inserted.length === 0) {
    throw new Error("RADIUS radusergroup insert returned no rows.");
  }
}

/**
 * Strict variant of syncRadiusCustomer for customer edits. Supabase
 * configuration, HTTP, and zero-row update failures are surfaced to callers.
 * Like syncRadiusCustomer, this deliberately leaves radacct untouched.
 */
export async function syncRadiusCustomerStrict(opts: RadiusCustomerSyncOpts): Promise<void> {
  if (opts.password) {
    await strictUpsertRadCheck(opts.username, "Cleartext-Password", opts.password);
  } else {
    await strictDeleteRadCheck(opts.username, "Cleartext-Password");
  }
  const simultaneousUse = String(
    opts.planType === "pppoe" ? 1 : Math.max(1, opts.sharedUsers ?? 1),
  );
  await strictUpsertRadCheck(opts.username, "Simultaneous-Use", simultaneousUse);
  await strictUpsertRadCheck(opts.username, "Port-Limit", simultaneousUse);
  await strictSetUserGroup(opts.username, `plan_${opts.planId}`);

  await strictDeleteRadCheck(opts.username, "Mikrotik-Rate-Limit");
  await strictDeleteRadCheck(opts.username, "Max-Data");
  await strictDeleteRadCheck(opts.username, "Max-All-Session");
  await strictDeleteRadCheck(opts.username, "WISPr-Session-Terminate-Time");
  await strictDeleteRadCheck(opts.username, "Expiration");

  const down = Number(opts.rateDown);
  const up = Number(opts.rateUp);
  if (Number.isFinite(down) && down > 0 && Number.isFinite(up) && up > 0) {
    const unitUp = rateUnitToSuffix(opts.rateUpUnit ?? "Mbps");
    const unitDown = rateUnitToSuffix(opts.rateDownUnit ?? "Mbps");
    let rate = `${up}${unitUp}/${down}${unitDown}`;
    if (opts.burst?.trim()) rate = `${rate} ${opts.burst.trim()}`;
    await strictUpsertRadCheck(opts.username, "Mikrotik-Rate-Limit", rate);
  }

  const dataLimitMb = Number(opts.dataLimitMb);
  if (opts.planType === "hotspot" && Number.isFinite(dataLimitMb) && dataLimitMb > 0) {
    await strictUpsertRadCheck(
      opts.username,
      "Max-Data",
      String(Math.floor(dataLimitMb * 1_000_000)),
    );
  }

  if (opts.expiresAt) {
    const expiresAt = new Date(opts.expiresAt);
    if (!Number.isNaN(expiresAt.getTime())) {
      const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      await strictUpsertRadCheck(opts.username, "Max-All-Session", String(remainingSeconds));
      await strictUpsertRadCheck(
        opts.username,
        "Expiration",
        expiresAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
          + " " + expiresAt.toTimeString().slice(0, 8),
      );
      const isoTerminate = expiresAt.toISOString().replace(/\.\d+Z$/, "+00:00").replace(/Z$/, "+00:00");
      await strictUpsertRadCheck(
        opts.username,
        "WISPr-Session-Terminate-Time",
        `${isoTerminate.slice(0, 10)}T${isoTerminate.slice(11, 19)}+00:00`,
      );
    }
  }

  await strictDeleteRadCheck(opts.username, "Auth-Type");
  if (!opts.enabled) {
    await strictUpsertRadCheck(opts.username, "Auth-Type", "Reject");
  }
}

export async function removeRadiusCustomer(username: string): Promise<void> {
  await sbDelete("radcheck", `username=eq.${enc(username)}`);
  await removeUserGroup(username);
  await sbDelete("radreply", `username=eq.${enc(username)}`);
}

/**
 * Strictly determine whether this login has any RADIUS authorization records.
 * Accounting history is deliberately excluded.
 */
export async function hasRadiusCustomerStrict(username: string): Promise<boolean> {
  for (const table of radiusIdentityTables) {
    const rows = await selectRadiusIdentityRows(table, username);
    if (rows.length > 0) return true;
  }
  return false;
}

/** Reject a RADIUS login already present in any authorization table. */
export async function assertRadiusTargetEmptyStrict(username: string): Promise<void> {
  if (await hasRadiusCustomerStrict(username)) {
    throw new Error("RADIUS identity already contains records for the target username.");
  }
}

/**
 * Strictly delete only RADIUS authorization identity records, then verify each
 * table is empty for the username. radacct usage history is never touched.
 */
export async function removeRadiusCustomerStrict(username: string): Promise<void> {
  for (const table of radiusIdentityTables) {
    await sbDeleteStrict(table, `username=eq.${enc(username)}`);
  }
  for (const table of radiusIdentityTables) {
    const remaining = await selectRadiusIdentityRows(table, username);
    if (remaining.length > 0) {
      throw new Error(`RADIUS ${table} still has records for the username after deletion.`);
    }
  }
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

type RadiusIdentityTable = "radcheck" | "radusergroup" | "radreply";
interface RadiusIdentityRow {
  id?: number;
  username: string;
}

const radiusIdentityTables: RadiusIdentityTable[] = ["radcheck", "radusergroup", "radreply"];

async function selectRadiusIdentityRows(
  table: RadiusIdentityTable,
  username: string,
): Promise<RadiusIdentityRow[]> {
  return sbSelectStrict<RadiusIdentityRow>(
    table,
    `username=eq.${enc(username)}&select=id`,
  );
}

async function moveRadiusIdentityRows(fromName: string, toName: string): Promise<void> {
  for (const table of radiusIdentityTables) {
    const rows = await selectRadiusIdentityRows(table, fromName);
    for (const row of rows) {
      if (!row.id) {
        throw new Error(`Cannot move RADIUS ${table} row without an id.`);
      }
      const updated = await sbUpdateStrict<RadiusIdentityRow>(
        table,
        `id=eq.${row.id}`,
        { username: toName },
      );
      if (updated.length === 0) {
        throw new Error(`RADIUS ${table} username move matched no rows (id ${row.id}).`);
      }
    }
  }
  for (const table of radiusIdentityTables) {
    const remaining = await selectRadiusIdentityRows(table, fromName);
    if (remaining.length > 0) {
      throw new Error(`RADIUS ${table} still has rows for the old username after the move.`);
    }
  }
}

/**
 * Strictly move RADIUS authorization rows to a new login. All target identities
 * are checked before any write; a failed partial move is automatically reversed.
 * Accounting history is intentionally not renamed or otherwise modified.
 */
export async function moveRadiusCustomerStrict(
  fromName: string,
  toName: string,
  onPreflightPassed?: () => void,
): Promise<void> {
  if (!fromName || !toName) throw new Error("Both RADIUS usernames are required for a move.");
  if (fromName === toName) return;

  for (const table of radiusIdentityTables) {
    const targetRows = await selectRadiusIdentityRows(table, toName);
    if (targetRows.length > 0) {
      throw new Error(`Cannot move RADIUS identity: ${table} already contains rows for the target username.`);
    }
  }

  onPreflightPassed?.();
  try {
    await moveRadiusIdentityRows(fromName, toName);
  } catch (moveError) {
    try {
      await rollbackRadiusCustomerMoveStrict(toName, fromName);
    } catch (rollbackError) {
      const moveMessage = moveError instanceof Error ? moveError.message : String(moveError);
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(
        `RADIUS username move failed (${moveMessage}); automatic rollback also failed (${rollbackMessage}).`,
      );
    }
    throw moveError;
  }
}

/**
 * Reverse an earlier strict move, including one that only partly completed.
 * Existing rows at toName are allowed because they can be the untouched portion
 * of the original identity following a partial move. This should only be used
 * to roll back a move whose target was initially verified empty.
 */
export async function rollbackRadiusCustomerMoveStrict(
  fromName: string,
  toName: string,
): Promise<void> {
  if (!fromName || !toName) throw new Error("Both RADIUS usernames are required for a rollback.");
  if (fromName === toName) return;
  await moveRadiusIdentityRows(fromName, toName);
}

export async function clearRadAcct(username: string): Promise<void> {
  if (!supabaseConfigured) return;
  await sbDelete("radacct", `username=eq.${enc(username)}`);
}

export async function resetRadAcctCounters(username: string): Promise<void> {
  if (!supabaseConfigured) return;
  await sbUpdate("radacct", `username=eq.${enc(username)}`, {
    acctinputoctets: 0,
    acctoutputoctets: 0,
  });
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
