export type TransactionAccountScope = {
  id: number;
  parent_id: number | null;
  role: string;
};

/**
 * Builds the row-ownership filter from the authenticated account, never from
 * a browser-selected tenant. Reseller transactions are stored under the
 * parent ISP and tagged with reseller_id; legacy reseller-owned rows may use
 * the reseller's own admin_id.
 */
export function transactionOwnerFilter(account: TransactionAccountScope): string | null {
  if (!Number.isSafeInteger(account.id) || account.id < 1) return null;

  if (account.role === "isp_admin") {
    return `admin_id=eq.${account.id}&reseller_id=is.null`;
  }

  if (account.role === "reseller") {
    const parentId = Number(account.parent_id);
    if (!Number.isSafeInteger(parentId) || parentId < 1) return null;
    return `or=(and(admin_id.eq.${parentId},reseller_id.eq.${account.id}),and(admin_id.eq.${account.id},reseller_id.is.null))`;
  }

  return null;
}