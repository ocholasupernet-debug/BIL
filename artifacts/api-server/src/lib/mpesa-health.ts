export type MpesaStkPushStatus = "available" | "down";

export interface MpesaStkPushHealth {
  status: MpesaStkPushStatus;
  paymentGateway: string;
  checkedAt: string;
}

type StkHealthTransaction = {
  created_at: string;
  payment_metadata: unknown;
};

export function withMpesaStkPushHealth(
  paymentMetadata: unknown,
  health: MpesaStkPushHealth,
): Record<string, unknown> {
  const existing = paymentMetadata && typeof paymentMetadata === "object" && !Array.isArray(paymentMetadata)
    ? paymentMetadata as Record<string, unknown>
    : {};
  return {
    ...existing,
    stk_push_health: health,
  };
}

export function latestMpesaStkPushHealth(
  transactions: StkHealthTransaction[],
): MpesaStkPushHealth | null {
  let latest: MpesaStkPushHealth | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const transaction of transactions) {
    const metadata = transaction.payment_metadata && typeof transaction.payment_metadata === "object"
      && !Array.isArray(transaction.payment_metadata)
      ? transaction.payment_metadata as Record<string, unknown>
      : null;
    const value = metadata?.stk_push_health;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const health = value as Record<string, unknown>;
    const status = health.status;
    const paymentGateway = health.paymentGateway;
    const checkedAt = health.checkedAt;
    const timestamp = typeof checkedAt === "string" ? Date.parse(checkedAt) : Number.NaN;
    if (
      (status !== "available" && status !== "down")
      || typeof paymentGateway !== "string"
      || !paymentGateway
      || !Number.isFinite(timestamp)
      || timestamp <= latestTime
    ) continue;

    latest = { status, paymentGateway, checkedAt: new Date(timestamp).toISOString() };
    latestTime = timestamp;
  }

  return latest;
}