import { Pool, type QueryResultRow } from "pg";
import { logger } from "./logger.js";

let pool: Pool | null = null;

function normalizeDatabaseUrl(raw: string): string {
  const schemeEnd = raw.indexOf("://");
  const userInfoStart = schemeEnd + 3;
  const passwordStart = raw.indexOf(":", userInfoStart);
  const hostStart = raw.lastIndexOf("@");
  if (schemeEnd < 0 || passwordStart < userInfoStart || hostStart < passwordStart) {
    throw new Error("The platform authentication database URL is invalid.");
  }
  const decodeSafely = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const username = encodeURIComponent(decodeSafely(raw.slice(userInfoStart, passwordStart)));
  const password = encodeURIComponent(decodeSafely(raw.slice(passwordStart + 1, hostStart)));
  const url = new URL(
    `${raw.slice(0, userInfoStart)}${username}:${password}${raw.slice(hostStart)}`,
  );
  url.searchParams.set("uselibpqcompat", "true");
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

function getPool(): Pool {
  if (pool) return pool;
  const rawUrl = process.env.SUPABASE_DB_URL?.trim()
    || process.env.SUPABASE_DATABASE_URL?.trim();
  if (!rawUrl) throw new Error("The platform authentication database connection is not configured.");

  pool = new Pool({
    connectionString: normalizeDatabaseUrl(rawUrl),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 15_000,
  });
  pool.on("error", error => {
    logger.error({ err: error }, "[platform-auth] database pool connection failed");
  });
  return pool;
}

async function queryRows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, values);
  return result.rows;
}

export interface PlatformAuthPolicyRow {
  otp_all_enabled: boolean;
  otp_whatsapp_enabled: boolean;
  otp_sms_enabled: boolean;
  otp_email_enabled: boolean;
  password_reauth: unknown;
}

export function selectPlatformAuthPolicy(): Promise<PlatformAuthPolicyRow[]> {
  return queryRows<PlatformAuthPolicyRow>(
    `SELECT otp_all_enabled, otp_whatsapp_enabled, otp_sms_enabled,
            otp_email_enabled, password_reauth
       FROM public.platform_auth_security_policy
      WHERE id = 'global'
      LIMIT 1`,
  );
}

export async function upsertPlatformAuthPolicy(input: {
  otpAllEnabled: boolean;
  otpWhatsappEnabled: boolean;
  otpSmsEnabled: boolean;
  otpEmailEnabled: boolean;
  passwordReauth: unknown;
  updatedBy: string;
}): Promise<void> {
  await queryRows(
    `INSERT INTO public.platform_auth_security_policy
       (id, otp_all_enabled, otp_whatsapp_enabled, otp_sms_enabled,
        otp_email_enabled, password_reauth, updated_by, updated_at)
     VALUES ('global', $1, $2, $3, $4, $5::jsonb, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       otp_all_enabled = EXCLUDED.otp_all_enabled,
       otp_whatsapp_enabled = EXCLUDED.otp_whatsapp_enabled,
       otp_sms_enabled = EXCLUDED.otp_sms_enabled,
       otp_email_enabled = EXCLUDED.otp_email_enabled,
       password_reauth = EXCLUDED.password_reauth,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.otpAllEnabled,
      input.otpWhatsappEnabled,
      input.otpSmsEnabled,
      input.otpEmailEnabled,
      JSON.stringify(input.passwordReauth),
      input.updatedBy,
    ],
  );
}

export interface PlatformAuthAuditInput {
  actorName: string;
  action: string;
  targetAdminId?: number | null;
  impersonationSessionId?: string | null;
  details?: Record<string, unknown>;
  sourceIp?: string | null;
  userAgent?: string | null;
}

export async function insertPlatformAuthAudit(input: PlatformAuthAuditInput): Promise<void> {
  await queryRows(
    `INSERT INTO public.platform_auth_audit
       (actor_name, action, target_admin_id, impersonation_session_id,
        details, source_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      input.actorName,
      input.action,
      input.targetAdminId ?? null,
      input.impersonationSessionId ?? null,
      JSON.stringify(input.details ?? {}),
      input.sourceIp ?? null,
      input.userAgent ?? null,
    ],
  );
}

export function selectPlatformAuthAudit(): Promise<QueryResultRow[]> {
  return queryRows(
    `SELECT id, actor_name, action, target_admin_id, impersonation_session_id,
            details, source_ip, user_agent, created_at
       FROM public.platform_auth_audit
      ORDER BY created_at DESC
      LIMIT 100`,
  );
}

export async function insertSuperAdminAccessSession(input: {
  targetAdminId: number;
  targetUsername: string;
  actorName: string;
  reason: string;
  expiresAt: string;
  sourceIp?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string } | null> {
  const rows = await queryRows<{ id: string }>(
    `INSERT INTO public.superadmin_impersonation_sessions
       (target_admin_id, target_username, actor_name, reason, expires_at, source_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.targetAdminId,
      input.targetUsername,
      input.actorName,
      input.reason,
      input.expiresAt,
      input.sourceIp ?? null,
      input.userAgent ?? null,
    ],
  );
  return rows[0] ?? null;
}

export async function getActiveSuperAdminAccessActor(
  sessionId: string,
  targetAdminId: string,
): Promise<string | null> {
  const rows = await queryRows<{ actor_name: string }>(
    `SELECT actor_name
       FROM public.superadmin_impersonation_sessions
      WHERE id = $1
        AND target_admin_id = $2
        AND ended_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [sessionId, targetAdminId],
  );
  return rows[0]?.actor_name ?? null;
}

export async function getOpenSuperAdminAccessSession(
  sessionId: string,
): Promise<{ id: string; target_admin_id: number } | null> {
  const rows = await queryRows<{ id: string; target_admin_id: number }>(
    `SELECT id, target_admin_id
       FROM public.superadmin_impersonation_sessions
      WHERE id = $1 AND ended_at IS NULL
      LIMIT 1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function endSuperAdminAccessSession(
  sessionId: string,
  endedBy: string,
): Promise<{ id: string; target_admin_id: number } | null> {
  const rows = await queryRows<{ id: string; target_admin_id: number }>(
    `UPDATE public.superadmin_impersonation_sessions
        SET ended_at = now(), ended_by = $2
      WHERE id = $1 AND ended_at IS NULL
      RETURNING id, target_admin_id`,
    [sessionId, endedBy],
  );
  return rows[0] ?? null;
}