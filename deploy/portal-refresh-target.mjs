const ROUTER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NO_ACTIVE_HOTSPOT_SERVER_ERROR = "No active Hotspot server is available for automatic selection; no files were changed.";

export function validateExpectedRouterName(value) {
  if (typeof value !== "string" || !ROUTER_NAME_PATTERN.test(value)) {
    throw new Error("The expected router name must be an exact valid stored name.");
  }
  return value;
}

export function resolveTenantApiOrigin(subdomain) {
  const normalized = typeof subdomain === "string" ? subdomain.trim().toLowerCase() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    throw new Error("The portal refresh marker must include an exact valid tenant subdomain.");
  }
  return `https://${normalized}.isplatty.org`;
}

export function resolvePortalBridgeSelection(routerName = null, bridgeName = null) {
  const expectedRouterName = routerName === null ? null : validateExpectedRouterName(routerName);
  const selectedBridgeName = bridgeName === null ? null : validateExpectedRouterName(bridgeName);

  if (selectedBridgeName !== null) {
    return {
      bridgeName: selectedBridgeName,
      ...(expectedRouterName !== null ? { expectedRouterName } : {}),
    };
  }
  if (expectedRouterName !== null) {
    return { autoSelectBridgeServer: true, expectedRouterName };
  }
  return { bridgeName: "co-hotspot-bridge" };
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

export function resolveTenantRouterTargets(routers) {
  if (!Array.isArray(routers)) {
    throw new Error("The tenant router list response was invalid.");
  }

  const seenIds = new Set();
  const seenNames = new Set();
  const targets = routers.map(router => {
    const rawId = router?.id;
    const validIdType = typeof rawId === "number"
      || (typeof rawId === "string" && /^\d+$/.test(rawId));
    const id = validIdType ? Number(rawId) : Number.NaN;
    if (!router || !Number.isSafeInteger(id) || id < 1) {
      throw new Error("The tenant router list contains an invalid router ID.");
    }

    const name = validateExpectedRouterName(router.name);
    if (seenIds.has(id) || seenNames.has(name)) {
      throw new Error("The tenant router list contains duplicate router IDs or names.");
    }
    seenIds.add(id);
    seenNames.add(name);
    return { id, name };
  });

  return targets.sort((left, right) => left.name.localeCompare(right.name));
}

export function isNoActiveHotspotServerResponse(status, body) {
  return status === 409
    && body?.error === NO_ACTIVE_HOTSPOT_SERVER_ERROR
    && Array.isArray(body.availableHotspotServers)
    && body.availableHotspotServers.length === 0;
}