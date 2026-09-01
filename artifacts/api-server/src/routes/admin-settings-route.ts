import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin, authenticatedAdminId } from "../lib/api-auth.js";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  type MessageChannel,
  type MessageTemplate,
  toMessageTemplate,
} from "../lib/message-templates.js";
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  ROLE_NAMES,
  adminHasPermission,
  roleLabel,
  type PermissionRow,
} from "../lib/platform-permissions.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
  sbUpsertStrict,
} from "../lib/supabase-client.js";
import { activeSuperAdminName, isActiveSuperAdminToken } from "./super-admin-auth-route.js";

const router: IRouter = Router();
const CHANNELS = new Set<MessageChannel>(["sms", "whatsapp", "email", "telegram"]);
const BACKUP_DIR = process.env.BACKUP_DIR?.trim() || join(tmpdir(), "ochola-supernet-backups");

interface TemplateRow {
  template_key: string;
  name: string;
  event: string;
  channels: unknown;
  subject: string | null;
  body: string;
  enabled: boolean;
  updated_at: string;
}

interface BackupRow {
  id: number;
  name: string;
  backup_type: "auto" | "manual";
  status: "running" | "completed" | "failed" | "unavailable";
  artifact_name: string | null;
  artifact_size: number | string | null;
  artifact_sha256: string | null;
  failure_reason: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

function requireSuperAdmin(req: Request, res: Response): string | null {
  const token = String(req.headers["x-sa-token"] ?? "");
  const name = activeSuperAdminName(token);
  if (!name) {
    res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
    return null;
  }
  return name;
}

function requireTenantPermission(permission: string) {
  return async (req: Request, res: Response, next: () => void): Promise<void> => {
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

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseTemplate(input: unknown): Omit<TemplateRow, "updated_at"> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const channels = Array.isArray(value.channels)
    ? value.channels.filter((channel): channel is MessageChannel => typeof channel === "string" && CHANNELS.has(channel as MessageChannel))
    : [];
  if (!validText(value.id, 40) || !validText(value.name, 120) || !validText(value.event, 80) ||
      !validText(value.body, 5000) || channels.length === 0 || typeof value.enabled !== "boolean" ||
      (value.subject !== undefined && value.subject !== null && typeof value.subject !== "string")) return null;
  if (!DEFAULT_MESSAGE_TEMPLATES.some(template => template.id === value.id && template.event === value.event)) return null;
  return {
    template_key: value.id.trim(),
    name: value.name.trim(),
    event: value.event.trim(),
    channels: [...new Set(channels)],
    subject: typeof value.subject === "string" && value.subject.trim() ? value.subject.trim().slice(0, 300) : null,
    body: value.body,
    enabled: value.enabled,
  };
}

function publicTemplate(row: TemplateRow | Omit<TemplateRow, "updated_at">): MessageTemplate {
  return toMessageTemplate(row as TemplateRow);
}

router.get("/admin/message-templates", requireAdmin(), requireTenantPermission("View Settings"), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req);
  try {
    const rows = await sbSelectStrict<TemplateRow>(
      "isp_message_templates",
      `admin_id=eq.${adminId}&select=template_key,name,event,channels,subject,body,enabled,updated_at&order=template_key.asc`,
    );
    const byKey = new Map(rows.map(row => [row.template_key, publicTemplate(row)]));
    const templates = DEFAULT_MESSAGE_TEMPLATES.map(template => byKey.get(template.id) ?? template);
    res.set("Cache-Control", "no-store").json({ ok: true, templates });
  } catch {
    res.status(503).json({ ok: false, error: "Message templates could not be loaded. Confirm the settings migration has been applied." });
  }
});

router.put("/admin/message-templates/:templateKey", requireAdmin(), requireTenantPermission("Edit Settings"), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req);
  const input = { ...(req.body ?? {}), id: req.params.templateKey };
  const template = parseTemplate(input);
  if (!template) {
    res.status(400).json({ ok: false, error: "Provide a valid template name, event, body, channel, and enabled state." });
    return;
  }
  try {
    const saved = await sbUpsertStrict<TemplateRow>("isp_message_templates", "admin_id,template_key", {
      admin_id: adminId,
      ...template,
      updated_at: new Date().toISOString(),
    });
    if (!saved[0]) throw new Error("No template was returned after save.");
    res.set("Cache-Control", "no-store").json({ ok: true, template: publicTemplate(saved[0]) });
  } catch {
    res.status(503).json({ ok: false, error: "Message template could not be saved. Confirm the settings migration has been applied." });
  }
});

router.get("/super-admin/roles", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const rows = await sbSelectStrict<PermissionRow>(
      "platform_role_permissions",
      `role_name=in.(${ROLE_NAMES.join(",")})&permission_key=in.(${ALL_PERMISSIONS.map(encodeURIComponent).join(",")})&select=role_name,permission_key,enabled,updated_at`,
    );
    const matrix: Record<string, Record<string, boolean>> = {};
    for (const role of ROLE_NAMES) {
      matrix[role] = Object.fromEntries(ALL_PERMISSIONS.map(permission => [
        permission,
        role === "super_admin" || rows.find(row => row.role_name === role && row.permission_key === permission)?.enabled === true,
      ]));
    }
    res.set("Cache-Control", "no-store").json({
      ok: true,
      roles: ROLE_NAMES.map(role => ({ key: role, label: roleLabel(role) })),
      catalog: PERMISSION_CATALOG,
      matrix,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Roles and permissions could not be loaded. Confirm the settings migration has been applied." });
  }
});

router.put("/super-admin/roles", async (req, res): Promise<void> => {
  const actor = requireSuperAdmin(req, res);
  if (!actor) return;
  const input = req.body?.matrix;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ ok: false, error: "A permission matrix is required." });
    return;
  }
  for (const role of ROLE_NAMES) {
    if (role === "super_admin") continue;
    const values = input[role];
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      res.status(400).json({ ok: false, error: `Permissions for ${roleLabel(role)} are required.` });
      return;
    }
    for (const permission of ALL_PERMISSIONS) {
      if (typeof values[permission] !== "boolean") {
        res.status(400).json({ ok: false, error: `Permission ${permission} for ${roleLabel(role)} must be true or false.` });
        return;
      }
    }
  }
  try {
    for (const role of ROLE_NAMES.filter(value => value !== "super_admin")) {
      await Promise.all(ALL_PERMISSIONS.map(permission => sbUpsertStrict(
        "platform_role_permissions",
        "role_name,permission_key",
        { role_name: role, permission_key: permission, enabled: input[role][permission], updated_by: actor, updated_at: new Date().toISOString() },
      )));
    }
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, error: "Roles and permissions could not be saved. Confirm the settings migration has been applied." });
  }
});

function backupPublic(row: BackupRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.backup_type,
    status: row.status,
    size: row.artifact_size == null ? null : Number(row.artifact_size),
    artifactName: row.artifact_name,
    sha256: row.artifact_sha256,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runPgDump(filePath: string): Promise<{ ok: boolean; reason?: string }> {
  const rawUrl = process.env.SUPABASE_DB_URL?.trim() || process.env.SUPABASE_DATABASE_URL?.trim();
  if (!rawUrl) return Promise.resolve({ ok: false, reason: "Database backup is unavailable because SUPABASE_DB_URL is not configured." });
  let serviceFile = "";
  try {
    const parsed = new URL(rawUrl);
    serviceFile = join(tmpdir(), `.ochola-pg-service-${process.pid}-${Date.now()}.conf`);
    const config = [
      "[ochola_backup]",
      `host=${parsed.hostname}`,
      `port=${parsed.port || "5432"}`,
      `user=${decodeURIComponent(parsed.username)}`,
      `password=${decodeURIComponent(parsed.password)}`,
      `dbname=${decodeURIComponent(parsed.pathname.replace(/^\/+/, ""))}`,
      "sslmode=require",
      "",
    ].join("\n");
    return (async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(serviceFile, config, { mode: 0o600 });
      return new Promise<{ ok: boolean; reason?: string }>(resolve => {
        const child = spawn("pg_dump", ["--service=ochola_backup", "--format=custom", "--no-owner", "--no-privileges", "--file", filePath], {
          env: { ...process.env, PGSERVICEFILE: serviceFile },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({ ok: false, reason: "Database backup timed out before it completed." });
        }, 10 * 60 * 1000);
        child.stderr.on("data", chunk => { stderr += String(chunk); });
        child.on("error", error => {
          clearTimeout(timer);
          resolve({ ok: false, reason: error.message.includes("ENOENT") ? "Database backup is unavailable because pg_dump is not installed on this server." : "Database backup could not be started." });
        });
        child.on("exit", code => {
          clearTimeout(timer);
          resolve(code === 0 ? { ok: true } : { ok: false, reason: stderr ? "Database backup failed. Check the server backup logs for details." : `Database backup failed with exit code ${code ?? "unknown"}.` });
        });
      }).finally(() => rm(serviceFile, { force: true }).catch(() => undefined));
    })();
  } catch {
    return Promise.resolve({ ok: false, reason: "Database backup is unavailable because the database connection configuration is invalid." });
  }
}

async function executeBackup(row: BackupRow): Promise<void> {
  const artifactName = `${row.id}-${basename(row.name).replace(/[^a-zA-Z0-9._-]/g, "-")}.dump`;
  const artifactPath = join(BACKUP_DIR, artifactName);
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    const result = await runPgDump(artifactPath);
    if (!result.ok) {
      await sbUpdateStrict("platform_backup_jobs", `id=eq.${row.id}`, { status: result.reason?.includes("unavailable") ? "unavailable" : "failed", failure_reason: result.reason, completed_at: new Date().toISOString() });
      return;
    }
    const info = await stat(artifactPath);
    const checksum = await sha256File(artifactPath);
    await sbUpdateStrict("platform_backup_jobs", `id=eq.${row.id}`, {
      status: "completed",
      artifact_name: artifactName,
      artifact_size: info.size,
      artifact_sha256: checksum,
      completed_at: new Date().toISOString(),
    });
  } catch {
    await rm(artifactPath, { force: true }).catch(() => undefined);
    await sbUpdateStrict("platform_backup_jobs", `id=eq.${row.id}`, {
      status: "failed",
      failure_reason: "The backup artifact could not be created or verified.",
      completed_at: new Date().toISOString(),
    }).catch(() => undefined);
  }
}

router.get("/super-admin/backups", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const rows = await sbSelectStrict<BackupRow>("platform_backup_jobs", "select=*&order=created_at.desc&limit=100");
    res.set("Cache-Control", "no-store").json({ ok: true, backups: rows.map(backupPublic) });
  } catch {
    res.status(503).json({ ok: false, error: "Backups could not be loaded. Confirm the settings migration has been applied." });
  }
});

router.post("/super-admin/backups", async (req, res): Promise<void> => {
  const actor = requireSuperAdmin(req, res);
  if (!actor) return;
  const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const name = requestedName ? requestedName.slice(0, 100).replace(/[^a-zA-Z0-9._-]/g, "-") : `manual-backup-${new Date().toISOString().slice(0, 10)}`;
  try {
    const created = await sbInsertStrict<BackupRow>("platform_backup_jobs", { name, backup_type: "manual", status: "running" });
    if (!created[0]) throw new Error("Backup job was not created.");
    void executeBackup(created[0]);
    res.status(202).json({ ok: true, backup: backupPublic(created[0]) });
  } catch {
    res.status(503).json({ ok: false, error: "Backup job could not be created. Confirm the settings migration has been applied." });
  }
});

router.delete("/super-admin/backups/:id", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "A valid backup id is required." });
    return;
  }
  try {
    const rows = await sbSelectStrict<BackupRow>("platform_backup_jobs", `id=eq.${id}&select=*&limit=1`);
    const row = rows[0];
    if (!row) { res.status(404).json({ ok: false, error: "Backup was not found." }); return; }
    if (row.artifact_name) await rm(join(BACKUP_DIR, basename(row.artifact_name)), { force: true });
    await sbDeleteStrict("platform_backup_jobs", `id=eq.${id}`);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Backup could not be deleted." });
  }
});

router.get("/super-admin/backups/:id/download", async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const id = Number(req.params.id);
  try {
    const rows = await sbSelectStrict<BackupRow>("platform_backup_jobs", `id=eq.${id}&status=eq.completed&select=*&limit=1`);
    const row = rows[0];
    if (!row?.artifact_name) { res.status(404).json({ ok: false, error: "A verified backup artifact is not available." }); return; }
    const filePath = join(BACKUP_DIR, basename(row.artifact_name));
    if (!existsSync(filePath)) { res.status(410).json({ ok: false, error: "The backup metadata exists, but its artifact is no longer on this server." }); return; }
    const info = await stat(filePath);
    if (Number(row.artifact_size) !== info.size || row.artifact_sha256 !== await sha256File(filePath)) {
      res.status(409).json({ ok: false, error: "The backup artifact failed integrity verification and was not downloaded." });
      return;
    }
    res.download(filePath, basename(row.artifact_name));
  } catch {
    res.status(503).json({ ok: false, error: "The verified backup artifact could not be downloaded." });
  }
});

export default router;