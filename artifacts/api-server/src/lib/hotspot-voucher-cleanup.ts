export const MANAGED_LEGACY_VOUCHER_COMMENT_MARKER = " voucher · ";

export interface LocalHotspotVoucherUser {
  id: string;
  name: string;
  comment: string;
}

export function isManagedLegacyVoucherComment(comment: unknown): boolean {
  return String(comment ?? "").includes(MANAGED_LEGACY_VOUCHER_COMMENT_MARKER);
}

export function findManagedVoucherCopies<T extends LocalHotspotVoucherUser>(
  users: T[],
  voucherCodes: ReadonlySet<string>,
): T[] {
  return users.filter(user =>
    voucherCodes.has(user.name)
    && isManagedLegacyVoucherComment(user.comment),
  );
}

export function findUnmatchedManagedVoucherUsers<T extends LocalHotspotVoucherUser>(
  users: T[],
  voucherCodes: ReadonlySet<string>,
): T[] {
  return users.filter(user =>
    isManagedLegacyVoucherComment(user.comment)
    && !voucherCodes.has(user.name),
  );
}
