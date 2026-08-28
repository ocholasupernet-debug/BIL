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
  analyzeSource,
  exportSource,
  setTargetRouter,
  runDryRun,
  runImport,
  getReport
} from "./api";
import type { RouterSummary, AnalyzeResponse, ExportResponse, DryRunResponse, ReportResponse } from "./types";
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
  const [sourceRouterId, setSourceRouterId] = useState<number | null>(null);
  const [targetRouterId, setTargetRouterId] = useState<number | null>(null);
  const [migrationId, setMigrationId] = useState<string | null>(null);

  const [analyzeData, setAnalyzeData] = useState<AnalyzeResponse | null>(null);
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

  const analyzeMutation = useMutation({
    mutationFn: analyzeSource,
    onSuccess: (data) => {
      setAnalyzeData(data);
      setCurrentStep(2);
    },
    onError: (err: any) => toast({ title: "Analysis failed", description: err.message, variant: "destructive" })
  });

  const exportMutation = useMutation({
    mutationFn: exportSource,
    onSuccess: (data) => {
      setExportData(data);
      setMigrationId(data.id);
      setCurrentStep(3);
    },
    onError: (err: any) => toast({ title: "Export failed", description: err.message, variant: "destructive" })
  });

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

  const handleNext = () => {
    if (currentStep === 1) {
      if (sourceRouterId) analyzeMutation.mutate(sourceRouterId);
    } else if (currentStep === 2) {
      if (sourceRouterId) exportMutation.mutate(sourceRouterId);
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
              {currentStep === 1 && <><Server size={18} className="text-[var(--isp-accent)]" /> Step 1: Select Source Router</>}
              {currentStep === 2 && <><Database size={18} className="text-[var(--isp-accent)]" /> Step 2: Source Analysis & Export</>}
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
            
            {/* Step 1: Source Router */}
            {currentStep === 1 && (
              <div className="space-y-6 max-w-2xl fade-in">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[var(--isp-text-muted)] uppercase tracking-wide">
                    Source Router
                  </label>
                  <p className="text-xs text-[var(--isp-text-muted)] mb-3">
                    Select the router whose configuration you wish to backup or migrate. This router must be currently online.
                  </p>
                  
                  {routersError ? (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                      Failed to load routers. Please check API connection.
                    </div>
                  ) : routersLoading ? (
                    <div className="p-4 bg-[var(--isp-inner-card)] rounded-lg text-sm text-[var(--isp-text-muted)] flex items-center gap-2">
                      <RefreshCw size={14} className="animate-spin" /> Loading routers...
                    </div>
                  ) : routers && routers.length === 0 ? (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 text-sm">
                      No routers found. Please add a router to the network before proceeding.
                    </div>
                  ) : (
                    <select
                      className="isp-input py-3 w-full cursor-pointer"
                      value={sourceRouterId || ""}
                      onChange={(e) => setSourceRouterId(Number(e.target.value))}
                    >
                      <option value="">-- Choose source router --</option>
                      {routers?.map(r => (
                        <option key={r.id} value={r.id} disabled={r.status !== 'online' && r.status !== 'connected'}>
                          {r.name} ({r.host}) - {r.status}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Export */}
            {currentStep === 2 && (
              <div className="space-y-6 max-w-2xl fade-in">
                <p className="text-sm text-[var(--isp-text)] leading-relaxed">
                  The system verified router identity and resources.
                  <br/><br/>
                  <strong className="text-[var(--isp-text)]">READ-ONLY MODE ACTIVE:</strong> No changes will be made to <code>{routers?.find(r => r.id === sourceRouterId)?.name}</code>.
                </p>

                {analyzeData && (
                  <div className="p-4 rounded-xl border border-[var(--isp-border)] bg-[var(--isp-inner-card)]">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--isp-text)] mb-3">Identity & Capabilities</h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {analyzeData.dataPoints.map((dp, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-[var(--isp-card)] rounded-lg border border-[var(--isp-border)]">
                          <span className="text-xs font-semibold text-[var(--isp-text-muted)] capitalize">{dp.type}</span>
                          <span className="text-sm font-bold text-[var(--isp-text)]">{dp.count}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-[var(--isp-text-muted)] p-2 bg-[var(--isp-card)] rounded border border-[var(--isp-border)]">
                      Identity: <span className="font-mono text-[var(--isp-text)]">{analyzeData.identity.name || "Unknown"}</span>
                      {analyzeData.identity.version && <span> · RouterOS {analyzeData.identity.version}</span>}
                      {analyzeData.identity.boardName && <span> · {analyzeData.identity.boardName}</span>}
                    </div>
                    {!analyzeData.compatible && (
                      <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 text-sm flex gap-2 items-start">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>{analyzeData.details}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Review */}
            {currentStep === 3 && exportData && (
              <div className="space-y-6 max-w-2xl fade-in">
                <div className="flex items-center gap-3 p-4 bg-[var(--isp-green-glow)] border border-[var(--isp-green)]/30 text-[var(--isp-green)] rounded-xl">
                  <CheckCircle2 size={24} />
                  <div>
                    <strong className="block text-sm font-bold">Snapshot Exported Successfully</strong>
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
                  
                  {routers && routers.length < 2 ? (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-600 text-sm">
                      No additional routers found. You need at least one other router to perform a migration.
                    </div>
                  ) : (
                    <select
                      className="isp-input py-3 w-full cursor-pointer"
                      value={targetRouterId || ""}
                      onChange={(e) => setTargetRouterId(Number(e.target.value))}
                    >
                      <option value="">-- Choose target router --</option>
                      {routers?.map(r => {
                        const isSource = r.id === sourceRouterId;
                        return (
                          <option key={r.id} value={r.id} disabled={isSource || (r.status !== 'online' && r.status !== 'connected')}>
                            {r.name} ({r.host}) {isSource ? "(Source - Unavailable)" : ""}
                          </option>
                        )
                      })}
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
                disabled={analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending}
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
                    (currentStep === 1 && !sourceRouterId) ||
                    (currentStep === 4 && (!targetRouterId || targetRouterId === sourceRouterId)) ||
                    (currentStep === 5 && (isDryRunDirty() || dryRunData?.plannedChanges.length === 0 || selectedIds.size === 0)) ||
                    (currentStep === 6 && confirmationText !== "MODIFY TARGET ROUTER") ||
                    analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending
                  }
                >
                  {analyzeMutation.isPending || exportMutation.isPending || targetMutation.isPending || dryRunMutation.isPending || importMutation.isPending ? (
                    <><RefreshCw size={14} className="animate-spin" /> Processing...</>
                  ) : (
                    <>
                      {currentStep === 1 && 'Analyze Router'}
                      {currentStep === 2 && 'Export Config'}
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
