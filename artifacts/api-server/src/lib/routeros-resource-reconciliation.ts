export type RouterOsResourceRow = Record<string, unknown>;

function routerBoolean(value: unknown): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

function matchesRouterValue(actual: unknown, expected: string): boolean {
  if (expected === "yes" || expected === "no") {
    const actualBoolean = routerBoolean(actual);
    if (actualBoolean !== null) return actualBoolean === (expected === "yes");
  }
  return String(actual ?? "").trim() === expected;
}

export function routerResourceSetFields(
  existing: RouterOsResourceRow,
  expected: Record<string, string>,
): string[] {
  return Object.entries(expected)
    .filter(([property, value]) => !matchesRouterValue(existing[property], value))
    .map(([property, value]) => `=${property}=${value}`);
}