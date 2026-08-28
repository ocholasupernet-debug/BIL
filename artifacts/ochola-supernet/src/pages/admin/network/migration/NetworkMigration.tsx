import React, { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "../NetworkTabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Database,
  FileCheck,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  Activity,
  Check
} from "lucide-react";
import {
  fetchRouters,
  createCollectorSession,
  getCollectorSessionStatus,
  createMigrationTunnel,
  getMigrationTunnelStatus,
  analyzeSource,
  exportSource,
  setTargetRouter,
  runDryRun,
  runImport,
  getReport
} from "./api";
import type { RouterSummary, CollectorSession, MigrationTunnelSession, ExportResponse, DryRunResponse, ReportResponse } from "./types";
import { useToast } from "@/hooks/use-toast";

const STEPS = [
  { id: 1, label: "Source" },
  { id: 2, label: "Export" },
  { id: 3, label: "Review" },
  { id: 4, label: "Target" },
  { id: 5, label: "Dry Run" },
  { id: 6, label: "Import" },
  { id: 7, label: "Report" },
];

export default function NetworkMigration() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [targetRouterId, setTargetRouterId] = useState<number | null>(null);
  const [migrationId, setMigrationId] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceRouterId, setSourceRouterId] = useState<number | null>(null);
  const [tunnel, setTunnel] = useState<MigrationTunnelSession | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [collector, setCollector] = useState<CollectorSession | null>(null);

  const [exportData, setExportData] = useState<ExportResponse | null>(null);
  const [dryRunData, setDryRunData] = useState<DryRunResponse | null>(null);
  const [reportData, setReportData] = useState<ReportResponse | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastDryRunIds, setLastDryRunIds] = useState<Set<string> | null>(null);

  const { data: routers, isLoading: routersLoading, error: routersError } = useQuery<RouterSummary[]>({
    queryKey: ["migration-routers"],
    queryFn: fetchRouters,
    retry: 1,
  });

  const { data: tunnelStatus } = useQuery({
    queryKey: ["migration-tunnel-status", tunnel?.leaseId],
    queryFn: () => getMigrationTunnelStatus(tunnel!.leaseId),
    enabled: Boolean(tunnel?.leaseId),
    refetchInterval: 5000,
    retry: false,
  });

  useEffect(() => {
    if (!tunnel) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [tunnel?.leaseId]);

  useEffect(() => {
    if (!tunnelStatus || !tunnel) return;
    setTunnel(current => current ? { ...current, status: tunnelStatus.status, expiresAt: tunnelStatus.expiresAt } : current);
  }, [tunnelStatus]);

  const collectorMutation = useMutation({
    mutationFn: createCollectorSession,
    onSuccess: (data) => {
      setCollector(data);
    },
    onError: (err: any) => toast({ title: "Collector could not be created", description: err.message, variant: "destructive" })
  });

  const collectorStatusMutation = useMutation({
    mutationFn: getCollectorSessionStatus,
    onSuccess: (data) => {
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
    onError: (err: any) => toast({ title: "Collection status unavailable", description: err.message, variant: "destructive" })
  });

  const tunnelMutation = useMutation({
    mutationFn: createMigrationTunnel,
    onSuccess: (data) => {
      setTunnel(data);
      toast({ title: "One-hour migration tunnel created", description: `Run the RouterOS command for ${data.tunnelAddress}, then verify the API connection.` });
    },
    onError: (err: any) => toast({ title: "Migration tunnel could not be created", description: err.message, variant: "destructive" }),
  });

  const exportMutation = useMutation({
    mutationFn: ({ routerId, tunnelId }: { routerId: number; tunnelId: string }) => exportSource(routerId, tunnelId),
    onSuccess: (data) => {
      setMigrationId(data.id);
      setExportData(data);
      setCurrentStep(3);
      toast({ title: "Source export saved", description: `Read-only export completed through ${data.tunnel?.address ?? "the temporary tunnel"}.` });
    },
    onError: (err: any) => toast({ title: "Source export failed", description: err.message, variant: "destructive" }),
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ routerId, tunnelId }: { routerId: number; tunnelId: string }) => analyzeSource(routerId, tunnelId),
    onSuccess: (_data, variables) => {
      exportMutation.mutate(variables);
    },
    onError: (err: any) => toast({ title: "Tunnel verification failed", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!collector?.token || collector.migrationId) return;
    const poll = () => collectorStatusMutation.mutate(collector.token);
    poll();
    const interval = window.setInterval(poll, 3000);
    return () => window.clearInterval(interval);
  }, [collector?.token, collector?.migrationId]);

  const targetMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: string, targetId: number }) => setTargetRouter(id, targetId),
    onSuccess: () => {
      setCurrentStep(5);
      if (migrationId) {
        dryRunMutation.mutate({ id: migrationId });
      }
    },
    onError: (err: any) => toast({ title: "Target selection failed", description: err.message, variant: "destructive" })
  });

  const dryRunMutation = useMutation({
    mutationFn: runDryRun,
    onSuccess: (data, variables) => {
      setDryRunData(data);
      if (!variables.approvedItemIds) {
        setSelectedIds(new Set());
        setLastDryRunIds(new Set());
      } else {
        setLastDryRunIds(new Set(variables.approvedItemIds));
      }
    },
    onError: (err: any) => toast({ title: "Dry run failed", description: err.message, variant: "destructive" })
  });

  const importMutation = useMutation({
    mutationFn: runImport,
    onSuccess: () => {
      if (migrationId) reportMutation.mutate(migrationId);
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" })
  });

  const reportMutation = useMutation({
    mutationFn: getReport,
    onSuccess: (data) => {
      setReportData(data);
      setCurrentStep(7);
    },
    onError: (err: any) => toast({ title: "Report fetch failed", description: err.message, variant: "destructive" })
  });

  const handleCheckbox = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const isDryRunDirty = () => {
    if (!lastDryRunIds) return false;
    if (lastDryRunIds.size !== selectedIds.size) return true;
    for (let id of selectedIds) {
      if (!lastDryRunIds.has(id)) return true;
    }
    return false;
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

  const copyCollectorCommand = async () => {
    if (!collector) return;
    try {
      await navigator.clipboard.writeText(collector.command);
      toast({ title: "Command copied", description: "Paste it into the active MikroTik terminal." });
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the command manually.", variant: "destructive" });
    }
  };

  const copyTunnelCommand = async () => {
    if (!tunnel) return;
    try {
      await navigator.clipboard.writeText(tunnel.command);
      toast({ title: "Command copied", description: "Paste it into the selected source MikroTik terminal." });
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the tunnel command manually.", variant: "destructive" });
    }
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (collector?.migrationId) setCurrentStep(2);
      else if (sourceRouterId) {
        if (!tunnel) tunnelMutation.mutate(sourceRouterId);
        else if (!migrationId && !analyzeMutation.isPending && !exportMutation.isPending) analyzeMutation.mutate({ routerId: sourceRouterId, tunnelId: tunnel.leaseId });
      }
    } else if (currentStep === 2) {
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(4);
    } else if (currentStep === 4) {
      if (migrationId && targetRouterId) targetMutation.mutate({ id: migrationId, targetId: targetRouterId });
    } else if (currentStep === 5) {
      setCurrentStep(6);
    } else if (currentStep === 6) {
      if (migrationId && confirmationText === "MODIFY TARGET ROUTER") {
        importMutation.mutate({ id: migrationId, confirmation: confirmationText, approvedItemIds: Array.from(selectedIds) });
      }
    }
  };

  const tunnelSecondsRemaining = tunnel ? Math.max(0, Math.floor((new Date(tunnel.expiresAt).getTime() - clock) / 1000)) : 0;
  const tunnelCountdown = `${Math.floor(tunnelSecondsRemaining / 3600)}h ${String(Math.floor((tunnelSecondsRemaining % 3600) / 60)).padStart(2, "0")}m ${String(tunnelSecondsRemaining % 60).padStart(2, "0")}s`;

  return (
    <AdminLayout>
      <div className="flex flex-col gap-5 max-w-[1000px] w-full mx-auto pb-12 fade-in">
        <div className="page-header">
          <h1>Migration & Disaster Recovery</h1>
          <p>Safely transfer configurations between MikroTik routers in high-stakes scenarios.</p>
        </div>

        <NetworkTabs active="migration" />

        {/* Status indicator */}
        <div className="flex items-center justify-between px-6 py-4 rounded-xl shadow-sm border border-[var(--isp-border)] bg-[var(--isp-card)]">
          {STEPS.map((step, idx) => {
            const active = step.id === currentStep;
            const completed = step.id < currentStep;
            return (
              <React.Fragment key={step.id}>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                    active ? 'bg-[var(--isp-accent)] text-white shadow-[0_0_0_4px_var(--isp-accent-glow)]' :
                    completed ? 'bg-[var(--isp-green)] text-white' :
                    'bg-[var(--isp-inner-card)] text-[var(--isp-text-sub)] border border-[var(--isp-border)]'
                  }`}>
                    {completed ? <Check size={14} /> : step.id}
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider hidden sm:block ${
                    active || completed ? 'text-[var(--isp-text)]' : 'text-[var(--isp-text-muted)]'
                  }`}>
                    {step.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-[2px] rounded-full mx-2 ${
                    completed ? 'bg-[var(--isp-green)]' : 'bg-[var(--isp-border)]'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Global Warning */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[var(--isp-border)] bg-[var(--isp-inner-card)] text-[var(--isp-text)] text-sm">
          <ShieldAlert className="text-[var(--isp-accent)]" size={20} />
          <div>
            <strong className="block text-[var(--isp-text)] uppercase tracking-wider text-xs font-bold mb-1">Strict Read-Only Guarantee</strong>
            <span className="text-[var(--isp-text-muted)]">Source router configurations will <b>never</b> be modified. Target selection contacts the target for identity checking. Dry run performs zero RouterOS calls.</span>
          </div>
        </div>

        <div className="flex flex-col border border-[var(--isp-border)] rounded-xl bg-[var(--isp-card)] shadow-[var(--shadow-card)] overflow-hidden min-h-[400px]">
          <div className="p-5 border-b border-[var(--isp-border)] bg-[var(--isp-section)] flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              {currentStep === 1 && <><Terminal size={18} className="text-[var(--isp-accent)]" /> Step 1: Collect Source Router</>}
              {currentStep === 2 && <><Database size={18} className="text-[var(--isp-accent)]" /> Step 2: Collected Export</>}
              {currentStep === 3 && <><FileCheck size={18} className="text-[var(--isp-accent)]" /> Step 3: Review Compatibility</>}
              {currentStep === 4 && <><ArrowRight size={18} className="text-[var(--isp-accent)]" /> Step 4: Select Target Router</>}
              {currentStep === 5 && <><Activity size={18} className="text-[var(--isp-accent)]" /> Step 5: Pre-flight Dry Run</>}
              {currentStep === 6 && <><Terminal size={18} className="text-[var(--isp-accent)]" /> Step 6: Confirmation & Import</>}
              {currentStep === 7 && <><CheckCircle2 size={18} className="text-[var(--isp-green)]" /> Step 7: Migration Report</>}
            </h2>
            <div className="text-xs font-bold text-[var(--isp-text-muted)] bg-[var(--isp-inner-card)] px-3 py-1 rounded-md border border-[var(--isp-border)]">
              {currentStep} / 7
            </div>
          </div>

          <div className="p-6 flex-1 bg-[var(--isp-card)]">
            
            {/* Step 1: Collect source export from the active router */}
            {currentStep === 1 && (
              <div className="space-y-6 max-w-2xl fade-in">
                <div className="space-y-4 p-4 rounded-xl border border-[var(--isp-accent)]/40 bg-[var(--isp-accent)]/5">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--isp-text)]">Registered source router tunnel</h3>
                    <p className="text-xs text-[var(--isp-text-muted)] mt-1">
                      Recommended for routers already registered in OcholaSupernet. A temporary OpenVPN management tunnel is created for one hour and is removed automatically.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--isp-text-muted)] uppercase tracking-wide">Source router</label>
                    <select
                      className="isp-input py-3 w-full cursor-pointer"
                      value={sourceRouterId ?? ""}
                      onChange={e => {
                        setSourceRouterId(e.target.value ? Number(e.target.value) : null);
                        setTunnel(null);
                        setMigrationId(null);
                        setExportData(null);
                      }}
                    >
                      <option value="">-- Choose registered source router --</option>
                      {routers?.map(r => (
                        <option key={r.id} value={r.id}>{r.name} · {r.status}</option>
                      ))}
                    </select>
                  </div>
                  {sourceRouterId && tunnel && (
                    <div className="space-y-3 rounded-lg border border-[var(--isp-border)] bg-[var(--isp-inner-card)] p-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="block text-[var(--isp-text-muted)]">Tunnel address</span>
                          <strong className="text-[var(--isp-text)]">{tunnel.tunnelAddress}</strong>
                        </div>
                        <div>
                          <span className="block text-[var(--isp-text-muted)]">Status</span>
                          <strong className="text-[var(--isp-text)] capitalize">{tunnel.status.replace("_", " ")}</strong>
                        </div>
                        <div>
                          <span className="block text-[var(--isp-text-muted)]">Time remaining</span>
                          <strong className={tunnelSecondsRemaining > 0 ? "text-[var(--isp-green)]" : "text-red-600"}>{tunnelCountdown}</strong>
                        </div>
                        <div>
                          <span className="block text-[var(--isp-text-muted)]">Expires</span>
                          <strong className="text-[var(--isp-text)]">{new Date(tunnel.expiresAt).toLocaleTimeString()}</strong>
                        </div>
                      </div>
                      <div>
                        <span className="text-[11px] text-[var(--isp-text-muted)]">Paste this command into the selected MikroTik terminal:</span>
                        <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed text-gray-300">{tunnel.command}</pre>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-ghost" onClick={copyTunnelCommand}><FileCheck size={14} /> Copy tunnel command</button>
                      </div>
                      <p className="text-[11px] text-amber-600">
                        After importing the script, continue to verify the RouterOS API and run the read-only export. The router removes this migration client after one hour.
                      </p>
                    </div>
                  )}
                  {sourceRouterId && !tunnel && (
                    <p className="text-xs text-[var(--isp-text-muted)]">Use the Continue button below to reserve the one-hour tunnel and receive the RouterOS command.</p>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-[var(--isp-accent)]/30 bg-[var(--isp-accent)]/5">
                  <h3 className="text-sm font-bold text-[var(--isp-text)] mb-2">Manual read-only collector</h3>
                  <ol className="text-xs text-[var(--isp-text-muted)] space-y-2 list-decimal pl-5">
                    <li>Give the source router a name and create a one-time collector session.</li>
                    <li>Paste the displayed command into the active MikroTik terminal.</li>
                    <li>The domain-hosted script reads the router and uploads the export automatically.</li>
                  </ol>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--isp-text-muted)] uppercase tracking-wide">Source router name</label>
                  <input className="isp-input py-3 w-full" value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="e.g. Main Office MikroTik" maxLength={120} />
                </div>
                {!collector && (
                  <button type="button" className="btn btn-primary" onClick={() => collectorMutation.mutate(sourceLabel.trim())} disabled={!sourceLabel.trim() || collectorMutation.isPending}>
                    {collectorMutation.isPending ? <><RefreshCw size={14} className="animate-spin" /> Creating session...</> : <><Terminal size={14} /> Create domain collector</>}
                  </button>
                )}
                {collector && (
                  <div className="space-y-4 p-4 rounded-xl border border-[var(--isp-border)] bg-[var(--isp-inner-card)]">
                    <div>
                      <label className="text-xs font-bold text-[var(--isp-text-muted)] uppercase tracking-wide">Domain-linked RouterOS command</label>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[#0a0a0a] p-3 text-[11px] leading-relaxed text-gray-300">{collector.command}</pre>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button type="button" className="btn btn-ghost" onClick={copyCollectorCommand}><FileCheck size={14} /> Copy command</button>
                        <a className="btn btn-ghost" href={collector.scriptUrl} target="_blank" rel="noreferrer"><FileCheck size={14} /> View hosted script</a>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--isp-border)] pt-3">
                      <div>
                        <strong className="block text-xs text-[var(--isp-text)]">
                          {collector.status === "waiting" ? "Waiting for the MikroTik..." : collector.migrationId ? "Export received and saved" : "Processing router export..."}
                        </strong>
                        <span className="text-[11px] text-[var(--isp-text-muted)]">Session expires {new Date(collector.expiresAt).toLocaleTimeString()}</span>
                      </div>
                      {!collector.migrationId && (
                        <button type="button" className="btn btn-ghost shrink-0" onClick={() => collectorStatusMutation.mutate(collector.token)} disabled={collectorStatusMutation.isPending}>
                          <RefreshCw size={14} className={collectorStatusMutation.isPending ? "animate-spin" : ""} /> Check collection
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-600">
                  The collector includes passwords and other sensitive values. Use it only on the intended source router, keep the one-time URL private, and wait for the web app to confirm collection.
                </div>
              </div>
            )}

            {/* Step 2: Export */}
            {currentStep === 2 && (
              <div className="space-y-6 max-w-2xl fade-in">
                <p className="text-sm text-[var(--isp-text)] leading-relaxed">
                  The web app received the export collected from the source router.
                  <br/><br/>
                   <strong className="text-[var(--isp-text)]">READ-ONLY COLLECTION:</strong> The source router was not contacted or modified. The collected export is stored as <code>{exportData?.sourceLabel || sourceLabel}</code>.
                </p>

                <div className="p-4 rounded-xl border border-[var(--isp-border)] bg-[var(--isp-inner-card)]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--isp-text)] mb-2">Source saved securely</h3>
                  <p className="text-xs text-[var(--isp-text-muted)]">
                    <strong className="text-[var(--isp-text)]">{exportData?.sourceLabel || sourceLabel}</strong> is now available as the source for this migration. The original terminal output remains encrypted and is not displayed again.
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Review */}
            {currentStep === 3 && exportData && (
              <div className="space-y-6 max-w-2xl fade-in">
                <div className="flex items-center gap-3 p-4 bg-[var(--isp-green-glow)] border border-[var(--isp-green)]/30 text-[var(--isp-green)] rounded-xl">
                  <CheckCircle2 size={24} />
                  <div>
                    <strong className="block text-sm font-bold">Source Export Saved Successfully</strong>
                    <span className="text-xs opacity-80">Reference ID: {exportData.id}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl text-center">
                    <div className="text-2xl font-black text-[var(--isp-text)]">{exportData.summary.users}</div>
                    <div className="text-[10px] font-bold uppercase text-[var(--isp-text-muted)] tracking-wider mt-1">Users</div>
                  </div>
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl text-center">
                    <div className="text-2xl font-black text-[var(--isp-text)]">{exportData.summary.queues}</div>
                    <div className="text-[10px] font-bold uppercase text-[var(--isp-text-muted)] tracking-wider mt-1">Queues</div>
                  </div>
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl text-center">
                    <div className="text-2xl font-black text-[var(--isp-text)]">{exportData.summary.pools}</div>
                    <div className="text-[10px] font-bold uppercase text-[var(--isp-text-muted)] tracking-wider mt-1">IP Pools</div>
                  </div>
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl text-center">
                    <div className="text-2xl font-black text-[var(--isp-text)]">{exportData.summary.configs}</div>
                    <div className="text-[10px] font-bold uppercase text-[var(--isp-text-muted)] tracking-wider mt-1">Configs</div>
                  </div>
                </div>

                {(exportData.findings.manual.length > 0 || exportData.findings.unsupported.length > 0 || exportData.findings.warnings.length > 0) && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-[var(--isp-text)]">Configuration Review</h3>
                    {exportData.findings.unsupported.length > 0 && (
                      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                        <strong className="text-xs text-red-500 uppercase">Unsupported Features</strong>
                        <ul className="list-disc pl-5 text-xs text-red-400 mt-1">
                          {exportData.findings.unsupported.map((u, i) => <li key={i}>{u}</li>)}
                        </ul>
                      </div>
                    )}
                    {exportData.findings.manual.length > 0 && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                        <strong className="text-xs text-amber-500 uppercase">Requires Manual Setup</strong>
                        <ul className="list-disc pl-5 text-xs text-amber-500/80 mt-1">
                          {exportData.findings.manual.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      </div>
                    )}
                    {exportData.findings.warnings.length > 0 && (
                      <div className="p-3 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl">
                        <strong className="text-xs text-[var(--isp-text-muted)] uppercase">General Warnings</strong>
                        <ul className="list-disc pl-5 text-xs text-[var(--isp-text)] mt-1">
                          {exportData.findings.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-[var(--isp-text-muted)]">
                  The data has been safely vaulted in the controller. Proceed to target selection.
                </p>
              </div>
            )}

            {/* Step 4: Target Selection */}
            {currentStep === 4 && (
              <div className="space-y-6 max-w-2xl fade-in">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--isp-text-muted)] uppercase tracking-wide">
                    Target / Replacement Router
                  </label>
                  <p className="text-xs text-[var(--isp-text-muted)] mb-3">
                    Select the destination for this configuration. 
                    <strong className="text-[var(--isp-accent)] ml-1">Do not select the same router.</strong>
                  </p>
                  
                  {routersError ? (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                      Failed to load target routers. Please check the API connection.
                    </div>
                  ) : routersLoading ? (
                    <div className="p-4 bg-[var(--isp-inner-card)] rounded-lg text-sm text-[var(--isp-text-muted)] flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin" /> Loading target routers...
                    </div>
                  ) : routers && routers.length < 1 ? (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 text-sm">
                      No target routers found. Add the replacement router before proceeding.
                    </div>
                  ) : (
                    <select
                      className="isp-input py-3 w-full cursor-pointer"
                      value={targetRouterId || ""}
                      onChange={(e) => setTargetRouterId(Number(e.target.value))}
                    >
                      <option value="">-- Choose target router --</option>
                      {routers?.map(r => (
                        <option key={r.id} value={r.id} disabled={r.status !== 'online' && r.status !== 'connected'}>
                          {r.name} ({r.host})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Step 5: Dry Run */}
            {currentStep === 5 && (
              <div className="space-y-6 max-w-3xl fade-in">
                <p className="text-sm text-[var(--isp-text)] mb-4">
                  Select which items you intend to import. The controller will simulate the import process against the target router API without committing changes. Dry run performs zero RouterOS calls.
                </p>

                {dryRunData && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border ${dryRunData.success ? 'bg-[var(--isp-green-glow)] border-[var(--isp-green)]/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <div className="flex items-center gap-2">
                        {dryRunData.success ? <CheckCircle2 className="text-[var(--isp-green)]" /> : <AlertTriangle className="text-red-500" />}
                        <strong className={`text-sm font-bold ${dryRunData.success ? 'text-[var(--isp-green)]' : 'text-red-500'}`}>
                          {dryRunData.success ? 'Dry run simulation completed.' : 'Dry run identified blockers.'}
                        </strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl">
                        <h4 className="text-xs font-bold text-[var(--isp-text)] uppercase tracking-wider mb-3">Planned Changes ({dryRunData.plannedChanges.length})</h4>
                        {dryRunData.plannedChanges.length === 0 ? (
                          <p className="text-xs text-[var(--isp-text-muted)] italic">No supported items found. This migration is report-only. Import is blocked.</p>
                        ) : (
                          <div className="space-y-2 h-64 overflow-y-auto custom-scrollbar pr-2">
                            {dryRunData.plannedChanges.map(item => (
                              <label key={item.id} className="flex items-start gap-3 p-2 hover:bg-[var(--isp-hover)] rounded border border-transparent hover:border-[var(--isp-border)] cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="mt-1 w-4 h-4 rounded border-[var(--isp-border)] text-[var(--isp-accent)] focus:ring-[var(--isp-accent)]"
                                  checked={selectedIds.has(item.id)}
                                  onChange={(e) => handleCheckbox(item.id, e.target.checked)}
                                />
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-[var(--isp-text)]">{item.category}</span>
                                  <span className="text-xs text-[var(--isp-text-muted)]">{item.label}</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {dryRunData.skipped.length > 0 && (
                        <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl">
                          <h4 className="text-xs font-bold text-[var(--isp-text)] uppercase tracking-wider mb-3">Skipped Items</h4>
                          <ul className="text-xs text-[var(--isp-text-muted)] space-y-1.5 list-disc pl-4 h-24 overflow-y-auto custom-scrollbar">
                            {dryRunData.skipped.map((s,i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>

                    {(dryRunData.warnings.length > 0 || dryRunData.conflicts.length > 0) && (
                      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                        <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <AlertTriangle size={14} /> Warnings & Conflicts
                        </h4>
                        <ul className="text-xs text-amber-600/80 space-y-1.5 list-disc pl-4 max-h-32 overflow-y-auto custom-scrollbar">
                          {dryRunData.conflicts.map((c,i) => <li key={i}><strong className="text-amber-600">Conflict:</strong> {c}</li>)}
                          {dryRunData.warnings.map((w,i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 6: Import Confirmation */}
            {currentStep === 6 && (
              <div className="space-y-6 max-w-xl mx-auto text-center fade-in py-8">
                <ShieldAlert size={48} className="mx-auto text-[var(--isp-accent)] mb-4" />
                <h3 className="text-lg font-black text-[var(--isp-text)]">Final Authorization Required</h3>
                <div className="text-sm text-[var(--isp-text-muted)] leading-relaxed max-w-md mx-auto space-y-3">
                  <p>
                    You are about to irreversibly apply the snapshot to the target router 
                    (<strong>{routers?.find(r => r.id === targetRouterId)?.name}</strong>).
                  </p>
                  <div className="p-3 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded text-left">
                    <strong className="block text-xs uppercase text-[var(--isp-text)] mb-1">State Capture & Rollback</strong>
                    <span className="text-xs">
                      A read-only configuration state capture will be taken before import. This is not a RouterOS backup file; recovery is manual and network interruptions may require direct intervention. Verify connectivity before proceeding.
                    </span>
                  </div>
                  <p>
                    To proceed, type <strong className="text-[var(--isp-text)] select-all bg-[var(--isp-border)] px-1.5 py-0.5 rounded">MODIFY TARGET ROUTER</strong> in the box below.
                  </p>
                </div>

                <div className="max-w-xs mx-auto mt-6">
                  <input
                    type="text"
                    className="isp-input text-center font-mono font-bold tracking-wider py-3 uppercase"
                    placeholder="MODIFY TARGET ROUTER"
                    value={confirmationText}
                    onChange={e => setConfirmationText(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {/* Step 7: Report */}
            {currentStep === 7 && reportData && (
              <div className="space-y-6 max-w-3xl fade-in">
                <div className={`flex items-center justify-between p-5 rounded-xl border ${reportData.success ? 'bg-[var(--isp-green-glow)] border-[var(--isp-green)]/30' : 'bg-red-500/10 border-red-500/30'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${reportData.success ? 'bg-[var(--isp-green)] text-white' : 'bg-red-500 text-white'}`}>
                      {reportData.success ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
                    </div>
                    <div>
                      <h3 className={`text-base font-black ${reportData.success ? 'text-[var(--isp-green)]' : 'text-red-500'}`}>
                        {reportData.success ? 'Migration Successful' : 'Migration Completed with Errors'}
                      </h3>
                      <p className="text-xs opacity-80 font-medium">Status: {reportData.status}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-[var(--isp-text)]">{reportData.importedItems}</div>
                    <div className="text-[10px] font-bold uppercase text-[var(--isp-text-muted)] tracking-wider">Items Imported</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl">
                    <h4 className="text-xs font-bold text-[var(--isp-text)] uppercase tracking-wider mb-2">Recovery Info</h4>
                    <p className="text-xs text-[var(--isp-text-muted)]">{reportData.recovery}</p>
                  </div>
                  <div className="p-4 bg-[var(--isp-inner-card)] border border-[var(--isp-border)] rounded-xl">
                    <h4 className="text-xs font-bold text-[var(--isp-text)] uppercase tracking-wider mb-2">Verification</h4>
                    <pre className="text-xs text-[var(--isp-text-muted)] whitespace-pre-wrap break-words">{JSON.stringify(reportData.verification, null, 2)}</pre>
                  </div>
                </div>

                {reportData.recoveryPackage && (
                  <div className="p-4 bg-red-500/5 border border-red-500/30 rounded-xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider">Redacted Recovery Package</h4>
                        <p className="text-xs text-[var(--isp-text-muted)] mt-1">{reportData.recoveryPackage.note}</p>
                      </div>
                      <button className="btn btn-ghost shrink-0" onClick={downloadRecoveryPackage}>
                        <FileCheck size={14} /> Download Recovery JSON
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div><dt className="text-[var(--isp-text-muted)]">Captured</dt><dd className="font-medium text-[var(--isp-text)]">{reportData.recoveryPackage.capturedAt || "Before first write"}</dd></div>
                      <div><dt className="text-[var(--isp-text-muted)]">Applied items</dt><dd className="font-medium text-[var(--isp-text)]">{reportData.recoveryPackage.appliedItemIds.length}</dd></div>
                      <div><dt className="text-[var(--isp-text-muted)]">Failed stage</dt><dd className="font-medium text-red-500">{reportData.recoveryPackage.failedStage}</dd></div>
                    </dl>
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold text-[var(--isp-text)]">Review captured pre-change state</summary>
                      <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-[#0a0a0a] p-3 text-gray-300 whitespace-pre-wrap break-words">{JSON.stringify(reportData.recoveryPackage.preChangeState, null, 2)}</pre>
                    </details>
                  </div>
                )}

                <div className="p-4 bg-[#0a0a0a] border border-[#1f1f1f] rounded-xl font-mono text-xs text-gray-300">
                  <div className="flex items-center justify-between mb-3 border-b border-[#222] pb-2">
                    <span className="font-bold text-gray-400">Execution Log</span>
                    <span className="text-[10px] text-gray-500">Read-only view</span>
                  </div>
                  <div className="h-64 overflow-y-auto custom-scrollbar space-y-1.5 pr-2">
                    {reportData.logs.map((log, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-gray-600 shrink-0">[{String(i+1).padStart(4, '0')}]</span>
                        <span className={log.toLowerCase().includes('error') || log.toLowerCase().includes('failed') ? 'text-red-400' : 'text-gray-300'}>
                          {log}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex justify-end pt-4">
                  <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                    <RefreshCw size={14} /> Start New Migration
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Footer Actions */}
          {currentStep < 7 && (
            <div className="p-5 border-t border-[var(--isp-border)] bg-[var(--isp-section)] flex justify-between items-center">
              <button 
                className="btn btn-ghost" 
                onClick={() => window.location.reload()}
                disabled={collectorMutation.isPending || collectorStatusMutation.isPending || tunnelMutation.isPending || analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending}
              >
                Cancel
              </button>
              
              <div className="flex items-center gap-3">
                {currentStep === 5 && isDryRunDirty() && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (migrationId) dryRunMutation.mutate({ id: migrationId, approvedItemIds: Array.from(selectedIds) });
                    }}
                    disabled={dryRunMutation.isPending}
                  >
                    {dryRunMutation.isPending ? "Updating..." : "Verify Approvals"}
                  </button>
                )}

                <button 
                  className={`btn ${currentStep === 6 ? 'btn-danger' : 'btn-primary'}`}
                  onClick={handleNext}
                  disabled={
                    (currentStep === 1 && !collector?.migrationId && !migrationId && !sourceRouterId) ||
                    (currentStep === 4 && !targetRouterId) ||
                    (currentStep === 5 && (isDryRunDirty() || dryRunData?.plannedChanges.length === 0 || selectedIds.size === 0)) ||
                    (currentStep === 6 && confirmationText !== "MODIFY TARGET ROUTER") ||
                    collectorMutation.isPending || collectorStatusMutation.isPending || tunnelMutation.isPending || analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending
                  }
                >
                  {collectorMutation.isPending || collectorStatusMutation.isPending || tunnelMutation.isPending || analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending ? (
                    <><RefreshCw size={14} className="animate-spin" /> Processing...</>
                  ) : (
                    <>
                      {currentStep === 1 && !collector?.migrationId && !tunnel && 'Start one-hour tunnel'}
                      {currentStep === 1 && !collector?.migrationId && tunnel && !migrationId && 'Verify tunnel & export'}
                      {currentStep === 1 && migrationId && 'Continue to Collected Export'}
                      {currentStep === 2 && 'Review Collected Data'}
                      {currentStep === 3 && 'Acknowledge & Continue'}
                      {currentStep === 4 && 'Prepare Dry Run'}
                      {currentStep === 5 && 'Continue to Import'}
                      {currentStep === 6 && 'EXECUTE IMPORT'}
                      {currentStep !== 6 && <ChevronRight size={16} />}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(150,150,150,0.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(150,150,150,0.4); }
      `}</style>
    </AdminLayout>
  );
}
