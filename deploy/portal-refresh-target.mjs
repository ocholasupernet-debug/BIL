const ROUTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateExpectedRouterName(value) {
  if (typeof value !== "string" || !ROUTER_NAME_PATTERN.test(value)) {
    throw new Error("The expected router name must be an exact valid stored name.");
  }
  return value;
}

export function resolveRouterIdByExactName(routers, expectedName) {
  const name = validateExpectedRouterName(expectedName);
  if (!Array.isArray(routers)) {
    throw new Error("The tenant router list response was invalid.");
  }

  const matches = routers.filter(router =>
    router
    && router.name === name
    && Number.isSafeInteger(Number(router.id))
    && Number(router.id) > 0,
  );
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `More than one tenant router has the exact name ${name}.`
      : `No tenant router has the exact name ${name}.`);
  }
  return Number(matches[0].id);
}