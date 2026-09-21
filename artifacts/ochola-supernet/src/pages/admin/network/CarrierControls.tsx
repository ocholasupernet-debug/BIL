import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Router as RouterIcon, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { getAdminApiToken } from "@/lib/supabase";

type Reseller = {
  id: number;
  name: string;
  company_name?: string | null;
  username: string;
  status?: string | null;
  is_active: boolean;
  created_at: string;
};

type CarrierPort = {
  id: number;
  reseller_id?: number | null;
  assigned_reseller_id?: number | null;
  router_id: number;
  interface_name: string;
  bridge_name?: string | null;
  bandwidth_cap_mbps: number;
  reseller_bandwidth_cap?: number | null;
  status: string;
  link_status?: "pending" | "active" | "suspended" | null;
  link_provisioning_error?: string | null;
};

type RouterOption = { id: number; name: string; status: string };
type CarrierResponse = {
  ok: boolean;
  resellers: Reseller[];
  pendingResellers: Reseller[];
  ports: CarrierPort[];
  routers: RouterOption[];
  refreshedAt?: string;
  error?: string;
};

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getAdminApiToken()}`,
    "Content-Type": "application/json",
  };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const body = await parseJsonResponse<T & { error?: string }>(response);
  if (!response.ok) throw new Error(body.error || `Request failed (HTTP ${response.status}).`);
  return body;
}

function statusLabel(reseller: Reseller, port?: CarrierPort): string {
  if (port?.link_status === "active") return "active";
  if (port?.link_status === "suspended" || reseller.status === "suspended_payment_pending") return "suspended";
  if (port?.link_status === "pending") return "awaiting approval";
  return reseller.status || "pending";
}

function statusStyle(status: string): React.CSSProperties {
  if (status === "active") {
    return { color: "#15803d", background: "rgba(34,197,94,.12)", borderColor: "rgba(34,197,94,.28)" };
  }
  if (status === "suspended") {
    return { color: "#b91c1c", background: "rgba(239,68,68,.1)", borderColor: "rgba(239,68,68,.26)" };
  }
  return { color: "#a16207", background: "rgba(245,158,11,.12)", borderColor: "rgba(245,158,11,.3)" };
}

const cardStyle: React.CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
  boxShadow: "var(--shadow-sm)",
};

export default function CarrierControls() {
  const [data, setData] = useState<CarrierResponse | null>(null);
  const [selectedPorts, setSelectedPorts] = useState<Record<number, string>>({});
  const [capDrafts, setCapDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const result = await apiJson<CarrierResponse>("/api/isp/pending-resellers");
      setData(result);
      setSelectedPorts((current) => {
        const next = { ...current };
        for (const reseller of result.resellers ?? []) {
          const assigned = (result.ports ?? []).find((port) =>
            (port.assigned_reseller_id ?? port.reseller_id) === reseller.id,
          );
          if (assigned && !next[reseller.id]) next[reseller.id] = String(assigned.id);
        }
        return next;
      });
      setCapDrafts((current) => {
        const next = { ...current };
        for (const reseller of result.resellers ?? []) {
          const assigned = (result.ports ?? []).find((port) =>
            (port.assigned_reseller_id ?? port.reseller_id) === reseller.id,
          );
          if (assigned && !next[reseller.id]) {
            next[reseller.id] = String(assigned.reseller_bandwidth_cap ?? assigned.bandwidth_cap_mbps);
          }
        }
        return next;
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load reseller link approvals.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const routerNames = useMemo(
    () => new Map((data?.routers ?? []).map((router) => [router.id, router.name])),
    [data?.routers],
  );

  const togglePipe = async (reseller: Reseller, action: "activate" | "suspend") => {
    const portId = Number(selectedPorts[reseller.id]);
    const port = data?.ports.find((candidate) => candidate.id === portId);
    const maxBandwidthCap = Number(capDrafts[reseller.id]);
    if (!port) {
      setError("Choose an assigned physical port before changing the link state.");
      return;
    }
    if (!Number.isSafeInteger(maxBandwidthCap) || maxBandwidthCap < 1) {
      setError("Enter a valid maximum bandwidth cap in Mbps.");
      return;
    }

    setBusy(reseller.id);
    setError("");
    setSuccess("");
    try {
      await apiJson("/api/isp/toggle-reseller-pipe", {
        method: "POST",
        body: JSON.stringify({
          resellerId: reseller.id,
          portName: port.interface_name,
          maxBandwidthCap,
          action,
        }),
      });
      setSuccess(`${reseller.company_name || reseller.name} link ${action === "activate" ? "activated" : "suspended"} and RouterOS was updated.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the reseller link.");
    } finally {
      setBusy(null);
    }
  };

  const resellers = data?.resellers ?? [];
  const pendingCount = data?.pendingResellers?.length ?? 0;

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1280, display: "grid", gap: 16 }}>
        <section style={{ ...cardStyle, padding: "20px 22px", background: "linear-gradient(135deg, rgba(37,99,235,.12), var(--isp-card) 55%)" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", gap: 9, alignItems: "center", color: "var(--isp-accent)", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
                <RouterIcon size={16} /> Carrier management
              </div>
              <h1 style={{ margin: "8px 0 6px", color: "var(--isp-text)", fontSize: 24, fontWeight: 850 }}>Link approval center</h1>
              <p style={{ margin: 0, color: "var(--isp-text-muted)", maxWidth: 720, fontSize: 13, lineHeight: 1.6 }}>
                Approve or suspend reseller wholesale pipes without exposing router credentials. State refreshes automatically every 15 seconds.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ padding: "7px 10px", borderRadius: 999, border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontSize: 12, fontWeight: 750 }}>
                {pendingCount} awaiting approval
              </span>
              <button type="button" onClick={() => void load(true)} disabled={loading} aria-label="Refresh carrier links" style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: 9, background: "var(--isp-input-bg)", color: "var(--isp-text)", cursor: loading ? "wait" : "pointer" }}>
                <RefreshCw size={15} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
              </button>
            </div>
          </div>
        </section>

        {error && <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 9, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.22)", color: "#b91c1c", fontSize: 13 }}><AlertTriangle size={16} /> <span>{error}</span></div>}
        {success && <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 9, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.22)", color: "#15803d", fontSize: 13 }}><CheckCircle2 size={16} /> <span>{success}</span></div>}

        <section style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--isp-border)", display: "flex", gap: 10, alignItems: "center" }}>
            <SlidersHorizontal size={17} color="var(--isp-accent)" />
            <div>
              <div style={{ color: "var(--isp-text)", fontWeight: 820, fontSize: 15 }}>Incoming reseller link requests</div>
              <div style={{ color: "var(--isp-text-muted)", fontSize: 12, marginTop: 3 }}>The router command is sent only after the tenant and assigned port pass server-side ownership checks.</div>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Reseller shop", "Assigned port", "Max bandwidth", "Wholesale state", "Link actions"].map((heading) => (
                    <th key={heading} style={{ padding: "11px 14px", textAlign: "left", color: "var(--isp-text-muted)", background: "var(--isp-input-bg)", borderBottom: "1px solid var(--isp-border)", fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase" }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  <tr><td colSpan={5} style={{ padding: 36, textAlign: "center", color: "var(--isp-text-muted)" }}>Loading reseller link requests…</td></tr>
                ) : resellers.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 36, textAlign: "center", color: "var(--isp-text-muted)" }}>No reseller accounts are waiting for a carrier link.</td></tr>
                ) : resellers.map((reseller) => {
                  const resellerPorts = (data?.ports ?? []).filter((port) =>
                    (port.assigned_reseller_id ?? port.reseller_id) === reseller.id,
                  );
                  const selectedPort = resellerPorts.find((port) => port.id === Number(selectedPorts[reseller.id])) ?? resellerPorts[0];
                  const state = statusLabel(reseller, selectedPort);
                  const isBusy = busy === reseller.id;
                  return (
                    <tr key={reseller.id}>
                      <td style={{ padding: "14px", borderBottom: "1px solid var(--isp-border)", color: "var(--isp-text)" }}>
                        <div style={{ fontWeight: 800 }}>{reseller.company_name || reseller.name}</div>
                        <div style={{ marginTop: 4, color: "var(--isp-text-muted)", fontSize: 12 }}>@{reseller.username}</div>
                      </td>
                      <td style={{ padding: "14px", borderBottom: "1px solid var(--isp-border)" }}>
                        <select aria-label={`Assigned port for ${reseller.company_name || reseller.name}`} value={selectedPorts[reseller.id] ?? ""} onChange={(event) => setSelectedPorts((current) => ({ ...current, [reseller.id]: event.target.value }))} style={{ minWidth: 190, border: "1px solid var(--isp-input-border)", borderRadius: 7, padding: "8px 9px", background: "var(--isp-input-bg)", color: "var(--isp-text)", font: "inherit" }}>
                          <option value="" disabled>Choose assigned port</option>
                          {resellerPorts.map((port) => <option key={port.id} value={port.id}>{port.interface_name} · {routerNames.get(port.router_id) || `Router ${port.router_id}`}</option>)}
                        </select>
                        {selectedPort?.link_provisioning_error && <div style={{ marginTop: 5, color: "#b91c1c", fontSize: 11 }}>{selectedPort.link_provisioning_error}</div>}
                      </td>
                      <td style={{ padding: "14px", borderBottom: "1px solid var(--isp-border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input aria-label={`Maximum bandwidth for ${reseller.company_name || reseller.name}`} type="range" min="1" max="1000" step="1" value={capDrafts[reseller.id] ?? "1"} onChange={(event) => setCapDrafts((current) => ({ ...current, [reseller.id]: event.target.value }))} style={{ width: 110, accentColor: "var(--isp-accent)" }} />
                          <input type="number" min="1" max="100000" value={capDrafts[reseller.id] ?? ""} onChange={(event) => setCapDrafts((current) => ({ ...current, [reseller.id]: event.target.value }))} style={{ width: 78, border: "1px solid var(--isp-input-border)", borderRadius: 7, padding: "7px 8px", background: "var(--isp-input-bg)", color: "var(--isp-text)", font: "inherit" }} />
                          <span style={{ color: "var(--isp-text-muted)", fontSize: 12 }}>Mbps</span>
                        </div>
                      </td>
                      <td style={{ padding: "14px", borderBottom: "1px solid var(--isp-border)" }}>
                        <span style={{ ...statusStyle(state), display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 999, border: "1px solid", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} /> {state}
                        </span>
                      </td>
                      <td style={{ padding: "14px", borderBottom: "1px solid var(--isp-border)" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          <button type="button" disabled={isBusy || !selectedPort || selectedPort.status !== "active"} onClick={() => void togglePipe(reseller, "activate")} style={{ border: 0, borderRadius: 7, padding: "8px 10px", background: isBusy ? "rgba(34,197,94,.35)" : "#16a34a", color: "#fff", fontWeight: 800, fontSize: 11, cursor: isBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}>🟢 Activate &amp; Sync Link</button>
                          <button type="button" disabled={isBusy || !selectedPort || selectedPort.status !== "active"} onClick={() => void togglePipe(reseller, "suspend")} style={{ border: "1px solid rgba(220,38,38,.3)", borderRadius: 7, padding: "8px 10px", background: "rgba(239,68,68,.08)", color: "#b91c1c", fontWeight: 800, fontSize: 11, cursor: isBusy ? "wait" : "pointer", whiteSpace: "nowrap" }}>🔴 Suspend Pipeline</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </AdminLayout>
  );
}