const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const BYTES_PER_UNIT = 1024;

/**
 * Formats a byte count using binary (1024-based) units.
 * Invalid or negative byte counts are represented by an em dash.
 */
export function formatBinaryBytes(value: unknown): string {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return "—";
  if (typeof value !== "number" && typeof value !== "string") return "—";

  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";

  let scaled = bytes;
  let unitIndex = 0;
  while (scaled >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    scaled /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  const formatted = unitIndex === 0
    ? (Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2))
    : scaled.toFixed(2);
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}