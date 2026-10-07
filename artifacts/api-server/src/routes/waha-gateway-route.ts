import { Router, type IRouter, type Request, type Response } from "express";
import { activeSuperAdminName } from "./super-admin-auth-route.js";
import { logger } from "../lib/logger.js";
import {
  clearWahaGatewayCredentials,
  getWahaGatewaySecretStatus,
  getWahaGatewaySettings,
  normalizeWahaPhone,
  saveWahaGatewayCredentials,
  saveWahaGatewaySettings,
  validateWahaBaseUrl,
  WahaGatewayError,
  wahaGatewayService,
} from "../services/whatsapp/waha-gateway-service.js";

const router: IRouter = Router();

function gatewayReady(
  settings: Awaited<ReturnType<typeof getWahaGatewaySettings>>,
  secrets: Awaited<ReturnType<typeof getWahaGatewaySecretStatus>>,
): boolean {
  if (!settings.enabled || !secrets.apiKeyConfigured) return false;
  try {
    validateWahaBaseUrl(settings.baseUrl);
    return true;
  } catch {
    return false;
  }
}

function superAdminActor(req: Request, res: Response): string | null {
  const token = String(req.headers["x-sa-token"] ?? "");
  const actor = activeSuperAdminName(token);
  if (!actor) {
    res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
    return null;
  }
  return actor;
}

router.get("/super-admin/waha/settings", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  try {
    const [settings, secrets] = await Promise.all([
      getWahaGatewaySettings(),
      getWahaGatewaySecretStatus(),
    ]);
    res.set("Cache-Control", "no-store").json({
      ok: true,
      settings,
      secrets,
      ready: gatewayReady(settings, secrets),
    });
  } catch {
    res.status(503).json({
      ok: false,
      error: "WAHA settings are unavailable. Confirm the WAHA migration has been applied.",
    });
  }
});

router.put("/super-admin/waha/settings", async (req, res): Promise<void> => {
  const actor = superAdminActor(req, res);
  if (!actor) return;
  try {
    const settings = await saveWahaGatewaySettings(req.body?.settings);
    const secrets = await getWahaGatewaySecretStatus();
    logger.info({ actor }, "[waha] platform gateway settings updated");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      settings,
      secrets,
      ready: gatewayReady(settings, secrets),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const invalidInput = message.startsWith("Enter ") ||
      message.startsWith("Choose ") ||
      message.startsWith("Provide ") ||
      message.startsWith("That host") ||
      message.startsWith("WAHA URL");
    res.status(invalidInput ? 400 : 503).json({
      ok: false,
      error: invalidInput ? message : "WAHA settings could not be saved. Check service-role access and the migration.",
    });
  }
});

router.put("/super-admin/waha/credentials", async (req, res): Promise<void> => {
  const actor = superAdminActor(req, res);
  if (!actor) return;
  try {
    await saveWahaGatewayCredentials(req.body?.credentials);
    const [settings, secrets] = await Promise.all([
      getWahaGatewaySettings(),
      getWahaGatewaySecretStatus(),
    ]);
    logger.info({ actor }, "[waha] encrypted platform API key updated");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      secrets,
      ready: gatewayReady(settings, secrets),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const invalidInput = message.startsWith("Enter ") || message.startsWith("The WAHA API key");
    res.status(invalidInput ? 400 : 503).json({
      ok: false,
      error: invalidInput ? message : "WAHA credentials could not be saved. Check service-role access and the migration.",
    });
  }
});

router.delete("/super-admin/waha/credentials", async (req, res): Promise<void> => {
  const actor = superAdminActor(req, res);
  if (!actor) return;
  try {
    await clearWahaGatewayCredentials();
    const [settings, secrets] = await Promise.all([
      getWahaGatewaySettings(),
      getWahaGatewaySecretStatus(),
    ]);
    logger.info({ actor }, "[waha] stored gateway API key cleared");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      secrets,
      ready: gatewayReady(settings, secrets),
    });
  } catch {
    res.status(503).json({
      ok: false,
      error: "WAHA credentials could not be cleared. Check service-role access and the migration.",
    });
  }
});

router.post("/super-admin/waha/test", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  const phone = typeof req.body?.phone === "string"
    ? normalizeWahaPhone(req.body.phone)
    : null;
  if (!phone) {
    res.status(400).json({ ok: false, error: "Enter a valid recipient phone number." });
    return;
  }
  try {
    await wahaGatewayService.sendText(
      phone,
      "Your OcholaSuperNet WAHA gateway test message was sent successfully.",
      { allowWhenDisabled: true },
    );
    res.set("Cache-Control", "no-store").json({
      ok: true,
      message: "The WAHA test message was accepted.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    res.status(502).json({
      ok: false,
      error: message.startsWith("Enter a valid") || message.startsWith("WAHA text")
        ? message
        : "The WAHA test message could not be sent. Check the server URL, session, API key, and WAHA status.",
    });
  }
});

router.get("/super-admin/waha/session", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  try {
    const session = await wahaGatewayService.getSessionPairingState();
    res.set("Cache-Control", "no-store, private").set("Pragma", "no-cache").json({
      ok: true,
      session,
    });
  } catch (error) {
    res.set("Cache-Control", "no-store, private").status(502).json({
      ok: false,
      error: error instanceof WahaGatewayError
        ? error.message
        : "Could not read WAHA session status.",
    });
  }
});

router.post("/super-admin/waha/session/start", async (req, res): Promise<void> => {
  if (!superAdminActor(req, res)) return;
  try {
    const session = await wahaGatewayService.startSessionPairing();
    res.set("Cache-Control", "no-store, private").set("Pragma", "no-cache").json({
      ok: true,
      session,
    });
  } catch (error) {
    res.set("Cache-Control", "no-store, private").status(502).json({
      ok: false,
      error: error instanceof WahaGatewayError
        ? error.message
        : "Could not start WAHA session pairing.",
    });
  }
});

export default router;
