import type { Request } from "express";

const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_HOST_SUFFIXES = [".isplatty.org", ".isplatty.com"];

export type TurnstileResult =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: string };

function isAllowedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix) &&
    normalized.length > suffix.length &&
    /^[a-z0-9.-]+$/.test(normalized),
  ) || normalized === "isplatty.org" || normalized === "isplatty.com";
}

export async function verifyAdminTurnstile(
  req: Request,
  expectedAction: "admin_login",
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Cloudflare verification is not configured. Sign-in is unavailable.",
    };
  }

  const token = typeof req.body?.turnstileToken === "string"
    ? req.body.turnstileToken.trim()
    : "";
  if (!token || token.length > 2048) {
    return { ok: false, status: 403, error: "Complete Cloudflare verification before signing in." };
  }

  const origin = req.get("origin") ?? "";
  let originHostname = "";
  try {
    originHostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return { ok: false, status: 403, error: "Cloudflare verification could not confirm this sign-in page." };
  }
  if (!isAllowedHostname(originHostname)) {
    return { ok: false, status: 403, error: "Cloudflare verification could not confirm this sign-in page." };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    const remoteIp = req.get("CF-Connecting-IP")?.trim();
    if (remoteIp) body.set("remoteip", remoteIp);

    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Siteverify returned ${response.status}`);

    const result = await response.json() as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      result.success === true &&
      result.action === expectedAction &&
      result.hostname?.toLowerCase() === originHostname
    ) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: "Cloudflare verification failed. Complete it again and retry." };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Cloudflare verification is temporarily unavailable. Try again shortly.",
    };
  }
}
