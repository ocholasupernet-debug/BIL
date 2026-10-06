export interface HotspotPlanDisplayValues {
  data_limit_mb?: unknown;
  data_cap_mode?: unknown;
  fup_policy?: unknown;
  fup_speed_down?: unknown;
  fup_speed_up?: unknown;
}

function formatSpeed(value: number): string {
  return value >= 1000 ? `${value / 1000} Gbps` : `${value} Mbps`;
}

export function formatHotspotDataAllowance(plan: HotspotPlanDisplayValues): string {
  const limitMb = Number(plan.data_limit_mb);
  if (!Number.isFinite(limitMb) || limitMb <= 0) return "Unlimited data";

  const amount = limitMb >= 1_000_000
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(limitMb / 1_000_000)} TB`
    : limitMb >= 1000
      ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(limitMb / 1000)} GB`
      : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(limitMb)} MB`;
  const policy = String(plan.data_cap_mode ?? plan.fup_policy ?? "").trim().toLowerCase();
  const throttleDown = Number(plan.fup_speed_down);
  if (policy === "throttle" && Number.isFinite(throttleDown) && throttleDown > 0) {
    const throttleUp = Number(plan.fup_speed_up);
    const upload = Number.isFinite(throttleUp) && throttleUp > 0
      ? ` / ${formatSpeed(throttleUp)}`
      : "";
    return `Limited · ${amount} cap · then ${formatSpeed(throttleDown)}${upload}`;
  }
  return `Limited · ${amount} cap · disconnects at the cap`;
}

export function formatHotspotSharedDevices(value: unknown): string {
  const parsed = Number(value);
  const devices = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  return devices === 1 ? "1 device" : `Up to ${devices} devices`;
}
