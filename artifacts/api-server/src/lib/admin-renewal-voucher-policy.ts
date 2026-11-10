export type RenewalVoucherState = {
  status: string;
  targetAdminId: number | null;
  expiresAt: string | null;
  maxUses: number;
  redemptionCount: number;
  redeemedInvoiceIds: number[];
};

export function renewalVoucherError(
  voucher: RenewalVoucherState,
  adminId: number,
  invoiceId: number,
  now = Date.now(),
): string | null {
  if (voucher.status !== "active") return "revoked";
  if (voucher.expiresAt && Date.parse(voucher.expiresAt) <= now) return "expired";
  if (voucher.targetAdminId !== null && voucher.targetAdminId !== adminId) return "not_for_account";
  if (voucher.redemptionCount >= voucher.maxUses) return "usage_limit";
  if (voucher.redeemedInvoiceIds.includes(invoiceId)) return "already_redeemed";
  return null;
}
