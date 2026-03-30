import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Users, Activity, Layers, Search, Plus, Trash2, Edit2,
  Eye, EyeOff, RefreshCw, Loader2, Check, X, AlertTriangle,
  Zap, Clock, ArrowDownUp, WifiOff,
} from "lucide-react";

/* ══════════════════════ Types ══════════════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; bridge_ip: string | null;
  status: string;
}
interface PPPSecret {
  id: string; name: string; password: string; service: string;
  profile: string; localAddress: string; remoteAddress: string;
  disabled: boolean; comment: string;
}
interface PPPActive {
  id: string; name: string; address: string; uptime: string;
  bytesIn: number; bytesOut: number; service: string;
}
interface PPPProfile {
  id: string; name: string; localAddress: string; remoteAddress: string;
  rateLimit: string; sessionTimeout: string; idleTimeout: string; comment: string;
}

/* ══════════════════════ Helpers ══════════════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-input-bg,#0f1923)",
  border: "1px solid var(--isp-input-border,rgba(255,255,255,0.1))",
  borderRadius: 8, padding: "0.55rem 0.875rem",
  color: "var(--isp-text)", fontSize: "0.875rem",
  fontFamily: "inherit", outline: "none",
  width: "100%", boxSizing: "border-box",
};
const sel: React.CSSProperties = { ...inp, appearance: "none" as const, cursor: "pointer" };

function fmtBytes(b: number): string {
  if (b === 0) return "0 B";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
}

/* ── router fetch ── */
async function fetchRouters(): Promise<DbRouter[]> {
  const { data } = await supabase
    .from("isp_routers")
    .select("id,name,host,bridge_ip,status")
    .eq("admin_id", ADMIN_ID)
    .order("name");
  return (data ?? []) as DbRouter[];
}

/* ── API helpers ── */
async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j as T;
}
async function apiPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}
async function apiPatch(path: string, body: Record<string, unknown>) {
  const r = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}
async function apiDelete(path: string) {
  const r = await fetch(path, { method: "DELETE" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

/* ══════════════════════ Password field ══════════════════════════ */
function PwInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "password"} style={{ ...inp, paddingRight: "2.5rem" }} />
      <button type="button" onClick={() => setShow(s => !s)}
        style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)", padding: 0, display: "flex" }}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/* ══════════════════════ Badge ══════════════════════════════════ */
function Badge({ label, color }: { label: string; color: string }) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    green:  { bg: "rgba(74,222,128,0.12)", text: "#4ade80", border: "rgba(74,222,128,0.3)" },
    red:    { bg: "rgba(248,113,113,0.12)", text: "#f87171", border: "rgba(248,113,113,0.3)" },
    cyan:   { bg: "rgba(6,182,212,0.12)",  text: "#06b6d4", border: "rgba(6,182,212,0.3)" },
    amber:  { bg: "rgba(251,191,36,0.12)", text: "#fbbf24", border: "rgba(251,191,36,0.3)" },
    violet: { bg: "rgba(167,139,250,0.12)",text: "#a78bfa", border: "rgba(167,139,250,0.3)" },
  };
  const c = map[color] ?? map.cyan;
  return (
    <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {label}
    </span>
  );
}

/* ══════════════════════ Add Secret Modal ══════════════════════ */
function AddSecretModal({
  routerId, profiles, onClose, onSaved,
}: { routerId: number; profiles: PPPProfile[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName]       = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState(profiles[0]?.name ?? "default");
  const [service, setService] = useState("pppoe");
  const [comment, setComment] = useState("");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");

  async function handleSave() {
    if (!name.trim() || !password.trim()) { setErr("Username and password are required."); return; }
    setSaving(true); setErr("");
    try {
      await apiPost(`/api/router/${routerId}/ppp/secrets`, { name: name.trim(), password, profile, service, comment });
      onSaved();
      onClose();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to create user"); }
    finally { setSaving(false); }
  }

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" };
  const modal: React.CSSProperties = { background: "var(--isp-card,#101b27)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "24px 28px", width: "min(480px,94vw)" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" };
  const row: React.CSSProperties = { marginBottom: 14 };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={16} style={{ color: "#06b6d4" }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--isp-text)" }}>Add PPP User</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4 }}><X size={16} /></button>
        </div>

        <div style={row}><label style={lbl}>Username *</label><input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="e.g. john_doe" /></div>
        <div style={row}><label style={lbl}>Password *</label><PwInput value={password} onChange={setPassword} placeholder="Strong password" /></div>
        <div style={row}>
          <label style={lbl}>Service</label>
          <select value={service} onChange={e => setService(e.target.value)} style={sel}>
            {["pppoe", "pptp", "l2tp", "any"].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>
        <div style={row}>
          <label style={lbl}>Profile</label>
          <select value={profile} onChange={e => setProfile(e.target.value)} style={sel}>
            {profiles.length ? profiles.map(p => <option key={p.id} value={p.name}>{p.name}{p.rateLimit ? ` — ${p.rateLimit}` : ""}</option>) : <option value="default">default</option>}
          </select>
        </div>
        <div style={row}><label style={lbl}>Comment (optional)</label><input value={comment} onChange={e => setComment(e.target.value)} style={inp} placeholder="e.g. Apartment 5B" /></div>

        {err && <p style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}><AlertTriangle size={12} style={{ marginRight: 4 }} />{err}</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? "Adding…" : "Add User"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ Edit Secret Modal ══════════════════════ */
function EditSecretModal({
  secret, routerId, profiles, onClose, onSaved,
}: { secret: PPPSecret; routerId: number; profiles: PPPProfile[]; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState(secret.password);
  const [profile,  setProfile]  = useState(secret.profile);
  const [comment,  setComment]  = useState(secret.comment);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      await apiPatch(`/api/router/${routerId}/ppp/secrets/${secret.id}`, { password, profile, comment });
      onSaved(); onClose();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Failed to update"); }
    finally { setSaving(false); }
  }

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" };
  const modal: React.CSSProperties = { background: "var(--isp-card,#101b27)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "24px 28px", width: "min(460px,94vw)" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Edit2 size={15} style={{ color: "#a78bfa" }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--isp-text)" }}>Edit User — {secret.name}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 14 }}><label style={lbl}>New Password</label><PwInput value={password} onChange={setPassword} /></div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Profile</label>
          <select value={profile} onChange={e => setProfile(e.target.value)} style={sel}>
            {profiles.length ? profiles.map(p => <option key={p.id} value={p.name}>{p.name}{p.rateLimit ? ` — ${p.rateLimit}` : ""}</option>) : <option value="default">default</option>}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}><label style={lbl}>Comment</label><input value={comment} onChange={e => setComment(e.target.value)} style={inp} /></div>

        {err && <p style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{err}</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.35)", color: "#a78bfa", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ Main page ══════════════════════════════ */
export default function NetworkPPP() {
  const qc = useQueryClient();
  const [routerId, setRouterId] = useState<number | null>(null);
  const [tab, setTab]           = useState<"secrets" | "active" | "profiles">("secrets");
  const [search, setSearch]     = useState("");
  const [showAdd, setShowAdd]   = useState(false);
  const [editing, setEditing]   = useState<PPPSecret | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  /* ── Router list ── */
  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["routers_ppp"],
    queryFn: fetchRouters,
  });

  /* Auto-select first router */
  React.useEffect(() => {
    if (routers.length && routerId === null) setRouterId(routers[0].id);
  }, [routers]);

  const rid = routerId ?? 0;

  /* ── PPP Secrets ── */
  const secretsQ = useQuery<{ secrets: PPPSecret[] }>({
    queryKey: ["ppp_secrets", rid],
    queryFn: () => apiGet(`/api/router/${rid}/ppp/secrets`),
    enabled: !!rid && tab === "secrets",
    refetchInterval: 30_000,
  });

  /* ── PPP Active ── */
  const activeQ = useQuery<{ sessions: PPPActive[] }>({
    queryKey: ["ppp_active", rid],
    queryFn: () => apiGet(`/api/router/${rid}/pppoe`),
    enabled: !!rid && tab === "active",
    refetchInterval: 10_000,
  });

  /* ── PPP Profiles ── */
  const profilesQ = useQuery<{ profiles: PPPProfile[] }>({
    queryKey: ["ppp_profiles", rid],
    queryFn: () => apiGet(`/api/router/${rid}/ppp/profiles`),
    enabled: !!rid,
  });

  const secrets  = secretsQ.data?.secrets   ?? [];
  const sessions = activeQ.data?.sessions   ?? [];
  const profiles = profilesQ.data?.profiles ?? [];

  /* ── Filtered lists ── */
  const filteredSecrets = useMemo(() =>
    secrets.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.comment.toLowerCase().includes(search.toLowerCase())),
    [secrets, search]);

  const filteredSessions = useMemo(() =>
    sessions.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [sessions, search]);

  /* ── Toggle disable mutation ── */
  const toggleMut = useMutation({
    mutationFn: ({ secretId, disabled }: { secretId: string; disabled: boolean }) =>
      apiPatch(`/api/router/${rid}/ppp/secrets/${secretId}`, { disabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ppp_secrets", rid] }),
  });

  /* ── Delete mutation ── */
  const deleteMut = useMutation({
    mutationFn: (secretId: string) => apiDelete(`/api/router/${rid}/ppp/secrets/${secretId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ppp_secrets", rid] }); setDeleting(null); },
  });

  /* ── Disconnect active session mutation ── */
  const disconnectMut = useMutation({
    mutationFn: (sessionId: string) => apiDelete(`/api/router/${rid}/ppp/active/${sessionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ppp_active", rid] }),
  });

  function refetchCurrent() {
    if (tab === "secrets") qc.invalidateQueries({ queryKey: ["ppp_secrets", rid] });
    else if (tab === "active") qc.invalidateQueries({ queryKey: ["ppp_active", rid] });
    else qc.invalidateQueries({ queryKey: ["ppp_profiles", rid] });
  }

  const isLoading = tab === "secrets" ? secretsQ.isLoading : tab === "active" ? activeQ.isLoading : profilesQ.isLoading;
  const isError   = tab === "secrets" ? secretsQ.isError   : tab === "active" ? activeQ.isError   : profilesQ.isError;
  const errMsg    = (tab === "secrets" ? secretsQ.error : tab === "active" ? activeQ.error : profilesQ.error) as Error | null;

  /* ── Table header style ── */
  const TH: React.CSSProperties = {
    padding: "10px 14px", fontSize: 11, fontWeight: 700,
    color: "var(--isp-text-muted)", textTransform: "uppercase" as const,
    letterSpacing: "0.06em", background: "rgba(255,255,255,0.025)",
    borderBottom: "1px solid var(--isp-border)",
  };
  const TD: React.CSSProperties = {
    padding: "12px 14px", fontSize: 13, color: "var(--isp-text)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    verticalAlign: "middle",
  };

  return (
    <AdminLayout>
      {showAdd && rid && (
        <AddSecretModal
          routerId={rid} profiles={profiles}
          onClose={() => setShowAdd(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ppp_secrets", rid] })}
        />
      )}
      {editing && rid && (
        <EditSecretModal
          secret={editing} routerId={rid} profiles={profiles}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ppp_secrets", rid] })}
        />
      )}

      <div style={{ padding: "1.75rem 2rem", display: "flex", flexDirection: "column", gap: "1.5rem", minHeight: "100%" }}>

        {/* ── Page header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontWeight: 800, fontSize: "1.4rem", color: "var(--isp-text)" }}>PPP Management</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--isp-text-muted)" }}>
              Manage PPP user accounts, active sessions and connection profiles
            </p>
          </div>
          {tab === "secrets" && rid && (
            <button
              onClick={() => setShowAdd(true)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 9, background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> Add PPP User
            </button>
          )}
        </div>

        {/* ── Network tabs ── */}
        <NetworkTabs active="ppp" />

        {/* ── Router selector ── */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "0 0 260px" }}>
            <select
              value={routerId ?? ""}
              onChange={e => { setRouterId(Number(e.target.value)); setSearch(""); }}
              style={{ ...sel, borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}
            >
              <option value="" disabled>— Select router —</option>
              {routers.map(r => <option key={r.id} value={r.id}>{r.name}{r.host ? ` (${r.host})` : ""}</option>)}
            </select>
          </div>
          {routers.length === 0 && (
            <span style={{ fontSize: 12, color: "#f87171" }}>No routers configured. Add one under Network → Routers.</span>
          )}
        </div>

        {/* ── Sub-tabs: Secrets / Active / Profiles ── */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--isp-border)", paddingBottom: 0 }}>
          {([
            { id: "secrets",  label: "Secrets",  icon: Users },
            { id: "active",   label: "Active Connections", icon: Activity },
            { id: "profiles", label: "Profiles", icon: Layers },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSearch(""); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", border: "none", background: "none",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
                color: tab === t.id ? "#06b6d4" : "var(--isp-text-muted)",
                borderBottom: tab === t.id ? "2px solid #06b6d4" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              <t.icon size={14} /> {t.label}
              {t.id === "active" && sessions.length > 0 && (
                <span style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>{sessions.length}</span>
              )}
            </button>
          ))}

          {/* Spacer + controls */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ ...inp, paddingLeft: 30, width: 180, padding: "6px 10px 6px 28px" }}
              />
            </div>
            <button
              onClick={refetchCurrent}
              style={{ padding: "6px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Content area ── */}
        {!rid ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--isp-text-muted)", fontSize: 14 }}>
            Select a router above to view PPP data.
          </div>
        ) : isLoading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--isp-text-muted)" }}>
            <Loader2 size={22} className="animate-spin" style={{ margin: "0 auto 8px", display: "block" }} />
            Loading…
          </div>
        ) : isError ? (
          <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "16px 20px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertTriangle size={16} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontWeight: 700, color: "#f87171", margin: 0 }}>Connection failed</p>
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 0" }}>{errMsg?.message ?? "Cannot reach router. Ensure the API port (8728) is open from the VPN range."}</p>
            </div>
          </div>
        ) : (
          <>
            {/* ════ SECRETS TAB ════ */}
            {tab === "secrets" && (
              <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Username", "Service", "Profile", "Comment", "Status", "Actions"].map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSecrets.length === 0 ? (
                      <tr><td colSpan={6} style={{ ...TD, textAlign: "center", padding: "40px 14px", color: "var(--isp-text-muted)" }}>
                        {search ? "No users match your search." : "No PPP secrets found on this router."}
                      </td></tr>
                    ) : filteredSecrets.map(s => (
                      <tr key={s.id} style={{ background: s.disabled ? "rgba(248,113,113,0.03)" : undefined }}>
                        <td style={TD}>
                          <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>{s.name}</span>
                        </td>
                        <td style={TD}><Badge label={s.service.toUpperCase()} color="cyan" /></td>
                        <td style={TD}><Badge label={s.profile} color="violet" /></td>
                        <td style={TD} title={s.comment}><span style={{ color: "var(--isp-text-muted)", fontSize: 12 }}>{s.comment || "—"}</span></td>
                        <td style={TD}>
                          <Badge label={s.disabled ? "Disabled" : "Enabled"} color={s.disabled ? "red" : "green"} />
                        </td>
                        <td style={{ ...TD, whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => toggleMut.mutate({ secretId: s.id, disabled: !s.disabled })}
                              title={s.disabled ? "Enable" : "Disable"}
                              style={{ padding: "4px 10px", borderRadius: 6, background: s.disabled ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)", border: `1px solid ${s.disabled ? "rgba(74,222,128,0.3)" : "rgba(251,191,36,0.3)"}`, color: s.disabled ? "#4ade80" : "#fbbf24", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            >
                              {s.disabled ? "Enable" : "Disable"}
                            </button>
                            <button
                              onClick={() => setEditing(s)}
                              style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", cursor: "pointer" }}
                            ><Edit2 size={12} /></button>
                            {deleting === s.id ? (
                              <div style={{ display: "flex", gap: 4 }}>
                                <button onClick={() => deleteMut.mutate(s.id)} style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                                  {deleteMut.isPending ? <Loader2 size={11} className="animate-spin" /> : "Confirm"}
                                </button>
                                <button onClick={() => setDeleting(null)} style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", cursor: "pointer", fontSize: 11 }}>Cancel</button>
                              </div>
                            ) : (
                              <button onClick={() => setDeleting(s.id)} style={{ padding: "4px 8px", borderRadius: 6, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", cursor: "pointer" }}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "var(--isp-text-muted)", display: "flex", justifyContent: "space-between" }}>
                  <span>{filteredSecrets.length} user{filteredSecrets.length !== 1 ? "s" : ""}{search ? " (filtered)" : ""}</span>
                  <span>{secrets.filter(s => !s.disabled).length} active / {secrets.filter(s => s.disabled).length} disabled</span>
                </div>
              </div>
            )}

            {/* ════ ACTIVE TAB ════ */}
            {tab === "active" && (
              <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Username", "IP Address", "Uptime", "Service", "↓ Bytes In", "↑ Bytes Out", "Actions"].map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...TD, textAlign: "center", padding: "40px 14px", color: "var(--isp-text-muted)" }}>
                        No active PPP sessions found.
                      </td></tr>
                    ) : filteredSessions.map(s => (
                      <tr key={s.id}>
                        <td style={TD}><span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>{s.name}</span></td>
                        <td style={TD}><span style={{ fontFamily: "monospace", fontSize: 12, color: "#06b6d4" }}>{s.address || "—"}</span></td>
                        <td style={TD}><div style={{ display: "flex", alignItems: "center", gap: 5 }}><Clock size={12} style={{ color: "var(--isp-text-muted)" }} />{s.uptime || "—"}</div></td>
                        <td style={TD}><Badge label={s.service.toUpperCase()} color="cyan" /></td>
                        <td style={TD}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><Zap size={12} style={{ color: "#4ade80" }} />{fmtBytes(s.bytesIn)}</div></td>
                        <td style={TD}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><ArrowDownUp size={12} style={{ color: "#f59e0b" }} />{fmtBytes(s.bytesOut)}</div></td>
                        <td style={TD}>
                          <button
                            onClick={() => disconnectMut.mutate(s.id)}
                            title="Disconnect this session"
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                          >
                            {disconnectMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <WifiOff size={11} />}
                            Kick
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "var(--isp-text-muted)" }}>
                  {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""} · Auto-refreshes every 10s
                </div>
              </div>
            )}

            {/* ════ PROFILES TAB ════ */}
            {tab === "profiles" && (
              <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Profile Name", "Rate Limit", "Local Address", "Remote Pool", "Session Timeout", "Idle Timeout", "Comment"].map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.length === 0 ? (
                      <tr><td colSpan={7} style={{ ...TD, textAlign: "center", padding: "40px 14px", color: "var(--isp-text-muted)" }}>
                        No PPP profiles found on this router.
                      </td></tr>
                    ) : profiles.map(p => (
                      <tr key={p.id}>
                        <td style={TD}><span style={{ fontWeight: 700 }}>{p.name}</span></td>
                        <td style={TD}>{p.rateLimit ? <Badge label={p.rateLimit} color="cyan" /> : <span style={{ color: "var(--isp-text-muted)" }}>—</span>}</td>
                        <td style={TD}><span style={{ fontFamily: "monospace", fontSize: 12 }}>{p.localAddress || "—"}</span></td>
                        <td style={TD}><span style={{ fontFamily: "monospace", fontSize: 12, color: "#a78bfa" }}>{p.remoteAddress || "—"}</span></td>
                        <td style={TD}>{p.sessionTimeout || "∞"}</td>
                        <td style={TD}>{p.idleTimeout || "∞"}</td>
                        <td style={TD}><span style={{ color: "var(--isp-text-muted)", fontSize: 12 }}>{p.comment || "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 11, color: "var(--isp-text-muted)" }}>
                  {profiles.length} profile{profiles.length !== 1 ? "s" : ""} on this router · Read-only — edit profiles directly on the router
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
