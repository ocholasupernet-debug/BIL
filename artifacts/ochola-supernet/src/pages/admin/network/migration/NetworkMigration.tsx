import React, { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  CloudDownload,
  Database,
  Download,
  FileCheck2,
  FileClock,
  KeyRound,
  RefreshCw,
  Router,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wifi,
  X,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "../NetworkTabs";
import { useToast } from "@/hooks/use-toast";
import {
  analyzeSource,
  createCollectorSession,
  createMigrationTunnel,
  exportSource,
  fetchRouters,
  getCollectorSessionStatus,
  getMigrationTunnelStatus,
  getReport,
  runDryRun,
  runImport,
  setTargetRouter,
} from "./api";
import type {
  CollectorSession,
  DryRunResponse,
  ExportResponse,
  MigrationTunnelSession,
  ReportResponse,
  RouterSummary,
} from "./types";
import "./NetworkMigration.css";

const STEPS = [
  { id: 1, label: "Source", icon: Terminal },
  { id: 2, label: "Export", icon: Database },
  { id: 3, label: "Review", icon: FileCheck2 },
  { id: 4, label: "Target", icon: ArrowRight },
  { id: 5, label: "Dry run", icon: Activity },
  { id: 6, label: "Import", icon: KeyRound },
  { id: 7, label: "Report", icon: CheckCircle2 },
];

function Pill({ children, tone = "good" }: { children: ReactNode; tone?: "good" | "warn" | "neutral" }) {
  return (
    <span className={`migration-pill ${tone === "warn" ? "warn" : tone === "neutral" ? "neutral" : ""}`}>
      {tone === "good" && <span className="migration-live-dot" />}
      {children}
    </span>
  );
}

function CardHead({
  icon: Icon,
  title,
  description,
  status,
  iconTone,
}: {
  icon: typeof Terminal;
  title: string;
  description: string;
  status?: ReactNode;
  iconTone?: "green";
}) {
  return (
    <div className="migration-card-head">
      <div className="migration-card-title">
        <span className={`migration-card-icon ${iconTone === "green" ? "green" : ""}`}><Icon size={15} /></span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {status}
    </div>
  );
}

function Boundary() {
  return (
    <div className="migration-boundary">
      <ShieldAlert size={17} />
      <div>
        <strong>Strict read-only guarantee</strong>
        <p>The source router is never modified. The temporary tunnel expires automatically. Target selection performs identity checks only; dry run performs zero RouterOS calls.</p>
      </div>
    </div>
  );
}

export default function NetworkMigration() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [targetRouterId, setTargetRouterId] = useState<number | null>(null);
  const [migrationId, setMigrationId] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceRouterId, setSourceRouterId] = useState<number | null>(null);
  const [tunnel, setTunnel] = useState<MigrationTunnelSession | null>(null);
  const [collector, setCollector] = useState<CollectorSession | null>(null);
  const [exportData, setExportData] = useState<ExportResponse | null>(null);
  const [dryRunData, setDryRunData] = useState<DryRunResponse | null>(null);
  const [reportData, setReportData] = useState<ReportResponse | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastDryRunIds, setLastDryRunIds] = useState<Set<string> | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [copied, setCopied] = useState("");
  const routersQuery = useQuery<RouterSummary[]>({
    queryKey: ["migration-routers"],
    queryFn: fetchRouters,
    retry: 1,
  });
  const routers = routersQuery.data;
  const routersLoading = routersQuery.isLoading;
  const routersError = routersQuery.error;
  const sourceRouter = routers?.find(router => router.id === sourceRouterId);
  const targetRouter = routers?.find(router => router.id === targetRouterId);

  const tunnelStatusQuery = useQuery({
    queryKey: ["migration-tunnel-status", tunnel?.leaseId],
    queryFn: () => getMigrationTunnelStatus(tunnel!.leaseId),
    enabled: Boolean(tunnel?.leaseId),
    refetchInterval: 5000,
    retry: false,
  });

  useEffect(() => {
    if (!tunnel) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tunnel?.leaseId]);

  useEffect(() => {
    if (!tunnelStatusQuery.data || !tunnel) return;
    setTunnel(current => current ? {
      ...current,
      status: tunnelStatusQuery.data.status,
      expiresAt: tunnelStatusQuery.data.expiresAt,
    } : current);
  }, [tunnelStatusQuery.data]);

  const collectorMutation = useMutation({
    mutationFn: (binding?: { sourceLabel?: string; sourceRouterId: number; tunnelId: string }) => createCollectorSession(
      binding?.sourceLabel ?? sourceLabel.trim(),
      binding ? { sourceRouterId: binding.sourceRouterId, tunnelId: binding.tunnelId } : (sourceRouterId && tunnel ? {
        sourceRouterId,
        tunnelId: tunnel.leaseId,
      } : undefined),
    ),
    onSuccess: data => {
      setCollector(data);
      toast({
        title: data.tunnel ? "Two-script collector ready" : "Read-only collector ready",
        description: data.tunnel ? "Connect the router first, then run the export script." : "Run the hosted export command on the intended source router.",
      });
    },
    onError: (error: any) => toast({ title: "Collector could not be created", description: error.message, variant: "destructive" }),
  });

  const collectorStatusMutation = useMutation({
    mutationFn: getCollectorSessionStatus,
    onSuccess: data => {
      setCollector(current => current ? { ...current, ...data } : current);
      if (data.migrationId && data.summary && data.findings) {
        setMigrationId(data.migrationId);
        setExportData({
          id: data.migrationId,
          status: data.status,
          sourceLabel: data.sourceLabel,
          sourceMode: data.sourceMode,
          summary: data.summary,
          findings: data.findings,
        });
      }
    },
    onError: (error: any) => toast({ title: "Collection status unavailable", description: error.message, variant: "destructive" }),
  });

  const tunnelMutation = useMutation({
    mutationFn: createMigrationTunnel,
    onSuccess: data => {
      setTunnel(data);
      toast({ title: "One-hour migration tunnel issued", description: "Run the connection script, then the separate read-only export script." });
      if (!collector) {
        collectorMutation.mutate({
          sourceLabel: sourceLabel.trim() || sourceRouter?.name || `Router ${data.routerId}`,
          sourceRouterId: data.routerId,
          tunnelId: data.leaseId,
        });
      }
    },
    onError: (error: any) => toast({ title: "Migration tunnel could not be created", description: error.message, variant: "destructive" }),
  });

  const exportMutation = useMutation({
    mutationFn: ({ routerId, tunnelId }: { routerId: number; tunnelId: string }) => exportSource(routerId, tunnelId),
    onSuccess: data => {
      setMigrationId(data.id);
      setExportData(data);
      setCurrentStep(2);
      toast({ title: "Source export saved", description: `Read-only export completed through ${data.tunnel?.address ?? "the temporary tunnel"}.` });
    },
    onError: (error: any) => toast({ title: "Source export failed", description: error.message, variant: "destructive" }),
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ routerId, tunnelId }: { routerId: number; tunnelId: string }) => analyzeSource(routerId, tunnelId),
    onSuccess: (_data, variables) => exportMutation.mutate(variables),
    onError: (error: any) => toast({ title: "Tunnel verification failed", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!collector?.token || collector.migrationId) return;
    const poll = () => collectorStatusMutation.mutate(collector.token);
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [collector?.token, collector?.migrationId]);

  const generateConfiguration = () => {
    if (!sourceRouterId) {
      toast({
        title: "Choose a source router first",
        description: "Select a registered source router to generate the two connection and export scripts.",
      });
      return;
    }
    if (!tunnel) {
      tunnelMutation.mutate(sourceRouterId);
      return;
    }
    if (!collector) {
      collectorMutation.mutate({
        sourceLabel: sourceLabel.trim() || sourceRouter?.name || `Router ${sourceRouterId}`,
        sourceRouterId,
        tunnelId: tunnel.leaseId,
      });
      return;
    }
    if (!migrationId && !analyzeMutation.isPending && !exportMutation.isPending) {
      analyzeMutation.mutate({ routerId: sourceRouterId, tunnelId: tunnel.leaseId });
    }
  };

  const dryRunMutation = useMutation({
    mutationFn: runDryRun,
    onSuccess: (data, variables) => {
      setDryRunData(data);
      if (variables.approvedItemIds) setLastDryRunIds(new Set(variables.approvedItemIds));
      else {
        setSelectedIds(new Set());
        setLastDryRunIds(new Set());
      }
    },
    onError: (error: any) => toast({ title: "Dry run failed", description: error.message, variant: "destructive" }),
  });

  const targetMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: number }) => setTargetRouter(id, targetId),
    onSuccess: () => {
      setCurrentStep(5);
      if (migrationId) dryRunMutation.mutate({ id: migrationId });
    },
    onError: (error: any) => toast({ title: "Target selection failed", description: error.message, variant: "destructive" }),
  });

  const reportMutation = useMutation({
    mutationFn: getReport,
    onSuccess: data => {
      setReportData(data);
      setCurrentStep(7);
    },
    onError: (error: any) => toast({ title: "Report fetch failed", description: error.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: runImport,
    onSuccess: () => {
      if (migrationId) reportMutation.mutate(migrationId);
    },
    onError: (error: any) => toast({ title: "Import failed", description: error.message, variant: "destructive" }),
  });

  const isBusy = collectorMutation.isPending || collectorStatusMutation.isPending || tunnelMutation.isPending ||
    analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending ||
    dryRunMutation.isPending || importMutation.isPending || reportMutation.isPending;
  const tunnelSecondsRemaining = tunnel
    ? Math.max(0, Math.floor((new Date(tunnel.expiresAt).getTime() - clock) / 1000))
    : 0;
  const tunnelCountdown = `${Math.floor(tunnelSecondsRemaining / 3600)}h ${String(Math.floor((tunnelSecondsRemaining % 3600) / 60)).padStart(2, "0")}m ${String(tunnelSecondsRemaining % 60).padStart(2, "0")}s`;

  const isDryRunDirty = () => {
    if (!lastDryRunIds) return false;
    if (lastDryRunIds.size !== selectedIds.size) return true;
    for (const id of selectedIds) if (!lastDryRunIds.has(id)) return true;
    return false;
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(label);
    toast({ title: `${label} copied`, description: "Keep one-time commands private and use them only on the intended router." });
    window.setTimeout(() => setCopied(""), 1800);
  };

  const downloadRecoveryPackage = () => {
    if (!reportData?.recoveryPackage) return;
    const blob = new Blob([JSON.stringify(reportData.recoveryPackage, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `router-migration-${reportData.recoveryPackage.migrationId}-recovery.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadScriptsBundle = () => {
    const connectionCommand = collector?.tunnelCommand || tunnel?.command || "";
    const tunnelScript = tunnel?.scriptUrl
      ? `# 1. Connection script\n# Downloaded from ${tunnel.scriptUrl}\n\n${connectionCommand}`
      : `# 1. Connection script\n\n${connectionCommand}`;
    const exportScript = collector?.scriptUrl
      ? `# 2. Read-only export script\n# Downloaded from ${collector.scriptUrl}\n\n${collector.command || ""}`
      : `# 2. Read-only export script\n\n${collector?.command || ""}`;
    const blob = new Blob([
      "# OcholaSupernet router migration script bundle\n",
      "# Run script 1 first, wait for the tunnel, then run script 2.\n\n",
      tunnelScript,
      "\n\n============================================================\n\n",
      exportScript,
      "\n",
    ], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ocholasupernet-router-migration-scripts.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;

  const resetSource = (value: string) => {
    setSourceRouterId(value ? Number(value) : null);
    setTunnel(null);
    setCollector(null);
    setMigrationId(null);
    setExportData(null);
    setDryRunData(null);
    setReportData(null);
    setTargetRouterId(null);
    setCurrentStep(1);
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (collector?.migrationId || migrationId) setCurrentStep(2);
      else generateConfiguration();
    } else if (currentStep === 2) setCurrentStep(3);
    else if (currentStep === 3) setCurrentStep(4);
    else if (currentStep === 4 && migrationId && targetRouterId) targetMutation.mutate({ id: migrationId, targetId: targetRouterId });
    else if (currentStep === 5 && dryRunData && !isDryRunDirty() && selectedIds.size > 0) setCurrentStep(6);
    else if (currentStep === 6 && migrationId && confirmationText === "MODIFY TARGET ROUTER") {
      importMutation.mutate({ id: migrationId, confirmation: confirmationText, approvedItemIds: Array.from(selectedIds) });
    }
  };

  const primaryDisabled =
    isBusy ||
    (currentStep === 1 && !collector?.migrationId && !migrationId && !sourceRouterId) ||
    (currentStep === 4 && !targetRouterId) ||
    (currentStep === 5 && (!dryRunData || isDryRunDirty() || dryRunData.plannedChanges.length === 0 || selectedIds.size === 0)) ||
    (currentStep === 6 && confirmationText !== "MODIFY TARGET ROUTER");
  const scriptsGenerated = Boolean(tunnel?.command && collector?.tunnelCommand && collector?.command);

  const renderStage = () => {
    if (currentStep === 1) {
      const tunnelCommand = collector?.tunnelCommand || tunnel?.command;
      return (
        <div className="migration-stack">
          <section className="migration-card">
            <CardHead
              icon={Terminal}
              title="Collect source router"
              description="Issue a bounded path, then run the two read-only scripts in order."
              status={tunnel ? <Pill>{tunnel.status === "connected" ? "Tunnel connected" : tunnel.status.replace("_", " ")}</Pill> : <Pill tone="neutral">Not started</Pill>}
            />
            <div className="migration-card-body">
              <div className="migration-form-block">
                <label className="migration-form-label" htmlFor="source-router">Registered source router</label>
                {routersLoading ? (
                  <div className="migration-loading"><RefreshCw size={14} className="animate-spin" /> Loading registered routers…</div>
                ) : (
                  <select
                    id="source-router"
                    className="migration-select"
                    value={sourceRouterId ?? ""}
                    onChange={event => resetSource(event.target.value)}
                    disabled={!routers?.length || isBusy}
                  >
                    <option value="">Choose a registered source router</option>
                    {routers?.map(router => <option key={router.id} value={router.id}>{router.name} · {router.status}</option>)}
                  </select>
                )}
                {routersError && <p className="migration-inline-error">{routersError instanceof Error ? routersError.message : "Registered routers could not be loaded."}</p>}
                {!routersLoading && !routersError && routers?.length === 0 && <p className="migration-inline-empty">No registered routers are available.</p>}
                {sourceRouter && (
                  <div className="migration-router-meta">
                    <span><Router size={12} /><strong>{sourceRouter.name}</strong></span>
                    <span><Server size={12} /><code>{sourceRouter.host}</code></span>
                    {sourceRouter.vpn_ip && <span><Wifi size={12} /><code>{sourceRouter.vpn_ip}</code></span>}
                    <span><Wifi size={12} />{sourceRouter.status}</span>
                    <span><Activity size={12} />Source access is read-only</span>
                  </div>
                )}
              </div>

              {sourceRouterId && !tunnel && (
                <div className="migration-tunnel revoked" style={{ marginTop: 12 }}>
                  <div className="migration-tunnel-title"><AlertTriangle size={14} /> No migration tunnel issued for this source</div>
                  <p className="migration-tunnel-copy">Issue a new one-hour connection-scoped tunnel before running the collector.</p>
                  <button className="migration-button primary" style={{ marginTop: 11 }} onClick={generateConfiguration} disabled={isBusy}>
                    <Terminal size={13} /> Generate configuration
                  </button>
                </div>
              )}

              {tunnel && (
                <>
                  <div className="migration-section-heading">
                    <h3>Temporary management tunnel</h3>
                    <span>Auto-revokes after 60 minutes</span>
                  </div>
                  <div className={`migration-tunnel ${tunnel.status === "revoked" || tunnel.status === "expired" ? "revoked" : ""}`}>
                    <div className="migration-tunnel-top">
                      <div>
                        <div className="migration-tunnel-title">
                          {tunnel.status === "connected" ? <ShieldCheck size={14} /> : <FileClock size={14} />}
                          {tunnel.status === "connected" ? "Connection-scoped tunnel is active" : "Tunnel script issued — waiting for router"}
                        </div>
                        <p className="migration-tunnel-copy">Only the selected source router can reach the migration service. No default route or LAN route is added.</p>
                      </div>
                      <span className="migration-mono" style={{ color: tunnelSecondsRemaining > 0 ? "var(--isp-green)" : "#ba4c47", fontSize: 10 }}>{tunnelCountdown}</span>
                    </div>
                    <div className="migration-tunnel-grid">
                      <div><div className="migration-detail-label">Tunnel address</div><div className="migration-detail-value">{tunnel.tunnelAddress}</div></div>
                      <div><div className="migration-detail-label">Interface</div><div className="migration-detail-value">{tunnel.interfaceName}</div></div>
                      <div><div className="migration-detail-label">Endpoint</div><div className="migration-detail-value">{tunnel.serverEndpoint}</div></div>
                      <div><div className="migration-detail-label">Expires</div><div className="migration-detail-value green">{new Date(tunnel.expiresAt).toLocaleTimeString()}</div></div>
                    </div>
                  </div>

                  <div className="migration-section-heading">
                    <h3>Two-script handoff</h3>
                    <span>Run in this order</span>
                  </div>
                  {tunnelCommand && collector?.command ? (
                    <div className="migration-script-stack">
                      <div className="migration-script">
                        <div className="migration-script-head">
                          <div className="migration-script-label"><span>1</span>Connect the router to the web through VPN</div>
                          <button className="migration-copy-button" onClick={() => copyText(tunnelCommand, "Tunnel command")}><Clipboard size={11} />{copied === "Tunnel command" ? "Copied" : "Copy"}</button>
                        </div>
                        <pre>{tunnelCommand}</pre>
                        <div className="migration-script-note"><ShieldAlert size={11} />Adds only the temporary interface, cleanup scheduler, and two connection-only firewall rules.</div>
                      </div>
                      <div className="migration-script">
                        <div className="migration-script-head">
                          <div className="migration-script-label"><span>2</span>Enable the read-only export</div>
                          <button className="migration-copy-button" onClick={() => copyText(collector.command, "Export command")}><Clipboard size={11} />{copied === "Export command" ? "Copied" : "Copy"}</button>
                        </div>
                        <pre>{collector.command}</pre>
                        <div className="migration-script-note"><CheckCircle2 size={11} />Reads and uploads configuration only. The source router is never modified by the export.</div>
                      </div>
                      <div className="migration-action-group">
                        <button className="migration-button ghost" onClick={() => copyText(`${tunnelCommand}\n\n${collector.command}`, "Both scripts")}><Clipboard size={12} /> Copy both scripts</button>
                         <button className="migration-button ghost" onClick={downloadScriptsBundle}><Download size={12} /> Download both</button>
                         {(collector.tunnelScriptUrl || tunnel?.scriptUrl) && <a className="migration-button ghost" href={downloadUrl(collector.tunnelScriptUrl || tunnel?.scriptUrl || "")} download="router-migration-tunnel.rsc"><Download size={12} /> Download connection</a>}
                         <a className="migration-button ghost" href={downloadUrl(collector.scriptUrl)} download="router-migration-export.rsc"><Download size={12} /> Download export</a>
                      </div>
                    </div>
                  ) : (
                    <div className="migration-preparing"><RefreshCw size={14} className="animate-spin" /> Preparing the two one-time scripts…</div>
                  )}
                </>
              )}

              {collector && (
                <div className="migration-action-bar">
                  <div>
                    <strong style={{ display: "block", fontSize: ".68rem" }}>
                      {collector.migrationId ? "Export received and saved" : collector.status === "waiting" ? "Waiting for the MikroTik…" : "Processing router export…"}
                    </strong>
                    <span className="migration-footer-note">Session expires {new Date(collector.expiresAt).toLocaleTimeString()}</span>
                  </div>
                  {!collector.migrationId && <button className="migration-button ghost" onClick={() => collectorStatusMutation.mutate(collector.token)} disabled={isBusy}><RefreshCw size={12} className={collectorStatusMutation.isPending ? "animate-spin" : ""} /> Check collection</button>}
                </div>
              )}

              <p className="migration-help"><ShieldAlert size={12} style={{ verticalAlign: "middle", marginRight: 4, color: "var(--isp-accent)" }} />One-time commands can contain sensitive values. Use them only on the intended router and wait for the web app to confirm collection.</p>
            </div>
          </section>

          <section className="migration-card migration-manual-card">
            <CardHead icon={CloudDownload} title="Manual read-only collector" description="Use this separate path when the source router is not registered. It does not create a VPN tunnel." status={<Pill tone="neutral">HTTPS only</Pill>} />
            <div className="migration-card-body">
              {!collector && !sourceRouterId ? (
                <>
                  <label className="migration-form-label" htmlFor="source-label">Source router name</label>
                  <input id="source-label" className="migration-input" value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} placeholder="e.g. Main Office MikroTik" maxLength={120} />
                  <p className="migration-help">The hosted command reads the router and uploads an encrypted export. No interface, route, firewall rule, or router file is created.</p>
                   <button className="migration-button ghost" style={{ marginTop: 11 }} onClick={() => collectorMutation.mutate(undefined)} disabled={!sourceLabel.trim() || isBusy}><Terminal size={13} /> Create manual collector</button>
                </>
              ) : sourceRouterId ? (
                <p className="migration-help">A registered source is selected above, so use its bounded two-script handoff instead of the manual collector.</p>
              ) : (
                <p className="migration-help">Manual collector created above. Run its hosted command, then monitor the collection status.</p>
              )}
            </div>
          </section>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <section className="migration-card">
          <CardHead icon={Database} title="Collected export" description={`Read-only configuration received from ${exportData?.sourceLabel || sourceRouter?.name || sourceLabel}.`} status={<Pill>Saved securely</Pill>} />
          <div className="migration-stage-body">
            {exportData ? (
              <>
                <div className="migration-report-hero"><CheckCircle2 size={20} /><div><strong>Source export received and sealed</strong><span>Reference {exportData.id}. The original terminal output remains encrypted and is not displayed again.</span></div></div>
                <div className="migration-metric-grid">
                  <div className="migration-metric"><strong>{exportData.summary.configs}</strong><span>Config items</span></div>
                  <div className="migration-metric"><strong>{exportData.summary.users}</strong><span>Users</span></div>
                  <div className="migration-metric"><strong>{exportData.summary.queues}</strong><span>Queues</span></div>
                  <div className="migration-metric"><strong>{exportData.summary.pools}</strong><span>IP pools</span></div>
                </div>
              </>
            ) : <div className="migration-preparing"><RefreshCw size={14} className="animate-spin" /> Waiting for the sealed export package…</div>}
          </div>
        </section>
      );
    }

    if (currentStep === 3) {
      return (
        <section className="migration-card">
          <CardHead icon={FileCheck2} title="Review compatibility" description="Resolve what can move cleanly before choosing a target." status={<Pill tone="warn">Review required</Pill>} />
          <div className="migration-stage-body">
            {exportData && (
              <>
                <div className="migration-report-hero"><CheckCircle2 size={20} /><div><strong>Source export saved successfully</strong><span>Reference {exportData.id} · source access remained read-only.</span></div></div>
                <div className="migration-finding-list">
                  {exportData.findings.unsupported.map((finding, index) => <div className="migration-finding danger" key={`unsupported-${index}`}><AlertTriangle size={13} />{finding}</div>)}
                  {exportData.findings.manual.map((finding, index) => <div className="migration-finding warn" key={`manual-${index}`}><AlertTriangle size={13} />{finding}</div>)}
                  {exportData.findings.warnings.map((finding, index) => <div className="migration-finding warn" key={`warning-${index}`}><AlertTriangle size={13} />{finding}</div>)}
                  {!exportData.findings.unsupported.length && !exportData.findings.manual.length && !exportData.findings.warnings.length && <div className="migration-finding good"><CheckCircle2 size={13} />No compatibility warnings were reported for this export.</div>}
                </div>
              </>
            )}
          </div>
        </section>
      );
    }

    if (currentStep === 4) {
      return (
        <section className="migration-card">
          <CardHead icon={ArrowRight} title="Select target router" description="Identity check only. No target configuration changes happen at this stage." status={<Pill tone="neutral">Read-only contact</Pill>} />
          <div className="migration-stage-body">
            <div className="migration-boundary"><ShieldCheck size={16} /><div><strong>Safe boundary</strong><p>The target is contacted only to verify identity, RouterOS version, and available interfaces.</p></div></div>
            <div className="migration-target-list">
              {routers?.map(router => {
                const isSource = router.id === sourceRouterId;
                const offline = !["online", "connected"].includes(router.status.toLowerCase());
                return (
                  <label key={router.id} className={`migration-target-option ${targetRouterId === router.id ? "selected" : ""} ${isSource || offline ? "disabled" : ""}`}>
                    <input type="radio" name="target-router" checked={targetRouterId === router.id} onChange={() => setTargetRouterId(router.id)} disabled={isSource || offline} />
                    <div className="migration-target-copy"><strong>{router.name}</strong><span>{router.host} · {router.status}{isSource ? " · selected source" : offline ? " · must be online" : ""}</span></div>
                    <Pill tone={offline ? "warn" : "neutral"}>{isSource ? "Source" : router.status}</Pill>
                  </label>
                );
              })}
            </div>
            {!routersLoading && (!routers || routers.length < 2) && <p className="migration-inline-empty">Add an online replacement router before continuing.</p>}
          </div>
        </section>
      );
    }

    if (currentStep === 5) {
      return (
        <section className="migration-card">
          <CardHead icon={Activity} title="Pre-flight dry run" description="Plan changes locally before any RouterOS import call." status={<Pill>Zero RouterOS calls</Pill>} />
          <div className="migration-stage-body">
            <div className="migration-boundary" style={{ borderColor: "rgba(22,140,120,.25)", background: "var(--isp-green-glow)" }}><ShieldCheck size={16} style={{ color: "var(--isp-green)" }} /><div><strong>Dry run is non-destructive</strong><p>Choose compatible items to approve. Nothing is written to {targetRouter?.name || "the target router"} until final confirmation.</p></div></div>
            {dryRunData ? (
              <>
                <div className="migration-finding-list"><div className={`migration-finding ${dryRunData.success ? "good" : "danger"}`}>{dryRunData.success ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{dryRunData.success ? "Dry run simulation completed." : "Dry run identified blockers."}</div></div>
                <table className="migration-dryrun-table"><thead><tr><th></th><th>Planned change</th><th>Scope</th></tr></thead><tbody>
                  {dryRunData.plannedChanges.map(item => <tr key={item.id}><td><input type="checkbox" checked={selectedIds.has(item.id)} onChange={event => { const next = new Set(selectedIds); event.target.checked ? next.add(item.id) : next.delete(item.id); setSelectedIds(next); }} /></td><td><strong>{item.category}</strong><br /><span style={{ color: "var(--isp-text-muted)" }}>{item.label}</span></td><td style={{ color: "var(--isp-text-muted)" }}>Approved item</td></tr>)}
                </tbody></table>
                {dryRunData.skipped.length > 0 && <div className="migration-finding warn"><AlertTriangle size={13} />Skipped: {dryRunData.skipped.join("; ")}</div>}
                {dryRunData.conflicts.length > 0 && <div className="migration-finding warn"><AlertTriangle size={13} />Conflicts: {dryRunData.conflicts.join("; ")}</div>}
                <div className="migration-action-bar"><span className="migration-footer-note"><strong style={{ color: "var(--isp-text)" }}>{selectedIds.size}</strong> of {dryRunData.plannedChanges.length} groups approved</span>{isDryRunDirty() && <button className="migration-button ghost" onClick={() => migrationId && dryRunMutation.mutate({ id: migrationId, approvedItemIds: Array.from(selectedIds) })} disabled={isBusy}><RefreshCw size={12} /> Verify approvals</button>}</div>
              </>
            ) : <div className="migration-preparing"><RefreshCw size={14} className="animate-spin" /> Preparing the non-destructive simulation…</div>}
          </div>
        </section>
      );
    }

    if (currentStep === 6) {
      return (
        <section className="migration-card">
          <CardHead icon={KeyRound} title="Confirmation and import" description={`This is the final write boundary for ${targetRouter?.name || "the target router"}.`} status={<Pill tone="warn">Write action</Pill>} />
          <div className="migration-stage-body">
            <div className="migration-confirm-panel"><p><strong>Target router will be modified.</strong> The pre-change state will be captured for recovery before approved groups are applied.</p><p>Type <strong className="migration-mono" style={{ color: "var(--isp-text)" }}>MODIFY TARGET ROUTER</strong> to authorize this import.</p><input className="migration-confirm-input" aria-label="Import confirmation" value={confirmationText} onChange={event => setConfirmationText(event.target.value.toUpperCase())} placeholder="MODIFY TARGET ROUTER" autoComplete="off" /></div>
            <div className="migration-boundary"><ShieldAlert size={16} /><div><strong>Irreversible from this page</strong><p>Network interruptions may require direct intervention. Verify target connectivity and the dry-run selections before continuing.</p></div></div>
          </div>
        </section>
      );
    }

    return (
      <section className="migration-card">
        <CardHead icon={CheckCircle2} iconTone="green" title="Migration report" description="Import results and recovery information are ready." status={<Pill>{reportData?.success ? "Completed" : "Completed with errors"}</Pill>} />
        <div className="migration-stage-body">
          {reportData && (
            <>
              <div className={`migration-report-hero ${reportData.success ? "" : "danger"}`}><CheckCircle2 size={20} /><div><strong>{reportData.success ? "Migration completed successfully" : "Migration completed with errors"}</strong><span>{reportData.importedItems} items imported · {reportData.failedItems} failed · status {reportData.status}</span></div></div>
              <div className="migration-metric-grid"><div className="migration-metric"><strong>{reportData.importedItems}</strong><span>Imported</span></div><div className="migration-metric"><strong>{reportData.failedItems}</strong><span>Failed</span></div><div className="migration-metric"><strong>{reportData.recoveryPackage?.appliedItemIds.length || 0}</strong><span>Captured items</span></div><div className="migration-metric"><strong>{reportData.recoveryPackage ? "Ready" : "—"}</strong><span>Recovery</span></div></div>
              <div className="migration-log">{reportData.logs.join("\n")}</div>
              {reportData.recoveryPackage && <div className="migration-action-bar"><span className="migration-footer-note">Recovery package <strong className="migration-mono" style={{ color: "var(--isp-text)" }}>{reportData.recoveryPackage.migrationId}</strong> captured before the first write.</span><button className="migration-button ghost" onClick={downloadRecoveryPackage}><CloudDownload size={12} /> Download recovery JSON</button></div>}
            </>
          )}
        </div>
      </section>
    );
  };

  return (
    <AdminLayout>
      <div className="network-migration">
        <div className="migration-page-header">
          <div>
            <div className="migration-eyebrow"><RefreshCw size={12} /> Network operations / controlled change</div>
            <h1 className="migration-page-title">Migration &amp; Disaster Recovery</h1>
            <p className="migration-page-subtitle">Move configuration between MikroTik routers with a read-only source, a bounded tunnel, and an explicit write boundary.</p>
          </div>
          <div className="migration-page-header-actions">
            <button
              className="migration-button primary"
              onClick={generateConfiguration}
              disabled={isBusy || scriptsGenerated || !sourceRouterId}
              title={!sourceRouterId ? "Choose a registered source router first" : undefined}
            >
              {scriptsGenerated ? <><CheckCircle2 size={13} /> Configuration generated</> : isBusy ? <><RefreshCw size={13} className="animate-spin" /> Generating…</> : <><Terminal size={13} /> Generate configuration</>}
            </button>
            <div className="migration-record">MIGRATION <strong>{migrationId || "NEW SESSION"}</strong></div>
          </div>
        </div>

        <NetworkTabs active="migration" />

        <div className="migration-context">
           <div className="migration-node"><div className="migration-node-label">Source / read-only</div><div className="migration-node-name">{sourceRouter?.name || sourceLabel || "Select a source router"}</div><div className="migration-node-meta">{sourceRouter ? <><span>{sourceRouter.host} · {sourceRouter.status}</span>{sourceRouter.vpn_ip && <><span> · </span><code>{sourceRouter.vpn_ip}</code></>}</> : "No source contacted yet"}</div></div>
          <div className="migration-context-arrow"><ArrowRight size={13} /></div>
          <div className="migration-node"><div className="migration-node-label">Target / pending</div><div className="migration-node-name">{targetRouter?.name || "Select after review"}</div><div className="migration-node-meta">{targetRouter ? `${targetRouter.host} · ${targetRouter.status}` : "No target contacted yet"}</div></div>
          <div className="migration-context-state"><ShieldCheck size={12} />{currentStep < 6 ? "No target writes" : "Write boundary"}</div>
        </div>

        <div className="migration-stepper" aria-label="Migration progress">
          {STEPS.map((step, index) => {
            const done = step.id < currentStep;
            const active = step.id === currentStep;
            const Icon = step.icon;
            return (
              <React.Fragment key={step.id}>
                <button className={`migration-step ${done ? "done" : ""} ${active ? "active" : ""}`} onClick={() => step.id <= currentStep && setCurrentStep(step.id)} disabled={step.id > currentStep} aria-current={active ? "step" : undefined}>
                  <span className="migration-step-number">{done ? <Check size={12} /> : <Icon size={12} />}</span><span className="migration-step-name">{step.label}</span>
                </button>
                {index < STEPS.length - 1 && <span className={`migration-step-connector ${done ? "done" : ""}`} />}
              </React.Fragment>
            );
          })}
        </div>

        <Boundary />

        <div className="migration-workspace">
          <div>{renderStage()}</div>
          <aside className="migration-aside">
            <section className="migration-card">
              <CardHead icon={FileCheck2} title="Operator runbook" description="Keep the handoff in this order." />
              <div className="migration-list">
                <div className="migration-list-item"><span className="migration-list-number">01</span><div><strong>Connect first</strong><p>Run the tunnel script on the selected source and wait for connected status.</p></div></div>
                <div className="migration-list-item"><span className="migration-list-number">02</span><div><strong>Export second</strong><p>Run the separate export script. It reads configuration and uploads the sealed package.</p></div></div>
                <div className="migration-list-item"><span className="migration-list-number">03</span><div><strong>Review before writing</strong><p>Choose a target, approve the dry run, then confirm the final import phrase.</p></div></div>
              </div>
            </section>
            <section className="migration-card">
              <CardHead icon={ShieldCheck} iconTone="green" title="Audit guardrails" description="Boundaries enforced by the workflow." />
              <div className="migration-guardrails">
                <div className="migration-guardrail"><CheckCircle2 size={12} />Source access is read-only.</div>
                <div className="migration-guardrail"><CheckCircle2 size={12} />Tunnel lease: 60 minutes maximum.</div>
                <div className="migration-guardrail"><CheckCircle2 size={12} />Target writes require exact phrase.</div>
                <div className="migration-guardrail"><CheckCircle2 size={12} />Recovery state captured before import.</div>
              </div>
            </section>
            <section className="migration-card">
              <CardHead icon={Activity} title="Session telemetry" description="Live record for this migration." />
              <div className="migration-session">
                <div className="migration-session-line"><span>Session status</span><strong style={{ color: tunnel ? "var(--isp-green)" : "var(--isp-text-muted)" }}>{tunnel ? tunnel.status.toUpperCase() : "NOT STARTED"}</strong></div>
                <div className="migration-session-line"><span>Collector</span><strong>{collector ? collector.status.toUpperCase() : "—"}</strong></div>
                <div className="migration-session-line"><span>Last stage</span><strong>{currentStep} / 7</strong></div>
              </div>
            </section>
          </aside>
        </div>

        {currentStep < 7 && (
          <div className="migration-footer">
            <span className="migration-footer-note">{currentStep === 1 ? "Nothing has been written to a router." : `Stage ${currentStep} of 7 · review each boundary before continuing.`}</span>
            <div className="migration-footer-actions">
              {currentStep > 1 ? <button className="migration-button ghost" onClick={() => setCurrentStep(step => step - 1)} disabled={isBusy}><ArrowLeft size={13} /> Back</button> : <button className="migration-button ghost" onClick={() => window.location.reload()} disabled={isBusy}><X size={13} /> Cancel</button>}
              <button className={`migration-button ${currentStep === 6 ? "danger" : "primary"}`} onClick={handleNext} disabled={primaryDisabled}>
                {isBusy ? <><RefreshCw size={13} className="animate-spin" /> Processing…</> : <>
                  {currentStep === 1 && !tunnel && "Generate configuration"}
                  {currentStep === 1 && tunnel && !migrationId && "Verify tunnel & export"}
                  {currentStep === 1 && migrationId && "Continue to export"}
                  {currentStep === 2 && "Review collected data"}
                  {currentStep === 3 && "Choose target"}
                  {currentStep === 4 && "Prepare dry run"}
                  {currentStep === 5 && "Continue to import"}
                  {currentStep === 6 && "Execute import"}
                  {currentStep !== 6 && <ArrowRight size={13} />}
                </>}
              </button>
            </div>
          </div>
        )}
        {copied && <div className="migration-toast" role="status">{copied} copied to clipboard</div>}
         <div className="migration-vpn-summary">
           <div>
             <strong>Permanent router VPN address</strong>
             <span>Assigned from the OpenVPN management pool and written to ipp.txt after the router connects.</span>
           </div>
           <code>{sourceRouter?.vpn_ip || tunnel?.tunnelAddress || "Assigned when configuration is generated"}</code>
         </div>
      </div>
    </AdminLayout>
  );
}