import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  MIGRATION_DESTINATION_PROJECT_REF,
  MIGRATION_SOURCE_PROJECT_REF,
  SupabaseMigrationError,
  type MigrationPlan,
  type MigrationVerification,
} from "../lib/supabase-migration.js";
import { createSupabaseMigrationRouter } from "./supabase-migration-route.js";

const sourceCredential = "source-secret-sentinel-not-for-response";
const destinationCredential = "destination-secret-sentinel-not-for-response";
const sourceDatabaseUrl =
  `postgresql://postgres:${sourceCredential}@db.${MIGRATION_SOURCE_PROJECT_REF}.supabase.co:5432/postgres`;
const destinationDatabaseUrl =
  `postgresql://postgres:${destinationCredential}@db.${MIGRATION_DESTINATION_PROJECT_REF}.supabase.co:5432/postgres`;
const sourceRootCertificate =
  "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----";
const destinationRootCertificate =
  "-----BEGIN CERTIFICATE-----\nZGVm\n-----END CERTIFICATE-----";
const fingerprint = "a".repeat(64);

const plan: MigrationPlan = {
  canMigrate: true,
  sourceProjectRef: MIGRATION_SOURCE_PROJECT_REF,
  destinationProjectRef: MIGRATION_DESTINATION_PROJECT_REF,
  sourcePostgresVersion: "16.2",
  destinationPostgresVersion: "16.2",
  tables: [{ name: "isp_admins", kind: "table", estimatedRows: 4 }],
  publicObjects: {
    tables: ["isp_admins"],
    views: [],
    materializedViews: [],
    sequences: [],
    functions: [],
    types: [],
    indexes: [],
    constraints: [],
    triggers: [],
    policies: [],
  },
  foreignKeyCount: 0,
  sourceExtensions: ["plpgsql"],
  missingDestinationExtensions: [],
  extensionVersionMismatches: [],
  compatibleExtensionVersionDifferences: [],
  destinationConflicts: [],
  toolFailure: null,
  schemaManifest: ["1; 1259 20000 TABLE public isp_admins"],
  sourceSchemaFingerprint: "b".repeat(64),
  fingerprint,
};

const verification: MigrationVerification = {
  verified: true,
  tableCount: 1,
  schemaMatches: true,
  sourceForeignKeyCount: 0,
  destinationForeignKeyCount: 0,
  relationshipsMatch: true,
  countMismatches: [],
};

async function withServer<T>(
  router: express.Router,
  work: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server failed to bind.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await work(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function sameOriginHeaders(baseUrl: string, token = "valid-test-token"): Record<string, string> {
  return {
    Origin: baseUrl,
    "x-sa-token": token,
    "Content-Type": "application/json",
  };
}

test("migration preflight requires a valid Super Admin session", async () => {
  let inspectCalls = 0;
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: (token) => token === "valid-test-token",
    inspect: async () => {
      inspectCalls += 1;
      return plan;
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl, "invalid"),
      body: JSON.stringify({ sourceDatabaseUrl, destinationDatabaseUrl }),
    });
    assert.equal(response.status, 401);
    assert.equal(inspectCalls, 0);
  });
});

test("migration endpoints reject cross-origin requests before inspecting credentials", async () => {
  let inspectCalls = 0;
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: () => true,
    inspect: async () => {
      inspectCalls += 1;
      return plan;
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: { ...sameOriginHeaders(baseUrl), Origin: "https://attacker.example" },
      body: JSON.stringify({ sourceDatabaseUrl, destinationDatabaseUrl }),
    });
    assert.equal(response.status, 403);
    assert.equal(inspectCalls, 0);
  });
});

test("preflight never echoes submitted connection strings or secret values", async () => {
  let received: [string, string] | null = null;
  let receivedCertificates: [unknown, unknown] | null = null;
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: (token) => token === "valid-test-token",
    inspect: async (source, destination, options) => {
      received = [String(source), String(destination)];
      receivedCertificates = [
        options?.sourceRootCertificate,
        options?.destinationRootCertificate,
      ];
      return plan;
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({
        sourceDatabaseUrl,
        destinationDatabaseUrl,
        sourceRootCertificate,
        destinationRootCertificate,
      }),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(received, [sourceDatabaseUrl, destinationDatabaseUrl]);
    assert.deepEqual(receivedCertificates, [sourceRootCertificate, destinationRootCertificate]);
    assert.equal(text.includes('"publicObjects"'), true);
    assert.equal(text.includes('"schemaManifest"'), true);
    assert.equal(text.includes(sourceCredential), false);
    assert.equal(text.includes(destinationCredential), false);
    assert.equal(text.includes(sourceDatabaseUrl), false);
    assert.equal(text.includes(destinationDatabaseUrl), false);
    assert.equal(text.includes(sourceRootCertificate), false);
    assert.equal(text.includes(destinationRootCertificate), false);
  });
});

test("preflight returns only allowlisted diagnostic fields on source failure", async () => {
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: (token) => token === "valid-test-token",
    inspect: async () => {
      throw new SupabaseMigrationError("source_connection_failed", {
        category: "authentication",
        stage: "connect",
      });
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({ sourceDatabaseUrl, destinationDatabaseUrl }),
    });
    const body = await response.json() as {
      ok: boolean;
      error: string;
      diagnostic?: { category?: string; stage?: string };
    };
    assert.equal(response.status, 422);
    assert.deepEqual(body, {
      ok: false,
      error: "source_connection_failed",
      diagnostic: { category: "authentication", stage: "connect" },
    });
    assert.equal(JSON.stringify(body).includes(sourceCredential), false);
    assert.equal(JSON.stringify(body).includes(destinationCredential), false);
  });
});

test("preflight exposes the specific PostgreSQL client version blocker", async () => {
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: () => true,
    inspect: async () => ({
      ...plan,
      canMigrate: false,
      sourcePostgresVersion: "17.6",
      destinationPostgresVersion: "17.12",
      toolFailure: {
        errorCode: "postgres_client_version_mismatch",
        diagnostic: {
          category: "tool_version_mismatch",
          stage: "tool_check",
          tool: "pg_dump",
          toolMajor: 16,
          requiredMajor: 17,
        },
      },
    }),
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({ sourceDatabaseUrl, destinationDatabaseUrl }),
    });
    const body = await response.json() as {
      ok: boolean;
      toolFailure?: { errorCode?: string; diagnostic?: { toolMajor?: number; requiredMajor?: number } };
      blockers?: string[];
    };
    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.toolFailure?.errorCode, "postgres_client_version_mismatch");
    assert.equal(body.toolFailure?.diagnostic?.toolMajor, 16);
    assert.equal(body.toolFailure?.diagnostic?.requiredMajor, 17);
    assert.ok(body.blockers?.includes("postgres_client_version_mismatch"));
  });
});

test("preflight returns the reviewed Vault version difference as non-blocking", async () => {
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: () => true,
    inspect: async () => ({
      ...plan,
      compatibleExtensionVersionDifferences: [
        "supabase_vault: source 0.3.1, destination 0.3.2",
      ],
    }),
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/preflight`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({ sourceDatabaseUrl, destinationDatabaseUrl }),
    });
    const body = await response.json() as {
      ok: boolean;
      compatibleExtensionVersionDifferences?: string[];
      blockers?: string[];
    };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.compatibleExtensionVersionDifferences, [
      "supabase_vault: source 0.3.1, destination 0.3.2",
    ]);
    assert.equal(body.blockers?.includes("destination_extension_versions_differ"), false);
  });
});

test("migration requires explicit destination confirmation and returns sanitized status", async () => {
  let runCalls = 0;
  let runCertificates: [unknown, unknown] | null = null;
  const router = createSupabaseMigrationRouter({
    isSuperAdminTokenActive: (token) => token === "valid-test-token",
    run: async (_source, _destination, _fingerprint, options) => {
      runCalls += 1;
      runCertificates = [
        options?.sourceRootCertificate,
        options?.destinationRootCertificate,
      ];
      const sourceBackup = {
        artifactName: "bil-public-source.dump",
        sizeBytes: 1024,
        sha256: "c".repeat(64),
        verifiedAt: new Date().toISOString(),
      };
      options?.onStage?.("backing_up");
      options?.onSourceBackup?.(sourceBackup);
      options?.onStage?.("copying");
      options?.onStage?.("verifying");
      return { plan, verification, sourceBackup };
    },
  });
  await withServer(router, async (baseUrl) => {
    const invalidConfirmation = await fetch(`${baseUrl}/super-admin/supabase-migration/run`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({
        sourceDatabaseUrl,
        destinationDatabaseUrl,
        sourceRootCertificate,
        destinationRootCertificate,
        fingerprint,
        confirmation: "not-the-destination",
      }),
    });
    assert.equal(invalidConfirmation.status, 400);
    assert.equal(runCalls, 0);

    const response = await fetch(`${baseUrl}/super-admin/supabase-migration/run`, {
      method: "POST",
      headers: sameOriginHeaders(baseUrl),
      body: JSON.stringify({
        sourceDatabaseUrl,
        destinationDatabaseUrl,
        sourceRootCertificate,
        destinationRootCertificate,
        fingerprint,
        confirmation: MIGRATION_DESTINATION_PROJECT_REF,
      }),
    });
    const body = await response.text();
    const parsed = JSON.parse(body) as { jobId: string };
    assert.equal(response.status, 202);
    assert.equal(runCalls, 1);
    assert.deepEqual(runCertificates, [sourceRootCertificate, destinationRootCertificate]);
    assert.equal(body.includes(sourceCredential), false);
    assert.equal(body.includes(destinationCredential), false);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const statusResponse = await fetch(
        `${baseUrl}/super-admin/supabase-migration/jobs/${parsed.jobId}`,
        { headers: sameOriginHeaders(baseUrl) },
      );
      const statusText = await statusResponse.text();
      const status = JSON.parse(statusText) as {
        job?: {
          state?: string;
          verification?: MigrationVerification;
          sourceBackup?: { artifactName?: string; sha256?: string };
        };
      };
      assert.equal(statusText.includes(sourceCredential), false);
      assert.equal(statusText.includes(destinationCredential), false);
      if (status.job?.state === "completed") {
        assert.equal(status.job.verification?.verified, true);
        assert.equal(status.job.sourceBackup?.artifactName, "bil-public-source.dump");
        assert.equal(status.job.sourceBackup?.sha256, "c".repeat(64));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Migration job did not reach completed status.");
  });
});
