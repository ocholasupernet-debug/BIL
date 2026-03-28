import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase, startImpersonation } from "@/lib/supabase";
import {
  Users, Search, LogIn, KeyRound, Eye, EyeOff,
  Loader2, CheckCircle2, XCircle, X, Save,
  ShieldAlert, Globe, AlertTriangle,
} from "lucide-react";

const C = {
  card: "rgba(255,255,255,0.04)",
  border: "rgba(99,102,241,0.15)",
  accent: "#6366f1",
  orange: "#f97316",
  danger: "#ef4444",
  text: "#e2e8f0",
  muted: "#64748b",
  sub: "#94a3b8",
};

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(99,102,241,0.2)",
  borderRadius: 8,
  padding: "9px 14px",
  color: "#e2e8f0",
  fontSize: "0.82rem",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

interface Admin {
  id: number;
  name: string;
  username: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  role: string | null;
  subdomain: string | null;
  created_at: string;
}

function Modal({ title, accent = C.accent, onClose, children }: {
  title: string; accent?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#0f1629", border: `1px solid ${accent}40`, borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${accent}25`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

export default function SuperAdminImpersonate() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [impersonating, setImpersonating] = useState<Admin | null>(null);
  const [resetting, setResetting] = useState<Admin | null>(null);
  const [newPass, setNewPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: admins = [], isLoading } = useQuery<Admin[]>({
    queryKey: ["sa_impersonate_admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_admins")
        .select("id,name,username,email,phone,is_active,role,subdomain,created_at")
        .order("id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const resetPassword = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      const { error } = await supabase
        .from("isp_admins")
        .update({ password })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sa_impersonate_admins"] });
      setResetting(null);
      setNewPass("");
      showToast("Password reset successfully");
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const handleImpersonate = (admin: Admin) => {
    startImpersonation(admin.id, admin.username, admin.name || admin.username);
    setImpersonating(null);
    navigate("/admin/dashboard");
  };

  const filtered = admins.filter(a =>
    [a.name, a.username, a.email, a.subdomain].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1100 }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#f97316,#ef4444)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShieldAlert size={18} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0 }}>Admin Impersonation</h1>
              <p style={{ color: C.muted, margin: 0, fontSize: "0.8rem" }}>Log in as any ISP admin or reset their security credentials.</p>
            </div>
          </div>
          {/* Warning banner */}
          <div style={{ marginTop: 16, background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle size={15} color="#f97316" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: "0.78rem", color: "#fdba74" }}>
              Impersonation sessions are for support and troubleshooting only. All actions taken while impersonating are performed under the admin's account. Use responsibly.
            </span>
          </div>
        </div>

        {/* ── Search ── */}
        <div style={{ position: "relative", marginBottom: 20, maxWidth: 360 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, username, subdomain…"
            style={{ ...inp, paddingLeft: 36 }}
          />
        </div>

        {/* ── Admin table ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {isLoading ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px", display: "block" }} />
              <p>Loading admins…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Users size={32} style={{ margin: "0 auto 10px", opacity: 0.4, display: "block" }} />
              <p style={{ margin: 0 }}>{search ? "No admins match your search." : "No admins found."}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Admin", "Username", "Subdomain", "Role", "Status", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {/* Admin */}
                      <td style={{ padding: "13px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "white" }}>
                              {(a.name || a.username || "?")[0].toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, color: "white" }}>{a.name || "—"}</p>
                            {a.email && <p style={{ margin: 0, fontSize: "0.7rem", color: C.muted }}>{a.email}</p>}
                          </div>
                        </div>
                      </td>
                      {/* Username */}
                      <td style={{ padding: "13px 16px", fontFamily: "monospace", color: C.sub }}>{a.username}</td>
                      {/* Subdomain */}
                      <td style={{ padding: "13px 16px" }}>
                        {a.subdomain
                          ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace", fontSize: "0.72rem", color: C.accent }}>
                              <Globe size={10} />{a.subdomain}.isplatty.org
                            </span>
                          : <span style={{ color: C.muted }}>—</span>}
                      </td>
                      {/* Role */}
                      <td style={{ padding: "13px 16px" }}>
                        <span style={{ background: "rgba(139,92,246,0.12)", color: "#c4b5fd", padding: "2px 8px", borderRadius: 12, fontSize: "0.68rem", fontWeight: 700 }}>
                          {a.role || "admin"}
                        </span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: "13px 16px" }}>
                        {a.is_active !== false
                          ? <span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} /> Active
                            </span>
                          : <span style={{ fontSize: "0.72rem", color: "#f87171", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", display: "inline-block" }} /> Inactive
                            </span>
                        }
                      </td>
                      {/* Actions */}
                      <td style={{ padding: "13px 16px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => setImpersonating(a)}
                            title="Log in as this admin"
                            style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.25)", borderRadius: 7, padding: "5px 11px", color: "#fb923c", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", fontWeight: 600 }}
                          >
                            <LogIn size={11} /> Impersonate
                          </button>
                          <button
                            onClick={() => { setResetting(a); setNewPass(""); setShowPass(false); }}
                            title="Reset this admin's password"
                            style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 7, padding: "5px 11px", color: "#818cf8", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", fontWeight: 600 }}
                          >
                            <KeyRound size={11} /> Reset Password
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Impersonate confirm modal ── */}
      {impersonating && (
        <Modal title="Confirm Impersonation" accent="#f97316" onClose={() => setImpersonating(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <AlertTriangle size={18} color="#f97316" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#fdba74", fontSize: "0.85rem" }}>You are about to impersonate an admin</p>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.5 }}>
                  You will be logged into the admin portal as <strong style={{ color: "white" }}>{impersonating.name || impersonating.username}</strong>.
                  A visible banner will appear so you can exit back to Super Admin at any time.
                </p>
              </div>
            </div>

            {/* Admin card */}
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "1rem", fontWeight: 800, color: "white" }}>{(impersonating.name || impersonating.username || "?")[0].toUpperCase()}</span>
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: "white", fontSize: "0.9rem" }}>{impersonating.name || impersonating.username}</p>
                <p style={{ margin: 0, fontSize: "0.75rem", color: C.muted }}>@{impersonating.username} · {impersonating.subdomain ? `${impersonating.subdomain}.isplatty.org` : "no subdomain"}</p>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setImpersonating(null)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>
                Cancel
              </button>
              <button
                onClick={() => handleImpersonate(impersonating)}
                style={{ background: "linear-gradient(135deg,#f97316,#ef4444)", border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6 }}
              >
                <LogIn size={14} /> Start Impersonation
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reset password modal ── */}
      {resetting && (
        <Modal title={`Reset Password — ${resetting.name || resetting.username}`} onClose={() => setResetting(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Admin info */}
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "white" }}>{(resetting.name || resetting.username || "?")[0].toUpperCase()}</span>
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: "white", fontSize: "0.85rem" }}>{resetting.name}</p>
                <p style={{ margin: 0, fontSize: "0.72rem", color: C.muted }}>@{resetting.username}</p>
              </div>
            </div>

            {/* New password field */}
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>New Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPass ? "text" : "password"}
                  value={newPass}
                  onChange={e => setNewPass(e.target.value)}
                  placeholder="Enter new password…"
                  style={{ ...inp, paddingRight: 42 }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 0, display: "flex" }}
                >
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: C.muted }}>
                The admin will use this password on their next login.
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              <button onClick={() => setResetting(null)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>
                Cancel
              </button>
              <button
                onClick={() => resetPassword.mutate({ id: resetting.id, password: newPass })}
                disabled={resetPassword.isPending || newPass.length < 4}
                style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: newPass.length < 4 ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6, opacity: newPass.length < 4 ? 0.5 : 1 }}
              >
                {resetPassword.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
                Reset Password
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.ok ? "#022c22" : "#450a0a", border: `1px solid ${toast.ok ? "#4ade80" : "#f87171"}`, borderRadius: 10, padding: "12px 20px", color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.82rem", zIndex: 300, display: "flex", alignItems: "center", gap: 8 }}>
          {toast.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {toast.msg}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
