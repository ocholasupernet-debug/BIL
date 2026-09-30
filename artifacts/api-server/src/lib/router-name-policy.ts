const ROUTER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export const ROUTER_NAME_MAX_LENGTH = 31;

export function routerNameBase(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug.slice(0, 27).replace(/-+$/g, "");
  if (!base) throw new Error("A tenant subdomain is required before creating a router");
  return base;
}

export function nextOrdinalRouterName(tenant: string, usedNames: Iterable<unknown>): string {
  const base = routerNameBase(tenant);
  const used = new Set([...usedNames].map(value => String(value ?? "").trim().toLowerCase()));
  for (let ordinal = 1; ordinal <= 9999; ordinal += 1) {
    const candidate = `${base}${ordinal}`;
    if (!used.has(candidate.toLowerCase()) && isSafeRouterName(candidate)) return candidate;
  }
  throw new Error(`No available router name remains for company prefix "${base}"`);
}

export function isSafeRouterName(value: unknown): value is string {
  const name = typeof value === "string" ? value.trim() : "";
  return (
    name.length > 0
    && name.length <= ROUTER_NAME_MAX_LENGTH
    && ROUTER_NAME_PATTERN.test(name)
  );
}

export function normalizeRouterName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!name) return "";
  if (!isSafeRouterName(name)) {
    throw new Error(
      `Router name must be 1-${ROUTER_NAME_MAX_LENGTH} characters using only letters, numbers, and hyphens.`,
    );
  }
  return name;
}