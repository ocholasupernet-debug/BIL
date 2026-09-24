export type PlanOwnership = {
  owner_reseller_id?: unknown;
};

export function planOwnerFilter(ownerResellerId: number | null): string {
  if (ownerResellerId === null) return "owner_reseller_id=is.null";
  if (!Number.isSafeInteger(ownerResellerId) || ownerResellerId < 1) {
    throw new Error("A valid reseller account is required to scope reseller packages.");
  }
  return `owner_reseller_id=eq.${ownerResellerId}`;
}

export function planBelongsToOwner(plan: PlanOwnership, ownerResellerId: number | null): boolean {
  const rawOwnerId = plan.owner_reseller_id;
  const planOwnerId = rawOwnerId === null || rawOwnerId === undefined || rawOwnerId === ""
    ? null
    : Number(rawOwnerId);
  return planOwnerId === ownerResellerId;
}