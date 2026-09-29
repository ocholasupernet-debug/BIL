export function preserveCumulativeUsage(
  observedBytes: number,
  storedBytes: unknown,
  storedMegabytes: unknown,
): number {
  const observed = Number.isFinite(observedBytes) ? Math.max(0, observedBytes) : 0;
  const byteValue = storedBytes === null || storedBytes === undefined || storedBytes === ""
    ? Number.NaN
    : Number(storedBytes);
  const mbValue = storedMegabytes === null || storedMegabytes === undefined || storedMegabytes === ""
    ? Number.NaN
    : Number(storedMegabytes);
  const stored = Number.isFinite(byteValue)
    ? Math.max(0, byteValue)
    : Number.isFinite(mbValue) ? Math.max(0, mbValue * 1_000_000) : 0;
  return Math.max(observed, stored);
}