export interface HotspotVoucherSession {
  acctstarttime: string | null;
  acctstoptime: string | null;
  callingstationid?: string | null;
  framedipaddress?: string | null;
  acctinputoctets?: number | string | null;
  acctoutputoctets?: number | string | null;
  acctinputgigawords?: number | string | null;
  acctoutputgigawords?: number | string | null;
}

export type HotspotVoucherAccessStatus =
  | "available"
  | "expired"
  | "active"
  | "inactive"
  | "unknown";

export interface HotspotVoucherStatusSummary {
  used: boolean;
  online: boolean;
  redeemedAt: string | null;
  redeemedBy: string | null;
  expiry: string | null;
  expiryKind: "service" | "redeem_by" | null;
  serviceStatus: HotspotVoucherAccessStatus;
  dataLimitBytes: number | null;
  dataUsedBytes: number;
}

function nonNegativeNumber(value: number | string | null | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function accountedBytes(
  octets: number | string | null | undefined,
  gigawords: number | string | null | undefined,
): number {
  return nonNegativeNumber(octets) + nonNegativeNumber(gigawords) * 4_294_967_296;
}

export function summarizeHotspotVoucherStatus(input: {
  sessions: HotspotVoucherSession[];
  validityMins: number;
  redeemBy: string | null;
  redeemedAt?: string | null;
  redeemedBy?: string | null;
  serviceExpiresAt?: string | null;
  dataLimitMb: number | null;
  dataCapMode: string | null;
  now?: number;
}): HotspotVoucherStatusSummary {
  const sessions = input.sessions;
  const used = sessions.length > 0 || Boolean(input.redeemedAt);
  const now = input.now ?? Date.now();
  const redeemedSession = sessions
    .map(session => ({ session, start: Date.parse(session.acctstarttime ?? "") }))
    .filter(item => Number.isFinite(item.start))
    .sort((left, right) => left.start - right.start)[0];
  const recordedRedemption = Date.parse(input.redeemedAt ?? "");
  const redeemedAt = Number.isFinite(recordedRedemption)
    ? new Date(recordedRedemption).toISOString()
    : redeemedSession
      ? new Date(redeemedSession.start).toISOString()
      : null;
  const sessionIdentity = redeemedSession
    ? String(
        redeemedSession.session.callingstationid
        || redeemedSession.session.framedipaddress
        || "",
      ).trim()
    : "";
  const redeemedBy = sessionIdentity || String(input.redeemedBy ?? "").trim() || null;
  const validityMins = Number.isFinite(input.validityMins)
    ? Math.max(0, input.validityMins)
    : 0;
  const savedServiceExpiry = Date.parse(input.serviceExpiresAt ?? "");
  const expiry = used
    ? Number.isFinite(savedServiceExpiry)
      ? new Date(savedServiceExpiry).toISOString()
      : redeemedAt && validityMins > 0
        ? new Date(Date.parse(redeemedAt) + validityMins * 60_000).toISOString()
        : null
    : input.redeemBy;
  const expiryKind = expiry ? (used ? "service" : "redeem_by") : null;
  const dataLimitMb = Number(input.dataLimitMb);
  const dataLimitBytes = Number.isFinite(dataLimitMb) && dataLimitMb > 0
    ? Math.floor(dataLimitMb * 1_000_000)
    : null;
  const dataUsedBytes = sessions.reduce(
    (total, session) =>
      total
      + accountedBytes(session.acctinputoctets, session.acctinputgigawords)
      + accountedBytes(session.acctoutputoctets, session.acctoutputgigawords),
    0,
  );
  const online = sessions.some(session =>
    Boolean(session.acctstarttime) && session.acctstoptime == null,
  );

  let serviceStatus: HotspotVoucherAccessStatus;
  if (!used) {
    const redeemByTime = input.redeemBy ? Date.parse(input.redeemBy) : Number.NaN;
    serviceStatus = Number.isFinite(redeemByTime) && redeemByTime <= now
      ? "expired"
      : "available";
  } else if (validityMins > 0 && !redeemedAt && !Number.isFinite(savedServiceExpiry)) {
    serviceStatus = "unknown";
  } else if (expiry && Date.parse(expiry) <= now) {
    serviceStatus = "inactive";
  } else if (
    String(input.dataCapMode ?? "disconnect").toLowerCase() !== "throttle"
    && dataLimitBytes !== null
    && dataUsedBytes >= dataLimitBytes
  ) {
    serviceStatus = "inactive";
  } else {
    serviceStatus = "active";
  }

  return {
    used,
    online,
    redeemedAt,
    redeemedBy,
    expiry,
    expiryKind,
    serviceStatus,
    dataLimitBytes,
    dataUsedBytes,
  };
}
