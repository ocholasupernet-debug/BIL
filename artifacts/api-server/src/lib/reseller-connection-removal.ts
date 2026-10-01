export type ResellerConnectionRequestStatus = "pending" | "approved" | "rejected";

export type ResellerConnectionRemovalPlan =
  | { allowed: false; error: string }
  | {
      allowed: true;
      clearConnection: boolean;
      updateParent: boolean;
      nextParentId: number | null;
    };

export function planIspResellerConnectionRemoval(input: {
  status: ResellerConnectionRequestStatus;
  ispAdminId: number;
  currentParentId: number | null;
  otherApprovedIspIds: number[];
  hasNonDisabledHandoffs: boolean;
}): ResellerConnectionRemovalPlan {
  if (input.status !== "approved") {
    return {
      allowed: true,
      clearConnection: false,
      updateParent: false,
      nextParentId: input.currentParentId,
    };
  }

  if (input.hasNonDisabledHandoffs) {
    return {
      allowed: false,
      error: "Remove or safely disable this ISP's reseller handoffs before clearing the approved connection. Pending cleanup must be completed first.",
    };
  }

  const updateParent = input.currentParentId === input.ispAdminId;
  return {
    allowed: true,
    clearConnection: true,
    updateParent,
    nextParentId: updateParent
      ? input.otherApprovedIspIds.find((id) => id !== input.ispAdminId) ?? null
      : input.currentParentId,
  };
}