import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, Clock3, Copy, KeyRound, Loader2, LogIn, Search, ShieldCheck } from "lucide-react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { startImpersonation } from "@/lib/supabase";

interface Admin {
  id: number;
  name: string | null;
  fullname?: string | null;
  username: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  role: string | null;
  subdomain: string | null;
  created_at: string;
}

interface AuditRecord {
  id: number;
  actor_name: string;
  action: string;
  target_admin_id: number | null;
  impersonation_session_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: 20 },
  input: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "10px 12px", color: "white", fontSize: 14, width: "100%", boxSizing: "border-box" },
  button: { border: 0, borderRadius: 8, padding: "9px 13px", color: "white", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 },
};

function saHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "",
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

export default function SuperAdminImpersonate() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Admin | null>(null);
  const [reason, setReason] = useState("");
  const [resetTarget, setResetTarget] = useState<Admin | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const adminsQuery = useQuery({
    queryKey: ["sa_admin_access_accounts"],
    queryFn: async () => readJson<{ admins: Admin[] }>(
      await fetch("/api/super-admin/admin-access/admins", { headers: saHeaders() }),
    ).then(result => result.admins),
  });
  const auditQuery = useQuery({
    queryKey: ["sa_admin_access_audit"],
    queryFn: async () => readJson<{ audit: AuditRecord[] }>(
      await fetch("/api/super-admin/admin-access/audit", { headers: saHeaders() }),
    ).then(result => result.audit),
  });

  const admins = adminsQuery.data ?? [];
  const filtered = admins.filter(admin =>
    [admin.name, admin.fullname, admin.username, admin.email, admin.subdomain]
      .some(value => String(value ?? "").toLowerCase().includes(search.toLowerCase())),
  );

  const resetPassword = async (admin: Admin) => {
    setBusy(true);
    setError("");
    setNotice("");
    setTemporaryPassword("");
    try {
      const data = await readJson<{ temporaryPassword: string }>(
        await fetch(`/api/super-admin/admin-access/${admin.id}/reset-password`, {
          method: "POST",
          headers: saHeaders(true),
          body: JSON.stringify({}),
        }),
      );
      setTemporaryPassword(data.temporaryPassword);
      setNotice("Temporary password created. Copy it now; the admin must choose a new password when signing in.");
      await queryClient.invalidateQueries({ queryKey: ["sa_admin_access_audit"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The password could not be reset.");
    } finally {
      setBusy(false);
    }
  };

  const beginAccess = async () => {
    if (!target || reason.trim().length < 8) return;
    setBusy(true);
    setError("");
    try {
      const data = await readJson<{
        token: string;
        sessionId: string;
        expiresAt: string;
        admin: { id: number; username: string; name: string | null; fullname: string | null; role: string | null };
      }>(
        await fetch(`/api/super-admin/admin-access/${target.id}/start`, {
          method: "POST",
          headers: saHeaders(true),
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      );
      startImpersonation(
        data.admin.id,
        data.admin.username,
        data.admin.fullname || data.admin.name || data.admin.username,
        data.admin.role || target.role || "isp_admin",
        data.token,
        data.sessionId,
        data.expiresAt,
      );
      navigate("/admin/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The temporary account-access session could not be started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1120, display: "grid", gap: 22 }}>
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ShieldCheck size={25} color="#f97316" />
            <div>
              <h1 style={{ margin: 0, color: "white", fontSize: 24 }}>Account access and password resets</h1>
              <p style={{ margin: "5px 0 0", color: "#94a3b8", fontSize: 14 }}>Access is temporary, reason-based, and recorded. Passwords are never revealed or reused.</p>
            </div>
          </div>
          <div style={{ ...styles.card, display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, color: "#fdba74", fontSize: 13 }}>
            <AlertTriangle size={17} />
            <span>Account access expires after 30 minutes. Changes made during the session are recorded. A password reset creates a one-time temporary password and forces the account owner to replace it.</span>
          </div>
        </header>

        <section style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ color: "white", fontSize: 17, margin: 0 }}>Administrator accounts</h2>
            <div style={{ position: "relative", width: "min(100%, 320px)" }}>
              <Search size={15} style={{ position: "absolute", left: 11, top: 12, color: "#64748b" }} />
              <input aria-label="Search administrators" placeholder="Search name, email, username…" style={{ ...styles.input, paddingLeft: 34 }} value={search} onChange={event => setSearch(event.target.value)} />
            </div>
          </div>
          {adminsQuery.isLoading ? <p style={{ color: "#94a3b8" }}>Loading accounts…</p> : null}
          {adminsQuery.error ? <p role="alert" style={{ color: "#fca5a5" }}>{(adminsQuery.error as Error).message}</p> : null}
          <div style={{ display: "grid", gap: 9 }}>
            {filtered.map(admin => (
              <div key={admin.id} style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                <div>
                  <strong style={{ color: "white" }}>{admin.fullname || admin.name || admin.username}</strong>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>@{admin.username} · {admin.role || "admin"} · {admin.subdomain ? `${admin.subdomain}.isplatty.org` : "No subdomain"} · {admin.is_active ? "Active" : "Inactive"}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={{ ...styles.button, background: "#b45309" }} disabled={!admin.is_active || busy} onClick={() => { setTarget(admin); setReason(""); setError(""); }}>
                    <LogIn size={14} /> Temporary access
                  </button>
                  <button type="button" style={{ ...styles.button, background: "#334155" }} disabled={busy} onClick={() => { setResetTarget(admin); setTemporaryPassword(""); setNotice(""); setError(""); }}>
                    <KeyRound size={14} /> Reset password
                  </button>
                </div>
              </div>
            ))}
            {!adminsQuery.isLoading && filtered.length === 0 && <p style={{ color: "#94a3b8" }}>No matching administrator accounts.</p>}
          </div>
        </section>

        {target && (
          <section style={{ ...styles.card, borderColor: "rgba(249,115,22,0.4)" }}>
            <h2 style={{ color: "white", fontSize: 17, margin: "0 0 6px" }}>Start temporary access: {target.fullname || target.name || target.username}</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px" }}>Enter the support or security reason. The session ends after 30 minutes and can be stopped from the admin banner.</p>
            <textarea aria-label="Reason for temporary access" style={{ ...styles.input, minHeight: 84, resize: "vertical" }} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe why this account access is needed (at least 8 characters)." />
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" style={{ ...styles.button, background: "#334155" }} onClick={() => setTarget(null)}>Cancel</button>
              <button type="button" style={{ ...styles.button, background: "#ea580c", opacity: busy || reason.trim().length < 8 ? 0.55 : 1 }} disabled={busy || reason.trim().length < 8} onClick={() => void beginAccess()}>
                {busy ? <Loader2 size={14} /> : <LogIn size={14} />} Start 30-minute session
              </button>
            </div>
          </section>
        )}

        {resetTarget && (
          <section style={{ ...styles.card, borderColor: "rgba(59,130,246,0.35)" }}>
            <h2 style={{ color: "white", fontSize: 17, margin: "0 0 8px" }}>Reset password: {resetTarget.fullname || resetTarget.name || resetTarget.username}</h2>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>This invalidates existing sessions. The generated temporary password is shown only here and will require a password change at sign-in.</p>
            {!temporaryPassword ? (
              <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
                <button type="button" style={{ ...styles.button, background: "#334155" }} onClick={() => setResetTarget(null)}>Cancel</button>
                <button type="button" style={{ ...styles.button, background: "#2563eb" }} disabled={busy} onClick={() => void resetPassword(resetTarget)}>{busy ? <Loader2 size={14} /> : <KeyRound size={14} />} Generate one-time password</button>
              </div>
            ) : (
              <div>
                <label style={{ display: "block", color: "#cbd5e1", fontSize: 12, marginBottom: 6 }}>Temporary password — copy and share securely</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input readOnly value={temporaryPassword} style={styles.input} />
                  <button type="button" aria-label="Copy temporary password" style={{ ...styles.button, background: "#2563eb" }} onClick={() => void navigator.clipboard?.writeText(temporaryPassword)}><Copy size={15} /> Copy</button>
                </div>
                <p role="status" style={{ color: "#86efac", fontSize: 13 }}>{notice}</p>
                <button type="button" style={{ ...styles.button, background: "#334155", marginLeft: "auto" }} onClick={() => { setResetTarget(null); setTemporaryPassword(""); }}>Done</button>
              </div>
            )}
          </section>
        )}

        {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}

        <section style={styles.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <Clock3 size={17} color="#60a5fa" />
            <h2 style={{ color: "white", fontSize: 17, margin: 0 }}>Recent authentication audit</h2>
          </div>
          {auditQuery.isLoading ? <p style={{ color: "#94a3b8" }}>Loading audit records…</p> : null}
          {auditQuery.error ? <p role="alert" style={{ color: "#fca5a5" }}>{(auditQuery.error as Error).message}</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {(auditQuery.data ?? []).slice(0, 30).map(record => (
              <div key={record.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "8px 0", color: "#cbd5e1", fontSize: 12 }}>
                <span><strong>{record.actor_name}</strong> · {record.action} · account {record.target_admin_id ?? "—"}{record.details?.reason ? ` · ${String(record.details.reason)}` : ""}</span>
                <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString()}</time>
              </div>
            ))}
            {!auditQuery.isLoading && (auditQuery.data?.length ?? 0) === 0 && <p style={{ color: "#94a3b8" }}>No authentication audit records yet.</p>}
          </div>
        </section>
      </div>
    </SuperAdminLayout>
  );
}