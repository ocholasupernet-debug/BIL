import type {
  HotspotUserProfile,
  PPPProfile,
} from "../lib/mikrotik.js";
import type { RouterUserSnapshotPayload } from "./router-user-snapshot-service.js";

export type ImportedServiceType = "hotspot" | "pppoe";

export interface ExistingImportPlan {
  id: number;
  name: string;
  type: string;
  price: number;
  validity: number;
  validity_unit: string;
  speed_down: number;
  speed_up: number;
  speed_down_unit: string;
  speed_up_unit: string;
  shared_users?: number | null;
  data_limit_mb?: number | null;
  data_cap_mode?: string | null;
  fup_speed_down?: number | null;
  fup_speed_up?: number | null;
}

export interface ExistingImportCustomer {
  id: number;
  admin_id: number;
  type: string;
  name: string;
  phone: string;
  username: string | null;
  pppoe_username: string | null;
  router_id: number | null;
  updated_at: string | null;
  passwordAvailable: boolean;
}

export interface RouterImportProfile {
  key: string;
  type: ImportedServiceType;
  name: string;
  userCount: number;
  profileAvailable: boolean;
  rateLimit: string;
  localAddress: string;
  remoteAddress: string;
  sessionTimeout: string;
  idleTimeout: string;
  keepaliveTimeout: string;
  sharedUsers: number | null;
  onlyOne: boolean | null;
  comment: string;
}

export interface RouterImportUser {
  key: string;
  type: ImportedServiceType;
  username: string;
  sourceId: string;
  profileName: string;
  profileKey: string;
  sourceService: string;
  comment: string;
  disabled: boolean;
  passwordAvailable: boolean;
  localAddress: string;
  remoteAddress: string;
  callerId: string;
  macAddress: string;
  server: string;
  limitUptime: string;
  limitBytesTotal: number;
  bytesIn: number;
  bytesOut: number;
  quotaReached: boolean;
  supported: boolean;
  reason: string | null;
  duplicate: boolean;
  replaceable: boolean;
  existingCustomerName: string | null;
  existingCustomerPhone: string | null;
  existingCustomerId: number | null;
  existingCustomerUpdatedAt: string | null;
}

export interface RouterImportPreview {
  routerId: number;
  routerName: string;
  capturedAt: string;
  users: RouterImportUser[];
  profiles: RouterImportProfile[];
  plans: ExistingImportPlan[];
}

export function routerImportProfileKey(type: ImportedServiceType, profileName: string): string {
  return JSON.stringify([type, profileName]);
}

function normalizedUsername(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function pppProfileRow(profile: PPPProfile): Omit<RouterImportProfile, "key" | "type" | "userCount" | "profileAvailable"> {
  return {
    name: profile.name,
    rateLimit: profile.rateLimit,
    localAddress: profile.localAddress,
    remoteAddress: profile.remoteAddress,
    sessionTimeout: profile.sessionTimeout,
    idleTimeout: profile.idleTimeout,
    keepaliveTimeout: "",
    sharedUsers: null,
    onlyOne: profile.onlyOne ?? null,
    comment: profile.comment,
  };
}

function hotspotProfileRow(profile: HotspotUserProfile): Omit<RouterImportProfile, "key" | "type" | "userCount" | "profileAvailable"> {
  return {
    name: profile.name,
    rateLimit: profile.rateLimit,
    localAddress: "",
    remoteAddress: "",
    sessionTimeout: profile.sessionTimeout,
    idleTimeout: profile.idleTimeout,
    keepaliveTimeout: profile.keepaliveTimeout,
    sharedUsers: profile.sharedUsers || null,
    onlyOne: null,
    comment: profile.comment,
  };
}

export function buildRouterImportPreview(
  snapshot: RouterUserSnapshotPayload,
  routerId: number,
  routerName: string,
  capturedAt: string,
  existingCustomers: ExistingImportCustomer[],
  existingRadiusUsernames: string[],
  plans: ExistingImportPlan[],
  adminId: number,
): RouterImportPreview {
  const profiles = new Map<string, RouterImportProfile>();
  const addProfile = (
    type: ImportedServiceType,
    name: string,
    details?: Omit<RouterImportProfile, "key" | "type" | "userCount" | "profileAvailable">,
  ) => {
    const safeName = name.trim() || "default";
    const key = routerImportProfileKey(type, safeName);
    const current = profiles.get(key);
    if (current) return current;
    const profile: RouterImportProfile = {
      key,
      type,
      name: safeName,
      userCount: 0,
      profileAvailable: Boolean(details),
      rateLimit: details?.rateLimit ?? "",
      localAddress: details?.localAddress ?? "",
      remoteAddress: details?.remoteAddress ?? "",
      sessionTimeout: details?.sessionTimeout ?? "",
      idleTimeout: details?.idleTimeout ?? "",
      keepaliveTimeout: details?.keepaliveTimeout ?? "",
      sharedUsers: details?.sharedUsers ?? null,
      onlyOne: details?.onlyOne ?? null,
      comment: details?.comment ?? "",
    };
    profiles.set(key, profile);
    return profile;
  };

  for (const profile of snapshot.pppProfiles ?? []) {
    addProfile("pppoe", profile.name, pppProfileRow(profile));
  }
  for (const profile of snapshot.hotspotProfiles ?? []) {
    addProfile("hotspot", profile.name, hotspotProfileRow(profile));
  }

  const rawUsers: Omit<
    RouterImportUser,
    | "duplicate"
    | "replaceable"
    | "existingCustomerName"
    | "existingCustomerPhone"
    | "existingCustomerId"
    | "existingCustomerUpdatedAt"
  >[] = [
    ...snapshot.pppSecrets.map((secret, index) => {
      const profileName = secret.profile || "default";
      const profile = addProfile("pppoe", profileName);
      profile.userCount += 1;
      const service = String(secret.service || "any").toLowerCase();
      const supported = service === "any" || service === "pppoe";
      return {
        key: `ppp:${index}`,
        type: "pppoe" as const,
        username: secret.name.trim(),
        sourceId: secret.id,
        profileName,
        profileKey: profile.key,
        sourceService: service,
        comment: secret.comment,
        disabled: secret.disabled,
        passwordAvailable: Boolean(secret.password),
        localAddress: secret.localAddress,
        remoteAddress: secret.remoteAddress,
        callerId: secret.callerId ?? "",
        macAddress: "",
        server: "",
        limitUptime: "",
        limitBytesTotal: 0,
        bytesIn: 0,
        bytesOut: 0,
        quotaReached: false,
        supported: Boolean(secret.name.trim()) && supported,
        reason: !secret.name.trim()
          ? "The router user has no username."
          : !supported
            ? `The ${service} PPP service is not supported by this import.`
            : null,
      };
    }),
    ...snapshot.hotspotUsers.map((user, index) => {
      const profileName = user.profile || "default";
      const profile = addProfile("hotspot", profileName);
      profile.userCount += 1;
      return {
        key: `hotspot:${index}`,
        type: "hotspot" as const,
        username: user.name.trim(),
        sourceId: user.id,
        profileName,
        profileKey: profile.key,
        sourceService: "hotspot",
        comment: user.comment,
        disabled: user.disabled,
        passwordAvailable: Boolean(user.password),
        localAddress: "",
        remoteAddress: "",
        callerId: "",
        macAddress: user.macAddress ?? "",
        server: user.server ?? "",
        limitUptime: user.limitUptime,
        limitBytesTotal: user.limitBytesTotal,
        bytesIn: user.bytesIn,
        bytesOut: user.bytesOut,
        quotaReached: user.limitBytesTotal > 0
          && user.bytesIn + user.bytesOut >= user.limitBytesTotal,
        supported: Boolean(user.name.trim()),
        reason: user.name.trim() ? null : "The router user has no username.",
      };
    }),
  ];

  const sourceCounts = new Map<string, number>();
  for (const user of rawUsers) {
    const normalized = normalizedUsername(user.username);
    if (normalized) sourceCounts.set(normalized, (sourceCounts.get(normalized) ?? 0) + 1);
  }
  const existingRadius = new Set(existingRadiusUsernames.map(normalizedUsername).filter(Boolean));
  const users = rawUsers.map((user): RouterImportUser => {
    const normalized = normalizedUsername(user.username);
    const sourceDuplicate = Boolean(normalized) && (sourceCounts.get(normalized) ?? 0) > 1;
    const matchingCustomers = normalized
      ? existingCustomers.filter(customer =>
        normalizedUsername(customer.username) === normalized
        || normalizedUsername(customer.pppoe_username) === normalized,
      )
      : [];
    const existingCustomer = matchingCustomers.length === 1 ? matchingCustomers[0] : null;
    const expectedRadiusUsername = existingCustomer
      ? user.type === "pppoe"
        ? existingCustomer.pppoe_username || existingCustomer.username
        : existingCustomer.username
      : null;
    const matchingRadiusUsernames = normalized
      ? existingRadiusUsernames.filter(username => normalizedUsername(username) === normalized)
      : [];
    const replaceable = Boolean(
      normalized
      && !sourceDuplicate
      && existingCustomer
      && Number(existingCustomer.admin_id) === adminId
      && String(existingCustomer.type).toLowerCase() === user.type
      && (
        existingCustomer.router_id == null
        || Number(existingCustomer.router_id) === routerId
      )
      && typeof existingCustomer.updated_at === "string"
      && Number.isFinite(Date.parse(existingCustomer.updated_at))
      && expectedRadiusUsername === user.username
      && matchingRadiusUsernames.every(username => username === user.username),
    );
    const duplicate = Boolean(normalized) && (
      sourceDuplicate
      || matchingCustomers.length > 0
      || existingRadius.has(normalized)
    );
    const reason = user.reason
      ?? (sourceDuplicate
        ? "This username appears more than once in the router backup."
        : replaceable
          ? "A matching account can be replaced in place; its live session and account history will be preserved."
          : duplicate
            ? "A matching username exists but cannot be safely replaced."
            : null);
    return {
      ...user,
      duplicate,
      replaceable,
      existingCustomerName: replaceable ? existingCustomer!.name : null,
      existingCustomerPhone: replaceable ? existingCustomer!.phone : null,
      passwordAvailable: user.passwordAvailable
        || Boolean(replaceable && existingCustomer?.passwordAvailable),
      existingCustomerId: replaceable ? Number(existingCustomer!.id) : null,
      existingCustomerUpdatedAt: replaceable ? existingCustomer!.updated_at ?? null : null,
      reason,
    };
  });

  return {
    routerId,
    routerName,
    capturedAt,
    users,
    profiles: [...profiles.values()].sort((a, b) =>
      a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    ),
    plans,
  };
}
