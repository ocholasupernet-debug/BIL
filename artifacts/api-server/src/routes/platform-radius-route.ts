import { Router, type IRouter, type Request, type Response } from "express";
import { activeSuperAdminName, isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import { sbSelectStrict } from "../lib/supabase-client.js";
import { decryptRouterApiSecret } from "../lib/router-api-secret.js";
import { runRouterCommand, type RouterCredentials } from "../lib/mikrotik.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import { runVpsScript } from "../lib/vps-ssh.js";
import {
  publicPlatformRadiusSettings,
  createOrRotatePlatformRadiusSecret,
  readPlatformRadiusSettings,
  savePlatformRadiusDiscovery,
  savePlatformRadiusSettings,
} from "../lib/platform-radius.js";
import { discoverConfiguredVpsRadius } from "../lib/radius-discovery.js";
import { logger } from "../lib/logger.js";
import { recordPlatformAuthAudit } from "../lib/platform-auth-security.js";
import {
  buildManagedRadiusClientFile,
  buildRadiusClientFileProvisionScript,
  normalizeRadiusClientIp,
  type RadiusSyncResult,
} from "../lib/radius-provisioning.js";

const router: IRouter = Router();
let radiusProvisionInFlight = false;

function requireSuperAdmin(req: Request, res: Response): boolean {
  const token = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  if (isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
  return false;
}

function isInputError(message: string): boolean {
  return /^(Enter |RADIUS |Create the initial|A RADIUS secret)/.test(message);
}

interface RadiusRouterRow {
  id: number;
  admin_id: number;
  name: string;
  host: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
  api_port: number | null;
}

function selectedRouterIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("Select between 1 and 100 routers.");
  }
  const ids = [...new Set(value.map(Number))];
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("Router selection contains an invalid id.");
  }
  return ids;
}

function routerCredentials(row: RadiusRouterRow): RouterCredentials {
  const password = decryptRouterApiSecret(row.router_secret);
  if (!password) throw new Error("Router API credentials are unavailable.");
  return {
    host: String(row.host ?? row.vpn_ip ?? "").trim(),
    bridgeIp: String(row.vpn_ip ?? "").trim() || undefined,
    port: Number(row.api_port) || 8728,
    username: String(row.router_username ?? "").trim() || ROUTER_MANAGEMENT_API_USERNAME,
    alternateUsernames: [ROUTER_MANAGEMENT_API_USERNAME],
    password,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 15_000,
  };
}

function radiusEntryMatches(
  row: Record<string, string>,
  host: string,
  settings: { secret: string; authenticationPort: number; accountingPort: number },
): boolean {
  return row.address === host
    && String(row.disabled ?? "").toLowerCase() !== "true"
    && row.secret === settings.secret
    && row["authentication-port"] === String(settings.authenticationPort)
    && row["accounting-port"] === String(settings.accountingPort)
    && String(row.service ?? "").split(",").map(value => value.trim()).includes("hotspot")
    && String(row.service ?? "").split(",").map(value => value.trim()).includes("ppp");
}

async function auditSecretAction(
  req: Request,
  action: string,
  rotated: boolean,
  extraDetails: Record<string, unknown> = {},
): Promise<void> {
  const token = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  const actorName = activeSuperAdminName(token);
  if (!actorName) return;
  try {
    await recordPlatformAuthAudit({
      actorName,
      action,
      sourceIp: req.ip,
      userAgent: req.get("user-agent") ?? null,
      details: { rotated, ...extraDetails },
    });
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown", action },
      "[platform-radius] audit event could not be saved",
    );
  }
}

router.get("/super-admin/radius-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const current = await readPlatformRadiusSettings();
    res.json({
      ok: true,
      settings: publicPlatformRadiusSettings(current.settings, current.source, current.vpsDiscovery),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "RADIUS settings could not be loaded.",
    });
  }
});

router.get("/super-admin/radius-settings/routers", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const rows = await sbSelectStrict<RadiusRouterRow>(
      "isp_routers",
      "select=id,admin_id,name,host,vpn_ip,router_username,router_secret,api_port&order=name.asc&limit=1000",
    );
    res.json({
      ok: true,
      routers: rows.map(row => {
        try {
          return {
            id: Number(row.id),
            name: row.name || `Router ${row.id}`,
            vpnIp: normalizeRadiusClientIp(row.vpn_ip),
            eligible: Boolean(row.router_secret),
            reason: row.router_secret ? undefined : "Router API credentials are not saved.",
          };
        } catch (error) {
          return {
            id: Number(row.id),
            name: row.name || `Router ${row.id}`,
            vpnIp: row.vpn_ip ? String(row.vpn_ip) : null,
            eligible: false,
            reason: error instanceof Error ? error.message : "A public router address is unavailable.",
          };
        }
      }),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Router eligibility could not be loaded.",
    });
  }
});

router.post("/super-admin/radius-settings/discover", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const discovery = await discoverConfiguredVpsRadius();
    await savePlatformRadiusDiscovery(discovery);
    await auditSecretAction(req, "radius_endpoint_checked", false, {
      endpointVerified: discovery.endpointVerified,
      installed: discovery.installed,
      running: discovery.running,
    });
    const current = await readPlatformRadiusSettings();
    res.json({
      ok: true,
      settings: publicPlatformRadiusSettings(current.settings, current.source, discovery),
    });
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-radius] configured VPS discovery failed",
    );
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Configured VPS RADIUS check failed.",
    });
  }
});

router.post("/super-admin/radius-settings/provision", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.body?.confirm !== true) {
    res.status(400).json({ ok: false, error: "Confirm provisioning for the selected routers." });
    return;
  }
  let ids: number[];
  try {
    ids = selectedRouterIds(req.body?.routerIds);
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid router selection." });
    return;
  }
  const replaceManaged = req.body?.replaceManaged === true;
  if (radiusProvisionInFlight) {
    res.status(409).json({ ok: false, error: "Another RADIUS provisioning attempt is already running." });
    return;
  }
  radiusProvisionInFlight = true;
  try {
    const current = await readPlatformRadiusSettings();
    const discovery = current.vpsDiscovery;
    if (!current.settings.secret || !discovery?.endpointVerified || !discovery.configRoot) {
      res.status(409).json({ ok: false, error: "Verify a running FreeRADIUS service and create a shared secret before provisioning." });
      return;
    }
    const routers = await sbSelectStrict<RadiusRouterRow>(
      "isp_routers",
      `id=in.(${ids.join(",")})&select=id,admin_id,name,host,vpn_ip,router_username,router_secret,api_port&limit=100`,
    );
    const byId = new Map(routers.map(row => [Number(row.id), row]));
    if (ids.some(id => !byId.has(id))) {
      res.status(404).json({ ok: false, error: "One or more selected router records no longer exist." });
      return;
    }
    const pending: Array<{
      row: RadiusRouterRow;
      vpnIp: string;
      operation: "add" | "replace" | "none";
    }> = [];
    const results: RadiusSyncResult[] = [];
    for (const id of ids) {
      const row = byId.get(id)!;
      let vpnIp: string;
      try {
        vpnIp = normalizeRadiusClientIp(row.vpn_ip);
        if (!row.router_secret) throw new Error("Router API credentials are not saved.");
        const entries = await runRouterCommand(routerCredentials(row), [
          "/radius/print",
          "=.proplist=.id,address,service,authentication-port,accounting-port,disabled,comment,secret",
        ]);
        const matchingAddress = entries.filter(entry => entry.address === discovery.radiusHost);
        const exact = matchingAddress.find(entry => radiusEntryMatches(entry, discovery.radiusHost!, {
          secret: current.settings.secret,
          authenticationPort: discovery.authenticationPort!,
          accountingPort: discovery.accountingPort!,
        }));
        if (exact) {
          pending.push({ row, vpnIp, operation: "none" });
          results.push({ routerId: id, status: "already-synced", vpnIp });
          continue;
        }
        if (matchingAddress.length > 0) {
          const managedComment = `OcholaSuperNet Managed RADIUS router-id=${id}`;
          const managed = matchingAddress.find(entry => entry.comment === managedComment);
          if (!replaceManaged || !managed?.[".id"]) {
            results.push({
              routerId: id,
              status: "conflict",
              vpnIp,
              error: "An existing RADIUS entry differs; it was not overwritten.",
            });
            continue;
          }
          pending.push({ row, vpnIp, operation: "replace" });
        } else {
          pending.push({ row, vpnIp, operation: "add" });
        }
      } catch (error) {
        results.push({
          routerId: id,
          status: "failed",
          vpnIp: String(row.vpn_ip ?? ""),
          error: error instanceof Error ? error.message : "Router check failed.",
        });
      }
    }

    const provisioned: typeof pending = [];
    for (const item of pending) {
      try {
        const content = buildManagedRadiusClientFile(
          { routerId: Number(item.row.id), vpnIp: item.vpnIp },
          current.settings.secret,
        );
        const script = buildRadiusClientFileProvisionScript({
          routerId: Number(item.row.id),
          content,
          replaceManaged,
          configRoot: discovery.configRoot,
        });
        const remote = await runVpsScript(script, { timeoutMs: 30_000 });
        const status = remote.stdout.match(/^status=(added|already_synced)$/m)?.[1];
        if (!remote.ok || !status) {
          const remoteError = remote.stdout.match(/^error=([a-z_]+)$/m)?.[1];
          results.push({
            routerId: Number(item.row.id),
            status: remoteError === "managed_file_conflict" ? "conflict" : "failed",
            vpnIp: item.vpnIp,
            error: remoteError === "radius_config_missing"
              ? "The FreeRADIUS main configuration file is unavailable."
              : remoteError === "managed_file_conflict"
                ? "A pre-existing client file differs and was not overwritten."
                : "FreeRADIUS client provisioning failed; server output was withheld.",
          });
          continue;
        }
        provisioned.push(item);
      } catch {
        results.push({
          routerId: Number(item.row.id),
          status: "failed",
          vpnIp: item.vpnIp,
          error: "FreeRADIUS client provisioning failed.",
        });
      }
    }

    for (const item of provisioned) {
      if (item.operation === "none") continue;
      const rowId = Number(item.row.id);
      const credentials = routerCredentials(item.row);
      const comment = `OcholaSuperNet Managed RADIUS router-id=${rowId}`;
      try {
        if (item.operation === "add") {
          await runRouterCommand(credentials, [
            "/radius/add",
            "=service=hotspot,ppp",
            `=address=${discovery.radiusHost}`,
            `=secret=${current.settings.secret}`,
            `=authentication-port=${discovery.authenticationPort}`,
            `=accounting-port=${discovery.accountingPort}`,
            `=comment=${comment}`,
          ]);
          results.push({ routerId: rowId, status: "added", vpnIp: item.vpnIp });
        } else {
          const rows = await runRouterCommand(credentials, [
            "/radius/print",
            "=.proplist=.id,address,comment",
            `?address=${discovery.radiusHost}`,
          ]);
          const managed = rows.find(candidate => candidate.comment === comment && candidate[".id"]);
          if (!managed) throw new Error("Managed RADIUS entry changed after preflight.");
          await runRouterCommand(credentials, [
            "/radius/set",
            `=.id=${managed[".id"]}`,
            `=secret=${current.settings.secret}`,
            `=authentication-port=${discovery.authenticationPort}`,
            `=accounting-port=${discovery.accountingPort}`,
          ]);
          results.push({ routerId: rowId, status: "added", vpnIp: item.vpnIp });
        }
      } catch {
        results.push({
          routerId: rowId,
          status: "failed",
          vpnIp: item.vpnIp,
          error: "MikroTik RADIUS synchronization failed; existing entries were not removed.",
        });
      }
    }

    const allSynced = results.length === ids.length
      && results.every(result => result.status === "added" || result.status === "already-synced");
    const checkedAt = new Date().toISOString();
    const routerSync = new Map(
      (discovery.routerSync ?? []).map(result => [result.routerId, result]),
    );
    for (const result of results) routerSync.set(result.routerId, { ...result, checkedAt });
    await savePlatformRadiusDiscovery({
      ...discovery,
      secretSynchronized: allSynced,
      checkedAt,
      routerSync: [...routerSync.values()],
      ...(allSynced ? { error: undefined } : {}),
    });
    await auditSecretAction(req, "radius_clients_provisioned", false, {
      routerIds: ids,
      synchronizedCount: results.filter(result => result.status === "added" || result.status === "already-synced").length,
      conflictCount: results.filter(result => result.status === "conflict").length,
    });
    const updated = await readPlatformRadiusSettings();
    res.status(allSynced ? 200 : 207).json({
      ok: allSynced,
      results,
      settings: publicPlatformRadiusSettings(updated.settings, updated.source, updated.vpsDiscovery),
    });
  } catch (error) {
    logger.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "[platform-radius] selected router provisioning failed",
    );
    res.status(503).json({ ok: false, error: "Selected RADIUS clients could not be provisioned." });
  } finally {
    radiusProvisionInFlight = false;
  }
});

router.post("/super-admin/radius-settings/secret", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const secret = await createOrRotatePlatformRadiusSecret(false);
    await auditSecretAction(req, "radius_secret_created", false);
    res.json({ ok: true, secret, shownOnce: true, requiresProvisioning: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RADIUS secret could not be created.";
    res.status(isInputError(message) ? 409 : 503).json({ ok: false, error: message });
  }
});

router.post("/super-admin/radius-settings/secret/rotate", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.body?.confirm !== true) {
    res.status(400).json({ ok: false, error: "Explicit confirmation is required to rotate the shared secret." });
    return;
  }
  try {
    const secret = await createOrRotatePlatformRadiusSecret(true);
    await auditSecretAction(req, "radius_secret_rotated", true);
    res.json({ ok: true, secret, shownOnce: true, requiresProvisioning: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RADIUS secret could not be rotated.";
    res.status(isInputError(message) ? 409 : 503).json({ ok: false, error: message });
  }
});

router.put("/super-admin/radius-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const settings = await savePlatformRadiusSettings(req.body);
    res.setHeader("Cache-Control", "no-store");
    const current = await readPlatformRadiusSettings();
    await auditSecretAction(req, "radius_settings_saved", false, { enabled: settings.enabled });
    res.json({
      ok: true,
      settings: publicPlatformRadiusSettings(settings, "database", current.vpsDiscovery),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RADIUS settings could not be saved.";
    res.status(isInputError(message) ? 400 : 503).json({ ok: false, error: message });
  }
});

export default router;
