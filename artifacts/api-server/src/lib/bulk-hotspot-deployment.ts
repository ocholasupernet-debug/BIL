export type BulkDeployMode = "install" | "replace";

export function parseBulkDeployMode(value: unknown): BulkDeployMode | null {
  const mode = String(value ?? "install").trim().toLowerCase();
  return mode === "install" || mode === "replace" ? mode : null;
}

export function isBulkReplacementScopeAllowed(
  mode: BulkDeployMode,
  scope: string,
): boolean {
  return mode !== "replace" || scope === "hotspot";
}

export function isApprovedHotspotAssetDestination(destinationPath: string): boolean {
  const normalised = destinationPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  const pathParts = normalised.split("/");
  return normalised.toLowerCase().startsWith("flash/hotspot/")
    && pathParts.length > 2
    && pathParts.every(part => part.length > 0 && part !== "." && part !== "..");
}