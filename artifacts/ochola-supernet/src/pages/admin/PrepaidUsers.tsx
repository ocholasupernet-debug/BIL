import React, { useState, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase, ADMIN_ID, type DbCustomer } from "@/lib/supabase";
import {
  Search, Loader2, RefreshCw, Wifi, Network, Globe,
  Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, Filter, Download, UploadCloud, Eye,
  X, Phone, Mail, CalendarDays, Server, Edit3, PlusCircle,
  Power, Trash2, MoreHorizontal, Database, Save,
} from "lucide-react";

const API      = import.meta.env.VITE_API_BASE ?? "";
const PAGE_SIZE = 20;

/* ══════════════════════════════ Types ══════════════════════════════ */
interface Plan   {
  id: number; name: string; type: string; price: number; speed_down: number; speed_up: number;
  validity?: number; validity_days?: number; validity_unit?: string; data_limit_mb?: number | null;
  router_id?: number | null;
}
interface Router { id: number; name: string; host: string; status: string; bridge_ip: string | null; }

interface Customer extends DbCustomer {
  router_id?: number | null;
  last_seen?: string | null;
  fup_limit_mb?: number | null;
}
interface Payment {
  id: number;
  customer_id: number | null;
  amount: number;
  payment_method: string;
  reference: string | null;
  mpesa_receipt?: string | null;
  status: string;
  created_at: string;
}
interface LiveData {
  hotspotUsers?: Array<{ user?: string; macAddress?: string; bytesIn?: number; bytesOut?: number }>;
  pppoeUsers?: Array<{ name?: string; bytesIn?: number; bytesOut?: number }>;
  fetchedAt?: string;
}

type StatusFilter = "all" | "active" | "expired" | "suspended" | "online";

/* ══════════════════════════════ Helpers ══════════════════════════════ */
function fmtDate(d?: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function normalizePhone(phone?: string | null) {
  return (phone ?? "").replace(/\D/g, "");
}
function purchaseUsername(user: Customer) {
  const actual = user.pppoe_username || user.username;
  if (actual) return actual;
  const created = new Date(user.created_at);
  const time = Number.isNaN(created.getTime())
    ? "0000"
    : `${String(created.getHours()).padStart(2, "0")}${String(created.getMinutes()).padStart(2, "0")}`;
  return `${time}-${normalizePhone(user.phone) || user.id}`;
}
function paymentLabel(payment?: Payment) {
  if (!payment) return "—";
  const method = payment.payment_method.toLowerCase();
  const reference = payment.reference || payment.mpesa_receipt || String(payment.id);
  if (method.includes("till")) return `mpesatillStk-${reference}`;
  if (method.includes("mpesa")) return `M-Pesa STK-${reference}`;
  if (method.includes("cash") || method.includes("manual")) return "Cash / Manual";
  return payment.payment_method;
}
function formatData(mb?: number | null) {
  if (mb === null || mb === undefined || !Number.isFinite(Number(mb))) return "—";
  const value = Number(mb);
  return value >= 1024 ? `${(value / 1024).toFixed(2)} GB` : `${value.toFixed(1)} MB`;
}
function customerIsOnline(user: Customer, onlineUsers: Set<string>) {
  return [user.username, user.pppoe_username, purchaseUsername(user)]
    .filter(Boolean)
    .some(value => onlineUsers.has(String(value).toLowerCase()));
}
function isExpiringSoon(d?: string | null) {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000; // 3 days
}
function isExpired(d?: string | null) {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

const TYPE_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hotspot: { label: "Hotspot", color: "var(--isp-accent)", bg: "var(--isp-accent-glow)",  icon: <Wifi    size={10} /> },
  pppoe:   { label: "PPPoE",   color: "var(--isp-accent)", bg: "var(--isp-accent-glow)", icon: <Network size={10} /> },
  static:  { label: "Static",  color: "#34d399", bg: "rgba(16,185,129,0.12)", icon: <Globe   size={10} /> },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  active:    { label: "Active",    color: "#4ade80", bg: "rgba(34,197,94,0.12)",    border: "rgba(34,197,94,0.3)",    icon: <CheckCircle2 size={10} /> },
  expired:   { label: "Expired",   color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)",   icon: <XCircle      size={10} /> },
  suspended: { label: "Suspended", color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.3)",    icon: <AlertTriangle size={10} /> },
  online:    { label: "Online",    color: "var(--isp-accent)", bg: "var(--isp-accent-glow)",   border: "var(--isp-accent-border)",     icon: <Wifi size={10} /> },
  offline:   { label: "Offline",   color: "#64748b", bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.25)",  icon: <Clock size={10} /> },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.62rem", fontWeight: 700, padding: "0.18rem 0.55rem",
      borderRadius: 4, background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      whiteSpace: "nowrap",
    }}>
      {m.icon} {m.label}
    </span>
  );
}

function TypeBadge({ type }: { type?: string | null }) {
  const m = TYPE_META[type ?? ""] ?? { label: type ?? "?", color: "#94a3b8", bg: "rgba(255,255,255,0.06)", icon: null };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.25rem",
      fontSize: "0.62rem", fontWeight: 700, padding: "0.18rem 0.5rem",
      borderRadius: 4, background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>
      {m.icon} {m.label}
    </span>
  );
}

function PresenceBadge({ online }: { online: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem",
      fontSize: "0.62rem", fontWeight: 800, padding: "0.2rem 0.55rem",
      borderRadius: 999, color: online ? "#22c55e" : "#ef4444",
      background: online ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
      border: `1px solid ${online ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
      whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: online ? "#22c55e" : "#ef4444" }} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function Avt({ name, id }: { name?: string | null; id: number }) {
  const COLORS = ["var(--isp-accent)","#8b5cf6","#f59e0b","#10b981","#ec4899","#f87171","#60a5fa"];
  const bg = COLORS[id % COLORS.length];
  const ini = (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: 34, height: 34, borderRadius: "50%", background: bg, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.72rem", fontWeight: 800, color: "white",
    }}>{ini}</div>
  );
}

/* ══════════════════════════════ Fetch helpers ══════════════════════════════ */
async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Customer[];
}
async function fetchPlans(): Promise<Plan[]> {
  const { data } = await supabase
    .from("isp_plans")
    .select("id,name,type,price,speed_down,speed_up,validity,validity_days,validity_unit,data_limit_mb,router_id")
    .eq("admin_id", ADMIN_ID);
  return (data ?? []) as Plan[];
}
async function fetchRouters(): Promise<Router[]> {
  const { data } = await supabase
    .from("isp_routers")
    .select("id,name,host,status,bridge_ip")
    .eq("admin_id", ADMIN_ID);
  return (data ?? []) as Router[];
}
async function fetchPayments(customerIds: number[]): Promise<Payment[]> {
  if (!customerIds.length) return [];
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("id,customer_id,amount,payment_method,reference,mpesa_receipt,status,created_at")
    .eq("admin_id", ADMIN_ID)
    .in("customer_id", customerIds)
    .in("status", ["completed", "paid", "success"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

/* ══════════════════════════════ Sync ══════════════════════════════ */
async function syncUsersToRouter(
  router: Router,
  users:  Customer[],
  plans:  Plan[],
  log:    (m: string) => void,
): Promise<boolean> {
  if (!router.host && !router.bridge_ip) { log(`  ⚠ ${router.name}: no IP address — skipped`); return false; }
  log(`\n▶ ${router.name}`);
  const planMap = Object.fromEntries(plans.map(p => [p.id, p]));
  const payload = {
    adminId: ADMIN_ID,
    routerId: router.id,
    users: users.map(u => ({
      username:     u.pppoe_username || u.username || "",
      password:     u.password || "",
      type:         u.type || "hotspot",
      status:       u.status,
      mac_address:  u.mac_address || undefined,
      plan_name:    u.plan_id ? planMap[u.plan_id]?.name : "",
      ip_address:   u.ip_address || undefined,
    })),
  };
  try {
    const res  = await fetch(`${API}/api/admin/sync/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json() as { ok: boolean; logs?: string[] };
    (data.logs ?? []).forEach((l: string) => log(l));
    return data.ok;
  } catch (e) {
    log(`  ✗ ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

function iconButton(color: string): React.CSSProperties {
  return {
    width: 27, height: 27, display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: 0, borderRadius: 6, border: `1px solid ${color}55`, color, background: `${color}16`,
    cursor: "pointer",
  };
}

function EditUserDialog({
  user, plans, routers, onClose, onSave,
}: {
  user: Customer;
  plans: Plan[];
  routers: Router[];
  onClose: () => void;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [username, setUsername] = useState(user.username ?? user.pppoe_username ?? "");
  const [planId, setPlanId] = useState(String(user.plan_id ?? ""));
  const [routerId, setRouterId] = useState(String(user.router_id ?? ""));
  const [saving, setSaving] = useState(false);
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "0.6rem 0.7rem", borderRadius: 7,
    background: "var(--isp-input-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)",
    font: "inherit", fontSize: "0.8rem",
  };
  const submit = async () => {
    if (!name.trim() || !username.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        ...(user.type === "pppoe" ? { pppoe_username: username.trim() } : { username: username.trim() }),
        plan_id: planId ? Number(planId) : null,
        router_id: routerId ? Number(routerId) : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="prepaid-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="prepaid-modal" role="dialog" aria-modal="true" aria-labelledby="edit-prepaid-user-title">
        <div className="prepaid-modal-heading">
          <div>
            <h2 id="edit-prepaid-user-title">Edit prepaid user</h2>
            <p>{purchaseUsername(user)}</p>
          </div>
          <button type="button" onClick={onClose} style={iconButton("#94a3b8")} aria-label="Close edit dialog"><X size={15} /></button>
        </div>
        <div className="prepaid-form-grid">
          <label>Name<input style={inputStyle} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Phone used for purchase<input style={inputStyle} value={phone} onChange={event => setPhone(event.target.value)} /></label>
          <label>Username<input style={inputStyle} value={username} onChange={event => setUsername(event.target.value)} /></label>
          <label>Plan<select style={inputStyle} value={planId} onChange={event => setPlanId(event.target.value)}>
            <option value="">No plan</option>
            {plans.filter(plan => !user.type || plan.type === user.type).map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price.toFixed(2)}</option>)}
          </select></label>
          <label>Router<select style={inputStyle} value={routerId} onChange={event => setRouterId(event.target.value)}>
            <option value="">Unassigned</option>
            {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
          </select></label>
        </div>
        <div className="prepaid-modal-actions">
          <button type="button" onClick={onClose} className="prepaid-secondary-button">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving || !name.trim() || !username.trim()} className="prepaid-primary-button">
            {saving ? <Loader2 size={13} className="prepaid-spin" /> : <Save size={13} />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtendUserDialog({
  user, onClose, onExtend,
}: { user: Customer; onClose: () => void; onExtend: (days: number) => Promise<void> }) {
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const value = Number(days);
    if (!Number.isInteger(value) || value <= 0 || value > 3650) return;
    setSaving(true);
    try { await onExtend(value); } finally { setSaving(false); }
  };
  return (
    <div className="prepaid-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="prepaid-modal prepaid-small-modal" role="dialog" aria-modal="true" aria-labelledby="extend-prepaid-user-title">
        <div className="prepaid-modal-heading">
          <div><h2 id="extend-prepaid-user-title">Extend access</h2><p>{purchaseUsername(user)}</p></div>
          <button type="button" onClick={onClose} style={iconButton("#94a3b8")} aria-label="Close extend dialog"><X size={15} /></button>
        </div>
        <label>Additional days<input autoFocus type="number" min="1" max="3650" value={days} onChange={event => setDays(event.target.value)} /></label>
        <p className="prepaid-help">The new expiry is calculated from the current expiry date, or from now if the account has already expired.</p>
        <div className="prepaid-modal-actions">
          <button type="button" onClick={onClose} className="prepaid-secondary-button">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving} className="prepaid-primary-button">
            {saving ? <Loader2 size={13} className="prepaid-spin" /> : <PlusCircle size={13} />} Extend
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════ Page ══════════════════════════════ */
export default function PrepaidUsers() {
  const qc = useQueryClient();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["prepaid_customers", ADMIN_ID],
    queryFn:  fetchCustomers,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const { data: plans   = [] } = useQuery<Plan[]>({
    queryKey: ["prepaid_plans", ADMIN_ID],
    queryFn:  fetchPlans,
    staleTime: 60_000,
  });
  const { data: routers = [] } = useQuery<Router[]>({
    queryKey: ["prepaid_routers", ADMIN_ID],
    queryFn:  fetchRouters,
    staleTime: 30_000,
  });
  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ["prepaid_payments", ADMIN_ID, customers.map(c => c.id).join(",")],
    queryFn: () => fetchPayments(customers.map(c => c.id)),
    enabled: customers.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const liveQueries = useQueries({
    queries: routers.map(router => ({
      queryKey: ["prepaid_live", router.id],
      queryFn: async () => {
        const response = await fetch(`/api/router/${router.id}/live`);
        if (!response.ok) throw new Error(`Router ${router.name} is unavailable`);
        return response.json() as Promise<LiveData & { routerId: number }>;
      },
      staleTime: 5_000,
      refetchInterval: 15_000,
    })),
  });

  const planMap   = useMemo(() => Object.fromEntries(plans.map(p   => [p.id,   p  ])), [plans]);
  const routerMap = useMemo(() => Object.fromEntries(routers.map(r => [r.id,   r  ])), [routers]);
  const paymentMap = useMemo(() => {
    const map: Record<number, Payment> = {};
    payments.forEach(payment => {
      if (payment.customer_id !== null && !map[payment.customer_id]) map[payment.customer_id] = payment;
    });
    return map;
  }, [payments]);
  const onlineUsers = useMemo(() => {
    const keys = new Set<string>();
    liveQueries.forEach(query => {
      const live = query.data;
      live?.hotspotUsers?.forEach(user => { if (user.user) keys.add(user.user.toLowerCase()); });
      live?.pppoeUsers?.forEach(user => { if (user.name) keys.add(user.name.toLowerCase()); });
    });
    return keys;
  }, [liveQueries]);

  /* ── UI state ── */
  const [search,      setSearch]      = useState("");
  const [statusTab,   setStatusTab]   = useState<StatusFilter>("all");
  const [typeFilter,  setTypeFilter]  = useState("");
  const [page,        setPage]        = useState(1);
  const [detailUser,  setDetailUser]  = useState<Customer | null>(null);
  const [editingUser, setEditingUser] = useState<Customer | null>(null);
  const [extendingUser, setExtendingUser] = useState<Customer | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState<number | null>(null);

  /* Sync state */
  const [showSyncPicker,  setShowSyncPicker]  = useState(false);
  const [pickedRouter,    setPickedRouter]     = useState("");
  const [syncing,         setSyncing]         = useState(false);
  const [syncLogs,        setSyncLogs]        = useState<string[] | null>(null);
  const [syncOk,          setSyncOk]          = useState<boolean | null>(null);

  async function updateUser(user: Customer, updates: Record<string, unknown>) {
    setActionError("");
    setActionBusy(user.id);
    try {
      const { error } = await supabase
        .from("isp_customers")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .eq("admin_id", ADMIN_ID);
      if (error) throw error;

      /* Keep the RADIUS gate in step with lifecycle and identity changes. */
      const previousUsername = user.pppoe_username || user.username;
      const nextUsername = String(
        updates[user.type === "pppoe" ? "pppoe_username" : "username"] ?? previousUsername ?? "",
      ).trim();
      if (previousUsername && nextUsername && previousUsername !== nextUsername) {
        await supabase.from("radcheck").delete().eq("username", previousUsername);
        await supabase.from("radusergroup").delete().eq("username", previousUsername);
        if (user.password) {
          const { error: authError } = await supabase.from("radcheck").insert({
            username: nextUsername, attribute: "Cleartext-Password", op: ":=", value: user.password,
          });
          if (authError) throw authError;
        }
      }
      const radiusUsername = nextUsername || previousUsername;
      if (radiusUsername && updates.status !== undefined) {
        await supabase.from("radcheck").delete().eq("username", radiusUsername).eq("attribute", "Auth-Type");
        if (updates.status === "suspended") {
          const { error: rejectError } = await supabase.from("radcheck").insert({
            username: radiusUsername, attribute: "Auth-Type", op: ":=", value: "Reject",
          });
          if (rejectError) throw rejectError;
        }
      }
      if (radiusUsername && updates.expires_at !== undefined) {
        await supabase.from("radcheck").delete().eq("username", radiusUsername).eq("attribute", "Expiration");
        if (updates.expires_at) {
          const { error: expiryError } = await supabase.from("radcheck").insert({
            username: radiusUsername, attribute: "Expiration", op: ":=", value: new Date(String(updates.expires_at)).toDateString(),
          });
          if (expiryError) throw expiryError;
        }
      }
      if (radiusUsername && updates.plan_id !== undefined) {
        await supabase.from("radusergroup").delete().eq("username", radiusUsername);
        const nextPlan = updates.plan_id ? planMap[Number(updates.plan_id)] : null;
        if (nextPlan) {
          const { error: groupError } = await supabase.from("radusergroup").insert({
            username: radiusUsername, groupname: nextPlan.name, priority: 1,
          });
          if (groupError) throw groupError;
        }
      }
      await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(user: Customer) {
    if (!window.confirm(`Delete ${purchaseUsername(user)}? This cannot be undone.`)) return;
    try {
      setActionBusy(user.id);
      const radUsername = user.pppoe_username || user.username || purchaseUsername(user);
      const { error } = await supabase.from("isp_customers").delete().eq("id", user.id).eq("admin_id", ADMIN_ID);
      if (error) throw error;
      await supabase.from("radcheck").delete().eq("username", radUsername);
      await supabase.from("radusergroup").delete().eq("username", radUsername);
      await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this user.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleExtend(user: Customer, days: number) {
    const current = user.expires_at && !isExpired(user.expires_at) ? new Date(user.expires_at) : new Date();
    current.setDate(current.getDate() + days);
    try {
      await updateUser(user, { expires_at: current.toISOString(), status: "active" });
      setExtendingUser(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not extend this user.");
    }
  }

  async function handleStatus(user: Customer, status: "active" | "suspended") {
    try {
      await updateUser(user, { status });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update this user's status.");
    }
  }

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:     customers.length,
    active:    customers.filter(c => c.status === "active").length,
    expired:   customers.filter(c => c.status === "expired").length,
    suspended: customers.filter(c => c.status === "suspended").length,
  }), [customers]);

  /* ── Filter ── */
  const filtered = useMemo(() => {
    let list = customers;
    if (statusTab === "online") list = list.filter(c => customerIsOnline(c, onlineUsers));
    else if (statusTab !== "all") list = list.filter(c => c.status === statusTab);
    if (typeFilter)          list = list.filter(c => c.type  === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.name   ?? "").toLowerCase().includes(q) ||
        (c.username ?? "").toLowerCase().includes(q) ||
        (c.pppoe_username ?? "").toLowerCase().includes(q) ||
        (c.phone  ?? "").includes(q) ||
        (c.email  ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [customers, statusTab, typeFilter, search, onlineUsers]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ── Sync handler ── */
  async function handleSync() {
    if (!pickedRouter) return;
    const router = routers.find(r => String(r.id) === pickedRouter);
    if (!router) return;
    setSyncing(true); setSyncLogs([]); setSyncOk(null);
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    log("Starting user sync…");
    const ok = await syncUsersToRouter(router, customers.filter(c => (c as any).router_id === router.id || true), plans, log);
    log(ok ? "\n✅ Sync complete." : "\n⚠ Sync finished with errors.");
    setSyncOk(ok);
    setSyncing(false);
    setShowSyncPicker(false);
  }

  /* ── Export CSV ── */
  function exportCSV() {
    const header = "Name,Username,Phone,Type,Plan,Status,Expires";
    const rows   = filtered.map(c => [
      c.name ?? "", c.username ?? c.pppoe_username ?? "", c.phone ?? "",
      c.type ?? "", c.plan_id ? (planMap[c.plan_id]?.name ?? "") : "",
      c.status, c.expires_at ? fmtDate(c.expires_at) : "",
    ].map(v => `"${v}"`).join(","));
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = "prepaid_users.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Styles ── */
  const BTN = (bg: string, color = "#fff"): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    padding: "0.42rem 1rem", borderRadius: 6, border: "none",
    background: bg, color, fontWeight: 700, fontSize: "0.8rem",
    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  });
  const INPUT: React.CSSProperties = {
    background: "var(--isp-input-bg,rgba(255,255,255,0.05))",
    border: "1px solid var(--isp-border)", borderRadius: 6,
    padding: "0.42rem 0.75rem", color: "var(--isp-text)",
    fontSize: "0.82rem", fontFamily: "inherit", outline: "none",
  };
  const TH: React.CSSProperties = {
    padding: "0.55rem 0.875rem", fontSize: "0.68rem", fontWeight: 800,
    color: "var(--isp-text-muted)", textTransform: "uppercase",
    letterSpacing: "0.06em", textAlign: "left",
    background: "rgba(255,255,255,0.025)",
    borderBottom: "1px solid var(--isp-border)",
  };
  const TD: React.CSSProperties = {
    padding: "0.7rem 0.875rem", fontSize: "0.8rem",
    color: "var(--isp-text)", borderBottom: "1px solid rgba(255,255,255,0.03)",
    verticalAlign: "middle",
  };

  const TABS: { key: StatusFilter; label: string; count: number; color: string }[] = [
    { key: "all",       label: "All",       count: stats.total,     color: "#94a3b8" },
    { key: "active",    label: "Active",    count: stats.active,    color: "#4ade80" },
    { key: "expired",   label: "Expired",   count: stats.expired,   color: "#f87171" },
    { key: "suspended", label: "Suspended", count: stats.suspended, color: "#fbbf24" },
    { key: "online",    label: "Online",    count: customers.filter(c => customerIsOnline(c, onlineUsers)).length, color: "#22c55e" },
  ];

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .prepaid-page{width:100%;max-width:1500px}
        .prepaid-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(2,6,23,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px}
        .prepaid-modal{width:100%;max-width:560px;background:var(--isp-card);border:1px solid var(--isp-border);border-radius:14px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.48)}
        .prepaid-small-modal{max-width:390px}
        .prepaid-modal-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
        .prepaid-modal-heading h2{margin:0;color:var(--isp-text);font-size:1rem}
        .prepaid-modal-heading p{margin:4px 0 0;color:var(--isp-text-muted);font:600 .7rem monospace}
        .prepaid-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .prepaid-form-grid label,.prepaid-small-modal label{display:flex;flex-direction:column;gap:6px;color:var(--isp-text-muted);font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
        .prepaid-small-modal input{width:100%;box-sizing:border-box;padding:10px;border-radius:7px;background:var(--isp-input-bg);border:1px solid var(--isp-border);color:var(--isp-text);font:inherit;font-size:.85rem}
        .prepaid-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
        .prepaid-primary-button,.prepaid-secondary-button{display:inline-flex;align-items:center;gap:6px;border-radius:7px;padding:9px 13px;font:700 .75rem inherit;cursor:pointer}
        .prepaid-primary-button{border:1px solid var(--isp-accent);background:var(--isp-accent);color:#fff}
        .prepaid-secondary-button{border:1px solid var(--isp-border);background:transparent;color:var(--isp-text-muted)}
        .prepaid-primary-button:disabled{opacity:.55;cursor:wait}
        .prepaid-help{font-size:.72rem;line-height:1.45;color:var(--isp-text-muted);margin:10px 0 0}
        .prepaid-spin{animation:spin 1s linear infinite}
        @media(max-width:680px){.prepaid-form-grid{grid-template-columns:1fr}.prepaid-table-shell{margin-right:-16px;border-right:0;border-radius:10px 0 0 10px}}
      `}</style>

      {actionError && (
        <div role="alert" style={{ marginBottom: "1rem", padding: "0.7rem 0.9rem", borderRadius: 8, color: "#fca5a5", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError("")} style={{ ...iconButton("#f87171"), flexShrink: 0 }} aria-label="Dismiss error"><X size={13} /></button>
        </div>
      )}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          plans={plans}
          routers={routers}
          onClose={() => setEditingUser(null)}
          onSave={updates => updateUser(editingUser, updates).catch(error => {
            setActionError(error instanceof Error ? error.message : "Could not save this user.");
            throw error;
          })}
        />
      )}
      {extendingUser && (
        <ExtendUserDialog
          user={extendingUser}
          onClose={() => setExtendingUser(null)}
          onExtend={days => handleExtend(extendingUser, days)}
        />
      )}

      <div className="prepaid-page" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--isp-text)", margin: "0 0 0.1rem" }}>
              Prepaid Users
            </h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: 0 }}>
              All WiFi subscribers — hotspot, PPPoE & static
            </p>
          </div>

          {/* Sync by Router */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSyncPicker(v => !v)} disabled={syncing}
              style={BTN("var(--isp-accent)")}>
              {syncing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <UploadCloud size={13} />}
              Sync by Router <ChevronDown size={11} />
            </button>
            {showSyncPicker && (
              <div style={{
                position: "absolute", top: "110%", right: 0, zIndex: 50,
                background: "var(--isp-card)", border: "1px solid var(--isp-border)",
                borderRadius: 10, padding: "0.875rem", minWidth: 240,
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.5rem" }}>
                  Select router
                </div>
                <select value={pickedRouter} onChange={e => setPickedRouter(e.target.value)}
                  style={{ ...INPUT, width: "100%", marginBottom: "0.5rem", cursor: "pointer" }}>
                  <option value="">— choose —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.status === "online" ? "🟢" : "🔴"}
                    </option>
                  ))}
                </select>
                <button onClick={handleSync} disabled={!pickedRouter || syncing}
                  style={{ ...BTN(pickedRouter ? "var(--isp-accent)" : "rgba(255,255,255,0.06)"), width: "100%", justifyContent: "center" }}>
                  {syncing ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={12} />}
                  Sync Users
                </button>
              </div>
            )}
          </div>

          <button onClick={exportCSV} style={BTN("linear-gradient(135deg,#22c55e,#16a34a)")}>
            <Download size={13} /> Export CSV
          </button>

          <button onClick={() => qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] })}
            style={BTN("rgba(255,255,255,0.06)", "var(--isp-text-muted)")}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "0.625rem" }}>
          {[
            { label: "Total Users",  value: stats.total,     color: "var(--isp-accent)", icon: <Users      size={18} /> },
            { label: "Active",       value: stats.active,    color: "#4ade80", icon: <CheckCircle2 size={18} /> },
            { label: "Expired",      value: stats.expired,   color: "#f87171", icon: <XCircle     size={18} /> },
            { label: "Suspended",    value: stats.suspended, color: "#fbbf24", icon: <AlertTriangle size={18} /> },
          ].map(s => (
            <div key={s.label} style={{
              background: "var(--isp-card)", border: "1px solid var(--isp-border)",
              borderRadius: 10, padding: "0.875rem 1rem",
              display: "flex", alignItems: "center", gap: "0.75rem",
            }}>
              <div style={{ color: s.color, opacity: 0.85 }}>{s.icon}</div>
              <div>
                <div style={{ fontSize: "1.35rem", fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: "0.67rem", color: "var(--isp-text-muted)", fontWeight: 600, marginTop: "0.2rem" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Sync log ── */}
        {syncLogs && (
          <div style={{
            background: syncOk === false ? "rgba(248,113,113,0.06)" : "rgba(37,99,235,0.05)",
            border: `1px solid ${syncOk === false ? "rgba(248,113,113,0.25)" : "rgba(37,99,235,0.2)"}`,
            borderRadius: 10, padding: "0.75rem 1rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: syncOk === false ? "#f87171" : "var(--isp-accent)" }}>
                Sync Log
              </span>
              <button onClick={() => setSyncLogs(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)", display: "flex", flexDirection: "column", gap: "0.1rem", maxHeight: 160, overflowY: "auto" }}>
              {syncLogs.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </div>
        )}

        {/* ── Status tabs + filters ── */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Status tabs */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.25rem" }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => { setStatusTab(t.key); setPage(1); }}
                style={{
                  padding: "0.3rem 0.75rem", borderRadius: 6, border: "none", fontFamily: "inherit",
                  fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
                  background: statusTab === t.key ? "rgba(255,255,255,0.1)" : "transparent",
                  color: statusTab === t.key ? t.color : "var(--isp-text-muted)",
                  transition: "all 0.15s",
                }}>
                {t.label}
                <span style={{
                  marginLeft: "0.35rem", fontSize: "0.6rem", fontWeight: 700,
                  background: statusTab === t.key ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)",
                  padding: "0.1rem 0.4rem", borderRadius: 3,
                  color: statusTab === t.key ? t.color : "var(--isp-text-muted)",
                }}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div style={{ position: "relative" }}>
            <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              style={{ ...INPUT, paddingRight: "1.75rem", cursor: "pointer", appearance: "none" }}>
              <option value="">All types</option>
              <option value="hotspot">Hotspot</option>
              <option value="pppoe">PPPoE</option>
              <option value="static">Static IP</option>
            </select>
            <Filter size={11} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
          </div>

          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, username, phone…"
              style={{ ...INPUT, paddingLeft: "2rem", width: "100%" }} />
          </div>
        </div>

        {/* ── Table ── */}
        <div className="prepaid-table-shell" style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1640, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={TH}>Username</th>
                <th style={TH}>Type</th>
                <th style={TH}>Plan</th>
                <th style={TH}>Created</th>
                <th style={TH}>Expires</th>
                <th style={TH}>Method</th>
                <th style={TH}>Router</th>
                <th style={TH}>Service status</th>
                <th style={TH}>Connection</th>
                <th style={TH}>Last seen</th>
                <th style={TH}>Data used</th>
                <th style={TH}>FUP</th>
                <th style={{ ...TH, textAlign: "center" }}>Manage</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={13} style={{ ...TD, textAlign: "center", padding: "3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", color: "var(--isp-text-muted)" }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--isp-accent)" }} /> Loading users…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ ...TD, textAlign: "center", padding: "3rem", color: "var(--isp-text-muted)" }}>
                    {search || typeFilter || statusTab !== "all"
                      ? "No users match this filter."
                      : "No prepaid users yet. Add customers from the Customers section."}
                  </td>
                </tr>
              ) : (
                pageRows.map(user => {
                  const plan   = user.plan_id ? planMap[user.plan_id] : null;
                  const routerId = user.router_id ?? plan?.router_id ?? null;
                  const router = routerId ? routerMap[routerId] : null;
                  const payment = paymentMap[user.id];
                  const username = purchaseUsername(user);
                  const online = customerIsOnline(user, onlineUsers);
                  const fup = user.fup_limit_mb ?? plan?.data_limit_mb ?? null;
                  const expiring = isExpiringSoon(user.expires_at);
                  const expired  = isExpired(user.expires_at);
                  return (
                    <tr key={user.id}
                      onMouseOver={e => (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.02)"}
                      onMouseOut={e  => (e.currentTarget as HTMLTableRowElement).style.background = "transparent"}
                      style={{ transition: "background 0.1s" }}
                    >
                      <td style={TD}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                          <Avt name={user.name} id={user.id} />
                          <div>
                            <div style={{ fontWeight: 800, fontSize: "0.78rem", color: "var(--isp-text)", fontFamily: "monospace", whiteSpace: "nowrap" }}>{username}</div>
                            <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>{user.phone || user.name || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={TD}><TypeBadge type={user.type} /></td>
                      <td style={TD}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--isp-text)", whiteSpace: "nowrap" }}>{plan?.name || "No plan"}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--isp-accent)", fontWeight: 700, marginTop: 3 }}>{plan ? `${plan.price.toFixed(2)} · ${plan.speed_down}/${plan.speed_up} Mbps` : "—"}</div>
                      </td>
                      <td style={{ ...TD, whiteSpace: "nowrap", fontSize: "0.72rem" }}>{fmtDate(user.created_at)}</td>
                      <td style={{ ...TD, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: expiring ? "#fbbf24" : expired ? "#f87171" : "var(--isp-text-muted)" }}>
                          {fmtDate(user.expires_at)}
                        </span>
                        {expiring && !expired && <div style={{ fontSize: "0.6rem", color: "#fbbf24", fontWeight: 700 }}>Expiring soon</div>}
                      </td>
                      <td style={{ ...TD, maxWidth: 190 }}>
                        <span title={paymentLabel(payment)} style={{ display: "block", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.7rem", color: payment ? "var(--isp-text)" : "var(--isp-text-muted)" }}>
                          {paymentLabel(payment)}
                        </span>
                        {payment && <div style={{ fontSize: "0.62rem", color: "var(--isp-text-sub)", marginTop: 2 }}>{formatData(payment.amount)} paid</div>}
                      </td>
                      <td style={TD}>
                        {router ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "0.3rem",
                            fontSize: "0.72rem", fontWeight: 700,
                            background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.18)",
                            color: "var(--isp-accent)", borderRadius: 5, padding: "0.18rem 0.5rem",
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: router.status === "online" ? "#22c55e" : "#475569" }} />
                            {router.name}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>Unassigned</span>
                        )}
                      </td>
                      <td style={TD}><StatusBadge status={user.status} /></td>
                      <td style={TD}><PresenceBadge online={online} /></td>
                      <td style={{ ...TD, whiteSpace: "nowrap", fontSize: "0.7rem" }}>{online ? "Just now" : fmtDate(user.last_seen)}</td>
                      <td style={{ ...TD, whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 700 }}>{formatData(user.data_used_mb)}</span>
                        {user.data_used_mb !== null && user.data_used_mb !== undefined && <div style={{ fontSize: "0.6rem", color: "var(--isp-text-sub)" }}>from router record</div>}
                      </td>
                      <td style={{ ...TD, whiteSpace: "nowrap", fontSize: "0.72rem" }}>{fup === null ? "Unlimited" : formatData(fup)}</td>
                      <td style={{ ...TD, textAlign: "center" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <button title="Edit user" aria-label={`Edit ${username}`} onClick={() => setEditingUser(user)} disabled={actionBusy === user.id}
                            style={{ ...iconButton("#60a5fa"), opacity: actionBusy === user.id ? 0.5 : 1 }}><Edit3 size={13} /></button>
                          <button title="Extend access" aria-label={`Extend ${username}`} onClick={() => setExtendingUser(user)} disabled={actionBusy === user.id}
                            style={iconButton("#a78bfa")}><PlusCircle size={13} /></button>
                          <button title={user.status === "active" ? "Disable user" : "Enable user"} aria-label={`${user.status === "active" ? "Disable" : "Enable"} ${username}`} onClick={() => void handleStatus(user, user.status === "active" ? "suspended" : "active")} disabled={actionBusy === user.id}
                            style={iconButton(user.status === "active" ? "#f59e0b" : "#22c55e")}>{user.status === "active" ? <Power size={13} /> : <CheckCircle2 size={13} />}</button>
                          <button title="Delete user" aria-label={`Delete ${username}`} onClick={() => void handleDelete(user)} disabled={actionBusy === user.id}
                            style={iconButton("#ef4444")}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                style={{
                  padding: "0.3rem 0.65rem", borderRadius: 5, border: "1px solid",
                  borderColor: p === page ? "transparent" : "var(--isp-border)",
                  background: p === page ? "var(--isp-accent)" : "rgba(255,255,255,0.04)",
                  color: p === page ? "white" : "var(--isp-text-muted)",
                  fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit",
                }}>
                {p}
              </button>
            ))}
            <span style={{ fontSize: "0.69rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              {filtered.length} user{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ════════════════ Detail Modal ════════════════ */}
      {detailUser && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setDetailUser(null); }}
        >
          <div style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 500, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem", marginBottom: "1.25rem" }}>
              <Avt name={detailUser.name} id={detailUser.id} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--isp-text)" }}>
                  {detailUser.name || detailUser.username || `User #${detailUser.id}`}
                </div>
                <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  <TypeBadge type={detailUser.type} />
                  <StatusBadge status={detailUser.status} />
                </div>
              </div>
              <button onClick={() => setDetailUser(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[
                { icon: <Users size={13} />,       label: "Username",   value: detailUser.pppoe_username || detailUser.username || "—" },
                { icon: <Phone size={13} />,       label: "Phone",      value: detailUser.phone || "—" },
                { icon: <Mail  size={13} />,       label: "Email",      value: detailUser.email || "—" },
                { icon: <Server size={13} />,      label: "IP Address", value: detailUser.ip_address || "—" },
                { icon: <Wifi  size={13} />,       label: "MAC",        value: detailUser.mac_address || "—" },
                { icon: <CalendarDays size={13} />,label: "Expires",    value: fmtDate(detailUser.expires_at) },
                { icon: <CalendarDays size={13} />,label: "Created",    value: fmtDate(detailUser.created_at) },
                { icon: <Network size={13} />,     label: "Data Used",  value: `${(detailUser.data_used_mb ?? 0).toFixed(1)} MB` },
              ].map(row => (
                <div key={row.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.625rem 0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
                    {row.icon} {row.label}
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--isp-text)", fontFamily: ["IP Address","MAC"].includes(row.label) ? "monospace" : "inherit" }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            {detailUser.plan_id && planMap[detailUser.plan_id] && (
              <div style={{ marginTop: "0.75rem", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, padding: "0.625rem 0.75rem" }}>
                <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>Plan</div>
                <div style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.85rem" }}>
                  {planMap[detailUser.plan_id].name}
                  <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-accent)", marginLeft: "0.5rem" }}>
                    {planMap[detailUser.plan_id].speed_down}/{planMap[detailUser.plan_id].speed_up} Mbps
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
