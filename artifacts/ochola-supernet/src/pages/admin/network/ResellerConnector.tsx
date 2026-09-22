import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { getAdminApiToken } from "@/lib/supabase";

type IspOption = {
  id: number;
  name: string;
  company_name?: string | null;
  subdomain?: string | null;
};

type ConnectionRequest = {
  id: number;
  reseller_id: number;
  isp_admin_id: number;
  note?: string | null;
  status: "pending" | "approved" | "rejected";
  responded_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ConnectorResponse = {
  ok: boolean;
  isps: IspOption[];
  requests: ConnectionRequest[];
  connectedIspId: number | null;
  connectedIspIds?: number[];
  error?: string;
};

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getAdminApiToken()}`,
    "Content-Type": "application/json",
  };
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

const cardStyle: React.CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
  boxShadow: "var(--shadow-sm)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  border: "1px solid var(--isp-input-border)",
  borderRadius: 8,
  padding: "9px 11px",
  background: "var(--isp-input-bg)",
  color: "var(--isp-text)",
  font: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
};

function statusStyle(status: ConnectionRequest["status"]): React.CSSProperties {
  if (status === "approved") {
    return { color: "#15803d", background: "rgba(34,197,94,.12)", borderColor: "rgba(34,197,94,.28)" };
  }
  if (status === "rejected") {
    return { color: "#b91c1c", background: "rgba(239,68,68,.1)", borderColor: "rgba(239,68,68,.26)" };
  }
  return { color: "#a16207", background: "rgba(245,158,11,.12)", borderColor: "rgba(245,158,11,.3)" };
}

function StatusBadge({ status }: { status: ConnectionRequest["status"] }) {
  const Icon = status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock3;
  return (
    <span style={{ ...statusStyle(status), display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 9px", borderRadius: 999, border: "1px solid", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
      <Icon size={13} /> {status}
    </span>
  );
}

export default function ResellerConnector() {
  const [data, setData] = useState<ConnectorResponse | null>(null);
  const [ispId, setIspId] = useState("");
  const [ispCompanyName, setIspCompanyName] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const result = await apiJson<ConnectorResponse>("/api/reseller/connection-options");
      setData(result);
      setIspId((current) => current || (result.isps[0] ? String(result.isps[0].id) : ""));
      setIspCompanyName((current) => current || (result.isps[0]?.company_name || result.isps[0]?.name || ""));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load ISP connection options.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  const ispNames = useMemo(
    () => new Map((data?.isps ?? []).map((isp) => [isp.id, isp.company_name || isp.name])),
    [data?.isps],
  );
  const connectedIspIds = data?.connectedIspIds?.length
    ? data.connectedIspIds
    : data?.connectedIspId
      ? [data.connectedIspId]
      : [];
  const currentConnections = connectedIspIds.map((id) => ispNames.get(id) || `ISP #${id}`);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError("");
    setSuccess("");
    try {
      await apiJson("/api/reseller/connection-requests", {
        method: "POST",
        body: JSON.stringify({
          ispAdminId: ispId ? Number(ispId) : undefined,
          companyName: ispCompanyName.trim(),
          note,
        }),
      });
      setNote("");
      setIspId("");
      setIspCompanyName("");
      setSuccess("Connection request sent. The ISP administrator will review it.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send the connection request.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1120, display: "grid", gap: 16 }}>
        <section style={{ ...cardStyle, padding: "22px 24px", background: "linear-gradient(135deg, rgba(37,99,235,.13), var(--isp-card) 58%)" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-accent)", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
                <Link2 size={16} /> Reseller connector
              </div>
              <h1 style={{ margin: "8px 0 6px", color: "var(--isp-text)", fontSize: 25, fontWeight: 850 }}>Request an ISP connection</h1>
              <p style={{ margin: 0, color: "var(--isp-text-muted)", maxWidth: 720, fontSize: 13, lineHeight: 1.6 }}>
                Choose an ISP to work with and send a connection request. The ISP will see your request in their Network → Resellers page.
              </p>
            </div>
            <button type="button" onClick={() => void load(true)} disabled={loading} aria-label="Refresh ISP connections" style={{ border: "1px solid var(--isp-border)", borderRadius: 8, padding: 9, background: "var(--isp-input-bg)", color: "var(--isp-text)", cursor: loading ? "wait" : "pointer" }}>
              <RefreshCw size={16} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
            </button>
          </div>
        </section>

        {error && <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 9, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.22)", color: "#b91c1c", fontSize: 13 }}><AlertTriangle size={16} /> <span>{error}</span></div>}
        {success && <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 13px", borderRadius: 9, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.22)", color: "#15803d", fontSize: 13 }}><CheckCircle2 size={16} /> <span>{success}</span></div>}

        {currentConnections.length > 0 && (
          <section style={{ ...cardStyle, padding: 18, borderColor: "rgba(34,197,94,.3)" }}>
            <div style={{ display: "flex", gap: 11, alignItems: "center", color: "#15803d", fontWeight: 850 }}><ShieldCheck size={19} /> Connected ISP accounts</div>
            <p style={{ margin: "8px 0 0", color: "var(--isp-text-muted)", fontSize: 13 }}>
              {currentConnections.join(", ")}. Ask each ISP administrator to assign and provision a wholesale port before serving customers.
            </p>
          </section>
        )}
        <form onSubmit={submit} style={{ ...cardStyle, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-text)", fontWeight: 850, fontSize: 16 }}><Building2 size={18} color="var(--isp-accent)" /> Send a connection request</div>
            <p style={{ margin: "7px 0 17px", color: "var(--isp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>Enter an ISP company name or choose a suggested account. You can send additional requests to the same or another ISP. Do not include passwords or router credentials in the note.</p>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,.8fr) minmax(0,1.2fr)", gap: 14, alignItems: "end" }}>
              <label style={{ display: "grid", gap: 6, color: "var(--isp-text-muted)", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
                ISP company name
                <input
                  required
                  list="reseller-isp-company-options"
                  value={ispCompanyName}
                  onChange={(event) => {
                    const value = event.target.value;
                    setIspCompanyName(value);
                    const match = (data?.isps ?? []).find((isp) => (isp.company_name || isp.name) === value);
                    setIspId(match ? String(match.id) : "");
                  }}
                  placeholder={loading ? "Loading ISP accounts…" : "Enter the ISP company name"}
                  style={inputStyle}
                  disabled={loading}
                />
                <datalist id="reseller-isp-company-options">
                  {(data?.isps ?? []).map((isp) => <option key={isp.id} value={isp.company_name || isp.name}>{isp.subdomain ? `Subdomain: ${isp.subdomain}` : ""}</option>)}
                </datalist>
              </label>
              <label style={{ display: "grid", gap: 6, color: "var(--isp-text-muted)", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>
                Message (optional)
                <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Tell the ISP how you want to work together" style={inputStyle} />
              </label>
            </div>
             <button type="submit" disabled={sending || loading || !ispCompanyName.trim()} style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, border: 0, borderRadius: 9, padding: "11px 15px", background: "var(--isp-accent)", color: "#fff", fontWeight: 800, cursor: sending ? "wait" : "pointer" }}>
              <Send size={15} /> {sending ? "Sending request…" : "Request connection"}
            </button>
            {!loading && !data?.isps.length && <div style={{ marginTop: 12, color: "var(--isp-text-muted)", fontSize: 13 }}>No active ISP accounts are currently available to connect.</div>}
        </form>

        <section style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--isp-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-text)", fontWeight: 850 }}><Clock3 size={17} color="var(--isp-accent)" /> Connection request history</div>
            <div style={{ marginTop: 4, color: "var(--isp-text-muted)", fontSize: 12 }}>Statuses update automatically while the ISP reviews your request.</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr>{["ISP", "Message", "Status", "Requested", "Updated"].map((heading) => <th key={heading} style={{ padding: "11px 14px", textAlign: "left", color: "var(--isp-text-muted)", background: "var(--isp-input-bg)", borderBottom: "1px solid var(--isp-border)", fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase" }}>{heading}</th>)}</tr></thead>
              <tbody>
                {(data?.requests ?? []).map((request) => (
                  <tr key={request.id}>
                    <td style={{ padding: "13px 14px", borderBottom: "1px solid var(--isp-border)", color: "var(--isp-text)", fontWeight: 750 }}>{ispNames.get(request.isp_admin_id) || `ISP #${request.isp_admin_id}`}</td>
                    <td style={{ padding: "13px 14px", borderBottom: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", maxWidth: 320 }}>{request.note || "—"}</td>
                    <td style={{ padding: "13px 14px", borderBottom: "1px solid var(--isp-border)" }}><StatusBadge status={request.status} /></td>
                    <td style={{ padding: "13px 14px", borderBottom: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{new Date(request.created_at).toLocaleString()}</td>
                    <td style={{ padding: "13px 14px", borderBottom: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{new Date(request.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!data?.requests.length && <tr><td colSpan={5} style={{ padding: 30, textAlign: "center", color: "var(--isp-text-muted)" }}>No connection requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </AdminLayout>
  );
}