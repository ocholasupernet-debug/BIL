import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleHelp,
  Copy,
  Download,
  FileSearch,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import {
  migrationApi,
  type MigrationJobStatus,
  type MigrationPlanItem,
  type MigrationPlanResponse,
  type MigrationRouter,
} from "./migration/api";

const panel = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 14,
  padding: 18,
  boxShadow: "var(--shadow-sm)",
};
const muted = { color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.55 };
const buttonStyle = (primary = false, disabled = false) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 9,
  padding: "10px 14px",
  border: primary ? "1px solid var(--isp-accent)" : "1px solid var(--isp-border)",
  background: primary ? "var(--isp-accent)" : "var(--isp-card)",
  color: primary ? "#fff" : "var(--isp-text)",
  fontWeight: 800,
  fontSize: 13,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
});

const stages = ["Source", "Tunnel", "Inspect", "Review", "Apply"];

function downloadText(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function displayRouter(router: MigrationRouter) {
  return router.name?.trim() || `Router ${router.id}`;
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function SectionHeading({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 27, height: 27, flex: "0 0 27px", borderRadius: 99,
        background: "rgba(37,99,235,.12)", color: "var(--isp-accent)", fontSize: 12, fontWeight: 900,
      }}>{number}</span>
      <div>
        <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>{title}</div>
        <div style={{ ...muted, marginTop: 3 }}>{detail}</div>
      </div>
    </div>
  );
}

function MigrationSteps({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Migration progress" style={{
      ...panel,
      padding: "13px 16px",
      display: "grid",
      gridTemplateColumns: "repeat(5,minmax(0,1fr))",
      gap: 7,
    }}>
      {stages.map((stage, index) => {
        const done = index < currentStep;
        const active = index === currentStep;
        return (
          <div key={stage} style={{
            display: "flex", alignItems: "center", gap: 8,
            color: active || done ? "var(--isp-accent)" : "var(--isp-text-muted)",
            fontSize: 12, fontWeight: active ? 850 : 700,
          }}>
            <span style={{
              width: 23, height: 23, flex: "0 0 23px", borderRadius: 99,
              display: "inline-flex", justifyContent: "center", alignItems: "center",
              border: `1px solid ${active || done ? "var(--isp-accent)" : "var(--isp-border)"}`,
              background: done ? "var(--isp-accent)" : "transparent",
              color: done ? "#fff" : "inherit",
            }}>{done ? <Check size={13} /> : index + 1}</span>
            <span>{stage}</span>
          </div>
        );
      })}
    </nav>
  );
}

function PlanRow({
  item,
  checked,
  onChange,
}: {
  item: MigrationPlanItem;
  checked: boolean;
  onChange: (id: string, selected: boolean) => void;
}) {
  return (
    <label style={{
      display: "grid",
      gridTemplateColumns: "22px minmax(0,1fr)",
      gap: 10,
      padding: "12px 0",
      borderBottom: "1px solid var(--isp-border)",
      cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(item.id, event.target.checked)}
        aria-label={`Approve ${item.category} item ${item.id}`}
        style={{ marginTop: 3, accentColor: "var(--isp-accent)" }}
      />
      <span>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: "var(--isp-text)", fontSize: 13, fontWeight: 850 }}>{item.category}</span>
          <code style={{ color: "var(--isp-text-muted)", fontSize: 11 }}>{item.id}</code>
        </span>
        <span style={{ ...muted, display: "block", marginTop: 5 }}>
          {item.command.filter(word => word.startsWith("=")).map(word => word.replace(/^=/, "").replace(/=.*/, "")).join(", ") || "RouterOS values shown in the dry-run"}
        </span>
      </span>
    </label>
  );
}

function createMigrationRegistrationKey(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export default function NetworkMigration() {
  const [routers, setRouters] = useState<MigrationRouter[]>([]);
  const [sourceId, setSourceId] = useState<number | "">("");
  const [targetId, setTargetId] = useState<number | "">("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<MigrationJobStatus | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [tunnelScript, setTunnelScript] = useState("");
  const [collectorScript, setCollectorScript] = useState("");
  const [plan, setPlan] = useState<MigrationPlanResponse | null>(null);
  const [outcome, setOutcome] = useState<"adopt_source" | "replace_router">("replace_router");
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState<{ commands: string[][]; warnings: string[] } | null>(null);
  const [applyAcknowledged, setApplyAcknowledged] = useState(false);
  const [applyResult, setApplyResult] = useState<{ completed: boolean; partial?: boolean; failures?: string[]; limitation?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedSource = useMemo(() => routers.find(item => item.id === Number(sourceId)), [routers, sourceId]);
  const replacementRouters = useMemo(
    () => routers.filter(item => item.id !== Number(sourceId) && !item.migration_source_only),
    [routers, sourceId],
  );
  const canStartMigration = !loading && !busy && (!jobId || ["failed", "completed"].includes(job?.status ?? ""));

  const refreshJob = useCallback(async (id: number) => {
    const current = await migrationApi.job(id);
    setJob(current);
    setSourceId(current.sourceRouterId ?? "");
    setTargetId(current.targetRouterId ?? "");
    setOutcome(current.targetMode);
    if (current.status === "source_pending" || current.status === "tunnel_issued") setCurrentStep(1);
    else if (current.status === "connected") setCurrentStep(2);
    else if (current.status === "exported") setCurrentStep(3);
    else if (["target_selected", "dry_run", "importing", "completed", "failed"].includes(current.status)) setCurrentStep(4);
    return current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const savedJobId = Number(sessionStorage.getItem("ochola_router_migration_job_id"));
    const hasSavedJob = Number.isSafeInteger(savedJobId) && savedJobId > 0;
    (async () => {
      try {
        const result = await migrationApi.routers();
        if (cancelled) return;
        setRouters(result.routers);
        if (!hasSavedJob && result.routers[0]) setSourceId(result.routers[0].id);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Routers could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    if (hasSavedJob) {
      setJobId(savedJobId);
      void refreshJob(savedJobId).catch(() => {
        sessionStorage.removeItem("ochola_router_migration_job_id");
        setJobId(null);
        setJob(null);
      });
      void migrationApi.tunnelScript(savedJobId).then(result => setTunnelScript(result.tunnelScript)).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [refreshJob]);

  useEffect(() => {
    if (!jobId || job?.status === "completed" || job?.status === "failed") return;
    const timer = window.setInterval(() => {
      void refreshJob(jobId).catch(() => {});
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [jobId, job?.status, refreshJob]);

  const runBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The migration request failed."); }
    finally { setBusy(false); }
  };

  const copyScript = async (label: string, contents: string) => {
    setError("");
    setNotice("");
    try {
      await navigator.clipboard.writeText(contents);
      setNotice(`${label} copied. Run it only on the selected source router while its temporary access is valid.`);
    } catch {
      setError("Clipboard access was blocked. The complete script is visible below for manual copying.");
    }
  };

  const startMigration = () => runBusy(async () => {
    if (!sourceId) throw new Error("Choose a source router first.");
    const result = await migrationApi.start(Number(sourceId));
    setJobId(result.jobId);
    sessionStorage.setItem("ochola_router_migration_job_id", String(result.jobId));
    setTargetId("");
    setOutcome("replace_router");
    setTunnelScript(result.tunnelScript);
    setCollectorScript("");
    setPlan(null);
    setApplyResult(null);
    await refreshJob(result.jobId);
    setCurrentStep(1);
    setNotice(`Temporary tunnel reserved at ${result.tunnelAddress}. It expires at ${new Date(result.expiresAt).toLocaleString()}.`);
  });

  const startSourceRegistration = () => runBusy(async () => {
    const keyStorage = "ochola_router_migration_registration_key";
    const registrationKey = jobId
      ? createMigrationRegistrationKey()
      : sessionStorage.getItem(keyStorage) || createMigrationRegistrationKey();
    sessionStorage.setItem(keyStorage, registrationKey);
    try {
      const result = await migrationApi.registerSource(registrationKey);
      const tunnelScript = result.tunnelScript || (await migrationApi.tunnelScript(result.jobId)).tunnelScript;
      setJobId(result.jobId);
      sessionStorage.setItem("ochola_router_migration_job_id", String(result.jobId));
      setSourceId(result.sourceRouterId);
      setTargetId("");
      setOutcome("replace_router");
      setRouters(current => {
        const pending = {
          id: result.sourceRouterId,
          name: result.sourceRouterName,
          status: "setup",
          host: "",
          migration_source_only: true,
        };
        return [pending, ...current.filter(item => item.id !== pending.id)];
      });
      setTunnelScript(tunnelScript);
      setCollectorScript("");
      setPlan(null);
      setApplyResult(null);
      await refreshJob(result.jobId);
      setCurrentStep(1);
      const expiry = result.expiresAt ? ` It expires at ${new Date(result.expiresAt).toLocaleString()}.` : "";
      setNotice(`Pending source ${result.sourceRouterName} is bound to this migration. Run the temporary tunnel script; identity verification will finalize an offline, migration-only dashboard record.${expiry}`);
    } catch (cause) {
      if (cause instanceof Error && /registration attempt has ended|tunnel expired/i.test(cause.message)) {
        sessionStorage.removeItem(keyStorage);
      }
      throw cause;
    }
  });

  const reloadTunnelScript = () => runBusy(async () => {
    if (!jobId) return;
    const result = await migrationApi.tunnelScript(jobId);
    setTunnelScript(result.tunnelScript);
    setNotice("A fresh copy of the temporary tunnel script is ready.");
  });

  const verifyTunnel = () => runBusy(async () => {
    if (!jobId) return;
    const result = await migrationApi.verify(jobId);
    setCurrentStep(2);
    const collector = await migrationApi.collectorScript(jobId);
    setCollectorScript(collector.collectorScript);
    await refreshJob(jobId);
    if (result.sourceRegistered) {
      const routerList = await migrationApi.routers();
      setRouters(routerList.routers);
      setSourceId(result.sourceRouterId ?? "");
      setOutcome("replace_router");
      setNotice(`Identity verified: ${result.identity.identity}, RouterOS ${result.identity.version}. ${result.sourceRouterName} is now listed as offline and migration-only; it has no persistent router access. The collector token is time-limited.`);
    } else {
      setNotice(`RouterOS API verified: ${result.identity.identity}, RouterOS ${result.identity.version}. The collector token is time-limited.`);
    }
  });

  const refreshCollector = () => runBusy(async () => {
    if (!jobId) return;
    const collector = await migrationApi.collectorScript(jobId);
    setCollectorScript(collector.collectorScript);
    setNotice(`A fresh export collector script is ready until ${new Date(collector.expiresAt).toLocaleString()}.`);
  });

  const downloadBoth = () => {
    if (!tunnelScript || !collectorScript) return;
    downloadText(`ochola-migration-tunnel-${jobId}.rsc`, tunnelScript);
    downloadText(`ochola-migration-export-${jobId}.rsc`, collectorScript);
    setNotice("Both scripts downloaded. Run the tunnel script first, then the export collector on the source router.");
  };

  const setChoice = (id: string, checked: boolean) => {
    setApprovedIds(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
    setDryRun(null);
    setApplyAcknowledged(false);
  };

  const chooseOutcome = () => runBusy(async () => {
    if (!jobId) return;
    if (outcome === "replace_router" && !targetId) throw new Error("Choose a distinct replacement router.");
    await migrationApi.chooseTarget(jobId, outcome, outcome === "replace_router" ? Number(targetId) : undefined);
    const result = await migrationApi.plan(jobId);
    setPlan(result);
    setApprovedIds([]);
    setDryRun(null);
    setApplyAcknowledged(false);
    setCurrentStep(4);
    await refreshJob(jobId);
  });

  const runDryRun = () => runBusy(async () => {
    if (!jobId) return;
    const result = await migrationApi.dryRun(jobId, approvedIds);
    setDryRun({ commands: result.commands, warnings: result.warnings });
    setApplyAcknowledged(false);
    await refreshJob(jobId);
    setNotice(`Dry-run ready. ${result.commands.length} reviewed RouterOS command(s); no target writes were sent.`);
  });

  const applyChanges = () => runBusy(async () => {
    if (!jobId) return;
    if (!applyAcknowledged) throw new Error("Acknowledge the reviewed dry-run before applying changes.");
    const result = await migrationApi.apply(jobId, approvedIds);
    setApplyResult(result);
    await refreshJob(jobId);
    if (result.completed) setNotice("The selected migration outcome completed.");
    else setError("The target migration stopped. Review the captured target state before retrying.");
  });

  const revokeTunnel = () => runBusy(async () => {
    if (!jobId) return;
    await migrationApi.revoke(jobId);
    await refreshJob(jobId);
    setNotice("Temporary migration access was revoked.");
  });

  const exportArrived = job?.status === "exported" || job?.status === "target_selected" || job?.status === "dry_run" || job?.status === "importing" || job?.status === "completed" || job?.status === "failed";

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 15, paddingBottom: 30 }}>
        <NetworkTabs active="migration" />
        <header>
          <div style={{ color: "var(--isp-accent)", fontSize: 11, fontWeight: 900, letterSpacing: ".12em" }}>NETWORK RECOVERY</div>
          <h1 style={{ margin: "6px 0 5px", color: "var(--isp-text)", fontSize: "1.55rem", fontWeight: 900 }}>RouterOS migration</h1>
          <p style={{ ...muted, margin: 0, maxWidth: 820 }}>
            Inspect a MikroTik through a temporary management tunnel, then review and copy supported RouterOS configuration and saved accounts to a separate replacement.
          </p>
        </header>

        <MigrationSteps currentStep={currentStep} />

        <section style={{ ...panel, borderColor: "rgba(37,99,235,.3)", background: "rgba(37,99,235,.045)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
            <ShieldCheck size={21} color="var(--isp-accent)" />
            <div>
              <div style={{ color: "var(--isp-text)", fontWeight: 900 }}>Migration safety boundaries</div>
              <ul style={{ ...muted, margin: "6px 0 0", paddingLeft: 18 }}>
                <li>Billing plans, customers, payment records, balances, and transaction history are not copied or changed.</li>
                <li>The temporary tunnel is restricted to this router, uses the isolated management VPN, and expires automatically.</li>
                <li>Saved PPPoE and Hotspot accounts are included only when RouterOS provides their credentials in the sensitive export; missing credentials and unsupported hardware-specific settings need manual setup.</li>
                <li>Raw exports and pre-migration target state stay encrypted on the server. Active sessions cannot be transferred, so customers reconnect on the replacement.</li>
              </ul>
            </div>
          </div>
        </section>

        {error && (
          <div role="alert" style={{ ...panel, display: "flex", gap: 9, alignItems: "flex-start", borderColor: "rgba(220,38,38,.35)", color: "var(--isp-text)" }}>
            <AlertTriangle size={18} color="#dc2626" />
            <span style={muted}>{error}</span>
          </div>
        )}
        {notice && (
          <div role="status" style={{ ...panel, display: "flex", gap: 9, alignItems: "flex-start", borderColor: "rgba(22,163,74,.3)" }}>
            <CheckCircle2 size={18} color="#16a34a" />
            <span style={muted}>{notice}</span>
          </div>
        )}

        <section style={{ ...panel, display: "grid", gap: 14 }}>
          <SectionHeading
            number="1"
            title="Choose the source router"
            detail="Use a listed router or register an unlisted source with a temporary script. A newly registered source remains migration-only and offline after identity verification."
          />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto", gap: 12, alignItems: "end" }}>
            <label style={{ display: "grid", gap: 6, color: "var(--isp-text)", fontSize: 12, fontWeight: 800 }}>
              Source MikroTik
              <select
                value={sourceId}
                onChange={event => setSourceId(event.target.value ? Number(event.target.value) : "")}
                disabled={loading || busy || Boolean(jobId && !["failed", "completed"].includes(job?.status ?? ""))}
                style={{ minHeight: 42, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--isp-border)", background: "var(--isp-card)", color: "var(--isp-text)" }}
              >
                <option value="">Select a router…</option>
                {routers.map(item => (
                  <option key={item.id} value={item.id}>{displayRouter(item)} · {item.migration_source_only ? "migration-only · offline" : item.host || item.vpn_ip || "address not saved"}</option>
                ))}
              </select>
            </label>
            <button type="button" style={buttonStyle(true, !canStartMigration || !sourceId)} disabled={!canStartMigration || !sourceId} onClick={startMigration}>
              {busy ? <LoaderCircle size={15} /> : <Wifi size={15} />} Start source inspection
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto", gap: 12, alignItems: "center", paddingTop: 4 }}>
            <div style={muted}>
              If the existing MikroTik is not listed, register it here. The script creates only temporary access; the dashboard record is finalized after RouterOS identity is verified.
            </div>
            <button type="button" style={buttonStyle(false, !canStartMigration)} disabled={!canStartMigration} onClick={startSourceRegistration}>
              {busy ? <LoaderCircle size={15} /> : <LockKeyhole size={15} />} Register unlisted source
            </button>
          </div>
          {routers.length === 0 && !loading && (
            <div style={{ ...muted, padding: 12, background: "rgba(148,163,184,.08)", borderRadius: 9 }}>
              No routers are listed yet. Use “Register unlisted source” for migration, or add a permanently managed router through the standard onboarding flow.{" "}
              <Link href="/admin/network/routers" style={{ color: "var(--isp-accent)", fontWeight: 800 }}>Open routers</Link>
            </div>
          )}
          {selectedSource && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, color: "var(--isp-text-muted)", fontSize: 12 }}>
              <span><Server size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{displayRouter(selectedSource)}</span>
              <span>Current record status: {selectedSource.status || "unknown"}</span>
              <span>Management address: {selectedSource.migration_source_only ? "temporary migration access only" : selectedSource.vpn_ip || selectedSource.host || "not saved"}</span>
            </div>
          )}
          <div style={muted}>
            After you start inspection, the exact temporary tunnel and export scripts appear below for review, copying, or download. Viewing a script does not run it.
          </div>
        </section>

        {jobId && (
          <section style={{ ...panel, display: "grid", gap: 14 }}>
            <SectionHeading
              number="2"
              title="Connect and inspect the source"
              detail="Run the downloaded temporary tunnel script on the source router, verify the authenticated RouterOS API connection, then run the export collector."
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 12 }}>
              <div style={{ border: "1px solid var(--isp-border)", borderRadius: 10, padding: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 850, fontSize: 13 }}>
                  <LockKeyhole size={16} color="var(--isp-accent)" /> Temporary management tunnel
                </div>
                <p style={{ ...muted, margin: "7px 0 12px" }}>
                  Job #{jobId}. Install and run the tunnel script on the selected source router. It creates only a temporary VPN interface, API exception, and API user.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" style={buttonStyle(false, !tunnelScript)} disabled={!tunnelScript} onClick={() => downloadText(`ochola-migration-tunnel-${jobId}.rsc`, tunnelScript)}>
                    <Download size={15} /> Download tunnel
                  </button>
                  <button type="button" style={buttonStyle(false, busy)} disabled={busy} onClick={reloadTunnelScript}>
                    <RefreshCw size={14} /> Refresh script
                  </button>
                </div>
                {tunnelScript && (
                  <details open style={{ marginTop: 12, borderTop: "1px solid var(--isp-border)", paddingTop: 10 }}>
                    <summary style={{ color: "var(--isp-text)", cursor: "pointer", fontWeight: 800 }}>View temporary tunnel script (.rsc)</summary>
                    <p style={{ ...muted, margin: "8px 0" }}>This temporary setup script is for the selected source router only. Keep it private; the access it creates expires automatically.</p>
                    <button type="button" style={buttonStyle(false)} onClick={() => void copyScript("Tunnel script", tunnelScript)}>
                      <Copy size={14} /> Copy tunnel script
                    </button>
                    <pre aria-label="Temporary tunnel RouterOS script" style={{ whiteSpace: "pre", overflow: "auto", color: "var(--isp-text)", fontSize: 11, lineHeight: 1.5, maxHeight: 320, padding: 12, borderRadius: 8, background: "rgba(15,23,42,.05)" }}>{tunnelScript}</pre>
                  </details>
                )}
                {job?.tunnel && <div style={{ ...muted, marginTop: 9 }}>Tunnel: {statusLabel(job.tunnel.status)} · expires {new Date(job.tunnel.expiresAt).toLocaleString()}</div>}
              </div>
              <div style={{ border: "1px solid var(--isp-border)", borderRadius: 10, padding: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 850, fontSize: 13 }}>
                  <Wifi size={16} color="var(--isp-accent)" /> RouterOS API preflight
                </div>
                <p style={{ ...muted, margin: "7px 0 12px" }}>
                  The API checks identity, RouterOS version, and board details through the temporary tunnel. It does not change router configuration or status.
                </p>
                <button type="button" style={buttonStyle(true, busy || !tunnelScript)} disabled={busy || !tunnelScript} onClick={verifyTunnel}>
                  {busy ? <LoaderCircle size={15} /> : <CheckCircle2 size={15} />} Verify RouterOS API
                </button>
                {job?.findings?.sourceIdentity?.identity && (
                  <div style={{ ...muted, marginTop: 9 }}>
                    Verified: {job.findings.sourceIdentity.identity} · RouterOS {job.findings.sourceIdentity.version}
                  </div>
                )}
              </div>
              <div style={{ border: "1px solid var(--isp-border)", borderRadius: 10, padding: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text)", fontWeight: 850, fontSize: 13 }}>
                  <FileSearch size={16} color="var(--isp-accent)" /> Sensitive source export
                </div>
                <p style={{ ...muted, margin: "7px 0 12px" }}>
                  Run the collector only after the preflight. The script sends bounded HTTPS chunks and removes its temporary RouterOS export file when complete.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" style={buttonStyle(false, !collectorScript)} disabled={!collectorScript} onClick={downloadBoth}>
                    <Download size={15} /> Download both
                  </button>
                  <button type="button" style={buttonStyle(false, busy || !job?.tunnel?.verifiedAt)} disabled={busy || !job?.tunnel?.verifiedAt} onClick={refreshCollector}>
                    <RefreshCw size={14} /> Refresh export script
                  </button>
                </div>
                {collectorScript && (
                  <details open style={{ marginTop: 12, borderTop: "1px solid var(--isp-border)", paddingTop: 10 }}>
                    <summary style={{ color: "var(--isp-text)", cursor: "pointer", fontWeight: 800 }}>View export collector script (.rsc)</summary>
                    <p style={{ ...muted, margin: "8px 0" }}>This script contains a short-lived upload token. Run it only on the selected source router after the API preflight, and do not share it.</p>
                    <button type="button" style={buttonStyle(false)} onClick={() => void copyScript("Export collector script", collectorScript)}>
                      <Copy size={14} /> Copy export script
                    </button>
                    <pre aria-label="RouterOS export collector script" style={{ whiteSpace: "pre", overflow: "auto", color: "var(--isp-text)", fontSize: 11, lineHeight: 1.5, maxHeight: 320, padding: 12, borderRadius: 8, background: "rgba(15,23,42,.05)" }}>{collectorScript}</pre>
                  </details>
                )}
                <div style={{ ...muted, marginTop: 8 }}>Run the tunnel script first; run the export collector second.</div>
              </div>
            </div>
            {job?.findings?.sourceIdentity && (
              <div style={{ ...muted, borderTop: "1px solid var(--isp-border)", paddingTop: 10 }}>
                Source preflight: {job.findings.sourceIdentity.identity} · {job.findings.sourceIdentity.board} · RouterOS {job.findings.sourceIdentity.version}
              </div>
            )}
            {job?.status === "exported" && <div style={{ color: "#15803d", fontWeight: 850, fontSize: 13 }}>Source export received and encrypted. Temporary tunnel access has been revoked.</div>}
            {job?.status !== "exported" && !exportArrived && job?.status !== "completed" && (
              <div style={{ ...muted, display: "flex", gap: 7, alignItems: "center" }}>
                <RefreshCw size={14} /> Waiting for the source export. This page checks status automatically every five seconds.
              </div>
            )}
            {job?.tunnel && ["connected", "script_issued"].includes(job.tunnel.status) && (
              <button type="button" style={{ ...buttonStyle(false, busy), justifySelf: "start" }} disabled={busy} onClick={revokeTunnel}>
                Revoke temporary tunnel now
              </button>
            )}
          </section>
        )}

        {exportArrived && job && (
          <>
            <section style={{ ...panel, display: "grid", gap: 13 }}>
              <SectionHeading
                number="3"
                title="Review what was found"
                detail="The complete export stays encrypted. The list below contains section counts and the supported configuration plan, not router credentials."
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(job.findings?.counts ?? {}).map(([section, count]) => (
                  <span key={section} style={{ padding: "6px 9px", borderRadius: 99, background: "rgba(148,163,184,.12)", color: "var(--isp-text)", fontSize: 11, fontWeight: 750 }}>
                    {section.replaceAll("_", " ")} · {count}
                  </span>
                ))}
              </div>
              {(job.findings?.warnings ?? []).map((warning, index) => (
                <div key={index} style={{ ...muted, display: "flex", alignItems: "flex-start", gap: 7 }}>
                  <CircleHelp size={15} color="var(--isp-accent)" /> {warning}
                </div>
              ))}
              <div style={{ ...muted }}>Credentials unavailable to the source export require manual configuration: {job.findings?.manualConfigurationCount ?? 0} item(s).</div>
              <div style={{ color: "var(--isp-text)", fontWeight: 850, fontSize: 13 }}>Choose the outcome</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(245px,1fr))", gap: 10 }}>
                {!job.findings?.sourceRegistrationComplete && (
                  <label style={{ border: `1px solid ${outcome === "adopt_source" ? "var(--isp-accent)" : "var(--isp-border)"}`, borderRadius: 10, padding: 12, display: "flex", gap: 9, cursor: "pointer" }}>
                    <input type="radio" name="migration-outcome" checked={outcome === "adopt_source"} onChange={() => setOutcome("adopt_source")} />
                    <span><strong style={{ color: "var(--isp-text)", fontSize: 13 }}>Adopt this same router</strong><span style={{ ...muted, display: "block", marginTop: 4 }}>No target copy or RouterOS writes. Existing install/verification gates remain unchanged.</span></span>
                  </label>
                )}
                <label style={{ border: `1px solid ${outcome === "replace_router" ? "var(--isp-accent)" : "var(--isp-border)"}`, borderRadius: 10, padding: 12, display: "flex", gap: 9, cursor: "pointer" }}>
                  <input type="radio" name="migration-outcome" checked={outcome === "replace_router"} onChange={() => setOutcome("replace_router")} />
                  <span><strong style={{ color: "var(--isp-text)", fontSize: 13 }}>Copy to a replacement router</strong><span style={{ ...muted, display: "block", marginTop: 4 }}>Select a different device; only reviewed portable RouterOS settings can be written.</span></span>
                </label>
              </div>
              {outcome === "replace_router" && (
                <label style={{ display: "grid", gap: 6, color: "var(--isp-text)", fontSize: 12, fontWeight: 800, maxWidth: 600 }}>
                  Replacement target
                  <select value={targetId} onChange={event => setTargetId(event.target.value ? Number(event.target.value) : "")} style={{ minHeight: 42, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--isp-border)", background: "var(--isp-card)", color: "var(--isp-text)" }}>
                    <option value="">Select a different router…</option>
                    {replacementRouters.map(item => <option key={item.id} value={item.id}>{displayRouter(item)} · {item.host || item.vpn_ip || "address not saved"}</option>)}
                  </select>
                </label>
              )}
              <button type="button" style={buttonStyle(true, busy || (outcome === "replace_router" && !targetId))} disabled={busy || (outcome === "replace_router" && !targetId)} onClick={chooseOutcome}>
                {busy ? <LoaderCircle size={15} /> : <Check size={15} />} Load review plan
              </button>
            </section>

            {plan && (
              <section style={{ ...panel, display: "grid", gap: 13 }}>
                <SectionHeading number="4" title="Approve portable configuration" detail="Rows are not applied until you select them, inspect the dry-run, and confirm the final apply step." />
                {plan.mode === "adopt_source" ? (
                  <div style={{ ...muted, padding: 12, borderRadius: 9, background: "rgba(22,163,74,.08)" }}>
                    Adoption does not import or overwrite configuration. No router records or billing tables are changed by this migration step.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" style={buttonStyle(false)} onClick={() => setApprovedIds(plan.items.map(item => item.id))}>Select supported rows</button>
                      <button type="button" style={buttonStyle(false)} onClick={() => { setApprovedIds([]); setDryRun(null); }}>Clear selection</button>
                    </div>
                    {plan.items.length === 0 && <div style={muted}>No supported portable rows were found to copy.</div>}
                    {plan.items.map(item => <PlanRow key={item.id} item={item} checked={approvedIds.includes(item.id)} onChange={setChoice} />)}
                    {plan.unsupported.length > 0 && (
                      <details>
                        <summary style={{ color: "var(--isp-text)", fontWeight: 800, cursor: "pointer" }}>Not copied ({plan.unsupported.length})</summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 9 }}>
                          {plan.unsupported.map(item => (
                            <div key={item.id} style={{ ...muted, display: "flex", gap: 7 }}>
                              <AlertTriangle size={14} color="#d97706" /> <span><strong>{item.category}</strong> — {item.reason || "Requires manual review."}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
                {plan.warnings.map((warning, index) => <div key={index} style={muted}>{warning}</div>)}
                <button type="button" style={buttonStyle(true, busy || (plan.mode === "replace_router" && approvedIds.length === 0))} disabled={busy || (plan.mode === "replace_router" && approvedIds.length === 0)} onClick={runDryRun}>
                  {busy ? <LoaderCircle size={15} /> : <FileSearch size={15} />} Run dry-run
                </button>
              </section>
            )}
          </>
        )}

        {dryRun && plan && (
          <section style={{ ...panel, display: "grid", gap: 12 }}>
            <SectionHeading number="5" title="Review dry-run and apply" detail="Dry-run sent zero writes. Applying sends only the approved portable RouterOS commands to the replacement target." />
            <div style={{ ...muted, padding: 12, borderRadius: 9, background: "rgba(245,158,11,.09)", border: "1px solid rgba(245,158,11,.25)" }}>
              <AlertTriangle size={15} style={{ verticalAlign: "middle", marginRight: 5 }} />
              The app captures encrypted, redacted target state before the first write. It stops at the first failed write; it does not perform an automatic rollback.
            </div>
            {dryRun.commands.length > 0 && (
              <details open>
                <summary style={{ color: "var(--isp-text)", cursor: "pointer", fontWeight: 800 }}>Planned replacement-router API commands ({dryRun.commands.length})</summary>
                <p style={muted}>These are the exact API commands the app will send after you confirm. They are not a .rsc script to paste into a RouterOS terminal.</p>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--isp-text)", fontSize: 11, maxHeight: 320, overflow: "auto", padding: 12, borderRadius: 8, background: "rgba(15,23,42,.05)" }}>
                  {dryRun.commands.map(command => command.join(" ")).join("\n")}
                </pre>
              </details>
            )}
            {plan.mode === "adopt_source" && <div style={muted}>This adoption action records the choice only. It performs no target or billing writes.</div>}
            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", color: "var(--isp-text)", fontSize: 13, fontWeight: 750 }}>
              <input type="checkbox" checked={applyAcknowledged} onChange={event => setApplyAcknowledged(event.target.checked)} style={{ marginTop: 3, accentColor: "var(--isp-accent)" }} />
              I reviewed this outcome. For a copy, I understand these changes apply only to the selected replacement router.
            </label>
            <button type="button" style={buttonStyle(true, busy || !applyAcknowledged)} disabled={busy || !applyAcknowledged} onClick={applyChanges}>
              {busy ? <LoaderCircle size={15} /> : <ShieldCheck size={15} />} Confirm and apply
            </button>
            {applyResult && (
              <div role="status" style={{ ...muted, padding: 12, borderRadius: 9, background: applyResult.completed ? "rgba(22,163,74,.08)" : "rgba(220,38,38,.08)" }}>
                <strong style={{ color: "var(--isp-text)" }}>{applyResult.completed ? "Migration complete." : applyResult.partial ? "Migration stopped after partial changes." : "Migration did not complete."}</strong>
                {applyResult.failures?.map(failure => <div key={failure}>{failure}</div>)}
                {applyResult.limitation && <div>{applyResult.limitation}</div>}
              </div>
            )}
          </section>
        )}

        <footer style={{ ...muted, display: "flex", alignItems: "center", gap: 7 }}>
          <LockKeyhole size={14} /> The scan never modifies billing data or promotes the source router.
          {job?.status === "failed" && <span> · Start a new session after reviewing the captured router state.</span>}
        </footer>
      </div>
    </AdminLayout>
  );
}