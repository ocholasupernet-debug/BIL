import { randomBytes } from "node:crypto";
import { ROUTER_MANAGEMENT_API_USERNAME } from "./router-management-vpn.js";

export interface RouterApiCredentialInput {
  routerName: string;
  username?: unknown;
  password?: unknown;
}

export interface RouterApiCredentialResult {
  username: string;
  password: string;
  generated: boolean;
}

/**
 * New script-installed routers receive a per-router secret automatically.
 * Existing/imported routers may still supply their current working credentials.
 */
export function resolveRouterApiCredentialsForCreate(
  input: RouterApiCredentialInput,
): RouterApiCredentialResult {
  const requestedPassword = typeof input.password === "string" ? input.password : "";
  const generated = requestedPassword.length === 0;
  const requestedUsername = typeof input.username === "string" ? input.username.trim() : "";

  return {
    username: generated
      ? ROUTER_MANAGEMENT_API_USERNAME
      : requestedUsername || input.routerName,
    password: generated ? randomBytes(32).toString("hex") : requestedPassword,
    generated,
  };
}
