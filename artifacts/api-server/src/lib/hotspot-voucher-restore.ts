export interface HotspotVoucherRestoreLimits {
  accountedBytes: number;
  remainingBytes: number | null;
  limitBytesTotal: number;
  fupThresholdBytes: number | null;
}

function nonNegativeBytes(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Preserve the greater of RADIUS-accounted usage and the router-local counter
 * when recreating a voucher on a MikroTik. RouterOS counts from the local user
 * record, so its new limit must include existing local bytes plus only the
 * remaining entitlement.
 */
export function calculateHotspotVoucherRestoreLimits(input: {
  dataLimitBytes: number | null;
  dataCapMode: "disconnect" | "throttle";
  radiusUsedBytes: number;
  routerUsedBytes: number;
}): HotspotVoucherRestoreLimits {
  const radiusUsedBytes = nonNegativeBytes(input.radiusUsedBytes);
  const routerUsedBytes = nonNegativeBytes(input.routerUsedBytes);
  const accountedBytes = Math.max(radiusUsedBytes, routerUsedBytes);

  if (input.dataLimitBytes === null || input.dataLimitBytes <= 0) {
    return {
      accountedBytes,
      remainingBytes: null,
      limitBytesTotal: 0,
      fupThresholdBytes: null,
    };
  }

  const capBytes = nonNegativeBytes(input.dataLimitBytes);
  const remainingBytes = Math.max(0, capBytes - accountedBytes);
  const routerThreshold = Math.max(1, routerUsedBytes + remainingBytes);

  return {
    accountedBytes,
    remainingBytes,
    limitBytesTotal: input.dataCapMode === "disconnect" ? routerThreshold : 0,
    fupThresholdBytes: input.dataCapMode === "throttle" ? routerThreshold : null,
  };
}
