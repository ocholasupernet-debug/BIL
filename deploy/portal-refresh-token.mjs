import { createHmac } from "node:crypto";

export function createAdminSessionToken({ adminId, authVersion, issuedAt, signingSecret }) {
  if (!Number.isSafeInteger(adminId) || adminId < 1) {
    throw new Error("A valid tenant admin ID is required to sign the portal refresh token.");
  }
  if (!Number.isSafeInteger(authVersion) || authVersion < 1) {
    throw new Error("The current tenant auth version is required to sign the portal refresh token.");
  }
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 1) {
    throw new Error("A valid issued-at time is required to sign the portal refresh token.");
  }
  if (typeof signingSecret !== "string" || signingSecret.length === 0) {
    throw new Error("A server signing secret is required to sign the portal refresh token.");
  }

  const claims = Buffer.from(JSON.stringify({ authVersion }), "utf8").toString("base64url");
  const body = `a.${adminId}.${issuedAt}.s${claims}`;
  const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
  return `${body}.${signature}`;
}
