import { Router, type Request, type Response } from "express";
import { authenticatedTenantAdminId, requireAuth } from "../lib/api-auth.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbRpc,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { getRouterCreds } from "./mikrotik-route.js";
import { planServicePoolName } from "../lib/port-service-resources.js";
import { planWritePayload } from "../lib/plan-write.js";
import {
  addRadiusPlan,
  assertRadiusTargetEmptyStrict,
  syncRadiusCustomerStrict,
} from "../lib/radius.js";
import {
  decodeRouterUserSnapshot,
  failRouterUserSnapshot,
  syncClaimedRouterUserSnapshot,
  type RouterUserSnapshotPayload,
} from "../services/router-user-snapshot-service.js";
import {
  buildRouterImportPreview,
  routerImportProfileKey,
  type ExistingImportCustomer,
  type ExistingImportPlan,
  type ImportedServiceType,
} from "../services/router-user-import-service.js";

const router = Router();
const ROOT = "/router-user-snapshots";

interface OwnedRouter {
  id: number;
  admin_id: number;
  name: string | null;
}

interface SnapshotStatusRow {
  schedule_enabled: boolean;
  next_sync_at: string | null;
  last_attempt_at: string | null;
  last_synced_at: string | null;
  last_sync_status: "never" | "success" | "failed";
  last_error_code: string | null;
  ppp_count: number;
  hotspot_count: number;
}

interface StoredUserSnapshot {
  ciphertext: string | null;
  iv: string | null;
  auth_tag: string | null;
  last_synced_at: string | null;
}

interface ImportPlanChoice {
  profileKey: string;
  mode: "existing" | "create";
  planId?: number;
  name?: string;
  price?: number;
  validityDays?: number;
  speedDown?: number;
  speedUp?: number;
}

interface ImportUserDetails {
  key: string;
  name: string;
  phone: string;
  password?: string;
  replaceTargetId?: number;
  replaceTargetUpdatedAt?: string | null;
}

interface ImportCustomerRecord extends Record<string, unknown> {
  id: number;
  admin_id: number;
  type: string;
  username: string | null;
  pppoe_username: string | null;
  router_id: number | null;
  updated_at: string | null;
  password: string | null;
  status: string;
  expires_at: string | null;
  data_used_bytes: number | string | null;
  data_used_mb: number | string | null;
}

type ImportRadiusTable = "radcheck" | "radusergroup" | "radreply";

interface ImportRadiusSnapshot {
  username: string;
  tables: Record<ImportRadiusTable, Record<string, unknown>[]>;
}

class ImportSnapshotNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportSnapshotNotReadyError";
  }
}

class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

function routerIdFrom(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

async function tenantIdForRequest(req: Request, res: Response): Promise<number> {
  if (req.authUser?.type !== "a") {
    res.status(403).json({ error: "An ISP admin account is required." });
    return 0;
  }
  const adminId = await authenticatedTenantAdminId(req);
  if (!Number.isSafeInteger(adminId) || adminId <= 0) {
    res.status(403).json({ error: "The signed-in ISP account could not be verified." });
    return 0;
  }
  return adminId;
}

async function loadOwnedRouter(adminId: number, id: number): Promise<OwnedRouter | null> {
  const rows = await sbSelectStrict<OwnedRouter>(
    "isp_routers",
    `id=eq.${id}&admin_id=eq.${adminId}&select=id,admin_id,name&limit=1`,
  );
  return rows[0] ?? null;
}

function postgrestCaseInsensitiveFilter(values: string[], columns: string[]): string {
  const conditions = columns.flatMap(column => values.map(value => {
    const escaped = value
      .replace(/[\\%_*]/g, character => `\\${character}`)
      .replace(/"/g, '\\"');
    return `${column}.ilike."${escaped}"`;
  }));
  return `or=${encodeURIComponent(`(${conditions.join(",")})`)}`;
}

async function loadImportRadiusSnapshot(username: string): Promise<ImportRadiusSnapshot> {
  const filter = `username=eq.${encodeURIComponent(username)}&select=*&limit=10000`;
  const [radcheck, radusergroup, radreply] = await Promise.all([
    sbSelectStrict<Record<string, unknown>>("radcheck", filter),
    sbSelectStrict<Record<string, unknown>>("radusergroup", filter),
    sbSelectStrict<Record<string, unknown>>("radreply", filter),
  ]);
  return { username, tables: { radcheck, radusergroup, radreply } };
}

async function restoreImportRadiusSnapshot(snapshot: ImportRadiusSnapshot): Promise<void> {
  const filter = `username=eq.${encodeURIComponent(snapshot.username)}`;
  for (const table of ["radusergroup", "radcheck", "radreply"] as const) {
    await sbDeleteStrict(table, filter);
    const rows = snapshot.tables[table].map(({ id: _id, ...row }) => row);
    if (rows.length) await sbInsertStrict(table, rows);
  }
}

async function resetImportedRadiusBindings(username: string): Promise<void> {
  const encodedUsername = encodeURIComponent(username);
  for (const attribute of ["Framed-IP-Address", "Framed-Pool", "Framed-IP-Netmask"]) {
    await sbDeleteStrict(
      "radreply",
      `username=eq.${encodedUsername}&attribute=eq.${encodeURIComponent(attribute)}`,
    );
  }
  await sbDeleteStrict(
    "radcheck",
    `username=eq.${encodedUsername}&attribute=eq.Calling-Station-Id`,
  );
}

async function loadImportSnapshot(
  adminId: number,
  routerId: number,
): Promise<{ payload: RouterUserSnapshotPayload; capturedAt: string }> {
  const rows = await sbSelectStrict<StoredUserSnapshot>(
    "router_user_snapshots",
    `admin_id=eq.${adminId}&router_id=eq.${routerId}&select=ciphertext,iv,auth_tag,last_synced_at&limit=1`,
  );
  const row = rows[0];
  if (!row?.ciphertext || !row.iv || !row.auth_tag || !row.last_synced_at) {
    throw new ImportSnapshotNotReadyError("Sync a user backup before importing accounts.");
  }
  const payload = decodeRouterUserSnapshot({
    ciphertext: row.ciphertext,
    iv: row.iv,
    auth_tag: row.auth_tag,
  });
  if (
    payload.version !== 2
    || !Array.isArray(payload.pppProfiles)
    || !Array.isArray(payload.hotspotProfiles)
  ) {
    throw new ImportSnapshotNotReadyError("Sync a fresh user backup to include the router package profiles.");
  }
  return { payload, capturedAt: row.last_synced_at };
}

async function loadImportPreview(
  adminId: number,
  router: OwnedRouter,
  snapshot: { payload: RouterUserSnapshotPayload; capturedAt: string },
) {
  const rawNames = [
    ...snapshot.payload.pppSecrets.map(user => user.name.trim()),
    ...snapshot.payload.hotspotUsers.map(user => user.name.trim()),
  ].filter(Boolean);
  const names = [...new Set(rawNames)];
  const existingCustomers: ExistingImportCustomer[] = [];
  const existingRadiusUsernames: string[] = [];

  if (names.length) {
    for (let start = 0; start < names.length; start += 100) {
      const batch = names.slice(start, start + 100);
      const radiusFilter = postgrestCaseInsensitiveFilter(batch, ["username"]);
      const customerFilter = postgrestCaseInsensitiveFilter(batch, ["username", "pppoe_username"]);
      const [radiusChecks, radiusGroups, radiusReplies, matchingCustomers] = await Promise.all([
        sbSelectStrict<{ username: string }>("radcheck", `${radiusFilter}&select=username&limit=10000`),
        sbSelectStrict<{ username: string }>("radusergroup", `${radiusFilter}&select=username&limit=10000`),
        sbSelectStrict<{ username: string }>("radreply", `${radiusFilter}&select=username&limit=10000`),
        sbSelectStrict<Omit<ExistingImportCustomer, "passwordAvailable"> & { password: string | null }>(
          "isp_customers",
          `${customerFilter}&select=id,admin_id,type,name,phone,username,pppoe_username,router_id,updated_at,password&limit=10000`,
        ),
      ]);
      existingRadiusUsernames.push(
        ...radiusChecks.map(row => row.username),
        ...radiusGroups.map(row => row.username),
        ...radiusReplies.map(row => row.username),
      );
      existingCustomers.push(...matchingCustomers.map(({ password, ...customer }) => ({
        ...customer,
        passwordAvailable: Boolean(password),
      })));
    }
  }

  const planRows = await sbSelectStrict<ExistingImportPlan>(
    "isp_plans",
    `admin_id=eq.${adminId}&router_id=eq.${router.id}&owner_reseller_id=is.null&is_active=is.true&select=id,name,type,price,validity,validity_unit,speed_down,speed_up,speed_down_unit,speed_up_unit,shared_users,data_limit_mb,data_cap_mode,fup_speed_down,fup_speed_up&order=name.asc&limit=2000`,
  );
  const plans = planRows.filter(plan =>
    ["hotspot", "pppoe"].includes(String(plan.type).toLowerCase()),
  );
  return buildRouterImportPreview(
    snapshot.payload,
    router.id,
    router.name ?? snapshot.payload.routerName,
    snapshot.capturedAt,
    existingCustomers,
    existingRadiusUsernames,
    plans,
    adminId,
  );
}

function isIpv4Address(value: string): boolean {
  const parts = value.trim().split(".");
  return value.trim() !== "0.0.0.0" && parts.length === 4 && parts.every(part =>
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
  );
}

function sourceUserForKey(
  snapshot: RouterUserSnapshotPayload,
  key: string,
): { type: ImportedServiceType; index: number; row: Record<string, unknown> } | null {
  const match = /^(ppp|hotspot):(\d+)$/.exec(key);
  if (!match) return null;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  if (match[1] === "ppp") {
    const row = snapshot.pppSecrets[index];
    return row ? { type: "pppoe", index, row: row as unknown as Record<string, unknown> } : null;
  }
  const row = snapshot.hotspotUsers[index];
  return row ? { type: "hotspot", index, row: row as unknown as Record<string, unknown> } : null;
}

function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && !/[\r\n\0]/.test(value);
}

router.use(ROOT, requireAuth("a"));

router.get(`${ROOT}/:routerId`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const rows = await sbSelectStrict<SnapshotStatusRow>(
      "router_user_snapshots",
      `admin_id=eq.${adminId}&router_id=eq.${routerId}&select=schedule_enabled,next_sync_at,last_attempt_at,last_synced_at,last_sync_status,last_error_code,ppp_count,hotspot_count&limit=1`,
    );
    const row = rows[0];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      routerId,
      routerName: ownedRouter.name,
      snapshotAvailable: Boolean(row?.last_synced_at),
      scheduleEnabled: row?.schedule_enabled ?? false,
      nextSyncAt: row?.next_sync_at ?? null,
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastSyncedAt: row?.last_synced_at ?? null,
      status: row?.last_sync_status ?? "never",
      errorCode: row?.last_error_code ?? null,
      pppCount: row?.ppp_count ?? 0,
      hotspotCount: row?.hotspot_count ?? 0,
    });
  } catch {
    logger.warn({ adminId, routerId }, "[user-snapshots] status could not be loaded");
    res.status(500).json({ error: "User backup status could not be loaded." });
  }
});

router.patch(`${ROOT}/:routerId/schedule`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "The enabled field must be true or false." });
    return;
  }

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const rows = await sbRpc<{ schedule_enabled: boolean; next_sync_at: string | null }>(
      "set_router_user_snapshot_schedule",
      { p_admin_id: adminId, p_router_id: routerId, p_enabled: req.body.enabled },
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      scheduleEnabled: rows[0]?.schedule_enabled ?? req.body.enabled,
      nextSyncAt: rows[0]?.next_sync_at ?? null,
    });
  } catch {
    logger.warn({ adminId, routerId }, "[user-snapshots] schedule could not be updated");
    res.status(500).json({ error: "The daily refresh setting could not be saved." });
  }
});

router.post(`${ROOT}/:routerId/sync`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  let leaseToken = "";
  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }

    const claims = await sbRpc<{ lease_token: string }>("claim_router_user_snapshot", {
      p_admin_id: adminId,
      p_router_id: routerId,
      p_force: true,
    });
    leaseToken = claims[0]?.lease_token ?? "";
    if (!leaseToken) {
      res.status(409).json({ error: "A user backup is already running for this router. Try again shortly." });
      return;
    }

    const found = await getRouterCreds(routerId, adminId);
    if (!found) {
      await failRouterUserSnapshot(adminId, routerId, leaseToken, "router_unavailable");
      res.status(503).json({ error: "Router connection details are unavailable. Check the router and try again." });
      return;
    }

    const result = await syncClaimedRouterUserSnapshot(
      adminId,
      routerId,
      leaseToken,
      found.row.name ?? ownedRouter.name ?? `Router ${routerId}`,
      found.creds,
    );
    if (!result.ok) {
      res.status(result.errorCode === "snapshot_too_large" ? 413 : 502).json({
        error: result.errorCode === "snapshot_too_large"
          ? "The user backup is larger than the secure storage limit."
          : "The router could not be synced. Check its connection and try again.",
      });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      lastSyncedAt: result.capturedAt,
      pppCount: result.pppCount,
      hotspotCount: result.hotspotCount,
    });
  } catch {
    if (leaseToken) {
      await failRouterUserSnapshot(adminId, routerId, leaseToken, "sync_failed").catch(() => undefined);
    }
    logger.warn({ adminId, routerId }, "[user-snapshots] manual sync failed");
    res.status(500).json({ error: "The user backup could not be completed." });
  }
});

router.get(`${ROOT}/:routerId/import-preview`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const snapshot = await loadImportSnapshot(adminId, routerId);
    const preview = await loadImportPreview(adminId, ownedRouter, snapshot);
    res.setHeader("Cache-Control", "no-store");
    res.json(preview);
  } catch (error) {
    if (error instanceof ImportSnapshotNotReadyError) {
      res.status(409).json({ code: "snapshot_not_ready", error: error.message });
      return;
    }
    logger.warn({ adminId, routerId }, "[user-snapshots] import preview could not be loaded");
    res.status(500).json({ error: "The account import preview could not be loaded." });
  }
});

router.post(`${ROOT}/:routerId/import`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  const createdPlanIds: number[] = [];
  const createdCustomerIds: number[] = [];
  const createdRadiusUsernames: string[] = [];
  const replacedCustomerSnapshots: Array<{
    row: ImportCustomerRecord;
    appliedUpdatedAt: string;
  }> = [];
  const replacedRadiusSnapshots: ImportRadiusSnapshot[] = [];
  const replacedCustomerIds: number[] = [];
  let suspendedUsersCount = 0;
  let quotaExhaustedUsersCount = 0;
  let importStarted = false;

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const snapshot = await loadImportSnapshot(adminId, routerId);
    if (req.body?.capturedAt !== snapshot.capturedAt) {
      res.status(409).json({ error: "The router backup changed after review. Refresh the preview before importing." });
      return;
    }
    const preview = await loadImportPreview(adminId, ownedRouter, snapshot);
    const requestedUsers = req.body?.users;
    const requestedPackages = req.body?.packages;
    if (
      !Array.isArray(requestedUsers)
      || requestedUsers.length === 0
      || requestedUsers.length > 2000
      || !Array.isArray(requestedPackages)
    ) {
      res.status(400).json({ error: "Choose at least one user and review its package assignment." });
      return;
    }

    const previewUsers = new Map(preview.users.map(user => [user.key, user]));
    const selectedKeys = new Set<string>();
    const stagedUsers: Array<{
      key: string;
      name: string;
      phone: string;
      password: string;
      source: Record<string, unknown>;
      type: ImportedServiceType;
      profileKey: string;
      username: string;
      disabled: boolean;
      replaceTargetId: number | null;
      replaceTargetUpdatedAt: string | null;
      candidate: (typeof preview.users)[number];
    }> = [];

    for (const raw of requestedUsers) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ error: "The selected user list is invalid." });
        return;
      }
      const details = raw as Partial<ImportUserDetails>;
      const key = stringField(details.key, 100);
      if (!key || selectedKeys.has(key)) {
        res.status(400).json({ error: "The selected user list is invalid." });
        return;
      }
      selectedKeys.add(key);
      const candidate = previewUsers.get(key);
      const source = sourceUserForKey(snapshot.payload, key);
      if (
        !candidate
        || !source
        || !candidate.supported
        || (candidate.duplicate && !candidate.replaceable)
      ) {
        res.status(409).json({ error: "One or more selected router users are unsupported or cannot be safely replaced." });
        return;
      }
      let replaceTargetId: number | null = null;
      let replaceTargetUpdatedAt: string | null = null;
      if (candidate.replaceable) {
        const requestedTargetUpdatedAt = details.replaceTargetUpdatedAt === null
          || typeof details.replaceTargetUpdatedAt === "string"
          ? details.replaceTargetUpdatedAt ?? null
          : undefined;
        if (
          Number(details.replaceTargetId) !== candidate.existingCustomerId
          || requestedTargetUpdatedAt !== candidate.existingCustomerUpdatedAt
        ) {
          res.status(409).json({ error: "The existing account changed after review. Refresh the preview before replacing it." });
          return;
        }
        replaceTargetId = candidate.existingCustomerId;
        replaceTargetUpdatedAt = candidate.existingCustomerUpdatedAt;
      } else if (
        details.replaceTargetId !== undefined
        || details.replaceTargetUpdatedAt !== undefined
      ) {
        res.status(400).json({ error: "An account can only be replaced when the current preview marks it as safe." });
        return;
      }
      const name = stringField(details.name, 160);
      const phone = stringField(details.phone, 80);
      if (!name || !phone) {
        res.status(400).json({ error: `Enter a name and phone number for ${candidate.username}.` });
        return;
      }
      const sourcePassword = String(source.row.password ?? "");
      let password = sourcePassword;
      if (sourcePassword) {
        if (details.password !== undefined) {
          res.status(400).json({ error: "Passwords already available from the router cannot be replaced in this import." });
          return;
        }
      } else if (
        !candidate.disabled
        && !candidate.quotaReached
        && !(candidate.replaceable && candidate.passwordAvailable)
      ) {
        if (!validPassword(details.password) || details.password.length < 8) {
          res.status(400).json({ error: `Enter a password for ${candidate.username}; the router did not supply one.` });
          return;
        }
        password = details.password;
      } else {
        if (
          details.password !== undefined
          && (!validPassword(details.password) || details.password.length < 8)
        ) {
          res.status(400).json({ error: `Enter a valid password for ${candidate.username}.` });
          return;
        }
        password = details.password ?? "";
      }
      stagedUsers.push({
        key,
        name,
        phone,
        password,
        source: source.row,
        type: source.type,
        profileKey: candidate.profileKey,
        username: candidate.username,
        disabled: candidate.disabled,
        replaceTargetId,
        replaceTargetUpdatedAt,
        candidate,
      });
    }

    const requestedPackageMap = new Map<string, ImportPlanChoice>();
    for (const raw of requestedPackages) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ error: "The package assignment list is invalid." });
        return;
      }
      const choice = raw as Partial<ImportPlanChoice>;
      const profileKey = stringField(choice.profileKey, 500);
      if (!profileKey || requestedPackageMap.has(profileKey)) {
        res.status(400).json({ error: "The package assignment list is invalid." });
        return;
      }
      requestedPackageMap.set(profileKey, {
        profileKey,
        mode: choice.mode as ImportPlanChoice["mode"],
        planId: choice.planId === undefined ? undefined : Number(choice.planId),
        name: typeof choice.name === "string" ? choice.name : undefined,
        price: choice.price === undefined ? undefined : Number(choice.price),
        validityDays: choice.validityDays === undefined ? undefined : Number(choice.validityDays),
        speedDown: choice.speedDown === undefined ? undefined : Number(choice.speedDown),
        speedUp: choice.speedUp === undefined ? undefined : Number(choice.speedUp),
      });
    }

    const neededProfileKeys = [...new Set(stagedUsers.map(user => user.profileKey))];
    const profileByKey = new Map(preview.profiles.map(profile => [profile.key, profile]));
    const plansById = new Map(preview.plans.map(plan => [Number(plan.id), plan]));
    const choicesByProfile = new Map<string, ImportPlanChoice>();
    const proposedPlanNames = new Set<string>();
    for (const profileKey of neededProfileKeys) {
      const profile = profileByKey.get(profileKey);
      const choice = requestedPackageMap.get(profileKey);
      if (!profile || routerImportProfileKey(profile.type, profile.name) !== profileKey || !choice) {
        res.status(400).json({ error: "Assign a package to every selected user profile." });
        return;
      }
      if (choice.mode === "existing") {
        const plan = plansById.get(Number(choice.planId));
        if (!plan || String(plan.type).toLowerCase() !== profile.type) {
          res.status(400).json({ error: `Choose an existing ${profile.type} package for the ${profile.name} profile.` });
          return;
        }
        const profileHasRouterByteCap = stagedUsers.some(user =>
          user.profileKey === profileKey
          && user.type === "hotspot"
          && user.candidate.limitBytesTotal > 0,
        );
        if (profileHasRouterByteCap && String(plan.data_cap_mode ?? "disconnect").toLowerCase() === "throttle") {
          res.status(400).json({
            error: `The ${profile.name} profile has router-enforced byte limits. Choose a disconnect-cap package or create a new package.`,
          });
          return;
        }
        choicesByProfile.set(profileKey, choice);
        continue;
      }
      if (choice.mode !== "create") {
        res.status(400).json({ error: "Choose an existing package or create one for each profile." });
        return;
      }
      const packageName = stringField(choice.name, 100);
      const price = Number(choice.price);
      const validityDays = Number(choice.validityDays);
      const speedDown = Number(choice.speedDown);
      const speedUp = Number(choice.speedUp);
      if (
        !packageName
        || !Number.isFinite(price)
        || price < 0
        || price > 1_000_000_000
        || !Number.isInteger(validityDays)
        || validityDays < 1
        || validityDays > 3650
        || !Number.isFinite(speedDown)
        || speedDown <= 0
        || speedDown > 100_000
        || !Number.isFinite(speedUp)
        || speedUp <= 0
        || speedUp > 100_000
      ) {
        res.status(400).json({
          error: `Enter a package name, price up to 1,000,000,000, speeds up to 100,000 Mbps, and validity from 1 to 3650 days for ${profile.name}.`,
        });
        return;
      }
      const normalizedPlanName = packageName.toLocaleLowerCase("en-US");
      if (
        preview.plans.some(plan => String(plan.name).trim().toLocaleLowerCase("en-US") === normalizedPlanName)
        || proposedPlanNames.has(normalizedPlanName)
      ) {
        res.status(409).json({ error: `A package named ${packageName} already exists. Choose a different name.` });
        return;
      }
      proposedPlanNames.add(normalizedPlanName);
      choicesByProfile.set(profileKey, {
        ...choice,
        profileKey,
        mode: "create",
        name: packageName,
        price,
        validityDays,
        speedDown,
        speedUp,
      });
    }

    const existingCustomerById = new Map<number, ImportCustomerRecord>();
    const existingRadiusByUsername = new Map<string, ImportRadiusSnapshot>();
    for (const user of stagedUsers.filter(candidate => candidate.replaceTargetId !== null)) {
      const targetId = user.replaceTargetId!;
      const rows = await sbSelectStrict<ImportCustomerRecord>(
        "isp_customers",
        `id=eq.${targetId}&admin_id=eq.${adminId}&select=*&limit=1`,
      );
      const target = rows[0];
      const targetRadiusUsername = target
        ? user.type === "pppoe"
          ? target.pppoe_username || target.username
          : target.username
        : null;
      if (
        !target
        || Number(target.id) !== targetId
        || Number(target.admin_id) !== adminId
        || String(target.type).toLowerCase() !== user.type
        || (target.router_id != null && Number(target.router_id) !== routerId)
        || targetRadiusUsername !== user.username
        || (target.updated_at ?? null) !== user.replaceTargetUpdatedAt
      ) {
        throw new ImportConflictError("The existing account changed after review. Refresh the preview before replacing it.");
      }
      existingCustomerById.set(targetId, target);
      existingRadiusByUsername.set(user.username, await loadImportRadiusSnapshot(user.username));
    }

    const capturedProfileByKey = new Map(preview.profiles.map(profile => [profile.key, profile]));
    const planIdByProfile = new Map<string, number>();
    const newlyCreatedPlanByProfile = new Set<string>();
    importStarted = true;

    for (const profileKey of neededProfileKeys) {
      const profile = capturedProfileByKey.get(profileKey)!;
      const choice = choicesByProfile.get(profileKey)!;
      if (choice.mode === "existing") {
        planIdByProfile.set(profileKey, Number(choice.planId));
        continue;
      }
      const description = [
        `Imported from RouterOS profile ${profile.name} on ${snapshot.payload.routerName}.`,
        profile.rateLimit ? `RouterOS rate limit: ${profile.rateLimit}.` : "",
        profile.sessionTimeout ? `RouterOS session timeout: ${profile.sessionTimeout}.` : "",
      ].filter(Boolean).join(" ");
      const [plan] = await sbInsertStrict<{ id: number }>("isp_plans", {
        admin_id: adminId,
        owner_reseller_id: null,
        ...planWritePayload({
          name: choice.name,
          type: profile.type,
          price: choice.price,
          durationDays: choice.validityDays,
          speedDown: choice.speedDown,
          speedUp: choice.speedUp,
          speedDownUnit: "Mbps",
          speedUpUnit: "Mbps",
          sharedUsers: profile.sharedUsers ?? 1,
          dataCapMode: "disconnect",
          isActive: true,
          clientCanPurchase: false,
          description,
        }, { routerId, portId: null }, {
          activeIpPool: planServicePoolName(profile.type),
          expiredIpPool: null,
        }),
      });
      if (!plan?.id) throw new Error("Created package did not return an id.");
      createdPlanIds.push(Number(plan.id));
      await addRadiusPlan({
        planId: Number(plan.id),
        rateUp: Number(choice.speedUp),
        rateUpUnit: "Mbps",
        rateDown: Number(choice.speedDown),
        rateDownUnit: "Mbps",
      });
      const radiusPlanAttributes = await sbSelectStrict<{ attribute: string }>(
        "radgroupreply",
        `plan_id=eq.${Number(plan.id)}&select=attribute&limit=20`,
      );
      if (!["Ascend-Data-Rate", "Ascend-Xmit-Rate", "Mikrotik-Rate-Limit"]
        .every(attribute => radiusPlanAttributes.some(row => row.attribute === attribute))) {
        throw new Error("The new package could not be fully configured in RADIUS.");
      }
      planIdByProfile.set(profileKey, Number(plan.id));
      newlyCreatedPlanByProfile.add(profileKey);
    }

    const assignedPlanIds = [...new Set(planIdByProfile.values())];
    const assignedPlans = await sbSelectStrict<{
      id: number;
      name: string;
      type: string;
      shared_users: number | null;
      speed_down: number | null;
      speed_up: number | null;
      speed_down_unit: string | null;
      speed_up_unit: string | null;
      data_limit_mb: number | null;
      data_cap_mode: string | null;
    }>(
      "isp_plans",
      `admin_id=eq.${adminId}&router_id=eq.${routerId}&owner_reseller_id=is.null&is_active=is.true&id=in.(${assignedPlanIds.join(",")})&select=id,name,type,shared_users,speed_down,speed_up,speed_down_unit,speed_up_unit,data_limit_mb,data_cap_mode&limit=2000`,
    );
    const assignedPlanById = new Map(assignedPlans.map(plan => [Number(plan.id), plan]));

    for (const user of stagedUsers) {
      const source = user.source;
      const planId = planIdByProfile.get(user.profileKey);
      if (!planId) throw new Error("Package assignment was lost.");
      const assignedPlan = assignedPlanById.get(planId);
      if (!assignedPlan) throw new Error("The assigned package could not be loaded.");
      const sourceProfile = capturedProfileByKey.get(user.profileKey);
      const sourceSettings = user.type === "pppoe"
        ? snapshot.payload.pppProfiles?.find(profile => profile.name === user.candidate.profileName)
        : snapshot.payload.hotspotProfiles?.find(profile => profile.name === user.candidate.profileName);
      const dataUsedBytes = user.type === "hotspot"
        ? Math.max(0, Number(source.bytesIn ?? 0)) + Math.max(0, Number(source.bytesOut ?? 0))
        : 0;
      const safeUsedBytes = Number.isSafeInteger(dataUsedBytes) ? dataUsedBytes : null;
      const replacing = user.replaceTargetId !== null;
      const existingCustomer = replacing
        ? existingCustomerById.get(user.replaceTargetId!)
        : undefined;
      const existingRadiusSnapshot = replacing
        ? existingRadiusByUsername.get(user.username)
        : undefined;
      if (replacing && (!existingCustomer || !existingRadiusSnapshot)) {
        throw new ImportConflictError("The existing account changed after review. Refresh the preview before replacing it.");
      }
      const previousBytesValue = Number(existingCustomer?.data_used_bytes ?? 0);
      const previousMbValue = Number(existingCustomer?.data_used_mb ?? 0);
      const previousUsedBytes = Math.max(
        Number.isFinite(previousBytesValue) && previousBytesValue > 0 ? previousBytesValue : 0,
        Number.isFinite(previousMbValue) && previousMbValue > 0 ? previousMbValue * 1_000_000 : 0,
      );
      const effectiveUsedBytes = safeUsedBytes === null
        ? previousUsedBytes
        : Math.max(previousUsedBytes, safeUsedBytes);
      const safeEffectiveUsedBytes = Number.isSafeInteger(effectiveUsedBytes)
        ? effectiveUsedBytes
        : null;
      const sourceLimitBytes = Math.max(0, Number(user.candidate.limitBytesTotal) || 0);
      const planLimitMb = Number(assignedPlan.data_limit_mb ?? 0);
      const planUsesHardDataCap = String(assignedPlan.data_cap_mode ?? "disconnect").toLowerCase() !== "throttle";
      const effectiveQuotaCapBytes = sourceLimitBytes > 0
        ? sourceLimitBytes
        : planUsesHardDataCap && Number.isFinite(planLimitMb) && planLimitMb > 0
          ? planLimitMb * 1_000_000
          : 0;
      const quotaReached = user.candidate.quotaReached || Boolean(
        replacing
        && user.type === "hotspot"
        && effectiveQuotaCapBytes > 0
        && effectiveUsedBytes >= effectiveQuotaCapBytes,
      );
      const preservedExpiry = existingCustomer?.expires_at ?? null;
      const expiryPassed = Boolean(
        preservedExpiry
        && Number.isFinite(Date.parse(preservedExpiry))
        && Date.parse(preservedExpiry) <= Date.now(),
      );
      const status = user.disabled
        ? "suspended"
        : quotaReached || expiryPassed
          ? "expired"
          : replacing && existingCustomer?.status !== "active"
            ? existingCustomer!.status
            : "active";
      const accountEnabled = status === "active";
      if (status === "suspended") suspendedUsersCount += 1;
      if (quotaReached) quotaExhaustedUsersCount += 1;
      const metadata = {
        source: "mikrotik",
        source_router_id: routerId,
        source_router_name: snapshot.payload.routerName,
        source_snapshot_at: snapshot.capturedAt,
        source_user_id: String(source.id ?? "").slice(0, 160),
        source_username: user.username,
        source_service: user.candidate.sourceService,
        source_profile_name: user.candidate.profileName,
        source_profile: sourceSettings ?? null,
        source_comment: String(source.comment ?? "").slice(0, 4000),
        source_disabled: user.disabled,
        source_quota_reached: quotaReached,
        replaced_existing_account: replacing,
        local_address: String(source.localAddress ?? "").slice(0, 160),
        remote_address: String(source.remoteAddress ?? "").slice(0, 160),
        caller_id: String(source.callerId ?? "").slice(0, 160),
        mac_address: String(source.macAddress ?? "").slice(0, 80),
        hotspot_server: String(source.server ?? "").slice(0, 160),
        limit_uptime: String(source.limitUptime ?? "").slice(0, 160),
        limit_bytes_total: Number(source.limitBytesTotal ?? 0),
        bytes_in: Number(source.bytesIn ?? 0),
        bytes_out: Number(source.bytesOut ?? 0),
        imported_package_id: planId,
        imported_package_created: newlyCreatedPlanByProfile.has(user.profileKey),
        package_profile: sourceProfile,
      };
      const remoteAddress = String(source.remoteAddress ?? "");
      const macAddress = String(source.macAddress ?? "");
      const callerId = String(source.callerId ?? "").trim();
      const radiusPassword = user.password || String(existingCustomer?.password ?? "");
      const userDataLimitMb = user.type === "hotspot" && sourceLimitBytes > 0
        ? sourceLimitBytes / 1_000_000
        : Number(assignedPlan.data_limit_mb) > 0
          ? Number(assignedPlan.data_limit_mb)
          : null;
      const customerFields: Record<string, unknown> = {
        name: user.name,
        phone: user.phone,
        username: user.username,
        password: radiusPassword,
        plan_id: planId,
        type: user.type,
        ip_address: isIpv4Address(remoteAddress) ? remoteAddress : null,
        mac_address: macAddress || null,
        pppoe_username: user.type === "pppoe" ? user.username : null,
        status,
        router_id: routerId,
        router_import_data: metadata,
      };
      if (!replacing) {
        customerFields.email = null;
        customerFields.expires_at = null;
      }
      if (user.type === "hotspot") {
        customerFields.fup_limit_mb = sourceLimitBytes > 0
          ? sourceLimitBytes / 1_000_000
          : null;
        customerFields.depletion_reason = quotaReached ? "data_limit" : null;
        if (safeEffectiveUsedBytes !== null) {
          customerFields.data_used_bytes = safeEffectiveUsedBytes;
          customerFields.data_used_mb = safeEffectiveUsedBytes / 1_000_000;
        }
      }

      if (replacing) {
        const targetId = user.replaceTargetId!;
        const oldCustomer = existingCustomer!;
        const oldUpdatedAt = oldCustomer.updated_at ?? null;
        const oldUpdatedAtMs = oldUpdatedAt ? Date.parse(oldUpdatedAt) : Number.NaN;
        const updatedAt = new Date(
          Math.max(Date.now(), Number.isFinite(oldUpdatedAtMs) ? oldUpdatedAtMs + 1 : 0)
            + replacedCustomerSnapshots.length,
        ).toISOString();
        const updatedAtFilter = oldUpdatedAt === null
          ? "updated_at=is.null"
          : `updated_at=eq.${encodeURIComponent(oldUpdatedAt)}`;
        const customerSnapshot = {
          row: oldCustomer,
          appliedUpdatedAt: updatedAt,
        };
        replacedCustomerSnapshots.push(customerSnapshot);
        const [updatedCustomer] = await sbUpdateStrict<ImportCustomerRecord>(
          "isp_customers",
          `id=eq.${targetId}&admin_id=eq.${adminId}&${updatedAtFilter}`,
          { ...customerFields, updated_at: updatedAt },
        );
        if (!updatedCustomer) {
          replacedCustomerSnapshots.pop();
          throw new ImportConflictError("The existing account changed during import. Refresh the preview and try again.");
        }
        customerSnapshot.appliedUpdatedAt = updatedCustomer.updated_at ?? updatedAt;
        replacedCustomerIds.push(targetId);
        replacedRadiusSnapshots.push(existingRadiusSnapshot!);
      } else {
        const [customer] = await sbInsertStrict<{ id: number }>("isp_customers", {
          admin_id: adminId,
          ...customerFields,
          email: null,
          expires_at: null,
          fup_limit_mb: user.type === "hotspot" && sourceLimitBytes > 0
            ? sourceLimitBytes / 1_000_000
            : null,
          depletion_reason: quotaReached ? "data_limit" : null,
          data_used_bytes: user.type === "hotspot" ? safeUsedBytes : null,
          data_used_mb: user.type === "hotspot" && safeUsedBytes !== null
            ? safeUsedBytes / 1_000_000
            : null,
        });
        if (!customer?.id) throw new Error("Imported customer did not return an id.");
        createdCustomerIds.push(Number(customer.id));
      }

      if (replacing || accountEnabled) {
        if (replacing) {
          // RADIUS changes apply on the next authentication; do not disconnect the active session or edit radacct.
          await resetImportedRadiusBindings(user.username);
        } else {
          await assertRadiusTargetEmptyStrict(user.username);
          createdRadiusUsernames.push(user.username);
        }
        await syncRadiusCustomerStrict({
          username: user.username,
          password: radiusPassword,
          planId,
          planType: user.type,
          enabled: accountEnabled,
          sharedUsers: Number(assignedPlan.shared_users) || 1,
          rateDown: Number(assignedPlan.speed_down),
          rateUp: Number(assignedPlan.speed_up),
          rateDownUnit: assignedPlan.speed_down_unit ?? "Mbps",
          rateUpUnit: assignedPlan.speed_up_unit ?? "Mbps",
          dataLimitMb: userDataLimitMb,
          dataCapMode: assignedPlan.data_cap_mode === "throttle" ? "throttle" : "disconnect",
          expiresAt: replacing ? preservedExpiry ?? undefined : undefined,
        });
        if (user.type === "pppoe" && isIpv4Address(remoteAddress)) {
          await sbInsertStrict("radreply", [{
            username: user.username,
            attribute: "Framed-IP-Address",
            op: ":=",
            value: remoteAddress,
          }]);
        }
        const callingStationId = user.type === "hotspot" ? macAddress : callerId;
        if (callingStationId) {
          await sbInsertStrict("radcheck", [{
            username: user.username,
            attribute: "Calling-Station-Id",
            op: ":=",
            value: callingStationId,
          }]);
        }
      }
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      ok: true,
      importedUsers: stagedUsers.length,
      replacedUsers: replacedCustomerIds.length,
      createdPackages: createdPlanIds.length,
      suspendedUsers: suspendedUsersCount,
      quotaExhaustedUsers: quotaExhaustedUsersCount,
    });
  } catch (error) {
    if (error instanceof ImportSnapshotNotReadyError && !importStarted) {
      res.status(409).json({ code: "snapshot_not_ready", error: error.message });
      return;
    }
    if (error instanceof ImportConflictError && !importStarted) {
      res.status(409).json({ error: error.message });
      return;
    }
    const cleanupErrors: string[] = [];
    if (importStarted) {
      for (const username of createdRadiusUsernames) {
        await sbDeleteStrict("radusergroup", `username=eq.${encodeURIComponent(username)}`)
          .catch(() => cleanupErrors.push("radius_group"));
        await sbDeleteStrict("radcheck", `username=eq.${encodeURIComponent(username)}`)
          .catch(() => cleanupErrors.push("radius_check"));
        await sbDeleteStrict("radreply", `username=eq.${encodeURIComponent(username)}`)
          .catch(() => cleanupErrors.push("radius_reply"));
      }
      for (const snapshot of [...replacedRadiusSnapshots].reverse()) {
        await restoreImportRadiusSnapshot(snapshot)
          .catch(() => cleanupErrors.push("replacement_radius"));
      }
      for (const snapshot of [...replacedCustomerSnapshots].reverse()) {
        const { id, admin_id: snapshotAdminId, ...previousFields } = snapshot.row;
        try {
          const restored = await sbUpdateStrict<ImportCustomerRecord>(
            "isp_customers",
            `id=eq.${id}&admin_id=eq.${snapshotAdminId}&updated_at=eq.${encodeURIComponent(snapshot.appliedUpdatedAt)}`,
            previousFields,
          );
          if (restored.length === 0) {
            const currentRows = await sbSelectStrict<{ updated_at: string | null }>(
              "isp_customers",
              `id=eq.${id}&admin_id=eq.${snapshotAdminId}&select=updated_at&limit=1`,
            );
            const unchanged = (currentRows[0]?.updated_at ?? null) === (snapshot.row.updated_at ?? null);
            if (!unchanged) cleanupErrors.push("replacement_customer");
          }
        } catch {
          cleanupErrors.push("replacement_customer");
        }
      }
      for (const customerId of createdCustomerIds) {
        await sbDeleteStrict("isp_customers", `id=eq.${customerId}&admin_id=eq.${adminId}`)
          .catch(() => cleanupErrors.push("customer"));
      }
      for (const planId of createdPlanIds) {
        await sbDeleteStrict("radgroupreply", `groupname=eq.${encodeURIComponent(`plan_${planId}`)}`)
          .catch(() => cleanupErrors.push("radius_plan"));
        await sbDeleteStrict("isp_plans", `id=eq.${planId}&admin_id=eq.${adminId}`)
          .catch(() => cleanupErrors.push("plan"));
      }
    }
    logger.warn({
      adminId,
      routerId,
      createdCustomers: createdCustomerIds.length,
      replacedCustomers: replacedCustomerIds.length,
      createdPackages: createdPlanIds.length,
      cleanupErrors,
    }, "[user-snapshots] account import failed");
    if (error instanceof ImportConflictError && cleanupErrors.length === 0) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({
      error: cleanupErrors.length
        ? "The import failed and some cleanup could not be confirmed. Check the account records before retrying."
        : "The import failed. Changes from this attempt were rolled back.",
    });
  }
});

export default router;