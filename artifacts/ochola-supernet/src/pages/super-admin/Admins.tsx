import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { supabase } from "@/lib/supabase";
import {
  Users, Plus, Search, Edit2, Trash2, CheckCircle2, XCircle,
  Loader2, Globe, RefreshCw, ToggleLeft, ToggleRight, X, Save,
} from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

interface Admin {
  id: number; name: string; username: string; email: string | null;
  phone: string | null; is_active: boolean; role: string | null;
  subdomain: string | null; created_at: string;
}

interface AdminForm {
  name: string; username: string; email: string; phone: string;
  role: string; subdomain: string; password: string;
}
const EMPTY: AdminForm = { name: "", username: "", email: "", phone: "", role: "admin", subdomain: "", password: "" };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#0f1629", border: "1px solid var(--isp-accent-glow)", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

export default function SuperAdminAdmins() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState<Admin | null>(null);
  const [form, setForm] = useState<AdminForm>(EMPTY);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const { data: admins = [], isLoading } = useQuery<Admin[]>({
    queryKey: ["sa_admins_list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_admins").select("id,name,username,email,phone,is_active,role,subdomain,created_at").order("id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase.from("isp_admins").update({ is_active: !is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sa_admins_list"] }); showToast("Status updated"); },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const createAdmin = useMutation({
    mutationFn: async (f: AdminForm) => {
      const slug = f.subdomain || f.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const { error } = await supabase.from("isp_admins").insert({
        name: f.name, username: f.username, email: f.email || null,
        phone: f.phone || null, role: f.role, subdomain: slug,
        password: f.password, is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sa_admins_list"] }); setShowAdd(false); setForm(EMPTY); showToast("Admin created"); },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const updateAdmin = useMutation({
    mutationFn: async ({ id, f }: { id: number; f: AdminForm }) => {
      const patch: Record<string, string | null> = { name: f.name, username: f.username, email: f.email || null, phone: f.phone || null, role: f.role, subdomain: f.subdomain || null };
      if (f.password) patch.password = f.password;
      const { error } = await supabase.from("isp_admins").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sa_admins_list"] }); setEditing(null); showToast("Admin updated"); },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const deleteAdmin = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("isp_admins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sa_admins_list"] }); setDeleting(null); showToast("Admin deleted"); },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const filtered = admins.filter(a =>
    [a.name, a.username, a.email, a.subdomain].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (a: Admin) => {
    setEditing(a);
    setForm({ name: a.name || "", username: a.username || "", email: a.email || "", phone: a.phone || "", role: a.role || "admin", subdomain: a.subdomain || "", password: "" });
  };

  const set = (k: keyof AdminForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1100 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>ISP Admins</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Manage all ISP administrators on the platform.</p>
          </div>
          <button onClick={() => { setShowAdd(true); setForm(EMPTY); }} style={{ display: "flex", alignItems: "center", gap: 8, background: C.accent, border: "none", borderRadius: 10, padding: "10px 18px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            <Plus size={15} /> Add Admin
          </button>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 20, maxWidth: 340 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, username, subdomain…" style={{ ...inp, paddingLeft: 36 }} />
        </div>

        {/* Table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {isLoading ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
              <p>Loading admins…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Users size={32} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              <p style={{ margin: 0 }}>{search ? "No admins match your search." : "No admins found."}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Name", "Username", "Subdomain", "Role", "Email", "Status", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "13px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,var(--isp-accent),#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "white" }}>{(a.name || a.username || "?")[0].toUpperCase()}</span>
                          </div>
                          <span style={{ fontWeight: 700, color: "white" }}>{a.name || "—"}</span>
                        </div>
                      </td>
                      <td style={{ padding: "13px 16px", fontFamily: "monospace", color: C.sub }}>{a.username}</td>
                      <td style={{ padding: "13px 16px" }}>
                        {a.subdomain
                          ? <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace", fontSize: "0.72rem", color: C.accent }}><Globe size={10} />{a.subdomain}.isplatty.org</span>
                          : <span style={{ color: C.muted }}>—</span>}
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        <span style={{ background: "rgba(139,92,246,0.12)", color: "#c4b5fd", padding: "2px 8px", borderRadius: 12, fontSize: "0.68rem", fontWeight: 700 }}>
                          {a.role || "admin"}
                        </span>
                      </td>
                      <td style={{ padding: "13px 16px", color: C.sub, fontSize: "0.75rem" }}>{a.email || "—"}</td>
                      <td style={{ padding: "13px 16px" }}>
                        <button onClick={() => toggleActive.mutate({ id: a.id, is_active: a.is_active })} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                          {a.is_active !== false
                            ? <><ToggleRight size={18} color="#4ade80" /><span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 700 }}>Active</span></>
                            : <><ToggleLeft size={18} color="#f87171" /><span style={{ fontSize: "0.72rem", color: "#f87171", fontWeight: 700 }}>Inactive</span></>
                          }
                        </button>
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => openEdit(a)} style={{ background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-glow)", borderRadius: 7, padding: "5px 10px", color: C.accent, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 600 }}>
                            <Edit2 size={11} /> Edit
                          </button>
                          <button onClick={() => setDeleting(a)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 7, padding: "5px 10px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 600 }}>
                            <Trash2 size={11} /> Delete
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

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Add New ISP Admin" onClose={() => setShowAdd(false)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Full Name"><input style={inp} value={form.name} onChange={e => set("name", e.target.value)} placeholder="FastNet Kenya" /></Field>
            <Field label="Username"><input style={inp} value={form.username} onChange={e => set("username", e.target.value)} placeholder="fastnet" /></Field>
            <Field label="Email"><input style={inp} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="admin@fastnet.ke" /></Field>
            <Field label="Phone"><input style={inp} value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+254700000000" /></Field>
            <Field label="Role">
              <select style={inp} value={form.role} onChange={e => set("role", e.target.value)}>
                <option value="admin">Admin</option>
                <option value="sub_admin">Sub Admin</option>
                <option value="reseller">Reseller</option>
              </select>
            </Field>
            <Field label="Subdomain (slug)"><input style={inp} value={form.subdomain} onChange={e => set("subdomain", e.target.value)} placeholder="fastnet" /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Password"><input style={inp} type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="Temporary password" /></Field>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button onClick={() => setShowAdd(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>Cancel</button>
            <button onClick={() => createAdmin.mutate(form)} disabled={createAdmin.isPending || !form.name || !form.username} style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6, opacity: (!form.name || !form.username) ? 0.5 : 1 }}>
              {createAdmin.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />} Create Admin
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editing && (
        <Modal title={`Edit — ${editing.name || editing.username}`} onClose={() => setEditing(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Full Name"><input style={inp} value={form.name} onChange={e => set("name", e.target.value)} /></Field>
            <Field label="Username"><input style={inp} value={form.username} onChange={e => set("username", e.target.value)} /></Field>
            <Field label="Email"><input style={inp} type="email" value={form.email} onChange={e => set("email", e.target.value)} /></Field>
            <Field label="Phone"><input style={inp} value={form.phone} onChange={e => set("phone", e.target.value)} /></Field>
            <Field label="Role">
              <select style={inp} value={form.role} onChange={e => set("role", e.target.value)}>
                <option value="admin">Admin</option>
                <option value="sub_admin">Sub Admin</option>
                <option value="reseller">Reseller</option>
              </select>
            </Field>
            <Field label="Subdomain"><input style={inp} value={form.subdomain} onChange={e => set("subdomain", e.target.value)} /></Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="New Password (leave blank to keep)"><input style={inp} type="password" value={form.password} onChange={e => set("password", e.target.value)} placeholder="Leave blank to keep current" /></Field>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button onClick={() => setEditing(null)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>Cancel</button>
            <button onClick={() => updateAdmin.mutate({ id: editing.id, f: form })} disabled={updateAdmin.isPending} style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6 }}>
              {updateAdmin.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />} Save Changes
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal title="Delete Admin" onClose={() => setDeleting(null)}>
          <p style={{ color: C.sub, fontSize: "0.85rem", marginBottom: 20 }}>
            Are you sure you want to delete <strong style={{ color: "white" }}>{deleting.name || deleting.username}</strong>? This action cannot be undone and will remove all associated data.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => setDeleting(null)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>Cancel</button>
            <button onClick={() => deleteAdmin.mutate(deleting.id)} disabled={deleteAdmin.isPending} style={{ background: "#dc2626", border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6 }}>
              {deleteAdmin.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.ok ? "#022c22" : "#450a0a", border: `1px solid ${toast.ok ? "#4ade80" : "#f87171"}`, borderRadius: 10, padding: "12px 20px", color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.82rem", zIndex: 300, display: "flex", alignItems: "center", gap: 8 }}>
          {toast.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {toast.msg}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
