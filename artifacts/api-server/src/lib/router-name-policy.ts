const ROUTER_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export const ROUTER_NAME_MAX_LENGTH = 31;

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