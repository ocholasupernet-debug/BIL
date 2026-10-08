import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  isNoActiveHotspotServerResponse,
  resolveRouterIdByExactName,
  resolveTenantRouterTargets,
  validateExpectedRouterName,
} from "./portal-refresh-target.mjs";

const markerPath = process.argv[2];
if (!markerPath) throw new Error("A one-time portal refresh marker path is required.");

const marker = JSON.parse(readFileSync(markerPath, "utf8"));
const markerId = String(marker.id ?? "");
const parseOptionalId = value => value === undefined || value === null || value === "" ? null : Number(value);
const resellerPortId = parseOptionalId(marker.resellerPortId);
const ispBridgeRouterId = parseOptionalId(marker.ispBridgeRouterId);
const ispBridgeRouterName = marker.ispBridgeRouterName === undefined || marker.ispBridgeRouterName === null || marker.ispBridgeRouterName === ""
  ? null
  : validateExpectedRouterName(marker.ispBridgeRouterName);
const ispBridgeName = marker.ispBridgeName === undefined || marker.ispBridgeName === null || marker.ispBridgeName === ""
  ? null
  : validateExpectedRouterName(marker.ispBridgeName);
const allIspBridgeRouters = marker.allIspBridgeRouters === true;
const adminId = parseOptionalId(marker.adminId) ?? 3;
if (!/^[a-z0-9-]{1,80}$/.test(markerId)) {
  throw new Error("The one-time portal refresh marker has an invalid ID.");
}
if (!Number.isSafeInteger(adminId) || adminId < 1) {
  throw new Error("The one-time portal refresh marker must identify a valid tenant admin.");
}
if (resellerPortId !== null && (!Number.isSafeInteger(resellerPortId) || resellerPortId < 1)) {
  throw new Error("The reseller port ID must be a positive integer.");
}
if (ispBridgeRouterId !== null && (!Number.isSafeInteger(ispBridgeRouterId) || ispBridgeRouterId < 1)) {
  throw new Error("The ISP bridge router ID must be a positive integer.");
}
if (ispBridgeRouterId !== null && ispBridgeRouterName !== null) {
  throw new Error("Specify the ISP bridge target by ID or exact name, not both.");
}
if (ispBridgeName !== null && ispBridgeRouterName === null) {
  throw new Error("An explicit ISP Hotspot interface requires an exact router name.");
}
if (
  allIspBridgeRouters
  && (resellerPortId !== null || ispBridgeRouterId !== null || ispBridgeRouterName !== null || ispBridgeName !== null)
) {
  throw new Error("The all-router portal refresh cannot be combined with a single router or reseller target.");
}
if (
  resellerPortId === null
  && ispBridgeRouterId === null
  && ispBridgeRouterName === null
  && !allIspBridgeRouters
) {
  throw new Error("The one-time portal refresh marker must identify at least one target.");
}

const stateDirectory = process.env.OCHOLA_DEPLOY_STATE_DIR || "/var/lib/ocholasupernet";
const completionPath = join(stateDirectory, `portal-refresh-${markerId}.done`);
if (existsSync(completionPath)) {
  console.log("::notice title=Hotspot portal refresh::This one-time refresh already completed; skipping.");
  process.exit(0);
}

const signingSecret = process.env.TOKEN_SIGNING_SECRET || process.env.SESSION_SECRET;

try {
  if (!signingSecret) {
    throw new Error("TOKEN_SIGNING_SECRET or SESSION_SECRET is required for the one-time portal refresh.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `a.${adminId}.${issuedAt}`;
  const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
  const token = `${payload}.${signature}`;
  const apiOrigin = "https://come.isplatty.org";

  async function refreshPortal(path, body, label, { skipIfNoActiveHotspot = false } = {}) {
    const response = await fetch(`${apiOrigin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
    const text = await response.text();
    if (!response.ok) {
      if (skipIfNoActiveHotspot && response.status === 409) {
        try {
          const errorBody = JSON.parse(text);
          if (isNoActiveHotspotServerResponse(response.status, errorBody)) {
            console.log(JSON.stringify({
              label,
              ok: false,
              skipped: true,
              reason: "No active Hotspot server is configured on this router.",
            }));
            return { skipped: true };
          }
        } catch {
          // Keep the original API error below if the response body is not JSON.
        }
      }
      throw new Error(`${label} portal refresh failed (${response.status}): ${text.slice(0, 500)}`);
    }

    const result = JSON.parse(text);
    if (result.ok !== true) {
      throw new Error(`${label} portal refresh returned an unsuccessful result.`);
    }
    console.log(JSON.stringify({
      label,
      ok: result.ok,
      portId: result.portId ?? null,
      routerId: result.routerId ?? null,
      bridgeName: result.bridgeName ?? null,
      directory: result.directory ?? null,
      plans: Array.isArray(result.plans) ? result.plans.map(plan => plan.name) : [],
      deployedFiles: result.deployedFiles ?? [],
      serviceConfigurationChanged: result.serviceConfigurationChanged ?? false,
    }));
    return { skipped: false };
  }

  async function listTenantRouters() {
    const response = await fetch(`${apiOrigin}/api/routers?adminId=${encodeURIComponent(adminId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Could not read the tenant router list (${response.status}): ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  }

  async function refreshIspBridge(routerId, routerName = null) {
    const targetDescription = routerName ? `ISP bridge ${routerName}` : "ISP bridge";
    return refreshPortal(
      `/api/admin/router/${routerId}/hotspot-portal/bridge-deploy`,
      {
        ...(routerName === null
          ? { bridgeName: ispBridgeName ?? "co-hotspot-bridge" }
          : { autoSelectBridgeServer: true }),
        overwrite: true,
        portalFileReplacementConsent: true,
        ...(routerName !== null ? { expectedRouterName: routerName } : {}),
      },
      targetDescription,
      { skipIfNoActiveHotspot: routerName !== null },
    );
  }

  let selectedRouterId = ispBridgeRouterId;
  if (ispBridgeRouterName !== null) {
    const routers = await listTenantRouters();
    selectedRouterId = resolveRouterIdByExactName(routers, ispBridgeRouterName);
    console.log(JSON.stringify({
      label: "ISP bridge target",
      routerId: selectedRouterId,
      routerName: ispBridgeRouterName,
    }));
  }
  if (allIspBridgeRouters) {
    const targets = resolveTenantRouterTargets(await listTenantRouters());
    if (targets.length === 0) {
      throw new Error("No installed tenant routers were found; no portal files were changed.");
    }
    console.log(JSON.stringify({
      label: "ISP bridge targets",
      count: targets.length,
      routerNames: targets.map(router => router.name),
    }));
    const failures = [];
    const deployedRouterNames = [];
    const skippedRouterNames = [];
    for (const target of targets) {
      try {
        const result = await refreshIspBridge(target.id, target.name);
        if (result?.skipped) skippedRouterNames.push(target.name);
        else deployedRouterNames.push(target.name);
      } catch (error) {
        const detail = String(error instanceof Error ? error.message : error)
          .replace(/[\r\n]+/g, " ")
          .slice(0, 500);
        failures.push(`${target.name}: ${detail}`);
        console.log(JSON.stringify({
          label: "ISP bridge refresh failed",
          routerId: target.id,
          routerName: target.name,
          error: detail,
        }));
      }
    }
    console.log(JSON.stringify({
      label: "ISP bridge refresh summary",
      deployedCount: deployedRouterNames.length,
      deployedRouterNames,
      skippedNoHotspotCount: skippedRouterNames.length,
      skippedNoHotspotRouterNames: skippedRouterNames,
    }));
    if (deployedRouterNames.length === 0 && skippedRouterNames.length === targets.length) {
      throw new Error("No installed tenant router has an active Hotspot server; no portal files were changed.");
    }
    if (failures.length > 0) {
      throw new Error(`Portal refresh failed for ${failures.length} of ${targets.length} tenant router(s): ${failures.join(" | ")}`);
    }
  }

  if (resellerPortId !== null) {
    await refreshPortal(
      `/api/admin/reseller-handoffs/${resellerPortId}/portal`,
      { overwrite: true, portalFileReplacementConsent: true },
      "reseller VLAN",
    );
  }
  if (selectedRouterId !== null) {
    await refreshIspBridge(selectedRouterId, ispBridgeRouterName);
  }

  mkdirSync(stateDirectory, { recursive: true, mode: 0o750 });
  const temporaryPath = `${completionPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify({
    id: markerId,
    completedAt: new Date().toISOString(),
  }), { mode: 0o640 });
  renameSync(temporaryPath, completionPath);
  console.log("::notice title=Hotspot portal refresh::All targeted Hotspot portal file refreshes completed and the one-time marker was recorded.");
} catch (error) {
  const detail = String(error instanceof Error ? error.message : error).replace(/[\r\n]+/g, " ").slice(0, 700);
  console.log(`::error title=One-time Hotspot portal refresh failed::${detail}`);
  throw error;
}