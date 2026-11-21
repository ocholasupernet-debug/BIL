import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  inspectSupabaseMigration,
  MIGRATION_DESTINATION_PROJECT_REF,
  MIGRATION_SOURCE_PROJECT_REF,
  parseSupabaseDatabaseUrl,
  runSupabasePublicMigration,
  SupabaseMigrationError,
  type MigrationClientFactory,
  type MigrationDatabaseClient,
  type MigrationSpawn,
  type ParsedDatabaseConnection,
} from "./supabase-migration.js";

const sourceSecret = "source-password-never-log";
const destinationSecret = "destination-password-never-log";
const sourceUrl =
  `postgresql://postgres:${sourceSecret}@db.${MIGRATION_SOURCE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const destinationUrl =
  `postgresql://postgres:${destinationSecret}@db.${MIGRATION_DESTINATION_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const sourceRootCertificate =
  "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----";
const destinationRootCertificate =
  "-----BEGIN CERTIFICATE-----\nZGVm\n-----END CERTIFICATE-----";
const testBackupDirectory = await mkdtemp(join(tmpdir(), "bil-supabase-migration-tests-"));
test.after(async () => rm(testBackupDirectory, { recursive: true, force: true }));

function errorCode(callback: () => unknown, code: string): void {
  assert.throws(callback, (error: unknown) =>
    error instanceof SupabaseMigrationError && error.code === code,
  );
}

function createClientFactory(options: {
  targetConflicts?: string[];
  destinationRowsAfterRestore?: number;
  schemaMismatchAfterRestore?: boolean;
  postgresVersion?: string;
  sourceExtensionVersion?: string;
  destinationExtensionVersion?: string;
  state?: { restored: boolean };
} = {}): MigrationClientFactory {
  const state = options.state ?? { restored: false };
  return (connection: ParsedDatabaseConnection): MigrationDatabaseClient => ({
    async connect() {},
    async end() {},
    async query(sql: string) {
      if (sql.startsWith("BEGIN ") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql === "SHOW transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] };
      }
      if (sql.includes("current_setting('server_version')")) {
        const version = options.postgresVersion ?? "16.2";
        const [major = "16", minor = "0"] = version.split(".");
        return { rows: [{ version, version_num: `${major}${minor.padStart(2, "0")}00` }] };
      }
      if (sql.includes("SELECT c.relname AS name")) {
        return {
          rows: [
            { name: "isp_admins", kind: "r", estimated_rows: "4" },
            { name: "isp_routers", kind: "r", estimated_rows: "9" },
          ],
        };
      }
      if (sql.includes("SELECT c.conname AS name")) {
        return {
          rows: [{
            name: "isp_routers_admin_id_fkey",
            source_table: "public.isp_routers",
            destination_table: "public.isp_admins",
            validated: true,
          }],
        };
      }
      if (sql.includes("SELECT extname AS name")) {
        return {
          rows: [{
            name: "supabase_vault",
            version: connection.projectRef === MIGRATION_DESTINATION_PROJECT_REF
              ? options.destinationExtensionVersion ?? "0.3.1"
              : options.sourceExtensionVersion ?? "0.3.1",
          }],
        };
      }
      if (sql.includes("SELECT object_kind, object_name")) {
        return {
          rows: connection.projectRef === MIGRATION_DESTINATION_PROJECT_REF
            ? (options.targetConflicts ?? []).map((name) => ({ object_kind: "table", object_name: name }))
            : [],
        };
      }
      if (sql.includes("SELECT count(*)::text AS row_count")) {
        const destination = connection.projectRef === MIGRATION_DESTINATION_PROJECT_REF;
        const rowCount = destination
          ? (state.restored ? options.destinationRowsAfterRestore ?? 4 : 0)
          : 4;
        return { rows: [{ row_count: String(rowCount) }] };
      }
      if (sql.includes("FROM information_schema.columns")) {
        const destinationMismatch = connection.projectRef === MIGRATION_DESTINATION_PROJECT_REF
          && state.restored
          && options.schemaMismatchAfterRestore;
        return {
          rows: [{
            table_name: "isp_admins",
            column_name: "id",
            ordinal_position: 1,
            data_type: destinationMismatch ? "text" : "integer",
            udt_schema: "pg_catalog",
            udt_name: destinationMismatch ? "text" : "int4",
            is_nullable: "NO",
            column_default: null,
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            datetime_precision: null,
          }],
        };
      }
      if (sql.includes("FROM pg_indexes")) {
        return { rows: [{ indexname: "isp_admins_pkey" }] };
      }
      if (sql.includes("FROM pg_views")) {
        return { rows: [{ kind: "view", name: "isp_admin_summary", definition: "SELECT 1" }] };
      }
      if (sql.includes("pg_get_functiondef")) {
        return { rows: [{ identity: "public.refresh_isp_summary()", kind: "f", definition: "SELECT 1" }] };
      }
      if (
        sql.includes("pg_get_constraintdef")
        || sql.includes("FROM pg_trigger")
        || sql.includes("FROM pg_policies")
        || sql.includes("FROM pg_type")
      ) {
        return { rows: [] };
      }
      throw new Error("Unexpected mocked query.");
    },
  });
}

class FakeChild extends EventEmitter {
  stdout: PassThrough | null = null;
  kill(): void {}
}

function createSuccessfulSpawn(
  state: { restored: boolean; failBackupVerification?: boolean; restoredToc?: string },
  captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }>,
  toolMajor = 16,
): MigrationSpawn {
  return ((command, args, options) => {
    const env = options.env ?? {};
    captured.push({ command, args, env: { ...env } });
    const child = new FakeChild();
    const isDumpCommand = command.includes("pg_dump");
    const isRestoreCommand = command.includes("pg_restore");
    if (args.includes("--version")) {
      child.stdout = new PassThrough();
      queueMicrotask(() => {
        child.stdout?.end(`${command} (PostgreSQL) ${toolMajor}.15`);
        child.emit("close", 0);
      });
    } else if (isDumpCommand && args.includes("--file")) {
      const fileIndex = args.indexOf("--file");
      const archivePath = args[fileIndex + 1];
      queueMicrotask(() => {
        void writeFile(String(archivePath), "custom archive test bytes")
          .then(() => child.emit("close", 0));
      });
    } else if (isDumpCommand) {
      child.stdout = new PassThrough();
      queueMicrotask(() => {
        child.stdout?.end("custom archive test bytes");
        child.emit("close", 0);
      });
    } else if (isRestoreCommand && args.includes("--list")) {
      child.stdout = new PassThrough();
      queueMicrotask(() => {
        child.stdout?.end([
          "; test table of contents",
          "1; 2615 2200 SCHEMA - public postgres",
          "2; 0 0 COMMENT - SCHEMA public postgres",
          "3; 1259 16384 TABLE public isp_admins postgres",
          "4; 0 16384 TABLE DATA public isp_admins postgres",
          "5; 0 0 EXTENSION - supabase_vault",
          "6; 0 0 COMMENT - EXTENSION supabase_vault",
          "",
        ].join("\n"));
        child.emit("close", 0);
      });
    } else if (isRestoreCommand && args.includes("/dev/null")) {
      queueMicrotask(() => child.emit("close", state.failBackupVerification ? 1 : 0));
    } else if (isRestoreCommand && args.includes("--dbname")) {
      const listIndex = args.indexOf("--use-list");
      const tocPath = listIndex >= 0 ? args[listIndex + 1] : undefined;
      queueMicrotask(() => {
        void (tocPath ? readFile(tocPath, "utf8") : Promise.resolve(""))
          .then((restoreToc) => {
            state.restoredToc = restoreToc;
            state.restored = true;
            child.emit("close", 0);
          });
      });
    } else {
      queueMicrotask(() => child.emit("close", 1));
    }
    return child as unknown as ReturnType<MigrationSpawn>;
  }) as MigrationSpawn;
}

test("connection parser accepts only the fixed Supabase project references", () => {
  const parsed = parseSupabaseDatabaseUrl(sourceUrl, MIGRATION_SOURCE_PROJECT_REF);
  assert.equal(parsed.projectRef, MIGRATION_SOURCE_PROJECT_REF);
  assert.equal(parsed.host, `db.${MIGRATION_SOURCE_PROJECT_REF}.supabase.co`);
  assert.equal(parsed.password, sourceSecret);
  assert.equal(
    parseSupabaseDatabaseUrl(
      `postgresql://postgres.${MIGRATION_DESTINATION_PROJECT_REF}:pw@aws-0-region.pooler.supabase.com:6543/postgres`,
      MIGRATION_DESTINATION_PROJECT_REF,
    ).projectRef,
    MIGRATION_DESTINATION_PROJECT_REF,
  );
  assert.equal(
    parseSupabaseDatabaseUrl(
      sourceUrl,
      MIGRATION_SOURCE_PROJECT_REF,
      sourceRootCertificate,
    ).caCertificate,
    sourceRootCertificate,
  );
  errorCode(
    () => parseSupabaseDatabaseUrl(sourceUrl, MIGRATION_SOURCE_PROJECT_REF, "not a PEM certificate"),
    "invalid_certificate",
  );
});

test("connection parser rejects wrong projects, arbitrary hosts, and disabled TLS", () => {
  errorCode(() => parseSupabaseDatabaseUrl(sourceUrl, MIGRATION_DESTINATION_PROJECT_REF), "wrong_project");
  errorCode(() => parseSupabaseDatabaseUrl("postgresql://u:p@db.example.com:5432/postgres", MIGRATION_SOURCE_PROJECT_REF), "invalid_connection");
  errorCode(() => parseSupabaseDatabaseUrl(
    `postgresql://postgres:${sourceSecret}@db.${MIGRATION_SOURCE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=disable`,
    MIGRATION_SOURCE_PROJECT_REF,
  ), "invalid_connection");
});

test("source connection failures expose a safe category and stage, never driver details", async () => {
  const sourceFailure = Object.assign(
    new Error(`password=${sourceSecret} host=db.${MIGRATION_SOURCE_PROJECT_REF}.supabase.co`),
    { code: "28P01" },
  );
  const clientFactory: MigrationClientFactory = () => ({
    async connect() { throw sourceFailure; },
    async end() {},
    async query() { return { rows: [] }; },
  });

  await assert.rejects(
    inspectSupabaseMigration(sourceUrl, destinationUrl, {
      clientFactory,
      skipSchemaManifest: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseMigrationError);
      assert.equal(error.code, "source_connection_failed");
      assert.deepEqual(error.diagnostic, { category: "authentication", stage: "connect" });
      assert.equal(JSON.stringify(error).includes(sourceSecret), false);
      assert.equal(JSON.stringify(error.diagnostic).includes(MIGRATION_SOURCE_PROJECT_REF), false);
      return true;
    },
  );
});

test("preflight returns a fixed public-schema plan without exposing connection values", async () => {
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory(),
    skipSchemaManifest: true,
  });
  assert.equal(plan.canMigrate, true);
  assert.equal(plan.sourceProjectRef, MIGRATION_SOURCE_PROJECT_REF);
  assert.equal(plan.destinationProjectRef, MIGRATION_DESTINATION_PROJECT_REF);
  assert.deepEqual(plan.tables.map((table) => table.name), ["isp_admins", "isp_routers"]);
  assert.deepEqual(plan.publicObjects.tables, ["isp_admins", "isp_routers"]);
  assert.deepEqual(plan.publicObjects.views, ["isp_admin_summary"]);
  assert.deepEqual(plan.publicObjects.functions, ["public.refresh_isp_summary()"]);
  assert.deepEqual(plan.publicObjects.indexes, ["isp_admins_pkey"]);
  assert.equal(plan.foreignKeyCount, 1);
  assert.equal(JSON.stringify(plan).includes(sourceSecret), false);
  assert.equal(JSON.stringify(plan).includes(destinationSecret), false);
});

test("preflight manifest comes from a schema-only PostgreSQL archive and omits owners", async () => {
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory(),
    spawn: createSuccessfulSpawn({ restored: false }, captured),
    sourceRootCertificate,
  });
  assert.ok(plan.schemaManifest.some((entry) => entry.includes("TABLE public isp_admins")));
  assert.equal(plan.schemaManifest.some((entry) => entry.includes("SCHEMA - public")), false);
  assert.equal(plan.schemaManifest.some((entry) => entry.includes("EXTENSION")), false);
  assert.equal(plan.schemaManifest.some((entry) => entry.endsWith(" postgres")), false);
  const schemaDump = captured.find((item) => item.args.includes("--schema-only"));
  assert.ok(schemaDump);
  assert.ok(schemaDump.args.includes("--file"));
  assert.ok(schemaDump.args.includes("--schema=public"));
  assert.equal(schemaDump.env.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.equal(schemaDump.env.PGSSLMODE, "verify-full");
  assert.equal(typeof schemaDump.env.PGSSLROOTCERT, "string");
  assert.equal(captured.flatMap((item) => item.args).join(" ").includes(sourceSecret), false);
});

test("preflight reports the installed PostgreSQL client major instead of a generic tools error", async () => {
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({ postgresVersion: "17.6" }),
    spawn: createSuccessfulSpawn({ restored: false }, captured, 16),
  });
  assert.equal(plan.canMigrate, false);
  assert.deepEqual(plan.schemaManifest, []);
  assert.deepEqual(plan.toolFailure, {
    errorCode: "postgres_client_version_mismatch",
    diagnostic: {
      category: "tool_version_mismatch",
      stage: "tool_check",
      tool: "pg_dump",
      toolMajor: 16,
      requiredMajor: 17,
    },
  });
  assert.equal(captured.some((item) => item.args.includes("--schema-only")), false);
});

test("preflight allows the reviewed Vault 0.3.1 to 0.3.2 transition without changing the extension", async () => {
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({
      sourceExtensionVersion: "0.3.1",
      destinationExtensionVersion: "0.3.2",
    }),
    skipSchemaManifest: true,
  });
  assert.equal(plan.canMigrate, true);
  assert.deepEqual(plan.extensionVersionMismatches, []);
  assert.deepEqual(plan.compatibleExtensionVersionDifferences, [
    "supabase_vault: source 0.3.1, destination 0.3.2",
  ]);
  assert.deepEqual(plan.missingDestinationExtensions, []);
});

test("preflight keeps reverse and unknown extension version transitions blocked", async () => {
  const reverse = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({
      sourceExtensionVersion: "0.3.2",
      destinationExtensionVersion: "0.3.1",
    }),
    skipSchemaManifest: true,
  });
  assert.equal(reverse.canMigrate, false);
  assert.deepEqual(reverse.compatibleExtensionVersionDifferences, []);
  assert.deepEqual(reverse.extensionVersionMismatches, [
    "supabase_vault: source 0.3.2, destination 0.3.1",
  ]);

  const unknown = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({
      sourceExtensionVersion: "0.3.1",
      destinationExtensionVersion: "0.3.3",
    }),
    skipSchemaManifest: true,
  });
  assert.equal(unknown.canMigrate, false);
  assert.deepEqual(unknown.compatibleExtensionVersionDifferences, []);
  assert.deepEqual(unknown.extensionVersionMismatches, [
    "supabase_vault: source 0.3.1, destination 0.3.3",
  ]);
});

test("preflight blocks a non-empty destination and reports only object names", async () => {
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({ targetConflicts: ["isp_admins"] }),
    skipSchemaManifest: true,
  });
  assert.equal(plan.canMigrate, false);
  assert.deepEqual(plan.destinationConflicts, ["table:isp_admins"]);
  assert.equal(JSON.stringify(plan).includes(destinationSecret), false);
});

test("migration verifies a durable source backup before any destination write", async () => {
  const state: { restored: boolean; restoredToc?: string } = { restored: false };
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({
      state,
      sourceExtensionVersion: "0.3.1",
      destinationExtensionVersion: "0.3.2",
    }),
    skipSchemaManifest: true,
  });
  const result = await runSupabasePublicMigration(sourceUrl, destinationUrl, plan.fingerprint, {
    clientFactory: createClientFactory({
      state,
      sourceExtensionVersion: "0.3.1",
      destinationExtensionVersion: "0.3.2",
    }),
    spawn: createSuccessfulSpawn(state, captured),
    skipSchemaManifest: true,
    sourceRootCertificate,
    destinationRootCertificate,
    backupDirectory: testBackupDirectory,
    allowTemporaryBackupDirectory: true,
  });
  const backup = result.sourceBackup;
  assert.equal(result.plan.canMigrate, true);
  assert.deepEqual(result.plan.compatibleExtensionVersionDifferences, [
    "supabase_vault: source 0.3.1, destination 0.3.2",
  ]);
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.schemaMatches, true);
  assert.ok(backup);
  const backupPath = join(testBackupDirectory, "supabase-migration", backup.artifactName);
  const backupInfo = await stat(backupPath);
  const backupDirInfo = await stat(join(testBackupDirectory, "supabase-migration"));
  assert.equal(backupInfo.size, backup.sizeBytes);
  assert.equal(backupInfo.mode & 0o777, 0o600);
  assert.equal(backupDirInfo.mode & 0o777, 0o700);
  assert.match(backup.sha256, /^[a-f0-9]{64}$/);
  const backupDumpIndex = captured.findIndex((item) => (
    item.command.includes("pg_dump") && item.args.includes("--file") && !item.args.includes("--schema-only")
  ));
  const restoreIndex = captured.findIndex((item) => (
    item.command.includes("pg_restore") && item.args.includes("--dbname")
  ));
  assert.ok(backupDumpIndex >= 0);
  assert.ok(restoreIndex > backupDumpIndex, "destination restore must happen after source backup creation");
  assert.ok(captured.some((item) => item.command.includes("pg_restore") && item.args.includes("/dev/null")));
  assert.equal(captured.flatMap((item) => item.args).join(" ").includes(sourceSecret), false);
  assert.equal(captured.flatMap((item) => item.args).join(" ").includes(destinationSecret), false);
  assert.equal(JSON.stringify(captured.map((item) => item.env)).includes(sourceRootCertificate), false);
  assert.equal(JSON.stringify(captured.map((item) => item.env)).includes(destinationRootCertificate), false);
  const sourceDump = captured.find((item) => item.args.includes("--file") && !item.args.includes("--schema-only"));
  assert.equal(sourceDump?.env.PGPASSWORD, sourceSecret);
  assert.equal(sourceDump?.env.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.equal(sourceDump?.env.PGSSLMODE, "verify-full");
  assert.equal(state.restored, true);
  assert.equal(state.restoredToc?.includes("EXTENSION"), false);
});

test("migration stops before destination restore when source backup verification fails", async () => {
  const state = { restored: false, failBackupVerification: true };
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({ state }),
    skipSchemaManifest: true,
  });
  await assert.rejects(
    runSupabasePublicMigration(sourceUrl, destinationUrl, plan.fingerprint, {
      clientFactory: createClientFactory({ state }),
      spawn: createSuccessfulSpawn(state, captured),
      skipSchemaManifest: true,
      backupDirectory: testBackupDirectory,
      allowTemporaryBackupDirectory: true,
    }),
    (error: unknown) => error instanceof SupabaseMigrationError
      && error.code === "source_backup_integrity_failed",
  );
  assert.equal(captured.some((item) => item.command.includes("pg_restore") && item.args.includes("--dbname")), false);
  assert.equal(state.restored, false);
});

test("migration verifies row counts and foreign-key relationships after restore", async () => {
  const state = { restored: false };
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const result = await runSupabasePublicMigration(sourceUrl, destinationUrl, (await inspectSupabaseMigration(
    sourceUrl,
    destinationUrl,
    { clientFactory: createClientFactory({ state }), skipSchemaManifest: true },
  )).fingerprint, {
    clientFactory: createClientFactory({ state }),
    spawn: createSuccessfulSpawn(state, captured),
    skipSchemaManifest: true,
    backupDirectory: testBackupDirectory,
    allowTemporaryBackupDirectory: true,
  });
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.tableCount, 2);
  assert.equal(result.verification.sourceForeignKeyCount, 1);
  assert.equal(result.verification.destinationForeignKeyCount, 1);
  assert.equal(result.verification.relationshipsMatch, true);
});

test("row-count differences are surfaced without leaking credentials", async () => {
  const state = { restored: false };
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory({ state }),
    skipSchemaManifest: true,
  });
  const result = await runSupabasePublicMigration(sourceUrl, destinationUrl, plan.fingerprint, {
    clientFactory: createClientFactory({ state, destinationRowsAfterRestore: 3 }),
    spawn: createSuccessfulSpawn(state, captured),
    skipSchemaManifest: true,
    backupDirectory: testBackupDirectory,
    allowTemporaryBackupDirectory: true,
  });
  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.countMismatches, [
    { table: "isp_admins", sourceRows: 4, destinationRows: 3 },
    { table: "isp_routers", sourceRows: 4, destinationRows: 3 },
  ]);
  assert.equal(JSON.stringify(result).includes(sourceSecret), false);
  assert.equal(JSON.stringify(result).includes(destinationSecret), false);
});

test("schema differences after restore are reported for review", async () => {
  const state = { restored: false };
  const captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const options = { state, schemaMismatchAfterRestore: true };
  const plan = await inspectSupabaseMigration(sourceUrl, destinationUrl, {
    clientFactory: createClientFactory(options),
    skipSchemaManifest: true,
  });
  const result = await runSupabasePublicMigration(sourceUrl, destinationUrl, plan.fingerprint, {
    clientFactory: createClientFactory(options),
    spawn: createSuccessfulSpawn(state, captured),
    skipSchemaManifest: true,
    backupDirectory: testBackupDirectory,
    allowTemporaryBackupDirectory: true,
  });
  assert.equal(result.verification.schemaMatches, false);
  assert.equal(result.verification.verified, false);
});
