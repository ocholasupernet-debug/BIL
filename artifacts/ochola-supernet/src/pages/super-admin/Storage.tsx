import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import {
  AlertTriangle, CheckCircle2, Clock3, Database, HardDrive, Loader2,
  RefreshCw, ShieldCheck, Trash2, UserRound, XCircle,
} from "lucide-react";

const C = {
  card: "rgba(255,255,255,0.04)",
  border: "var(--isp-accent-glow)",
  accent: "var(--isp-accent)",
  text: "#e2e8f0",
  muted: "#64748b",
  sub: "#94a3b8",
  green: "#4ade80",
  red: "#f87171",
  amber: "#fbbf24",
};

interface AdminUsage {
  id: number;
  name: string;
  username: string;
  email: string | null;
  is_active: boolean;
  bytes: number | null;
  rowCount: number | null;
  breakdown: Record<string, { bytes: number; rows: number }>;
}

interface Candidate {
  id: number;
  admin_id: number;
  source_label: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  bytes: number;
  rowCount: number;
}

interface CleanupRequest {
  id: number;
  admin_id: number;
  scope: string;
  reason: string;
  requested_by: string;
  scheduled_for: string;
  candidate_bytes: number | string;
  candidate_rows: number | string;
  status: "pending" | "processing" | "cancelled" | "completed" | "failed";
  completed_at: string | null;
  failure_details: string | null;
  created_at: string;
}

interface PhysicalSource {
  source: string;
  status: "available" | "partial" | "unavailable" | "stale";
  measurementKind: string;
  usedBytes: number | null;
  capacityBytes: number | null;
  freeBytes: number | null;
  measuredAt: string | null;
  error: string | null;
  details: {
    path?: string;
    buckets?: Array<{
      bucket: string;
      status: "available" | "unavailable";
      usedBytes: number | null;
      objectCount: number | null;
      measuredAt: string | null;
      error: string | null;
    }>;
  };
}

interface StorageData {
  measuredAt: string;
  capacityBytes: number | null;
  totalUsedBytes: number | null;
  freeBytes: number | null;
  usagePercent: number | null;
  capacity: { bytes: number | null; source: string; measuredAt: string | null };
  freeSpace: { bytes: number | null; source: string | null; measuredAt: string | null };
  measurement: {
    kind: string;
    retentionDays: number;
    notes: string[];
    tenantRowPayload: {
      source: string;
      status: "available" | "unavailable";
      usedBytes: number | null;
      measuredAt: string | null;
      error: string | null;
    };
    freshness: {
      collectionIntervalMinutes: number;
      staleAfterMinutes: number;
      checkedAt: string;
    };
    physicalSources: PhysicalSource[];
  };
  usage: AdminUsage[];
  candidates: Candidate[];
  requests: CleanupRequest[];
}

function formatBytes(value: number | null): string {
  if (value === null) return "Not configured";
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
}

function sourceLabel(source: string): string {
  return {
    supabase_postgres: "Supabase Postgres",
    supabase_storage: "Supabase Storage",
    vps_filesystem: "VPS filesystem",
  }[source] || source;
}

function statusColor(status: PhysicalSource["status"]): string {
  return status === "available" ? C.green : status === "partial" || status === "stale" ? C.amber : C.red;
}

function countdown(value: string, now: number): string {
  const remaining = new Date(value).getTime() - now;
  if (remaining <= 0) return "Due now";
  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatCard({ label, value, detail, icon: Icon, color = C.accent }: {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ color: C.muted, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
        <Icon size={16} color={color} />
      </div>
      <strong style={{ display: "block", color, fontSize: "1.45rem", marginTop: 10 }}>{value}</strong>
      <span style={{ color: C.sub, fontSize: 11 }}>{detail}</span>
    </div>
  );
}

function Button({ children, onClick, disabled = false, danger = false, secondary = false }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        borderRadius: 8, padding: "8px 12px", fontSize: 11, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
        color: danger ? C.red : secondary ? C.sub : "white",
        background: danger ? "rgba(239,68,68,0.1)" : secondary ? "rgba(255,255,255,0.05)" : C.accent,
        border: `1px solid ${danger ? "rgba(239,68,68,0.25)" : secondary ? "rgba(255,255,255,0.1)" : C.accent}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function SuperAdminStorage() {
  const [data, setData] = useState<StorageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [capacityGb, setCapacityGb] = useState("");
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [delayDays, setDelayDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const token = () => localStorage.getItem("ochola_superadmin_token") || "";
  const showToast = (message: string, ok = true) => {
    setToast({ message, ok });
    window.setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/super-admin/storage", { headers: { "x-sa-token": token() } });
      const body = await response.json() as StorageData & { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not load storage data.");
      setData(body);
      if (body.capacityBytes !== null) setCapacityGb((body.capacityBytes / 1024 ** 3).toFixed(1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load storage data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(true), 60_000);
    const ticker = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(ticker);
    };
  }, [load]);

  const adminsById = useMemo(() => new Map((data?.usage ?? []).map(admin => [admin.id, admin])), [data]);
  const selectedAdmin = selectedAdminId ? adminsById.get(selectedAdminId) : null;
  const selectedCandidates = (data?.candidates ?? []).filter(candidate => selectedCandidateIds.includes(candidate.id));
  const pendingRequests = (data?.requests ?? []).filter(request => request.status === "pending" || request.status === "processing");
  const history = (data?.requests ?? []).filter(request => request.status !== "pending" && request.status !== "processing");

  const toggleCandidate = (candidate: Candidate) => {
    if (selectedAdminId !== null && selectedAdminId !== candidate.admin_id) {
      showToast("Select cleanup items from one ISP admin at a time.", false);
      return;
    }
    setSelectedAdminId(candidate.admin_id);
    setSelectedCandidateIds(current =>
      current.includes(candidate.id) ? current.filter(id => id !== candidate.id) : [...current, candidate.id],
    );
  };

  const saveCapacity = async () => {
    const gb = Number(capacityGb);
    if (!Number.isFinite(gb) || gb < 0) {
      showToast("Enter a valid capacity in GB.", false);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/super-admin/storage/capacity", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-sa-token": token() },
        body: JSON.stringify({ capacityBytes: Math.round(gb * 1024 ** 3) }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; deletedBytes?: number };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not save capacity.");
      showToast("Platform storage capacity saved.");
      await load(true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not save capacity.", false);
    } finally {
      setSaving(false);
    }
  };

  const scheduleCleanup = async () => {
    if (!selectedAdminId || selectedCandidateIds.length === 0 || reason.trim().length < 5) {
      showToast("Choose an admin, at least one eligible item, and explain the cleanup.", false);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/super-admin/storage/cleanup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token() },
        body: JSON.stringify({
          adminId: selectedAdminId,
          candidateIds: selectedCandidateIds,
          reason: reason.trim(),
          scheduledFor: new Date(Date.now() + Number(delayDays) * 86_400_000).toISOString(),
        }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; deletedBytes?: number };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not schedule cleanup.");
      showToast("Admin notified and cleanup countdown started.");
      setSelectedAdminId(null);
      setSelectedCandidateIds([]);
      setReason("");
      await load(true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not schedule cleanup.", false);
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (id: number) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/super-admin/storage/cleanup-requests/${id}/cancel`, {
        method: "POST",
        headers: { "x-sa-token": token() },
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not cancel cleanup.");
      showToast("Cleanup request cancelled.");
      await load(true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not cancel cleanup.", false);
    } finally {
      setSaving(false);
    }
  };

  const deleteNow = async () => {
    if (!confirmDeleteId || confirmationText !== "DELETE") return;
    setSaving(true);
    try {
      const response = await fetch(`/api/super-admin/storage/cleanup-requests/${confirmDeleteId}/delete-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sa-token": token() },
        body: JSON.stringify({ confirmation: confirmationText }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; deletedBytes?: number };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not delete cleanup data.");
      showToast(`Cleanup complete; released ${formatBytes(body.deletedBytes ?? 0)}.`);
      setConfirmDeleteId(null);
      setConfirmationText("");
      await load(true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Immediate cleanup failed.", false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1180 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
          <div>
            <h1 style={{ color: "white", fontSize: "1.45rem", fontWeight: 850, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <HardDrive size={23} color={C.accent} /> Storage governance
            </h1>
            <p style={{ color: C.muted, fontSize: 12, margin: "5px 0 0" }}>Measure tenant-owned data and manage reviewed cleanup without touching live service records.</p>
          </div>
          <Button onClick={() => void load(true)} disabled={refreshing} secondary>
            <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} /> Refresh
          </Button>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: C.red, padding: "12px 14px", borderRadius: 10, fontSize: 12, marginBottom: 18 }}>
            <strong>Storage report unavailable.</strong> {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: C.muted, padding: 60, textAlign: "center" }}><Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} /><p>Loading measured storage…</p></div>
        ) : data && (
          <>
            <div className="storage-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 18 }}>
              <StatCard label="Measured in use" value={formatBytes(data.totalUsedBytes)} detail={data.measurement.tenantRowPayload.status === "available" ? `Tenant row estimate · ${formatDate(data.measurement.tenantRowPayload.measuredAt)}` : "Tenant estimate unavailable"} icon={Database} color={data.totalUsedBytes === null ? C.amber : C.accent} />
              <StatCard label="Platform capacity" value={formatBytes(data.capacityBytes)} detail={data.capacityBytes === null ? "Configure a capacity budget below" : `${data.usagePercent?.toFixed(1)}% · ${data.capacity.source} · ${formatDate(data.capacity.measuredAt)}`} icon={HardDrive} color={data.capacityBytes === null ? C.amber : C.accent} />
              <StatCard label="Storage left" value={formatBytes(data.freeBytes)} detail={data.freeSpace.source ? `${data.freeSpace.source} · ${formatDate(data.freeSpace.measuredAt)}` : "Remaining capacity is unknown"} icon={ShieldCheck} color={data.freeBytes === null ? C.amber : C.green} />
              <StatCard label="Cleanup candidates" value={String(data.candidates.length)} detail={`Aged migration items · ${data.measurement.retentionDays}+ days`} icon={Trash2} color={data.candidates.length > 0 ? C.amber : C.green} />
            </div>

            <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, padding: "11px 14px", color: C.sub, fontSize: 11, lineHeight: 1.5, marginBottom: 20 }}>
              <strong style={{ color: C.amber }}>Measurement boundary:</strong> {data.measurement.notes.join(" ")}
              <span style={{ display: "block", color: C.muted, marginTop: 3 }}>
                Server collector runs every {data.measurement.freshness.collectionIntervalMinutes} minutes; readings become stale after {data.measurement.freshness.staleAfterMinutes} minutes. Freshness checked {formatDate(data.measurement.freshness.checkedAt)}.
              </span>
            </div>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Connected physical storage sources</h2>
                <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 11 }}>These measurements are kept separate from tenant row-payload estimates. Every value carries its source and measurement time.</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {data.measurement.physicalSources.map(source => {
                  const sourceStatusColor = statusColor(source.status);
                  const buckets = source.details.buckets ?? [];
                  return (
                    <div key={source.source} style={{ background: "rgba(0,0,0,0.16)", border: `1px solid ${C.border}`, borderRadius: 10, padding: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <strong style={{ color: "white", fontSize: 12 }}>{sourceLabel(source.source)}</strong>
                        <span style={{ color: sourceStatusColor, fontSize: 9, fontWeight: 800, textTransform: "uppercase" }}>{source.status}</span>
                      </div>
                      <p style={{ color: C.muted, fontSize: 10, margin: "6px 0 10px" }}>{source.measurementKind}</p>
                      <div style={{ color: source.usedBytes === null ? C.amber : C.accent, fontWeight: 800, fontSize: 16 }}>{formatBytes(source.usedBytes)} used</div>
                      <div style={{ color: C.sub, fontSize: 10, marginTop: 4 }}>
                        {source.capacityBytes === null ? "Capacity: unavailable" : `Capacity: ${formatBytes(source.capacityBytes)}`}
                        {" · "}
                        {source.freeBytes === null ? "Free: unavailable" : `Free: ${formatBytes(source.freeBytes)}`}
                      </div>
                      <div style={{ color: C.muted, fontSize: 9, marginTop: 8 }}>Measured {formatDate(source.measuredAt)}</div>
                      {source.error && <div style={{ color: sourceStatusColor, fontSize: 10, marginTop: 7 }}>{source.error}</div>}
                      {buckets.length > 0 && <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 9, paddingTop: 8 }}>
                        {buckets.map(bucket => <div key={bucket.bucket} style={{ display: "flex", justifyContent: "space-between", color: bucket.status === "available" ? C.sub : C.red, fontSize: 10, padding: "2px 0" }}><span>{bucket.bucket}</span><span>{bucket.status === "available" ? formatBytes(bucket.usedBytes) : "unavailable"}</span></div>)}
                      </div>}
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Platform capacity</h2>
                  <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 11 }}>Set the real storage budget used to calculate “Storage left”.</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input value={capacityGb} onChange={event => setCapacityGb(event.target.value)} inputMode="decimal" placeholder="e.g. 250" style={{ width: 110, background: "rgba(0,0,0,0.2)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontSize: 12 }} />
                  <span style={{ color: C.sub, fontSize: 11 }}>GB</span>
                  <Button onClick={() => void saveCapacity()} disabled={saving}>Save capacity</Button>
                </div>
              </div>
            </section>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ padding: "15px 18px", borderBottom: `1px solid ${C.border}` }}>
                <h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Usage by ISP admin</h2>
                <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 11 }}>Includes measured tenant-owned database row payloads and protected metadata; secrets are never displayed.</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["ISP admin", "Measured data", "Records", "Share of measured total", "Breakdown"].map(label => <th key={label} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</th>)}</tr></thead>
                  <tbody>
                    {data.usage.map(admin => {
                      const share = data.totalUsedBytes !== null && data.totalUsedBytes > 0 && admin.bytes !== null ? admin.bytes / data.totalUsedBytes * 100 : 0;
                      return (
                        <tr key={admin.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td style={{ padding: "12px 16px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><UserRound size={14} color={C.accent} /><div><strong style={{ color: "white" }}>{admin.name || admin.username}</strong><span style={{ display: "block", color: C.muted, fontSize: 10 }}>{admin.email || admin.username}</span></div></div></td>
                          <td style={{ padding: "12px 16px", color: C.accent, fontWeight: 800, whiteSpace: "nowrap" }}>{formatBytes(admin.bytes)}<div style={{ width: 110, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 4, marginTop: 6 }}><div style={{ width: `${Math.min(100, share)}%`, height: "100%", background: C.accent, borderRadius: 4 }} /></div></td>
                          <td style={{ padding: "12px 16px", color: C.sub }}>{admin.rowCount === null ? "—" : admin.rowCount.toLocaleString()}</td>
                          <td style={{ padding: "12px 16px", color: C.sub }}>{share.toFixed(1)}%</td>
                          <td style={{ padding: "12px 16px", color: C.muted, maxWidth: 360 }}>{Object.entries(admin.breakdown).sort(([, a], [, b]) => b.bytes - a.bytes).slice(0, 4).map(([source, value]) => <span key={source} style={{ display: "inline-block", margin: "2px 6px 2px 0", padding: "3px 6px", background: "rgba(255,255,255,0.04)", borderRadius: 5, fontSize: 10 }}>{source}: {formatBytes(value.bytes)}</span>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="storage-work-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)", gap: 18, alignItems: "start" }}>
              <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "15px 18px", borderBottom: `1px solid ${C.border}` }}>
                  <h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Eligible unused data</h2>
                  <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 11 }}>Only completed or failed router-migration packages older than 30 days can be selected.</p>
                </div>
                {data.candidates.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: C.muted, fontSize: 12 }}><CheckCircle2 size={22} color={C.green} /><p>No eligible cleanup candidates found.</p></div> : (
                  <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["", "ISP admin", "Source", "Age", "Size"].map(label => <th key={label} style={{ textAlign: "left", padding: "9px 12px", color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{label}</th>)}</tr></thead>
                    <tbody>{data.candidates.map(candidate => <tr key={candidate.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidate(candidate)} aria-label={`Select ${candidate.source_label}`} /></td>
                      <td style={{ padding: "10px 12px", color: C.sub }}>{adminsById.get(candidate.admin_id)?.name || `Admin #${candidate.admin_id}`}</td>
                      <td style={{ padding: "10px 12px", color: C.text }}>{candidate.source_label}<span style={{ display: "block", color: C.muted, fontSize: 9 }}>{candidate.status} · #{candidate.id}</span></td>
                      <td style={{ padding: "10px 12px", color: C.sub }}>{formatDate(candidate.created_at)}</td>
                      <td style={{ padding: "10px 12px", color: C.accent, fontWeight: 700 }}>{formatBytes(candidate.bytes)}</td>
                    </tr>)}</tbody>
                  </table></div>
                )}
              </section>

              <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Notify and schedule deletion</h2>
                <p style={{ color: C.muted, fontSize: 11, lineHeight: 1.5 }}>The admin receives an in-app notice and can recover the selected data before the countdown ends.</p>
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Selected admin</label>
                  <div style={{ padding: "9px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 8, color: selectedAdmin ? C.text : C.muted, fontSize: 12 }}>{selectedAdmin?.name || "Select candidates from one admin"}</div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Selected data</label>
                  <div style={{ color: selectedCandidates.length ? C.accent : C.muted, fontSize: 12 }}>{selectedCandidates.length} item(s) · {formatBytes(selectedCandidates.reduce((sum, candidate) => sum + candidate.bytes, 0))}</div>
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Reason</label>
                  <textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this aged data should be removed…" rows={3} maxLength={500} style={{ resize: "vertical", background: "rgba(0,0,0,0.2)", border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, color: C.text, fontFamily: "inherit", fontSize: 12 }} />
                  <label style={{ color: C.muted, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>Recovery period</label>
                  <select value={delayDays} onChange={event => setDelayDays(event.target.value)} style={{ background: "#111827", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 10px", color: C.text, fontSize: 12 }}><option value="1">1 day</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select>
                  <Button onClick={() => void scheduleCleanup()} disabled={saving || !selectedAdminId || !selectedCandidateIds.length || reason.trim().length < 5}><Clock3 size={13} /> Notify admin and start countdown</Button>
                </div>
              </section>
            </div>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginTop: 18 }}>
              <div style={{ padding: "15px 18px", borderBottom: `1px solid ${C.border}` }}><h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Pending cleanups</h2></div>
              {pendingRequests.length === 0 ? <div style={{ padding: 24, color: C.muted, fontSize: 12 }}>No pending deletion requests.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}><thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["Admin", "Reason", "Items", "Deadline", "Status", "Actions"].map(label => <th key={label} style={{ textAlign: "left", padding: "9px 14px", color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{label}</th>)}</tr></thead><tbody>{pendingRequests.map(request => <tr key={request.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><td style={{ padding: "11px 14px", color: C.text }}>{adminsById.get(request.admin_id)?.name || `Admin #${request.admin_id}`}</td><td style={{ padding: "11px 14px", color: C.sub, maxWidth: 260 }}>{request.reason}</td><td style={{ padding: "11px 14px", color: C.sub }}>{Number(request.candidate_rows)} · {formatBytes(Number(request.candidate_bytes))}</td><td style={{ padding: "11px 14px", color: C.amber, whiteSpace: "nowrap" }}>{formatDate(request.scheduled_for)}<span style={{ display: "block", fontWeight: 800 }}>{countdown(request.scheduled_for, now)}</span></td><td style={{ padding: "11px 14px", color: request.status === "processing" ? C.amber : C.accent }}>{request.status}</td><td style={{ padding: "11px 14px" }}><div style={{ display: "flex", gap: 6 }}><Button onClick={() => void cancelRequest(request.id)} disabled={saving || request.status !== "pending"} secondary><XCircle size={12} /> Cancel</Button><Button onClick={() => { setConfirmDeleteId(request.id); setConfirmationText(""); }} disabled={saving || request.status !== "pending"} danger><Trash2 size={12} /> Delete anyway</Button></div></td></tr>)}</tbody></table></div>}
            </section>

            <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginTop: 18 }}>
              <div style={{ padding: "15px 18px", borderBottom: `1px solid ${C.border}` }}><h2 style={{ margin: 0, color: "white", fontSize: 14 }}>Cleanup history</h2></div>
              {history.length === 0 ? <div style={{ padding: 24, color: C.muted, fontSize: 12 }}>No completed, cancelled, or failed cleanup requests yet.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}><thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["Admin", "Scope", "Status", "Created", "Result"].map(label => <th key={label} style={{ textAlign: "left", padding: "9px 14px", color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{label}</th>)}</tr></thead><tbody>{history.map(request => <tr key={request.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}><td style={{ padding: "11px 14px", color: C.text }}>{adminsById.get(request.admin_id)?.name || `Admin #${request.admin_id}`}</td><td style={{ padding: "11px 14px", color: C.sub }}>{request.scope} · #{request.id}</td><td style={{ padding: "11px 14px", color: request.status === "completed" ? C.green : request.status === "failed" ? C.red : C.muted }}>{request.status}</td><td style={{ padding: "11px 14px", color: C.muted }}>{formatDate(request.created_at)}</td><td style={{ padding: "11px 14px", color: request.failure_details ? C.red : C.sub }}>{request.failure_details || `${Number(request.candidate_rows)} row(s) · ${formatBytes(Number(request.candidate_bytes))}`}</td></tr>)}</tbody></table></div>}
            </section>
          </>
        )}
      </div>

      {confirmDeleteId !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div style={{ width: "100%", maxWidth: 440, background: "#111827", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", color: C.red }}><AlertTriangle size={20} /><h2 style={{ margin: 0, color: "white", fontSize: 16 }}>Delete immediately?</h2></div>
            <p style={{ color: C.sub, fontSize: 12, lineHeight: 1.6 }}>This skips the admin recovery countdown and permanently removes the selected aged migration artifacts. Type <strong style={{ color: C.red }}>DELETE</strong> to continue.</p>
            <input value={confirmationText} onChange={event => setConfirmationText(event.target.value)} placeholder="DELETE" autoFocus style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, padding: 10, color: "white", fontSize: 13 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}><Button secondary onClick={() => { setConfirmDeleteId(null); setConfirmationText(""); }}>Cancel</Button><Button danger disabled={saving || confirmationText !== "DELETE"} onClick={() => void deleteNow()}><Trash2 size={13} /> Delete anyway</Button></div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: "fixed", right: 22, bottom: 22, zIndex: 400, background: toast.ok ? "#052e24" : "#450a0a", border: `1px solid ${toast.ok ? C.green : C.red}`, borderRadius: 9, padding: "11px 16px", color: toast.ok ? C.green : C.red, fontSize: 12, fontWeight: 700 }}>{toast.message}</div>}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@media(max-width:900px){.storage-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.storage-work-grid{grid-template-columns:1fr!important}}@media(max-width:560px){.storage-stat-grid{grid-template-columns:1fr!important}}`}</style>
    </SuperAdminLayout>
  );
}