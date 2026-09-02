import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import {
  CheckCircle2,
  Edit3,
  Globe,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Router as RouterIcon,
  Search,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

const C = {
  card: "rgba(255,255,255,0.04)",
  border: "rgba(148,163,184,0.18)",
  accent: "var(--isp-accent)",
  text: "#e2e8f0",
  muted: "#64748b",
  sub: "#94a3b8",
};

const ROUTER_STATUSES = ["offline", "online", "active", "setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"];

interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string | null;
  admin_id: number;
  model: string | null;
  ros_version: string | null;
  router_username: string | null;
  has_password: boolean;
  ip_address: string | null;
  bridge_ip: string | null;
  proxy_ip: string | null;
  created_at: string;
  last_seen: string | null;
}

interface DbAdmin {
  id: number;
  name: string;
  username: string | null;
  subdomain: string | null;
  is_active: boolean;
}

interface RouterResponse {
  ok: boolean;
  routers: DbRouter[];
  admins: DbAdmin[];
  error?: string;
}

interface FormState {
  adminId: string;
  name: string;
  host: string;
  ipAddress: string;
  bridgeIp: string;
  proxyIp: string;
  model: string;
  rosVersion: string;
  username: string;
  password: string;
  status: string;
}

const emptyForm: FormState = {
  adminId: "",
  name: "",
  host: "",
  ipAddress: "",
  bridgeIp: "",
  proxyIp: "",
  model: "",
  rosVersion: "",
  username: "",
  password: "",
  status: "offline",
};

function token(): string {
  try {
    return localStorage.getItem("ochola_superadmin_token") || "";
  } catch {
    return "";
  }
}

async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-sa-token", token());
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "The Super Admin request could not be completed.");
  }
  return response;
}

function StatusDot({ status }: { status: string | null }) {
  const online = status === "online" || status === "active";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20,
      fontSize: "0.68rem", fontWeight: 700, background: online ? "rgba(74,222,128,0.12)" : "rgba(100,116,139,0.15)",
      color: online ? "#4ade80" : "#94a3b8", border: `1px solid ${online ? "rgba(74,222,128,0.25)" : "rgba(100,116,139,0.2)"}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "#4ade80" : "#64748b" }} />
      {status || "unknown"}
    </span>
  );
}

function FormInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: C.sub, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label} {required && <b style={{ color: "#f87171" }}>*</b>}
      </span>
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={type === "password" ? "new-password" : undefined}
        style={{
          width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${C.border}`, background: "rgba(15,23,42,0.72)", color: C.text, outline: "none",
          fontSize: "0.82rem",
        }}
      />
      {help && <span style={{ color: C.muted, fontSize: "0.68rem", lineHeight: 1.35 }}>{help}</span>}
    </label>
  );
}

export default function SuperAdminRouters() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isLoading: loadingRouters, isError: loadingError } = useQuery<RouterResponse>({
    queryKey: ["sa_all_routers_detail"],
    queryFn: async () => {
      const response = await apiRequest("/api/super-admin/routers");
      return response.json() as Promise<RouterResponse>;
    },
  });

  const routers = data?.routers ?? [];
  const admins = data?.admins ?? [];
  const adminMap = useMemo(() => Object.fromEntries(admins.map(admin => [admin.id, admin])), [admins]);

  const filtered = routers.filter(router =>
    [router.name, router.host, router.model, router.router_username, adminMap[router.admin_id]?.name, adminMap[router.admin_id]?.subdomain]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const onlineCount = routers.filter(router => router.status === "online" || router.status === "active").length;

  const saveRouter = useMutation({
    mutationFn: async (values: { id: number | null; form: FormState }) => {
      const payload: Record<string, unknown> = {
        adminId: Number(values.form.adminId),
        name: values.form.name,
        host: values.form.host,
        ipAddress: values.form.ipAddress,
        bridgeIp: values.form.bridgeIp,
        proxyIp: values.form.proxyIp,
        model: values.form.model,
        rosVersion: values.form.rosVersion,
        username: values.form.username,
        status: values.form.status,
      };
      if (values.id === null || values.form.password) payload.password = values.form.password;
      const response = await apiRequest(
        values.id === null ? "/api/super-admin/routers" : `/api/super-admin/routers/${values.id}`,
        { method: values.id === null ? "POST" : "PATCH", body: JSON.stringify(payload) },
      );
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sa_all_routers_detail"] });
      setForm(null);
      setEditingId(null);
      setActionError("");
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const openAdd = () => {
    setActionError("");
    setEditingId(null);
    setForm({ ...emptyForm, adminId: admins[0] ? String(admins[0].id) : "" });
  };

  const openEdit = (router: DbRouter) => {
    setActionError("");
    setEditingId(router.id);
    setForm({
      adminId: String(router.admin_id),
      name: router.name,
      host: router.host,
      ipAddress: router.ip_address || "",
      bridgeIp: router.bridge_ip || "",
      proxyIp: router.proxy_ip || "",
      model: router.model || "",
      rosVersion: router.ros_version || "",
      username: router.router_username || "",
      password: "",
      status: router.status || "offline",
    });
  };

  const deleteRouter = async (router: DbRouter) => {
    const admin = adminMap[router.admin_id];
    const confirmed = window.confirm(
      `Delete ${router.name}? This permanently removes the router and related router records${admin ? ` from ${admin.name || admin.username || `ISP #${admin.id}`}` : ""}.`,
    );
    if (!confirmed) return;

    setActionError("");
    setDeletingId(router.id);
    try {
      await apiRequest(`/api/super-admin/routers/${router.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["sa_all_routers_detail"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Router deletion failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const setField = (field: keyof FormState, value: string) => {
    setForm(current => current ? { ...current, [field]: value } : current);
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1200 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>All Routers</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Add, edit, and remove MikroTik routers across all ISP accounts.</p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            disabled={loadingRouters || admins.length === 0}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 8,
              padding: "10px 14px", color: "white", background: C.accent, fontWeight: 800, fontSize: "0.78rem",
              cursor: loadingRouters || admins.length === 0 ? "not-allowed" : "pointer", opacity: loadingRouters || admins.length === 0 ? 0.5 : 1,
            }}
          >
            <Plus size={15} /> Add router
          </button>
        </div>

        {(actionError || loadingError) && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", marginBottom: 18, borderRadius: 9, color: "#fca5a5", background: "rgba(127,29,29,0.2)", border: "1px solid rgba(248,113,113,0.25)", fontSize: "0.78rem" }}>
            <XCircle size={15} />
            <span>{actionError || "Routers could not be loaded. Your session may have expired."}</span>
          </div>
        )}

        {form && (
          <form
            onSubmit={event => {
              event.preventDefault();
              setActionError("");
              saveRouter.mutate({ id: editingId, form });
            }}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 24 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
              <div>
                <h2 style={{ color: "white", fontSize: "1rem", margin: 0 }}>{editingId === null ? "Add router" : "Edit router"}</h2>
                <p style={{ color: C.muted, fontSize: "0.75rem", margin: "4px 0 0" }}>Router credentials are stored server-side and never returned in this form.</p>
              </div>
              <button type="button" onClick={() => { setForm(null); setEditingId(null); }} aria-label="Close router form" title="Close" style={{ border: 0, background: "transparent", color: C.muted, cursor: "pointer", padding: 2 }}>
                <X size={17} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: C.sub, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>ISP account <b style={{ color: "#f87171" }}>*</b></span>
                <select
                  value={form.adminId}
                  onChange={event => setField("adminId", event.target.value)}
                  required
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#0f172a", color: C.text, outline: "none", fontSize: "0.82rem" }}
                >
                  <option value="" disabled>Select an ISP</option>
                  {admins.map(admin => <option key={admin.id} value={admin.id}>{admin.name || admin.username || `ISP #${admin.id}`}{admin.subdomain ? ` · ${admin.subdomain}` : ""}</option>)}
                </select>
              </label>
              <FormInput label="Router name" value={form.name} onChange={value => setField("name", value)} placeholder="e.g. come1" required />
              <FormInput label="Host or IP address" value={form.host} onChange={value => setField("host", value)} placeholder="10.8.5.10 or router.example" required />
              <FormInput label="Router username" value={form.username} onChange={value => setField("username", value)} placeholder="admin" required />
              <FormInput
                label="Router password"
                value={form.password}
                onChange={value => setField("password", value)}
                placeholder={editingId === null ? "Required" : "Leave blank to keep current"}
                type="password"
                required={editingId === null}
                help="Never shown again after saving."
              />
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: C.sub, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</span>
                <select
                  value={form.status}
                  onChange={event => setField("status", event.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#0f172a", color: C.text, outline: "none", fontSize: "0.82rem" }}
                >
                  {ROUTER_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <FormInput label="RouterOS version" value={form.rosVersion} onChange={value => setField("rosVersion", value)} placeholder="7.16" />
              <FormInput label="Model" value={form.model} onChange={value => setField("model", value)} placeholder="hAP ax2" />
              <FormInput label="IP address" value={form.ipAddress} onChange={value => setField("ipAddress", value)} placeholder="Optional" />
              <FormInput label="Bridge IP" value={form.bridgeIp} onChange={value => setField("bridgeIp", value)} placeholder="Optional" />
              <FormInput label="Proxy IP" value={form.proxyIp} onChange={value => setField("proxyIp", value)} placeholder="Optional" />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => { setForm(null); setEditingId(null); }} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", color: C.sub, background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: "0.78rem" }}>Cancel</button>
              <button type="submit" disabled={saveRouter.isPending} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 8, padding: "9px 15px", color: "white", background: C.accent, cursor: saveRouter.isPending ? "wait" : "pointer", fontWeight: 800, fontSize: "0.78rem", opacity: saveRouter.isPending ? 0.65 : 1 }}>
                {saveRouter.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={14} />}
                {editingId === null ? "Add router" : "Save changes"}
              </button>
            </div>
          </form>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Total routers", value: routers.length, color: C.accent },
            { label: "Online", value: onlineCount, color: "#4ade80" },
            { label: "Offline", value: routers.length - onlineCount, color: "#f87171" },
          ].map(stat => (
            <div key={stat.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px" }}>
              <p style={{ fontSize: "0.68rem", color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>{stat.label}</p>
              <p style={{ fontSize: "1.6rem", fontWeight: 800, color: stat.color, margin: "4px 0 0" }}>{loadingRouters ? "…" : stat.value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, maxWidth: 420 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted }} />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, host, ISP…" style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px 9px 36px", color: C.text, fontSize: "0.82rem", width: "100%", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {loadingRouters ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 10px" }} />
              <p>Loading routers…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <RouterIcon size={32} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              <p style={{ margin: 0 }}>{routers.length === 0 ? "No routers found. Add the first router above." : "No routers match your search."}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Router", "Host / IP", "Credentials", "Model", "ISP Admin", "Status", "Actions"].map(heading => (
                      <th key={heading} style={{ textAlign: "left", padding: "10px 14px", color: C.muted, fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(router => {
                    const admin = adminMap[router.admin_id];
                    return (
                      <tr key={router.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "13px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <RouterIcon size={14} color={C.accent} />
                            </div>
                            <span style={{ fontWeight: 700, color: "white" }}>{router.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "13px 14px", fontFamily: "monospace", fontSize: "0.75rem", color: C.sub }}>{router.host}</td>
                        <td style={{ padding: "13px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.text }}>
                            <UserRound size={13} color={C.muted} /> {router.router_username || "—"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, color: router.has_password ? "#4ade80" : "#fbbf24", fontSize: "0.68rem", marginTop: 4 }}>
                            <LockKeyhole size={12} /> {router.has_password ? "Password saved" : "No password"}
                          </div>
                        </td>
                        <td style={{ padding: "13px 14px", color: C.sub }}>{router.model || "—"}{router.ros_version ? <div style={{ fontSize: "0.68rem", color: C.muted }}>ROS {router.ros_version}</div> : null}</td>
                        <td style={{ padding: "13px 14px" }}>
                          {admin ? (
                            <div>
                              <span style={{ fontWeight: 600, color: C.text }}>{admin.name || admin.username || `ISP #${admin.id}`}</span>
                              {admin.subdomain && <div style={{ fontSize: "0.68rem", color: C.accent, fontFamily: "monospace" }}>{admin.subdomain}.isplatty.org</div>}
                            </div>
                          ) : <span style={{ color: C.muted }}>Admin #{router.admin_id}</span>}
                        </td>
                        <td style={{ padding: "13px 14px" }}><StatusDot status={router.status} /></td>
                        <td style={{ padding: "13px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <button type="button" onClick={() => openEdit(router)} title={`Edit ${router.name}`} aria-label={`Edit ${router.name}`} style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 7, padding: 7, color: C.sub, background: "transparent", cursor: "pointer" }}><Edit3 size={13} /></button>
                            <button type="button" onClick={() => deleteRouter(router)} disabled={deletingId === router.id} title={`Delete ${router.name}`} aria-label={`Delete ${router.name}`} style={{ display: "inline-flex", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 7, padding: 7, color: "#f87171", background: "transparent", cursor: deletingId === router.id ? "wait" : "pointer", opacity: deletingId === router.id ? 0.6 : 1 }}>
                              {deletingId === router.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, color: C.muted, fontSize: "0.7rem" }}>
          <KeyRound size={13} />
          Password values are never displayed or written to activity logs. Leave the password blank when editing to keep the existing credential.
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}