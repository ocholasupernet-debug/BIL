import type { RequestHandler } from "express";
import { authenticatedAdminId } from "./api-auth.js";
import { adminHasPermission } from "./platform-permissions.js";

export function requireTenantPermission(permission: string): RequestHandler {
  return async (req, res, next): Promise<void> => {
    if (permission === "Manage Gateways" && req.authUser?.type === "a" && req.authUser.uid === "superadmin") {
      next();
      return;
    }

    const adminId = authenticatedAdminId(req);
    if (!adminId) {
      res.status(403).json({ ok: false, error: "A valid signed-in ISP Admin session is required." });
      return;
    }

    try {
      if (!(await adminHasPermission(adminId, permission))) {
        res.status(403).json({ ok: false, error: `Your role does not have the ${permission} permission.` });
        return;
      }
      next();
    } catch {
      res.status(503).json({ ok: false, error: "Permissions could not be verified. Confirm the settings migration has been applied." });
    }
  };
}