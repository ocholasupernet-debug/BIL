import { createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { sbSelect } from "./supabase-client.js";

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET
  ?? process.env.SUPERADMIN_API_KEY
  ?? "change-me-in-production";
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_S = 300;

export interface ApiTokenPayload {
  type: "a" | "c";
  uid: string;
  time: number;
}

export function generateToken(type: "a" | "c", uid: string): string {
  const time = Math.floor(Date.now() / 1000);
  const hash = createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update(`${type}.${uid}.${time}`)
    .digest("hex");
  return `${type}.${uid}.${time}.${hash}`;
}

export function validateToken(token: string): ApiTokenPayload | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [type, uid, timeStr, hash] = parts;
  if (type !== "a" && type !== "c") return null;

  const time = parseInt(timeStr, 10);
  if (isNaN(time)) return null;

  const nowS = Math.floor(Date.now() / 1000);
  if (time > nowS + MAX_CLOCK_SKEW_S) return null;

  if (time !== 0) {
    const ageMs = (nowS - time) * 1000;
    if (ageMs > TOKEN_TTL_MS) return null;
  }

  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update(`${type}.${uid}.${time}`)
    .digest("hex");
  if (hash !== expected) return null;

  return { type: type as "a" | "c", uid, time };
}

export function extractToken(req: Request): string {
  const authHeader = req.headers.authorization ?? "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const tokenParam = req.query.token ?? req.headers["x-api-token"] ?? req.headers["x-sa-token"];
  return typeof tokenParam === "string" ? tokenParam.trim() : "";
}

export function requireAuth(requiredType?: "a" | "c") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    const payload = validateToken(token);

    if (!payload) {
      res.status(401).json({ ok: false, error: "Invalid or expired token" });
      return;
    }

    if (requiredType && payload.type !== requiredType) {
      res.status(403).json({ ok: false, error: "Insufficient permissions" });
      return;
    }

    (req as Record<string, unknown>).authUser = payload;
    next();
  };
}

export function requireAdmin() {
  return requireAuth("a");
}

export function requireCustomer() {
  return requireAuth("c");
}

export function optionalAuth() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    const payload = validateToken(token);
    if (payload) {
      (req as Record<string, unknown>).authUser = payload;
    }
    next();
  };
}

export async function lookupAdmin(uid: string): Promise<Record<string, unknown> | null> {
  if (uid === "superadmin") {
    return {
      id: 0,
      username: process.env.SUPERADMIN_USERNAME ?? "Latty",
      role: "superadmin",
    };
  }
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `id=eq.${encodeURIComponent(uid)}&select=id,username,fullname,email,role&limit=1`,
  );
  return rows[0] ?? null;
}

export async function lookupCustomer(uid: string): Promise<Record<string, unknown> | null> {
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `id=eq.${encodeURIComponent(uid)}&select=id,username,fullname,email,phone,status,plan_name,wallet_balance&limit=1`,
  );
  return rows[0] ?? null;
}
