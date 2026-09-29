export type DataCapMode = "disconnect" | "throttle";

export type FupPolicy = {
  dataCapMode: DataCapMode;
  fupSpeedDown: number | null;
  fupSpeedUp: number | null;
};

export function dataLimitMegabytesToBytes(value: unknown): number {
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    throw new Error("A positive finite data cap is required.");
  }
  const bytes = Math.floor(megabytes * 1_000_000);
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error("The data cap is outside the supported byte range.");
  }
  return bytes;
}

export function speedToMegabitsPerSecond(value: unknown, unit: unknown = "Mbps"): number {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return Number.NaN;
  const normalizedUnit = String(unit ?? "Mbps").trim().toLowerCase();
  if (normalizedUnit.startsWith("kb") || normalizedUnit.startsWith("kbit")) return speed / 1_000;
  if (normalizedUnit.startsWith("gb") || normalizedUnit.startsWith("gbit")) return speed * 1_000;
  return speed;
}

export function fupRateLimitFromMbps(speedDownMbps: unknown, speedUpMbps: unknown): string {
  const down = Number(speedDownMbps);
  const up = Number(speedUpMbps);
  if (!Number.isFinite(down) || down <= 0 || !Number.isFinite(up) || up <= 0) {
    throw new Error("Positive finite FUP speeds are required.");
  }
  const downKbps = Math.round(down * 1_000);
  const upKbps = Math.round(up * 1_000);
  if (!Number.isSafeInteger(downKbps) || downKbps < 1 || !Number.isSafeInteger(upKbps) || upKbps < 1) {
    throw new Error("FUP speeds are outside the supported range.");
  }
  return `${upKbps}k/${downKbps}k`;
}

export function validateFupPolicy(
  serviceType: unknown,
  dataLimitMb: unknown,
  mode: unknown,
  speedDown: unknown,
  speedUp: unknown,
  planSpeedDown?: unknown,
  planSpeedUp?: unknown,
  planSpeedDownUnit?: unknown,
  planSpeedUpUnit?: unknown,
): FupPolicy {
  const parsedCap = dataLimitMb === null || dataLimitMb === undefined || dataLimitMb === ""
    ? null
    : Number(dataLimitMb);
  const cap = parsedCap === 0 ? null : parsedCap;
  if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
    throw new Error("dataLimitMb must be a positive finite number or null.");
  }
  if (cap !== null && (Math.round(cap * 100) / 100 !== cap)) {
    throw new Error("dataLimitMb supports a maximum precision of two decimal places.");
  }
  if (cap !== null) dataLimitMegabytesToBytes(cap);
  const normalizedMode: DataCapMode = mode === undefined || mode === null || mode === ""
    ? "disconnect"
    : String(mode).trim().toLowerCase() as DataCapMode;
  if (normalizedMode !== "disconnect" && normalizedMode !== "throttle") {
    throw new Error("dataCapMode must be disconnect or throttle.");
  }
  const service = String(serviceType ?? "hotspot").trim().toLowerCase();
  if (normalizedMode === "throttle" && !["hotspot", "trial", "trials"].includes(service)) {
    throw new Error("Throttle mode is supported only for hotspot plans.");
  }
  if (normalizedMode === "throttle" && cap === null) {
    throw new Error("Throttle mode requires a positive data cap.");
  }
  const down = speedDown === null || speedDown === undefined || speedDown === "" ? null : Number(speedDown);
  const up = speedUp === null || speedUp === undefined || speedUp === "" ? null : Number(speedUp);
  if (normalizedMode === "throttle" && (
    down === null || up === null || !Number.isFinite(down) || down <= 0 || !Number.isFinite(up) || up <= 0
  )) {
    throw new Error("Throttle mode requires positive finite reduced download and upload speeds.");
  }
  if (normalizedMode === "throttle") {
    if (Math.round(down! * 100) / 100 !== down || Math.round(up! * 100) / 100 !== up) {
      throw new Error("FUP speeds support a maximum precision of two decimal places.");
    }
    const planDownMbps = speedToMegabitsPerSecond(planSpeedDown, planSpeedDownUnit);
    const planUpMbps = speedToMegabitsPerSecond(planSpeedUp, planSpeedUpUnit);
    if (!Number.isFinite(planDownMbps) || !Number.isFinite(planUpMbps)) {
      throw new Error("Throttle mode requires positive normal download and upload plan speeds.");
    }
    if (
      down! >= planDownMbps
      || up! >= planUpMbps
    ) {
      throw new Error("FUP speeds must be lower than the plan's normal download and upload speeds.");
    }
    fupRateLimitFromMbps(down, up);
  }
  return {
    dataCapMode: normalizedMode,
    fupSpeedDown: normalizedMode === "throttle" ? down : null,
    fupSpeedUp: normalizedMode === "throttle" ? up : null,
  };
}