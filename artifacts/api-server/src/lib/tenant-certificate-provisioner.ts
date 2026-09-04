import { execFile } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { promisify } from "util";
import { sbSelectStrict } from "./supabase-client.js";

const execFileAsync = promisify(execFile);
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function certificateSyncScript(): string {
  const candidates = [
    process.env.TENANT_CERT_PROVISION_SCRIPT?.trim(),
    "/usr/local/bin/ols-provision-subdomain.sh",
    "/var/www/ocholasupernet/deploy/sync-tenant-certificates.sh",
    resolve(process.cwd(), "deploy/sync-tenant-certificates.sh"),
    resolve(process.cwd(), "../../deploy/sync-tenant-certificates.sh"),
  ].filter((value): value is string => Boolean(value));
  const script = candidates.find(candidate => existsSync(candidate));
  if (!script) {
    throw new Error("The tenant certificate synchronizer is not installed on this server.");
  }
  return script;
}

/**
 * Issue or renew the exact-host HTTPS certificate and Nginx vhost for a
 * tenant. The script is deliberately idempotent and remains the single
 * authority for certbot/Nginx changes.
 */
export async function provisionTenantCertificate(subdomain: string): Promise<void> {
  const normalized = subdomain.trim().toLowerCase();
  if (!SUBDOMAIN_PATTERN.test(normalized)) {
    throw new Error("The tenant subdomain is not valid for certificate provisioning.");
  }
  /*
   * The synchronizer reads active tenants from Supabase and updates all
   * matching Nginx vhosts. It intentionally has no positional argument; the
   * subdomain validation above prevents an invalid activation from reaching
   * the shell and also documents the caller's contract.
   */
  await execFileAsync("bash", [certificateSyncScript(), normalized], {
    timeout: 120_000,
    maxBuffer: 256 * 1024,
  });
}

/** Resolve an active tenant and provision its certificate after activation. */
export async function provisionTenantCertificateForAdmin(adminId: number): Promise<void> {
  if (!Number.isSafeInteger(adminId) || adminId <= 0) {
    throw new Error("A valid tenant id is required for certificate provisioning.");
  }
  const admins = await sbSelectStrict<{ subdomain: string | null }>(
    "isp_admins",
    `id=eq.${encodeURIComponent(String(adminId))}&is_active=is.true&status=eq.active&select=subdomain&limit=1`,
  );
  const subdomain = admins[0]?.subdomain?.trim();
  if (!subdomain) throw new Error("The activated tenant has no subdomain.");
  await provisionTenantCertificate(subdomain);
}