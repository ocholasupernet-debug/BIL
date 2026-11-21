import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";

const SOURCE_REF = "qfsxsbzaqwmyuxhramyw";
const DESTINATION_REF = "vuvyweofsutgqdtbjckj";
const C = {
  card: "rgba(255,255,255,0.04)",
  border: "var(--isp-accent-glow)",
  accent: "var(--isp-accent)",
  text: "#e2e8f0",
  muted: "#64748b",
  sub: "#94a3b8",
  green: "#4ade80",
  red: "#fca5a5",
  amber: "#fbbf24",
};

interface MigrationPlan {
  ok?: boolean;
  scope: "public";
  sourceProjectRef: string;
  destinationProjectRef: string;
  sourcePostgresVersion: string;
  destinationPostgresVersion: string;
  tables: Array<{ name: string; kind: "table" | "materialized_view"; estimatedRows: number | null }>;
  publicObjects: {
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
  };
  foreignKeyCount: number;
  sourceExtensions: string[];
  missingDestinationExtensions: string[];
  extensionVersionMismatches: string[];
  destinationConflicts: string[];
  toolFailure?: {
    errorCode: string;
    diagnostic?: { category?: string; stage?: string; tool?: string; toolMajor?: number; requiredMajor?: number } | null;
  } | null;
  blockers: string[];
  schemaManifest: string[];
  fingerprint: string;
}

interface MigrationVerification {
  verified: boolean;
  tableCount: number;
  schemaMatches: boolean;
  sourceForeignKeyCount: number;
  destinationForeignKeyCount: number;
  relationshipsMatch: boolean;
  countMismatches: Array<{ table: string; sourceRows: number; destinationRows: number }>;
}

interface MigrationJob {
  id: string;
  state: "running" | "completed" | "failed";
  stage: "checking" | "backing_up" | "copying" | "verifying" | "finished";
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  diagnostic: { category?: string; stage?: string; tool?: string; toolMajor?: number; requiredMajor?: number } | null;
  verification: MigrationVerification | null;
  sourceBackup: { artifactName: string; sizeBytes: number; sha256: string; verifiedAt: string } | null;
}

interface ApiError {
  ok?: boolean;
  error?: string;
  diagnostic?: { category?: string; stage?: string; tool?: string; toolMajor?: number; requiredMajor?: number };
  jobId?: string;
  job?: MigrationJob;
}

function authHeaders(): Record<string, string> {
  return {
    "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "",
  };
}

function humanError(
  code: string | undefined,
  diagnostic?: ApiError["diagnostic"],
): string {
  if (
    code === "postgres_client_version_mismatch"
    && diagnostic?.toolMajor
    && diagnostic.requiredMajor
  ) {
    return `${diagnostic.tool || "PostgreSQL client"} major ${diagnostic.toolMajor} cannot process this source. Install PostgreSQL ${diagnostic.requiredMajor} client tools; strict TLS verification remains enabled.`;
  }
  if (
    (code === "source_connection_failed" || code === "destination_connection_failed")
    && diagnostic?.category
  ) {
    const side = code === "source_connection_failed" ? "source" : "destination";
    const messages: Record<string, string> = {
      authentication: `The ${side} PostgreSQL server rejected authentication. Verify its password and session-pooler username.`,
      permission: `The ${side} connection was accepted, but its role cannot read the required schema metadata.`,
      dns: `The ${side} pooler hostname could not be resolved. Copy the host from that project's Session pooler settings.`,
      network: `The ${side} pooler could not be reached. Verify its host, port, and network availability.`,
      tls: `Strict TLS certificate verification failed for the ${side}. Upload the matching project's root certificate from Database Settings → SSL Configuration; certificate checks remain enabled.`,
      timeout: `The ${side} database did not respond before the read-only check timed out.`,
      database_unavailable: `The ${side} PostgreSQL service refused or could not accept the connection.`,
      tool_version_mismatch: "The PostgreSQL dump/restore client major version does not match the source server.",
      tool_missing: "The required PostgreSQL dump/restore client is not installed on this server.",
      tool_execution: `The ${side} PostgreSQL operation failed. No connection details were logged.`,
      other: `The ${side} read-only check failed for an unclassified reason. No connection details were logged.`,
    };
    return messages[diagnostic.category]
      ?? `The ${side} read-only check failed. No connection details were logged.`;
  }
  const messages: Record<string, string> = {
    invalid_connection: "A connection string is invalid or uses an unsupported host.",
    invalid_certificate: "Upload a valid PEM root certificate downloaded from the matching Supabase project's Database settings.",
    wrong_project: "The connection string does not match the expected source or destination project.",
    source_connection_failed: "The source database could not be checked. Verify its connection and read access.",
    source_read_only_unavailable: "The source connection could not be guaranteed read-only. No migration was started.",
    destination_connection_failed: "The destination database could not be checked. Verify its connection and access.",
    source_public_schema_empty: "No BIL tables were found in the source public schema.",
    destination_public_schema_not_empty: "The destination already contains public schema objects; copying is blocked.",
    destination_extensions_missing: "Install the source extensions on the destination before copying.",
    destination_extension_versions_differ: "The source and destination extension versions differ. Do not upgrade or downgrade either project automatically; review compatibility before copying.",
    postgres_major_versions_differ: "Use the same PostgreSQL major version for both projects.",
    postgres_version_mismatch: "The source and destination PostgreSQL major versions differ. Align the reviewed migration plan before copying.",
    stale_plan: "The database layout changed after review. Run the preflight again.",
    unsafe_plan: "The preflight found a blocker. Review it before continuing.",
    migration_tools_unavailable: diagnostic?.tool === "pg_dump" || diagnostic?.tool === "pg_restore"
      ? `${diagnostic.tool} is not available in a PostgreSQL ${diagnostic.requiredMajor ?? "matching"} client installation.`
      : "PostgreSQL dump/restore tools are unavailable or could not run on this server.",
    postgres_client_version_mismatch: "The installed PostgreSQL dump/restore client is older or newer than the source server. Install matching client tools; SSL verification remains enabled.",
    source_backup_failed: "The source public-schema backup could not be created. No destination write was attempted.",
    source_backup_integrity_failed: "The source backup failed archive integrity verification. No destination write was attempted.",
    destination_not_empty: "The destination public schema changed or is no longer empty. No copy was started.",
    restore_failed: "The database copy failed. The destination transaction was rolled back when possible.",
    restore_timed_out: "The database copy exceeded the time limit and was stopped.",
    verification_failed: "The copy finished but row counts or relationships did not match. Do not cut over.",
    migration_failed: "The migration could not be completed. No credential details were returned.",
  };
  return messages[code || ""] || "The request could not be completed. Check the entered connections and try again.";
}

function formatRows(value: number | null): string {
  if (value === null) return "estimate unavailable";
  return `about ${value.toLocaleString()} rows`;
}

export default function SuperAdminSupabaseMigration() {
  const [sourceDatabaseUrl, setSourceDatabaseUrl] = useState("");
  const [destinationDatabaseUrl, setDestinationDatabaseUrl] = useState("");
  const [sourceRootCertificate, setSourceRootCertificate] = useState("");
  const [destinationRootCertificate, setDestinationRootCertificate] = useState("");
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<MigrationJob | null>(null);

  const clearConnections = () => {
    setSourceDatabaseUrl("");
    setDestinationDatabaseUrl("");
    setSourceRootCertificate("");
    setDestinationRootCertificate("");
  };

  const loadRootCertificate = (
    file: File | undefined,
    setCertificate: (value: string) => void,
  ) => {
    if (!file) {
      setCertificate("");
      return;
    }
    if (file.size > 64 * 1024) {
      setCertificate("");
      setError("Root certificate files must be 64 KiB or smaller.");
      return;
    }
    void file.text().then((certificate) => {
      setCertificate(certificate);
      setError("");
    }).catch(() => {
      setCertificate("");
      setError("The selected root certificate could not be read.");
    });
  };

  useEffect(() => {
    const clearOnPageHide = () => {
      setSourceDatabaseUrl("");
      setDestinationDatabaseUrl("");
      setSourceRootCertificate("");
      setDestinationRootCertificate("");
    };
    window.addEventListener("pagehide", clearOnPageHide);
    return () => window.removeEventListener("pagehide", clearOnPageHide);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/super-admin/supabase-migration/jobs/${encodeURIComponent(jobId)}`,
          { headers: authHeaders(), cache: "no-store" },
        );
        const data = await response.json() as ApiError;
        if (!response.ok || !data.job || cancelled) {
          if (!cancelled) setError(humanError(data.error));
          return;
        }
        setJob(data.job);
        if (data.job.state === "running") {
          timer = window.setTimeout(() => void poll(), 1800);
        } else {
          clearConnections();
          setConfirmation("");
          if (data.job.state === "failed") {
            setError(humanError(data.job.errorCode || undefined, data.job.diagnostic || undefined));
          }
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void poll(), 3500);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId]);

  const runPreflight = async () => {
    setError("");
    setPlan(null);
    setJob(null);
    setJobId("");
    setBusy(true);
    try {
      const response = await fetch("/api/super-admin/supabase-migration/preflight", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sourceDatabaseUrl,
          destinationDatabaseUrl,
          sourceRootCertificate,
          destinationRootCertificate,
        }),
      });
      const data = await response.json() as MigrationPlan & ApiError;
      if (data.sourceProjectRef && data.destinationProjectRef) {
        setPlan(data);
      }
      if (!response.ok && !data.sourceProjectRef) {
          setError(humanError(data.error, data.diagnostic));
      }
    } catch {
      setError("The preflight request failed. Verify the server is available and try again.");
    } finally {
      clearConnections();
      setBusy(false);
    }
  };

  const startMigration = async () => {
    if (!plan || !plan.ok || confirmation !== DESTINATION_REF) return;
    setError("");
    setBusy(true);
    setJob(null);
    try {
      const response = await fetch("/api/super-admin/supabase-migration/run", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sourceDatabaseUrl,
          destinationDatabaseUrl,
          sourceRootCertificate,
          destinationRootCertificate,
          fingerprint: plan.fingerprint,
          confirmation,
        }),
      });
      const data = await response.json() as ApiError;
      if (!response.ok || !data.jobId) {
        setError(humanError(data.error, data.diagnostic));
        return;
      }
      setJobId(data.jobId);
      setJob({
        id: data.jobId,
        state: "running",
        stage: "checking",
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorCode: null,
        diagnostic: null,
        verification: null,
        sourceBackup: null,
      });
    } catch {
      setError("The migration request failed before a job could be confirmed.");
    } finally {
      clearConnections();
      setBusy(false);
    }
  };

  const statusLabel = job?.stage === "checking"
    ? "Rechecking the reviewed plan"
    : job?.stage === "backing_up"
      ? "Creating and verifying source backup"
      : job?.stage === "copying"
        ? "Copying the public schema to the destination"
        : job?.stage === "verifying"
          ? "Checking row counts and relationships"
          : "Migration status";
  const objectGroups = plan ? [
    { label: "Views", names: plan.publicObjects.views },
    { label: "Materialized views", names: plan.publicObjects.materializedViews },
    { label: "Sequences", names: plan.publicObjects.sequences },
    { label: "Functions and procedures", names: plan.publicObjects.functions },
    { label: "Custom types", names: plan.publicObjects.types },
    { label: "Indexes", names: plan.publicObjects.indexes },
    { label: "Constraints", names: plan.publicObjects.constraints },
    { label: "Triggers", names: plan.publicObjects.triggers },
    { label: "RLS policies", names: plan.publicObjects.policies },
  ].filter((group) => group.names.length > 0) : [];

  return (
    <SuperAdminLayout>
      <div className="bil-migration-page">
        <header className="bil-migration-header">
          <div>
            <h1>Supabase Migration</h1>
            <p>Enter the source and destination PostgreSQL connections, then run the read-only preflight review. Before any destination write, the server creates and verifies a restricted public-schema source backup; copying still requires a clean review and the typed destination project ID.</p>
          </div>
          <div className="bil-migration-badge"><Lock size={14} /> Super Admin only</div>
        </header>

        <section className="bil-migration-warning">
          <ShieldCheck size={18} />
          <div>
            <strong>Credentials stay temporary</strong>
            <p>Connection strings and optional root certificates are sent only to this authenticated API over the same origin, held temporarily in memory, and cleared after each request. They are not saved in browser storage, files, logs, or app settings.</p>
          </div>
        </section>

        <section className="bil-migration-scope">
          <div className="bil-migration-scope-title"><Database size={16} /><strong>Migration scope and safety boundary</strong></div>
          <ul>
            <li>Copies only the BIL application’s <code>public</code> PostgreSQL schema and data; PostgreSQL restore order handles table dependencies.</li>
            <li>The source is opened read-only. A checksum- and archive-verified public-schema backup is retained in the server backup directory before any destination write.</li>
            <li>Destination project identity and public-schema emptiness are checked again after backup and immediately before restore.</li>
            <li>Database roles, object owners, ACL grants, non-public schemas, and PostgreSQL large objects are excluded and need separate review.</li>
            <li>No R2 changes, production switch, automatic cutover, or deployment are performed.</li>
          </ul>
        </section>

        <section className="bil-migration-deferred">
          <h2>Separate items not migrated by this step</h2>
          <div className="bil-migration-deferred-grid">
            <div>
              <strong>Supabase Auth users and identities</strong>
              <span>No Supabase Auth SDK or Admin API use was found in the app code. Live users and identities have not been inspected and will not be copied here.</span>
            </div>
            <div>
              <strong>Supabase Storage files</strong>
              <span>The app has server-side bucket/object metadata telemetry, but no Storage upload/download flow was found. Actual file objects are unknown and will not be copied here.</span>
            </div>
            <div>
              <strong>Project settings and Edge Functions</strong>
              <span>These are outside the PostgreSQL public-schema transfer and need separate review and migration.</span>
            </div>
          </div>
        </section>

        <section className="bil-migration-card">
          <div className="bil-migration-card-title">
            <span className="bil-migration-step">1</span>
            <div><h2>Enter database connections</h2><p>Use Supabase PostgreSQL direct or session-pooler URLs with SSL enabled.</p></div>
          </div>
          <div className="bil-migration-grid">
            <label>
              <span>Source connection</span>
              <small>Expected project: <code>{SOURCE_REF}</code></small>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={sourceDatabaseUrl}
                onChange={(event) => setSourceDatabaseUrl(event.target.value)}
                placeholder="postgresql://postgres:••••@db.<source-ref>.supabase.co:5432/postgres"
                aria-label="Source database connection string"
              />
            </label>
            <label>
              <span>Destination connection</span>
              <small>Expected project: <code>{DESTINATION_REF}</code></small>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={destinationDatabaseUrl}
                onChange={(event) => setDestinationDatabaseUrl(event.target.value)}
                placeholder="postgresql://postgres:••••@db.<destination-ref>.supabase.co:5432/postgres"
                aria-label="Destination database connection string"
              />
            </label>
          </div>
          <div className="bil-migration-grid">
            <label>
              <span>Source TLS root certificate (optional)</span>
              <small>Upload the source project's certificate from Database Settings → SSL Configuration.</small>
              <input
                type="file"
                accept=".crt,.pem,application/x-pem-file,text/plain"
                aria-label="Source Supabase TLS root certificate"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  loadRootCertificate(file, setSourceRootCertificate);
                }}
              />
              {sourceRootCertificate && <small>Root certificate loaded in memory for this check.</small>}
            </label>
            <label>
              <span>Destination TLS root certificate (optional)</span>
              <small>Upload the destination project's certificate from Database Settings → SSL Configuration.</small>
              <input
                type="file"
                accept=".crt,.pem,application/x-pem-file,text/plain"
                aria-label="Destination Supabase TLS root certificate"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  loadRootCertificate(file, setDestinationRootCertificate);
                }}
              />
              {destinationRootCertificate && <small>Root certificate loaded in memory for this check.</small>}
            </label>
          </div>
          <p className="bil-migration-actions">
            TLS verification remains enabled; the uploaded certificates are used only as trusted roots and are deleted from memory/temp files after checks.
          </p>
          <div className="bil-migration-actions">
            <button
              type="button"
              onClick={() => void runPreflight()}
              disabled={busy || !sourceDatabaseUrl || !destinationDatabaseUrl}
            >
              {busy ? <Loader2 className="bil-spin" size={15} /> : <ShieldCheck size={15} />}
              {busy ? "Checking…" : "Validate and preview"}
            </button>
            <span>Only the fixed source and destination project IDs are accepted.</span>
          </div>
        </section>

        {error && (
          <div className="bil-migration-error" role="alert"><AlertTriangle size={17} />{error}</div>
        )}

        {plan && (
          <section className="bil-migration-card">
            <div className="bil-migration-card-title">
              <span className={`bil-migration-step ${plan.ok ? "is-good" : "is-blocked"}`}>
                {plan.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
              </span>
              <div>
                <h2>{plan.ok ? "Preflight ready for review" : "Preflight found blockers"}</h2>
                <p>Source and destination credentials were cleared from the form after inspection.</p>
              </div>
            </div>
            <div className="bil-migration-summary">
              <div><span>Source</span><strong>{plan.sourceProjectRef}</strong><small>PostgreSQL {plan.sourcePostgresVersion}</small></div>
              <div><span>Destination</span><strong>{plan.destinationProjectRef}</strong><small>PostgreSQL {plan.destinationPostgresVersion}</small></div>
              <div><span>Data relations</span><strong>{plan.tables.length}</strong><small>{plan.foreignKeyCount} relationships</small></div>
            </div>

            <div className="bil-migration-table-list">
              <div className="bil-migration-list-heading"><strong>Data-bearing relations included</strong><span>Estimated source rows</span></div>
              {plan.tables.map((table) => (
                <div className="bil-migration-table-row" key={table.name}>
                  <code>{table.kind === "materialized_view" ? `materialized view · ${table.name}` : table.name}</code><span>{formatRows(table.estimatedRows)}</span>
                </div>
              ))}
              {plan.tables.length === 0 && <p className="bil-migration-empty">No public tables were found.</p>}
            </div>
            <p className="bil-migration-note">These are PostgreSQL catalog estimates, not row data. Exact source and destination counts are compared after an explicitly confirmed copy.</p>
            {objectGroups.length > 0 && (
              <div className="bil-migration-object-groups">
                <h3>Other public schema objects included</h3>
                {objectGroups.map((group) => (
                  <details key={group.label}>
                    <summary>{group.label} <span>{group.names.length}</span></summary>
                    <div className="bil-migration-object-names">
                      {group.names.map((name) => <code key={name}>{name}</code>)}
                    </div>
                  </details>
                ))}
              </div>
            )}
            {plan.schemaManifest.length > 0 && (
              <details className="bil-migration-manifest">
                <summary>Exact schema-only restore manifest · {plan.schemaManifest.length} entries</summary>
                <p>Read from a source-only, read-only pg_dump schema archive; ownership and ACL entries are excluded. Data rows are represented separately by the relations and estimates above.</p>
                <pre>{plan.schemaManifest.join("\n")}</pre>
              </details>
            )}

            {plan.sourceExtensions.length > 0 && (
              <p className="bil-migration-note"><strong>Source extensions:</strong> {plan.sourceExtensions.join(", ")}</p>
            )}
            {plan.blockers.length > 0 && (
              <div className="bil-migration-blockers">
                <strong>Resolve these before copying:</strong>
                <ul>{plan.blockers.map((blocker) => (
                  <li key={blocker}>
                    {humanError(
                      blocker,
                      blocker === plan.toolFailure?.errorCode
                        ? plan.toolFailure.diagnostic ?? undefined
                        : undefined,
                    )}
                  </li>
                ))}</ul>
              </div>
            )}
            {plan.destinationConflicts.length > 0 && (
              <p className="bil-migration-note"><strong>Destination conflicts:</strong> {plan.destinationConflicts.slice(0, 8).join(", ")}{plan.destinationConflicts.length > 8 ? `, and ${plan.destinationConflicts.length - 8} more` : ""}</p>
            )}
            {plan.missingDestinationExtensions.length > 0 && (
              <p className="bil-migration-note"><strong>Missing destination extensions:</strong> {plan.missingDestinationExtensions.join(", ")}</p>
            )}
            {plan.extensionVersionMismatches.length > 0 && (
              <p className="bil-migration-note">
                <strong>Extension version differences:</strong> {plan.extensionVersionMismatches.join("; ")}.
                Neither project will be upgraded or downgraded automatically; this difference blocks copying until compatibility is reviewed.
              </p>
            )}

            {plan.ok && (
              <div className="bil-migration-confirm">
                <h3>2. Confirm the destination before copying</h3>
                <p>Re-enter both connection strings for this one-time request, then type the destination project ID. This does not switch production.</p>
                <div className="bil-migration-grid">
                  <label>
                    <span>Source connection again</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={sourceDatabaseUrl}
                      onChange={(event) => setSourceDatabaseUrl(event.target.value)}
                      aria-label="Re-enter source database connection string"
                    />
                  </label>
                  <label>
                    <span>Destination connection again</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={destinationDatabaseUrl}
                      onChange={(event) => setDestinationDatabaseUrl(event.target.value)}
                      aria-label="Re-enter destination database connection string"
                    />
                  </label>
                </div>
                <label className="bil-migration-confirm-label">
                  <span>Type the destination project ID to authorize the copy</span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={DESTINATION_REF}
                  />
                </label>
                <button
                  className="bil-migration-run"
                  type="button"
                  onClick={() => void startMigration()}
                  disabled={busy || !sourceDatabaseUrl || !destinationDatabaseUrl || confirmation !== DESTINATION_REF}
                >
                  {busy ? <Loader2 className="bil-spin" size={15} /> : <Database size={15} />}
                  {busy ? "Starting…" : "Copy public schema to destination"}
                </button>
              </div>
            )}
          </section>
        )}

        {job && (
          <section className="bil-migration-card" aria-live="polite">
            <div className="bil-migration-card-title">
              <span className={`bil-migration-step ${job.state === "completed" ? "is-good" : job.state === "failed" ? "is-blocked" : ""}`}>
                {job.state === "running"
                  ? <RefreshCw className="bil-spin" size={16} />
                  : job.state === "completed"
                    ? <CheckCircle2 size={17} />
                    : <AlertTriangle size={17} />}
              </span>
              <div>
                <h2>{job.state === "completed" ? "Migration verification complete" : job.state === "failed" ? "Migration stopped" : statusLabel}</h2>
                <p>{job.state === "completed" ? "Review the counts and relationships below before making any separate cutover decision." : job.state === "running" ? job.stage === "backing_up" ? "The source is read-only while its public schema is dumped and verified; no destination write has started." : "The source remains read-only; the destination is being populated from the verified archive." : humanError(job.errorCode || undefined, job.diagnostic || undefined)}</p>
              </div>
            </div>
            {job.sourceBackup && (
              <p className="bil-migration-note">
                <strong>Verified source backup retained:</strong> {job.sourceBackup.artifactName} · {job.sourceBackup.sizeBytes.toLocaleString()} bytes · SHA-256 {job.sourceBackup.sha256}
              </p>
            )}
            {job.verification && (
              <>
                <div className="bil-migration-summary">
                  <div><span>Row-count check</span><strong className={job.verification.countMismatches.length === 0 ? "is-good-text" : "is-bad-text"}>{job.verification.countMismatches.length === 0 ? "Passed" : "Mismatch"}</strong><small>{job.verification.tableCount} data relations compared</small></div>
                  <div><span>Relationship check</span><strong className={job.verification.relationshipsMatch ? "is-good-text" : "is-bad-text"}>{job.verification.relationshipsMatch ? "Passed" : "Mismatch"}</strong><small>{job.verification.destinationForeignKeyCount} destination foreign keys</small></div>
                  <div><span>Schema check</span><strong className={job.verification.schemaMatches ? "is-good-text" : "is-bad-text"}>{job.verification.schemaMatches ? "Passed" : "Mismatch"}</strong><small>columns, policies, functions, and indexes</small></div>
                  <div><span>Cutover</span><strong>Not performed</strong><small>Manual review required</small></div>
                </div>
                {job.verification.countMismatches.length > 0 && (
                  <div className="bil-migration-blockers">
                    <strong>Row count mismatches</strong>
                    <ul>{job.verification.countMismatches.map((mismatch) => (
                      <li key={mismatch.table}>{mismatch.table}: source {mismatch.sourceRows.toLocaleString()}, destination {mismatch.destinationRows.toLocaleString()}</li>
                    ))}</ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>

      <style>{`
        .bil-migration-page{max-width:1040px;margin:0 auto;color:${C.text};}
        .bil-migration-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 20px;}
        .bil-migration-header h1{font-size:1.4rem;font-weight:800;color:white;margin:0;}
        .bil-migration-header p{color:${C.muted};font-size:.82rem;margin:5px 0 0;max-width:660px;line-height:1.5;}
        .bil-migration-badge{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:#93c5fd;font-size:.7rem;font-weight:700;white-space:nowrap;}
        .bil-migration-warning,.bil-migration-scope{display:flex;align-items:flex-start;gap:12px;padding:15px 17px;margin-bottom:16px;border-radius:12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);color:${C.green};}
        .bil-migration-warning p{color:${C.sub};font-size:.74rem;line-height:1.55;margin:4px 0 0;}
        .bil-migration-scope{display:block;background:rgba(59,130,246,.06);border-color:rgba(59,130,246,.18);color:#93c5fd;}
        .bil-migration-scope-title{display:flex;align-items:center;gap:8px;font-size:.82rem;}
        .bil-migration-scope ul{margin:10px 0 0;padding-left:20px;color:${C.sub};font-size:.72rem;line-height:1.8;}
        .bil-migration-deferred{margin:16px 0;padding:15px 17px;border:1px solid rgba(251,191,36,.18);border-radius:12px;background:rgba(120,53,15,.08);}
        .bil-migration-deferred h2{margin:0 0 11px;color:${C.amber};font-size:.8rem;}
        .bil-migration-deferred-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
        .bil-migration-deferred-grid>div{display:flex;flex-direction:column;gap:6px;padding:11px;border:1px solid rgba(148,163,184,.12);border-radius:9px;background:rgba(15,23,42,.25);}
        .bil-migration-deferred-grid strong{color:white;font-size:.7rem;}
        .bil-migration-deferred-grid span{color:${C.sub};font-size:.66rem;line-height:1.55;}
        .bil-migration-scope code,.bil-migration-card code{color:#bfdbfe;background:rgba(59,130,246,.08);padding:2px 4px;border-radius:4px;}
        .bil-migration-card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:19px;margin:16px 0;}
        .bil-migration-card-title{display:flex;align-items:flex-start;gap:11px;margin-bottom:18px;}
        .bil-migration-card-title h2{color:white;font-size:.95rem;margin:0;font-weight:750;}
        .bil-migration-card-title p{color:${C.muted};font-size:.72rem;margin:4px 0 0;line-height:1.45;}
        .bil-migration-step{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:0 0 28px;background:rgba(59,130,246,.14);color:#93c5fd;font-size:.78rem;font-weight:800;}
        .bil-migration-step.is-good{background:rgba(16,185,129,.14);color:${C.green};}
        .bil-migration-step.is-blocked{background:rgba(239,68,68,.12);color:${C.red};}
        .bil-migration-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}
        .bil-migration-grid label,.bil-migration-confirm-label{display:flex;flex-direction:column;gap:6px;color:${C.text};font-size:.74rem;font-weight:650;min-width:0;}
        .bil-migration-grid label small{color:${C.muted};font-weight:500;}
        .bil-migration-grid input,.bil-migration-confirm-label input{width:100%;box-sizing:border-box;border:1px solid rgba(148,163,184,.23);border-radius:8px;background:rgba(15,23,42,.5);padding:10px 11px;color:white;font:500 .74rem ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;}
        .bil-migration-grid input:focus,.bil-migration-confirm-label input:focus{border-color:${C.accent};box-shadow:0 0 0 2px rgba(59,130,246,.14);}
        .bil-migration-grid input::placeholder,.bil-migration-confirm-label input::placeholder{color:#64748b;}
        .bil-migration-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;}
        .bil-migration-actions button,.bil-migration-run{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:8px;background:${C.accent};color:white;font-size:.76rem;font-weight:750;padding:10px 14px;cursor:pointer;}
        .bil-migration-actions button:disabled,.bil-migration-run:disabled{opacity:.45;cursor:not-allowed;}
        .bil-migration-actions span{color:${C.muted};font-size:.67rem;}
        .bil-migration-error{display:flex;align-items:center;gap:9px;padding:12px 14px;margin:16px 0;border:1px solid rgba(248,113,113,.28);border-radius:10px;background:rgba(127,29,29,.14);color:${C.red};font-size:.76rem;}
        .bil-migration-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:4px 0 16px;}
        .bil-migration-summary>div{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid rgba(148,163,184,.12);border-radius:9px;background:rgba(15,23,42,.27);min-width:0;}
        .bil-migration-summary span{font-size:.62rem;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;font-weight:700;}
        .bil-migration-summary strong{font-size:.82rem;color:white;overflow-wrap:anywhere;}
        .bil-migration-summary small{font-size:.66rem;color:${C.sub};}
        .bil-migration-table-list{max-height:280px;overflow:auto;border:1px solid rgba(148,163,184,.12);border-radius:9px;}
        .bil-migration-list-heading,.bil-migration-table-row{display:flex;justify-content:space-between;gap:12px;padding:9px 12px;border-bottom:1px solid rgba(148,163,184,.1);font-size:.7rem;}
        .bil-migration-list-heading{position:sticky;top:0;background:#111827;color:${C.sub};font-size:.65rem;}
        .bil-migration-table-row code{background:none;color:${C.text};padding:0;}
        .bil-migration-table-row span{color:${C.muted};white-space:nowrap;}
        .bil-migration-empty,.bil-migration-note{font-size:.7rem;color:${C.sub};line-height:1.6;}
        .bil-migration-object-groups{margin-top:16px;}
        .bil-migration-object-groups h3{font-size:.75rem;color:white;margin:0 0 8px;}
        .bil-migration-object-groups details{border-top:1px solid rgba(148,163,184,.12);padding:8px 2px;}
        .bil-migration-object-groups summary{cursor:pointer;color:${C.sub};font-size:.7rem;}
        .bil-migration-object-groups summary span{margin-left:6px;color:${C.accent};font-weight:700;}
        .bil-migration-object-names{display:flex;flex-wrap:wrap;gap:6px;padding:9px 2px 2px;max-height:180px;overflow:auto;}
        .bil-migration-object-names code{font-size:.64rem;overflow-wrap:anywhere;}
        .bil-migration-manifest{margin-top:14px;border:1px solid rgba(148,163,184,.15);border-radius:9px;padding:10px 12px;}
        .bil-migration-manifest summary{cursor:pointer;color:${C.sub};font-size:.7rem;font-weight:700;}
        .bil-migration-manifest p{color:${C.muted};font-size:.66rem;line-height:1.5;}
        .bil-migration-manifest pre{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:${C.text};font: .64rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;}
        .bil-migration-blockers{margin-top:12px;padding:11px 13px;border:1px solid rgba(251,191,36,.2);border-radius:9px;background:rgba(120,53,15,.12);color:${C.amber};font-size:.72rem;}
        .bil-migration-blockers ul{margin:7px 0 0;padding-left:19px;color:${C.sub};line-height:1.6;}
        .bil-migration-confirm{margin-top:19px;padding-top:17px;border-top:1px solid rgba(148,163,184,.15);}
        .bil-migration-confirm h3{font-size:.82rem;color:white;margin:0;}
        .bil-migration-confirm>p{font-size:.7rem;color:${C.muted};line-height:1.55;margin:5px 0 14px;}
        .bil-migration-confirm-label{margin-top:13px;max-width:480px;}
        .bil-migration-run{margin-top:13px;background:#b45309;}
        .is-good-text{color:${C.green}!important}.is-bad-text{color:${C.red}!important}
        .bil-spin{animation:bilspin 1s linear infinite}@keyframes bilspin{to{transform:rotate(360deg)}}
        @media(max-width:700px){.bil-migration-header{flex-direction:column}.bil-migration-grid{grid-template-columns:1fr}.bil-migration-summary{grid-template-columns:1fr}.bil-migration-deferred-grid{grid-template-columns:1fr}.bil-migration-card{padding:15px}.bil-migration-actions{align-items:flex-start;flex-direction:column}}
      `}</style>
    </SuperAdminLayout>
  );
}
