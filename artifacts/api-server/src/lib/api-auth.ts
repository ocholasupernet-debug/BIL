import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { sbSelect } from "./supabase-client.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: ApiTokenPayload;
    }
  }
}

const TOKEN_SIGNING_SECRET = process.env.TOKEN_SIGNING_SECRET ?? process.env.SESSION_SECRET ?? "";
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_S = 300;
const PAYMENT_INTENT_TTL_MS = 5 * 60 * 1000;

export interface ApiTokenPayload {
  type: "a" | "c";
  uid: string;
  time: number;
}

export interface PaymentIntentPayload {
  adminId: number;
  planId: number;
  amount: number;
  phone: string;
  issuedAt: number;
  nonce: string;
}

export const apiTokenSigningConfigured = !!TOKEN_SIGNING_SECRET;

export function generateToken(type: "a" | "c", uid: string): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const time = Math.floor(Date.now() / 1000);
  const hash = createHmac("sha256", TOKEN_SIGNING_SECRET)
    .update(`${type}.${uid}.${time}`)
    .digest("hex");
  return `${type}.${uid}.${time}.${hash}`;
}

export function validateToken(token: string): ApiTokenPayload | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;

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

export function generatePaymentIntent(payload: Omit<PaymentIntentPayload, "issuedAt" | "nonce">): string {
  if (!TOKEN_SIGNING_SECRET) throw new Error("Server token signing is not configured.");
  const body: PaymentIntentPayload = {
    ...payload,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function validatePaymentIntent(token: string): PaymentIntentPayload | null {
  if (!TOKEN_SIGNING_SECRET || !token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", TOKEN_SIGNING_SECRET).update(encoded).digest("hex");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PaymentIntentPayload;
    if (!Number.isSafeInteger(payload.adminId) || !Number.isSafeInteger(payload.planId) ||
        !Number.isFinite(payload.amount) || payload.amount <= 0 ||
        !/^2547\d{8}$/.test(payload.phone) || !payload.nonce ||
        Date.now() - payload.issuedAt > PAYMENT_INTENT_TTL_MS ||
        payload.issuedAt > Date.now() + MAX_CLOCK_SKEW_S * 1000) return null;
    return payload;
  } catch {
    return null;
  }
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

    req.authUser = payload;
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
      req.authUser = payload;
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
