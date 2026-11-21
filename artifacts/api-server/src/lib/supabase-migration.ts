import { createHash, randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { logger } from "./logger.js";

export const MIGRATION_SOURCE_PROJECT_REF = "qfsxsbzaqwmyuxhramyw";
export const MIGRATION_DESTINATION_PROJECT_REF = "vuvyweofsutgqdtbjckj";
const MAX_CONNECTION_STRING_LENGTH = 4096;
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;

export type MigrationErrorCode =
  | "invalid_connection"
  | "invalid_certificate"
  | "wrong_project"
  | "source_connection_failed"
  | "destination_connection_failed"
  | "source_read_only_unavailable"
  | "source_schema_empty"
  | "destination_not_empty"
  | "missing_extensions"
  | "destination_extension_versions_differ"
  | "postgres_version_mismatch"
  | "stale_plan"
  | "unsafe_plan"
  | "migration_tools_unavailable"
  | "postgres_client_version_mismatch"
  | "source_backup_failed"
  | "source_backup_integrity_failed"
  | "restore_failed"
  | "restore_timed_out"
  | "verification_failed";

export type MigrationDiagnosticCategory =
  | "authentication"
  | "permission"
  | "dns"
  | "network"
  | "tls"
  | "timeout"
  | "database_unavailable"
  | "tool_version_mismatch"
  | "tool_missing"
  | "tool_execution"
  | "other";

export type MigrationDiagnosticStage =
  | "connect"
  | "read_only_transaction"
  | "read_only_check"
  | "schema_read"
  | "tool_check"
  | "schema_manifest"
  | "source_backup"
  | "source_backup_verify"
  | "destination_restore";

export interface MigrationDiagnostic {
  category: MigrationDiagnosticCategory;
  stage: MigrationDiagnosticStage;
  tool?: "pg_dump" | "pg_restore";
  toolMajor?: number;
  requiredMajor?: number;
}

export interface MigrationToolFailure {
  errorCode: MigrationErrorCode;
  diagnostic: MigrationDiagnostic;
}

export interface SourceBackupArtifact {
  artifactName: string;
  sizeBytes: number;
  sha256: string;
  verifiedAt: string;
}

interface VerifiedSourceBackup extends SourceBackupArtifact {
  filePath: string;
  restoreToc: string;
}

export class SupabaseMigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    readonly diagnostic?: MigrationDiagnostic,
  ) {
    super(code);
    this.name = "SupabaseMigrationError";
  }
}

export interface ParsedDatabaseConnection {
  projectRef: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  caCertificate?: string;
}

export interface MigrationTable {
  name: string;
  kind: "table" | "materialized_view";
  estimatedRows: number | null;
}

export interface PublicSchemaObjects {
  tables: string[];
  views: string[];
  materializedViews: string[];
  sequences: string[];
  functions: string[];
  types: string[];
  indexes: string[];
  constraints: string[];
  triggers: string[];
  policies: string[];
}

export interface MigrationPlan {
  sourceProjectRef: string;
  destinationProjectRef: string;
  sourcePostgresVersion: string;
  destinationPostgresVersion: string;
  tables: MigrationTable[];
  publicObjects: PublicSchemaObjects;
  foreignKeyCount: number;
  sourceExtensions: string[];
  missingDestinationExtensions: string[];
  extensionVersionMismatches: string[];
  destinationConflicts: string[];
  toolFailure?: MigrationToolFailure | null;
  sourceSchemaFingerprint: string;
  schemaManifest: string[];
  fingerprint: string;
  canMigrate: boolean;
}

export interface MigrationVerification {
  verified: boolean;
  tableCount: number;
  schemaMatches: boolean;
  sourceForeignKeyCount: number;
  destinationForeignKeyCount: number;
  relationshipsMatch: boolean;
  countMismatches: Array<{ table: string; sourceRows: number; destinationRows: number }>;
}

interface ForeignKey {
  name: string;
  sourceTable: string;
  destinationTable: string;
  validated: boolean;
}

interface DatabaseInventory {
  serverVersion: string;
  serverMajor: number;
  tables: MigrationTable[];
  publicObjects: PublicSchemaObjects;
  foreignKeys: ForeignKey[];
  extensions: string[];
  extensionVersions: string[];
  conflicts: string[];
  schemaFingerprint: string;
}

type PgQueryResult = { rows: Array<Record<string, unknown>> };
export interface MigrationDatabaseClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
}

export type MigrationClientFactory = (connection: ParsedDatabaseConnection) => MigrationDatabaseClient;
export type MigrationSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

const MAX_ROOT_CERTIFICATE_LENGTH = 64 * 1024;
const MAX_TOOL_STDERR_BYTES = 16 * 1024;
const CERTIFICATE_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\t \r\n]*[A-Za-z0-9+/=\r\n]+?[\t \r\n]*-----END CERTIFICATE-----/g;

function parseRootCertificate(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_ROOT_CERTIFICATE_LENGTH) {
    throw new SupabaseMigrationError("invalid_certificate");
  }
  const blocks = value.match(CERTIFICATE_BLOCK_PATTERN) ?? [];
  const remainder = value.replace(CERTIFICATE_BLOCK_PATTERN, "").trim();
  if (blocks.length === 0 || blocks.length > 8 || remainder.length > 0) {
    throw new SupabaseMigrationError("invalid_certificate");
  }
  return blocks.join("\n");
}

function classifyDatabaseError(error: unknown): MigrationDiagnosticCategory {
  if (!error || typeof error !== "object" || !("code" in error)) return "other";
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return "other";

  if (code === "28P01" || code === "28000") return "authentication";
  if (code === "42501") return "permission";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "57014" || code === "ETIMEDOUT") return "timeout";
  if (
    code === "ECONNREFUSED"
    || code === "ECONNRESET"
    || code === "EHOSTUNREACH"
    || code === "ENETUNREACH"
    || code === "EPIPE"
    || code.startsWith("08")
  ) {
    return "network";
  }
  if (
    code.startsWith("ERR_TLS_")
    || code.startsWith("CERT_")
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return "tls";
  }
  if (code === "53300" || code === "57P01" || code === "57P02" || code === "57P03") {
    return "database_unavailable";
  }
  return "other";
}

function invalidConnection(): never {
  throw new SupabaseMigrationError("invalid_connection");
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return invalidConnection();
  }
}

/**
 * Accept only Supabase direct or Supavisor connection URLs and bind each URL
 * to the one project reference this migration phase is allowed to access.
 */
export function parseSupabaseDatabaseUrl(
  rawValue: unknown,
  expectedProjectRef: string,
  rootCertificate?: unknown,
): ParsedDatabaseConnection {
  if (
    typeof rawValue !== "string"
    || rawValue.length < 16
    || rawValue.length > MAX_CONNECTION_STRING_LENGTH
    || /[\u0000-\u001f\u007f]/.test(rawValue)
  ) {
    return invalidConnection();
  }

  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return invalidConnection();
  }

  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || url.hash
    || url.pathname !== "/postgres"
    || !url.password
  ) {
    return invalidConnection();
  }

  for (const key of url.searchParams.keys()) {
    if (key !== "sslmode") return invalidConnection();
  }
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && !["require", "verify-ca", "verify-full"].includes(sslMode)) {
    return invalidConnection();
  }

  const host = url.hostname.toLowerCase();
  const decodedUsername = decodeUrlPart(url.username);
  let projectRef: string | null = null;
  const directHost = host.match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
  if (directHost && decodedUsername === "postgres") {
    projectRef = directHost[1];
  } else if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    const poolerUser = decodedUsername.match(/^postgres\.([a-z0-9]{20})$/);
    if (poolerUser) projectRef = poolerUser[1];
  }

  const port = url.port ? Number(url.port) : 5432;
  if (
    !projectRef
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || !url.username
  ) {
    return invalidConnection();
  }
  if (projectRef !== expectedProjectRef) {
    throw new SupabaseMigrationError("wrong_project");
  }

  const caCertificate = parseRootCertificate(rootCertificate);
  return {
    projectRef,
    host,
    port,
    database: "postgres",
    username: decodedUsername,
    password: decodeUrlPart(url.password),
    ...(caCertificate ? { caCertificate } : {}),
  };
}

function defaultClientFactory(connection: ParsedDatabaseConnection): MigrationDatabaseClient {
  return new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: {
      rejectUnauthorized: true,
      servername: connection.host,
      ...(connection.caCertificate ? { ca: connection.caCertificate } : {}),
    },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    application_name: "bil-guided-supabase-migration",
  }) as unknown as MigrationDatabaseClient;
}

async function withReadOnlyClient<T>(
  connection: ParsedDatabaseConnection,
  clientFactory: MigrationClientFactory,
  work: (client: MigrationDatabaseClient) => Promise<T>,
  failureCode: "source_connection_failed" | "destination_connection_failed",
): Promise<T> {
  const client = clientFactory(connection);
  let connected = false;
  let transactionStarted = false;
  let stage: MigrationDiagnosticStage = "connect";
  try {
    await client.connect();
    connected = true;
    stage = "read_only_transaction";
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;
    stage = "read_only_check";
    const readOnlyResult = await client.query("SHOW transaction_read_only");
    if (String(readOnlyResult.rows[0]?.transaction_read_only ?? "").toLowerCase() !== "on") {
      throw new SupabaseMigrationError(
        failureCode === "source_connection_failed"
          ? "source_read_only_unavailable"
          : "destination_connection_failed",
      );
    }
    stage = "schema_read";
    const value = await work(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return value;
  } catch (error) {
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { /* do not expose driver details */ }
    }
    if (error instanceof SupabaseMigrationError) throw error;
    const diagnostic = { category: classifyDatabaseError(error), stage };
    logger.warn(
      { databaseSide: failureCode.startsWith("source_") ? "source" : "destination", ...diagnostic },
      "[supabase-migration] read-only database check failed",
    );
    throw new SupabaseMigrationError(failureCode, diagnostic);
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* do not expose driver details */ }
    }
  }
}

async function inspectDatabase(client: MigrationDatabaseClient): Promise<DatabaseInventory> {
  const versionResult = await client.query(
    "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_num",
  );
  const version = String(versionResult.rows[0]?.version ?? "");
  const versionNum = Number(versionResult.rows[0]?.version_num ?? 0);
  if (!version || !Number.isSafeInteger(versionNum) || versionNum < 1) {
    throw new SupabaseMigrationError("source_connection_failed");
  }

  const tableResult = await client.query(`
    SELECT c.relname AS name,
           c.relkind AS kind,
           CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint::text ELSE NULL END AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'm')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
    ORDER BY c.relname
  `);
  const tables = tableResult.rows.map((row) => {
    const estimate = row.estimated_rows == null ? null : Number(row.estimated_rows);
    return {
      name: String(row.name),
      kind: (row.kind === "m" ? "materialized_view" : "table") as MigrationTable["kind"],
      estimatedRows: Number.isSafeInteger(estimate) && estimate !== null && estimate >= 0 ? estimate : null,
    };
  });

  const foreignKeyResult = await client.query(`
    SELECT c.conname AS name,
           c.conrelid::regclass::text AS source_table,
           c.confrelid::regclass::text AS destination_table,
           c.convalidated AS validated
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype = 'f'
    ORDER BY c.conrelid::regclass::text, c.conname
  `);
  const foreignKeys = foreignKeyResult.rows.map((row) => ({
    name: String(row.name),
    sourceTable: String(row.source_table),
    destinationTable: String(row.destination_table),
    validated: row.validated === true,
  }));

  const extensionResult = await client.query(
    "SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY extname",
  );
  const extensions = extensionResult.rows.map((row) => String(row.name));
  const extensionVersions = extensionResult.rows.map(
    (row) => `${String(row.name)}:${String(row.version)}`,
  );

  const conflictResult = await client.query(`
    SELECT object_kind, object_name FROM (
      SELECT CASE c.relkind
               WHEN 'r' THEN 'table'
               WHEN 'p' THEN 'partitioned_table'
               WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'materialized_view'
               WHEN 'S' THEN 'sequence'
               WHEN 'f' THEN 'foreign_table'
             END::text AS object_kind,
             c.relname::text AS object_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
        )
      UNION ALL
      SELECT 'function'::text, p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
        )
      UNION ALL
      SELECT 'type'::text, t.typname::text
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
        )
    ) objects
    ORDER BY object_kind, object_name
  `);
  const conflicts = conflictResult.rows.map((row) => `${String(row.object_kind)}:${String(row.object_name)}`);

  const schemaParts: unknown[][] = [];
  const columns = await client.query(`
    SELECT table_name, column_name, ordinal_position, data_type, udt_schema, udt_name,
           is_nullable, column_default, character_maximum_length, numeric_precision,
           numeric_scale, datetime_precision
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  schemaParts.push(columns.rows);
  const constraints = await client.query(`
    SELECT c.conrelid::regclass::text AS table_name, c.conname AS name, c.contype AS type,
           c.convalidated AS validated, pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
    ORDER BY c.conrelid::regclass::text, c.conname
  `);
  schemaParts.push(constraints.rows);
  const indexes = await client.query(`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  schemaParts.push(indexes.rows);
  const triggers = await client.query(`
    SELECT c.relname AS table_name, t.tgname AS name, pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `);
  schemaParts.push(triggers.rows);
  const policies = await client.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  schemaParts.push(policies.rows);
  const routines = await client.query(`
    SELECT p.oid::regprocedure::text AS identity, p.prokind AS kind,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    ORDER BY p.oid::regprocedure::text
  `);
  schemaParts.push(routines.rows);
  const views = await client.query(`
    SELECT 'view'::text AS kind, schemaname, viewname AS name, definition
    FROM pg_views WHERE schemaname = 'public'
    UNION ALL
    SELECT 'materialized_view'::text, schemaname, matviewname, definition
    FROM pg_matviews WHERE schemaname = 'public'
    ORDER BY kind, name
  `);
  schemaParts.push(views.rows);
  const types = await client.query(`
    SELECT t.typname AS name, t.typtype AS kind,
           CASE WHEN t.typtype = 'e' THEN (
             SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
             FROM pg_enum e WHERE e.enumtypid = t.oid
           ) ELSE pg_get_expr(t.typdefaultbin, 0) END AS definition,
           CASE WHEN t.typtype = 'd' THEN (
             SELECT pg_get_constraintdef(c.oid, true)
             FROM pg_constraint c WHERE c.contypid = t.oid ORDER BY c.conname LIMIT 1
           ) ELSE NULL END AS domain_constraint
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e')
    ORDER BY t.typname
  `);
  schemaParts.push(types.rows);
  schemaParts.push(conflicts);
  schemaParts.push(extensionVersions);
  const schemaFingerprint = createHash("sha256").update(JSON.stringify(schemaParts)).digest("hex");
  const publicObjects: PublicSchemaObjects = {
    tables: tableResult.rows
      .filter((row) => row.kind === "r" || row.kind === "p")
      .map((row) => String(row.name)),
    views: views.rows.filter((row) => row.kind === "view").map((row) => String(row.name)),
    materializedViews: views.rows
      .filter((row) => row.kind === "materialized_view")
      .map((row) => String(row.name)),
    sequences: conflictResult.rows
      .filter((row) => row.object_kind === "sequence")
      .map((row) => String(row.object_name)),
    functions: routines.rows.map((row) => String(row.identity)),
    types: types.rows.map((row) => String(row.name)),
    indexes: indexes.rows.map((row) => String(row.indexname)),
    constraints: constraints.rows.map(
      (row) => `${String(row.table_name)}.${String(row.name)}`,
    ),
    triggers: triggers.rows.map(
      (row) => `${String(row.table_name)}.${String(row.name)}`,
    ),
    policies: policies.rows.map(
      (row) => `${String(row.tablename)}.${String(row.policyname)}`,
    ),
  };

  return {
    serverVersion: version,
    serverMajor: Math.floor(versionNum / 10_000),
    tables,
    publicObjects,
    foreignKeys,
    extensions,
    extensionVersions,
    conflicts,
    schemaFingerprint,
  };
}

function planFingerprint(
  source: DatabaseInventory,
  destination: DatabaseInventory,
  schemaManifest: string[],
): string {
  const payload = JSON.stringify({
    sourceMajor: source.serverMajor,
    destinationMajor: destination.serverMajor,
    sourceSchemaFingerprint: source.schemaFingerprint,
    tables: source.tables.map((table) => table.name),
    publicObjects: source.publicObjects,
    schemaManifest,
    foreignKeys: source.foreignKeys,
    sourceExtensions: source.extensions,
    sourceExtensionVersions: source.extensionVersions,
    destinationExtensions: destination.extensions,
    destinationExtensionVersions: destination.extensionVersions,
    destinationConflicts: destination.conflicts,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function publicSchemaTocEntries(catalogText: string): string[] {
  return catalogText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => (
      line
      && !line.startsWith(";")
      && !/\bSCHEMA\s+-\s+public(?:\s|$)/.test(line)
      && !/\bCOMMENT\s+-\s+SCHEMA\s+public(?:\s|$)/.test(line)
    ))
    .map((line) => line.replace(/\s+\S+$/, "").trim());
}

async function writeRootCertificateFile(
  directory: string,
  connection: ParsedDatabaseConnection,
  fileName: string,
): Promise<string | undefined> {
  if (!connection.caCertificate) return undefined;
  const filePath = join(directory, fileName);
  await writeFile(filePath, connection.caCertificate, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return filePath;
}

interface PostgresToolchain {
  pgDump: string;
  pgRestore: string;
  major: number;
}

interface ToolRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
  timedOut?: boolean;
}

function pgToolCandidates(tool: "pg_dump" | "pg_restore", major: number): string[] {
  const override = process.env[tool === "pg_dump" ? "BIL_PG_DUMP_BIN" : "BIL_PG_RESTORE_BIN"]?.trim();
  return [...new Set([
    override,
    `/usr/lib/postgresql/${major}/bin/${tool}`,
    `${tool}-${major}`,
    `${tool}${major}`,
    tool,
  ].filter((candidate): candidate is string => Boolean(candidate)))];
}

function parsePostgresToolMajor(output: string): number | null {
  const match = /PostgreSQL\)?\s+(\d+)(?:\.\d+)?/i.exec(output);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}

async function runCliTool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  spawn: MigrationSpawn,
  options: { maxOutputBytes?: number; timeoutMs?: number } = {},
): Promise<ToolRunResult> {
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputTooLarge = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: ToolRunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveResult(result);
    };
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      finish({ exitCode: null, stdout, stderr, spawnError: "spawn_failed" });
      return;
    }
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > maxOutputBytes) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stdout += value.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderrBytes >= MAX_TOOL_STDERR_BYTES) return;
      const remaining = MAX_TOOL_STDERR_BYTES - stderrBytes;
      const bounded = value.subarray(0, remaining);
      stderrBytes += bounded.length;
      stderr += bounded.toString("utf8");
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        spawnError: error.code === "ENOENT" ? "not_found" : "spawn_failed",
      });
    });
    child.once("close", (code) => finish({
      exitCode: outputTooLarge ? null : code,
      stdout,
      stderr,
      ...(timedOut ? { timedOut: true } : {}),
      ...(outputTooLarge ? { spawnError: "output_too_large" } : {}),
    }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30 * 60 * 1000);
    timer.unref?.();
  });
}

function toolFailureFromRun(
  result: ToolRunResult,
  tool: "pg_dump" | "pg_restore",
  stage: MigrationDiagnosticStage,
  requiredMajor: number,
): SupabaseMigrationError {
  if (result.timedOut) {
    return new SupabaseMigrationError("migration_tools_unavailable", {
      category: "timeout",
      stage,
      tool,
      requiredMajor,
    });
  }
  if (result.spawnError === "not_found") {
    return new SupabaseMigrationError("migration_tools_unavailable", {
      category: "tool_missing",
      stage,
      tool,
      requiredMajor,
    });
  }
  const error = result.stderr.toLowerCase();
  let category: MigrationDiagnosticCategory = "tool_execution";
  let code: MigrationErrorCode = "source_connection_failed";
  if (/28p01|password authentication failed|no password supplied|authentication failed/.test(error)) {
    category = "authentication";
  } else if (/certificate|ssl|tls|verify-full/.test(error)) {
    category = "tls";
  } else if (/permission denied|insufficient privilege|must be owner/.test(error)) {
    category = "permission";
  } else if (/could not translate host|name or service not known|temporary failure in name resolution/.test(error)) {
    category = "dns";
  } else if (/timed out|timeout|connection timed out/.test(error)) {
    category = "timeout";
  } else if (/refused|could not connect|no route to host|network is unreachable/.test(error)) {
    category = "network";
  }
  if (tool === "pg_restore") code = "restore_failed";
  return new SupabaseMigrationError(code, { category, stage, tool, requiredMajor });
}

async function resolvePostgresToolchain(
  requiredMajor: number,
  spawn: MigrationSpawn,
): Promise<PostgresToolchain> {
  const resolved = {} as Pick<PostgresToolchain, "pgDump" | "pgRestore">;
  for (const tool of ["pg_dump", "pg_restore"] as const) {
    let lastObservedMajor: number | null = null;
    for (const candidate of pgToolCandidates(tool, requiredMajor)) {
      const version = await runCliTool(
        candidate,
        ["--version"],
        { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" },
        spawn,
        { maxOutputBytes: 4096, timeoutMs: 5_000 },
      );
      if (version.exitCode !== 0 || version.spawnError) continue;
      const major = parsePostgresToolMajor(version.stdout);
      if (major === requiredMajor) {
        resolved[tool === "pg_dump" ? "pgDump" : "pgRestore"] = candidate;
        break;
      }
      if (major !== null) {
        lastObservedMajor = major;
      }
    }
    if (!resolved[tool === "pg_dump" ? "pgDump" : "pgRestore"]) {
      if (lastObservedMajor !== null) {
        throw new SupabaseMigrationError("postgres_client_version_mismatch", {
          category: "tool_version_mismatch",
          stage: "tool_check",
          tool,
          toolMajor: lastObservedMajor,
          requiredMajor,
        });
      }
      throw new SupabaseMigrationError("migration_tools_unavailable", {
        category: "tool_missing",
        stage: "tool_check",
        tool,
        requiredMajor,
      });
    }
  }
  return { ...resolved, major: requiredMajor };
}

function classifySourceCliFailure(
  error: SupabaseMigrationError,
): MigrationToolFailure {
  return {
    errorCode: error.code === "postgres_client_version_mismatch"
      ? "postgres_client_version_mismatch"
      : error.code === "migration_tools_unavailable"
        ? "migration_tools_unavailable"
        : "source_connection_failed",
    diagnostic: error.diagnostic ?? {
      category: "tool_execution",
      stage: "schema_manifest",
    },
  };
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function isTemporaryPath(path: string): boolean {
  const resolvedPath = resolve(path);
  return [resolve(tmpdir()), "/tmp", "/var/tmp", "/dev/shm"].some((root) => (
    resolvedPath === root || resolvedPath.startsWith(`${root}/`)
  ));
}

async function createVerifiedSourceBackup(
  connection: ParsedDatabaseConnection,
  requiredMajor: number,
  options: {
    spawn?: MigrationSpawn;
    backupDirectory?: string;
    allowTemporaryBackupDirectory?: boolean;
  } = {},
): Promise<VerifiedSourceBackup> {
  const spawn = options.spawn ?? nodeSpawn;
  const backupRoot = resolve(
    options.backupDirectory?.trim()
      || process.env.BACKUP_DIR?.trim()
      || join(process.cwd(), "data", "backups"),
  );
  if (!options.allowTemporaryBackupDirectory && isTemporaryPath(backupRoot)) {
    throw new SupabaseMigrationError("source_backup_failed", {
      category: "permission",
      stage: "source_backup",
    });
  }
  const backupDirectory = join(backupRoot, "supabase-migration");
  const artifactName = `bil-public-${connection.projectRef}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.dump`;
  const artifactPath = join(backupDirectory, artifactName);
  const metadataPath = `${artifactPath}.json`;
  let tempDir = "";
  let sourceEnv: NodeJS.ProcessEnv | undefined;
  let verified = false;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "bil-supabase-backup-"));
    const tools = await resolvePostgresToolchain(requiredMajor, spawn);
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await chmod(backupDirectory, 0o700);
    const archiveHandle = await open(artifactPath, "wx", 0o600);
    await archiveHandle.close();
    const sourceCaFile = await writeRootCertificateFile(
      tempDir,
      connection,
      "source-root-ca.pem",
    );
    const dumpEnvironment = childEnvironment(connection, true, sourceCaFile);
    sourceEnv = dumpEnvironment;
    const dump = await runCliTool(tools.pgDump, [
      "--format=custom",
      "--schema=public",
      "--no-owner",
      "--no-acl",
      "--no-password",
      "--file",
      artifactPath,
      "--dbname",
      connection.database,
    ], dumpEnvironment, spawn);
    delete dumpEnvironment.PGPASSWORD;
    if (dump.exitCode !== 0) {
      throw toolFailureFromRun(dump, "pg_dump", "source_backup", requiredMajor);
    }

    const catalog = await runCliTool(
      tools.pgRestore,
      ["--list", "--format=custom", artifactPath],
      { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" },
      spawn,
    );
    if (catalog.exitCode !== 0) {
      throw new SupabaseMigrationError("source_backup_integrity_failed", {
        category: "tool_execution",
        stage: "source_backup_verify",
        tool: "pg_restore",
        requiredMajor,
      });
    }
    const catalogLines = catalog.stdout.split(/\r?\n/);
    const restoreLines = catalogLines.filter((line) => (
      !/\bSCHEMA\s+-\s+public(?:\s|$)/.test(line)
      && !/\bCOMMENT\s+-\s+SCHEMA\s+public(?:\s|$)/.test(line)
    ));
    const restoreToc = restoreLines.join("\n");
    if (
      !restoreLines.some((line) => line.trim() && !line.trimStart().startsWith(";"))
      || !/\bTABLE DATA\b/.test(restoreToc)
    ) {
      throw new SupabaseMigrationError("source_backup_integrity_failed", {
        category: "tool_execution",
        stage: "source_backup_verify",
        tool: "pg_restore",
        requiredMajor,
      });
    }

    const decoded = await runCliTool(
      tools.pgRestore,
      ["--format=custom", "--exit-on-error", "--no-owner", "--no-acl", "--file", "/dev/null", artifactPath],
      { PATH: process.env.PATH ?? "", LANG: "C", LC_ALL: "C" },
      spawn,
    );
    if (decoded.exitCode !== 0) {
      throw new SupabaseMigrationError("source_backup_integrity_failed", {
        category: "tool_execution",
        stage: "source_backup_verify",
        tool: "pg_restore",
        requiredMajor,
      });
    }
    const info = await stat(artifactPath);
    const checksum = await sha256File(artifactPath);
    const checksumAfterRead = await sha256File(artifactPath);
    if (
      info.size <= 0
      || !/^[a-f0-9]{64}$/.test(checksum)
      || checksum !== checksumAfterRead
    ) {
      throw new SupabaseMigrationError("source_backup_integrity_failed", {
        category: "tool_execution",
        stage: "source_backup_verify",
        tool: "pg_restore",
        requiredMajor,
      });
    }

    await chmod(artifactPath, 0o600);
    const verifiedAt = new Date().toISOString();
    const artifact: SourceBackupArtifact = {
      artifactName,
      sizeBytes: info.size,
      sha256: checksum,
      verifiedAt,
    };
    await writeFile(metadataPath, JSON.stringify({
      scope: "public",
      sourceProjectRef: connection.projectRef,
      postgresMajor: requiredMajor,
      ...artifact,
    }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    verified = true;
    return { ...artifact, filePath: artifactPath, restoreToc };
  } catch (error) {
    if (error instanceof SupabaseMigrationError) throw error;
    throw new SupabaseMigrationError("source_backup_failed", {
      category: "tool_execution",
      stage: "source_backup",
    });
  } finally {
    if (sourceEnv) delete sourceEnv.PGPASSWORD;
    if (!verified) {
      await rm(artifactPath, { force: true }).catch(() => {});
      await rm(metadataPath, { force: true }).catch(() => {});
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readPublicSchemaManifest(
  connection: ParsedDatabaseConnection,
  requiredMajor: number,
  spawn: MigrationSpawn,
): Promise<string[]> {
  const tools = await resolvePostgresToolchain(requiredMajor, spawn);
  const tempDir = await mkdtemp(join(tmpdir(), "bil-supabase-ca-"));
  let dumpEnv: NodeJS.ProcessEnv | undefined;
  try {
    const caFile = await writeRootCertificateFile(tempDir, connection, "source-root-ca.pem");
    const environment = childEnvironment(connection, true, caFile);
    dumpEnv = environment;
    const archivePath = join(tempDir, "schema-manifest.dump");
    const archiveFile = await open(archivePath, "wx", 0o600);
    await archiveFile.close();
    const dump = await runCliTool(tools.pgDump, [
      "--format=custom",
      "--schema=public",
      "--schema-only",
      "--no-owner",
      "--no-acl",
      "--no-password",
      "--file",
      archivePath,
      "--dbname",
      connection.database,
    ], environment, spawn);
    delete environment.PGPASSWORD;
    if (dump.exitCode !== 0) {
      throw toolFailureFromRun(dump, "pg_dump", "schema_manifest", requiredMajor);
    }
    const catalog = await runCliTool(tools.pgRestore, ["--list", "--format=custom", archivePath], {
        PATH: process.env.PATH ?? "",
        LANG: "C",
        LC_ALL: "C",
    }, spawn);
    if (catalog.exitCode !== 0) {
      throw toolFailureFromRun(catalog, "pg_restore", "schema_manifest", requiredMajor);
    }
    return publicSchemaTocEntries(catalog.stdout);
  } catch (error) {
    if (error instanceof SupabaseMigrationError) throw error;
    throw new SupabaseMigrationError("migration_tools_unavailable", {
      category: "tool_execution",
      stage: "schema_manifest",
      requiredMajor,
    });
  } finally {
    if (dumpEnv) delete dumpEnv.PGPASSWORD;
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function inspectSupabaseMigration(
  sourceValue: unknown,
  destinationValue: unknown,
  options: {
    clientFactory?: MigrationClientFactory;
    spawn?: MigrationSpawn;
    skipSchemaManifest?: boolean;
    sourceRootCertificate?: unknown;
    destinationRootCertificate?: unknown;
  } = {},
): Promise<MigrationPlan> {
  const sourceConnection = parseSupabaseDatabaseUrl(
    sourceValue,
    MIGRATION_SOURCE_PROJECT_REF,
    options.sourceRootCertificate,
  );
  const destinationConnection = parseSupabaseDatabaseUrl(
    destinationValue,
    MIGRATION_DESTINATION_PROJECT_REF,
    options.destinationRootCertificate,
  );
  const clientFactory = options.clientFactory ?? defaultClientFactory;

  const source = await withReadOnlyClient(
    sourceConnection,
    clientFactory,
    inspectDatabase,
    "source_connection_failed",
  );
  const destination = await withReadOnlyClient(
    destinationConnection,
    clientFactory,
    inspectDatabase,
    "destination_connection_failed",
  );
  const missingDestinationExtensions = source.extensions.filter(
    (extension) => !destination.extensions.includes(extension),
  );
  const destinationExtensionVersions = new Map(
    destination.extensionVersions.map((item) => {
      const separator = item.lastIndexOf(":");
      return [item.slice(0, separator), item.slice(separator + 1)] as const;
    }),
  );
  const extensionVersionMismatches = source.extensionVersions.flatMap((item) => {
    const separator = item.lastIndexOf(":");
    const name = item.slice(0, separator);
    const sourceVersion = item.slice(separator + 1);
    const destinationVersion = destinationExtensionVersions.get(name);
    return destinationVersion && destinationVersion !== sourceVersion
      ? [`${name}: source ${sourceVersion}, destination ${destinationVersion}`]
      : [];
  });
  let schemaManifest: string[] = [];
  let toolFailure: MigrationToolFailure | null = null;
  if (!options.skipSchemaManifest) {
    try {
      schemaManifest = await readPublicSchemaManifest(
        sourceConnection,
        source.serverMajor,
        options.spawn ?? nodeSpawn,
      );
    } catch (error) {
      if (error instanceof SupabaseMigrationError) {
        toolFailure = classifySourceCliFailure(error);
      } else {
        toolFailure = {
          errorCode: "migration_tools_unavailable",
          diagnostic: { category: "tool_execution", stage: "schema_manifest" },
        };
      }
    }
  }
  const sourceMajor = source.serverMajor;
  const destinationMajor = destination.serverMajor;
  const fingerprint = planFingerprint(source, destination, schemaManifest);
  const canMigrate = source.publicObjects.tables.length > 0
    && destination.conflicts.length === 0
    && missingDestinationExtensions.length === 0
    && extensionVersionMismatches.length === 0
    && sourceMajor === destinationMajor
    && toolFailure === null;

  return {
    sourceProjectRef: MIGRATION_SOURCE_PROJECT_REF,
    destinationProjectRef: MIGRATION_DESTINATION_PROJECT_REF,
    sourcePostgresVersion: source.serverVersion,
    destinationPostgresVersion: destination.serverVersion,
    tables: source.tables,
    publicObjects: source.publicObjects,
    foreignKeyCount: source.foreignKeys.length,
    sourceExtensions: source.extensions,
    missingDestinationExtensions,
    extensionVersionMismatches,
    destinationConflicts: destination.conflicts,
    toolFailure,
    sourceSchemaFingerprint: source.schemaFingerprint,
    schemaManifest,
    fingerprint,
    canMigrate,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function exactRowCounts(
  connection: ParsedDatabaseConnection,
  tables: MigrationTable[],
  clientFactory: MigrationClientFactory,
  failureCode: "source_connection_failed" | "destination_connection_failed",
): Promise<Map<string, number>> {
  return withReadOnlyClient(connection, clientFactory, async (client) => {
    const counts = new Map<string, number>();
    for (const table of tables) {
      const result = await client.query(
        `SELECT count(*)::text AS row_count FROM public.${quoteIdentifier(table.name)}`,
      );
      const count = Number(result.rows[0]?.row_count);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new SupabaseMigrationError(failureCode);
      }
      counts.set(table.name, count);
    }
    return counts;
  }, failureCode);
}

async function foreignKeySignatures(
  connection: ParsedDatabaseConnection,
  clientFactory: MigrationClientFactory,
  failureCode: "source_connection_failed" | "destination_connection_failed",
): Promise<ForeignKey[]> {
  return withReadOnlyClient(connection, clientFactory, async (client) => {
    const result = await client.query(`
      SELECT c.conname AS name,
             c.conrelid::regclass::text AS source_table,
             c.confrelid::regclass::text AS destination_table,
             c.convalidated AS validated
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.contype = 'f'
      ORDER BY c.conrelid::regclass::text, c.conname
    `);
    return result.rows.map((row) => ({
      name: String(row.name),
      sourceTable: String(row.source_table),
      destinationTable: String(row.destination_table),
      validated: row.validated === true,
    }));
  }, failureCode);
}

function childEnvironment(
  connection: ParsedDatabaseConnection,
  readOnly: boolean,
  caFile?: string,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
    PGSSLMODE: "verify-full",
    ...(caFile ? { PGSSLROOTCERT: caFile } : {}),
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: readOnly ? "-c default_transaction_read_only=on" : "",
  };
}

export async function restorePublicSchema(
  backup: VerifiedSourceBackup,
  destinationConnection: ParsedDatabaseConnection,
  requiredMajor: number,
  options: { spawn?: MigrationSpawn; timeoutMs?: number } = {},
): Promise<void> {
  const spawn = options.spawn ?? nodeSpawn;
  const tempDir = await mkdtemp(join(tmpdir(), "bil-supabase-migration-"));
  let destinationEnv: NodeJS.ProcessEnv | undefined;
  try {
    const tools = await resolvePostgresToolchain(requiredMajor, spawn);
    const currentChecksum = await sha256File(backup.filePath);
    if (currentChecksum !== backup.sha256) {
      throw new SupabaseMigrationError("source_backup_integrity_failed", {
        category: "tool_execution",
        stage: "source_backup_verify",
        tool: "pg_restore",
        requiredMajor,
      });
    }
    const destinationCaFile = await writeRootCertificateFile(
      tempDir,
      destinationConnection,
      "destination-root-ca.pem",
    );
    const destinationChildEnvironment = childEnvironment(destinationConnection, false, destinationCaFile);
    destinationEnv = destinationChildEnvironment;
    const tocPath = join(tempDir, "restore-toc.list");
    await writeFile(tocPath, backup.restoreToc, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const restoreArgs = [
      "--format=custom",
      "--use-list",
      tocPath,
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "--dbname",
      destinationConnection.database,
      backup.filePath,
    ];
    const result = await runCliTool(
      tools.pgRestore,
      restoreArgs,
      destinationChildEnvironment,
      spawn,
      { timeoutMs: options.timeoutMs ?? RESTORE_TIMEOUT_MS },
    );
    delete destinationChildEnvironment.PGPASSWORD;
    if (result.exitCode !== 0) {
      throw toolFailureFromRun(result, "pg_restore", "destination_restore", requiredMajor);
    }
  } catch (error) {
    if (error instanceof SupabaseMigrationError) throw error;
    throw new SupabaseMigrationError("restore_failed", {
      category: "tool_execution",
      stage: "destination_restore",
      tool: "pg_restore",
      requiredMajor,
    });
  } finally {
    if (destinationEnv) delete destinationEnv.PGPASSWORD;
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runSupabasePublicMigration(
  sourceValue: unknown,
  destinationValue: unknown,
  expectedFingerprint: string,
  options: {
    clientFactory?: MigrationClientFactory;
    spawn?: MigrationSpawn;
    skipSchemaManifest?: boolean;
    sourceRootCertificate?: unknown;
    destinationRootCertificate?: unknown;
    backupDirectory?: string;
    allowTemporaryBackupDirectory?: boolean;
    onSourceBackup?: (backup: SourceBackupArtifact) => void;
    onStage?: (stage: "checking" | "backing_up" | "copying" | "verifying") => void;
  } = {},
): Promise<{
  plan: MigrationPlan;
  verification: MigrationVerification;
  sourceBackup?: SourceBackupArtifact;
}> {
  const clientFactory = options.clientFactory ?? defaultClientFactory;
  const sourceConnection = parseSupabaseDatabaseUrl(
    sourceValue,
    MIGRATION_SOURCE_PROJECT_REF,
    options.sourceRootCertificate,
  );
  const destinationConnection = parseSupabaseDatabaseUrl(
    destinationValue,
    MIGRATION_DESTINATION_PROJECT_REF,
    options.destinationRootCertificate,
  );
  options.onStage?.("checking");
  const plan = await inspectSupabaseMigration(sourceValue, destinationValue, {
    clientFactory,
    spawn: options.spawn,
    skipSchemaManifest: options.skipSchemaManifest,
    sourceRootCertificate: options.sourceRootCertificate,
    destinationRootCertificate: options.destinationRootCertificate,
  });
  if (plan.fingerprint !== expectedFingerprint) {
    throw new SupabaseMigrationError("stale_plan");
  }
  if (!plan.canMigrate) {
    if (plan.toolFailure) {
      throw new SupabaseMigrationError(
        plan.toolFailure.errorCode,
        plan.toolFailure.diagnostic,
      );
    }
    if (plan.destinationConflicts.length > 0) {
      throw new SupabaseMigrationError("destination_not_empty");
    }
    if (plan.missingDestinationExtensions.length > 0) {
      throw new SupabaseMigrationError("missing_extensions");
    }
    if (plan.extensionVersionMismatches.length > 0) {
      throw new SupabaseMigrationError("destination_extension_versions_differ");
    }
    if (
      plan.sourcePostgresVersion.split(".")[0]
      !== plan.destinationPostgresVersion.split(".")[0]
    ) {
      throw new SupabaseMigrationError("postgres_version_mismatch");
    }
    throw new SupabaseMigrationError("unsafe_plan");
  }

  options.onStage?.("backing_up");
  const sourceBackup = await createVerifiedSourceBackup(
    sourceConnection,
    Number(plan.sourcePostgresVersion.split(".")[0]),
    {
      spawn: options.spawn,
      backupDirectory: options.backupDirectory,
      allowTemporaryBackupDirectory: options.allowTemporaryBackupDirectory,
    },
  );
  options.onSourceBackup?.({
    artifactName: sourceBackup.artifactName,
    sizeBytes: sourceBackup.sizeBytes,
    sha256: sourceBackup.sha256,
    verifiedAt: sourceBackup.verifiedAt,
  });

  const recheckedPlan = await inspectSupabaseMigration(sourceValue, destinationValue, {
    clientFactory,
    spawn: options.spawn,
    skipSchemaManifest: options.skipSchemaManifest,
    sourceRootCertificate: options.sourceRootCertificate,
    destinationRootCertificate: options.destinationRootCertificate,
  });
  if (recheckedPlan.fingerprint !== expectedFingerprint) {
    throw new SupabaseMigrationError("stale_plan");
  }
  if (!recheckedPlan.canMigrate) {
    if (recheckedPlan.toolFailure) {
      throw new SupabaseMigrationError(
        recheckedPlan.toolFailure.errorCode,
        recheckedPlan.toolFailure.diagnostic,
      );
    }
    if (recheckedPlan.destinationConflicts.length > 0) {
      throw new SupabaseMigrationError("destination_not_empty");
    }
    if (recheckedPlan.extensionVersionMismatches.length > 0) {
      throw new SupabaseMigrationError("destination_extension_versions_differ");
    }
    throw new SupabaseMigrationError("unsafe_plan");
  }

  options.onStage?.("copying");
  await restorePublicSchema(
    sourceBackup,
    destinationConnection,
    Number(plan.sourcePostgresVersion.split(".")[0]),
    { spawn: options.spawn },
  );

  options.onStage?.("verifying");
  const [
    sourceCounts,
    destinationCounts,
    sourceForeignKeys,
    destinationForeignKeys,
    sourceSchema,
    destinationSchema,
  ] = await Promise.all([
    exactRowCounts(sourceConnection, plan.tables, clientFactory, "source_connection_failed"),
    exactRowCounts(destinationConnection, plan.tables, clientFactory, "destination_connection_failed"),
    foreignKeySignatures(sourceConnection, clientFactory, "source_connection_failed"),
    foreignKeySignatures(destinationConnection, clientFactory, "destination_connection_failed"),
    withReadOnlyClient(
      sourceConnection,
      clientFactory,
      inspectDatabase,
      "source_connection_failed",
    ),
    withReadOnlyClient(
      destinationConnection,
      clientFactory,
      inspectDatabase,
      "destination_connection_failed",
    ),
  ]);
  const countMismatches = plan.tables.flatMap((table) => {
    const sourceRows = sourceCounts.get(table.name);
    const destinationRows = destinationCounts.get(table.name);
    return sourceRows === destinationRows
      ? []
      : [{
          table: table.name,
          sourceRows: sourceRows ?? -1,
          destinationRows: destinationRows ?? -1,
        }];
  });
  const relationshipsMatch = JSON.stringify(sourceForeignKeys) === JSON.stringify(destinationForeignKeys)
    && destinationForeignKeys.every((foreignKey) => foreignKey.validated);
  const schemaMatches = sourceSchema.schemaFingerprint === destinationSchema.schemaFingerprint;
  const verification: MigrationVerification = {
    verified: countMismatches.length === 0 && relationshipsMatch && schemaMatches,
    tableCount: plan.tables.length,
    schemaMatches,
    sourceForeignKeyCount: sourceForeignKeys.length,
    destinationForeignKeyCount: destinationForeignKeys.length,
    relationshipsMatch,
    countMismatches,
  };
  return { plan, verification, sourceBackup };
}
