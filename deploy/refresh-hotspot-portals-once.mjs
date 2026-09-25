import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const markerPath = process.argv[2];
if (!markerPath) throw new Error("A one-time portal refresh marker path is required.");

const marker = JSON.parse(readFileSync(markerPath, "utf8"));
const markerId = String(marker.id ?? "");
const resellerPortId = Number(marker.resellerPortId);
const ispBridgeRouterId = Number(marker.ispBridgeRouterId);
if (!/^[a-z0-9-]{1,80}$/.test(markerId)) {
  throw new Error("The one-time portal refresh marker has an invalid ID.");
}
if (!Number.isSafeInteger(resellerPortId) || resellerPortId < 1) {
  throw new Error("The reseller port ID must be a positive integer.");
}
if (!Number.isSafeInteger(ispBridgeRouterId) || ispBridgeRouterId < 1) {
  throw new Error("The ISP bridge router ID must be a positive integer.");
}

const stateDirectory = process.env.OCHOLA_DEPLOY_STATE_DIR || "/var/lib/ocholasupernet";
const completionPath = join(stateDirectory, `portal-refresh-${markerId}.done`);
if (existsSync(completionPath)) {
  console.log("[portal-refresh] This one-time refresh already completed; skipping.");
  process.exit(0);
}

const signingSecret = process.env.TOKEN_SIGNING_SECRET || process.env.SESSION_SECRET;
if (!signingSecret) {
  throw new Error("TOKEN_SIGNING_SECRET or SESSION_SECRET is required for the one-time portal refresh.");
}

const issuedAt = Math.floor(Date.now() / 1000);
const payload = `a.3.${issuedAt}`;
const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
const token = `${payload}.${signature}`;
const apiOrigin = "https://come.isplatty.org";

async function refreshPortal(path, body, label) {
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
}

await refreshPortal(
  `/api/admin/reseller-handoffs/${resellerPortId}/portal`,
  { overwrite: true },
  "reseller VLAN",
);
await refreshPortal(
  `/api/admin/router/${ispBridgeRouterId}/hotspot-portal/bridge-deploy`,
  { bridgeName: "co-hotspot-bridge", overwrite: true },
  "ISP bridge",
);

mkdirSync(stateDirectory, { recursive: true, mode: 0o750 });
const temporaryPath = `${completionPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, JSON.stringify({
  id: markerId,
  completedAt: new Date().toISOString(),
}), { mode: 0o640 });
renameSync(temporaryPath, completionPath);
console.log("[portal-refresh] Both portal file refreshes completed and the one-time marker was recorded.");