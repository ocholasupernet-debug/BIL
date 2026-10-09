import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase, ADMIN_ID, getAdminApiToken, type DbCustomer } from "@/lib/supabase";
import { useReconnectPrepaidHotspot, type HotspotReconnectResult } from "@workspace/api-client-react";
import {
  Loader2, RefreshCw, Wifi, Network, Globe,
  Users, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, Filter, Download, UploadCloud, Eye,
  X, Phone, Mail, CalendarDays, Server, Edit3, PlusCircle,
  Power, Trash2, MoreHorizontal, Database, Save, RotateCw,
} from "lucide-react";
import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { fetchAdminRouterContext, type AdminContextRouter } from "@/lib/admin-router-context";
import { mergeCustomerServiceIdentities } from "@/lib/customer-identities";
import { getCustomerServiceStatus } from "@/lib/customer-service-status";
import {
  buildLivePresenceByRouter,
  customerIsOnline,
  normalizeLiveIdentity,
  prepaidServiceType,
  purchaseUsername,
} from "@/lib/prepaid-live-presence";
import { usePrepaidLiveQueries } from "@/lib/prepaid-live-queries";
import { PrepaidSyncReport, type PrepaidSyncResult } from "@/components/ui/PrepaidSyncReport";
import { syncActiveAccountsToRouter } from "@/lib/prepaid-sync";
import { transactionDisplayId } from "@/lib/transaction-reference";

const PAGE_SIZE = 20;

/* ══════════════════════════════ Types ══════════════════════════════ */
interface Plan   {
  id: number; name: string; type: string; price: number; speed_down: number; speed_up: number;
  speed_down_unit?: string; speed_up_unit?: string;
  validity?: number; validity_days?: number; validity_unit?: string; data_limit_mb?: number | null;
  router_id?: number | null; port_id?: number | null; is_active?: boolean;
}
interface Router { id: number; name: string; host: string; status: string; bridge_ip: string | null; }

interface Customer extends DbCustomer {
  router_id?: number | null;
  port_id?: number | null;
  last_seen?: string | null;
  data_used_bytes?: number | string | null;
  service_online?: boolean | null;
  fup_limit_mb?: number | null;
  depletion_reason?: string | null;
}
interface DisplayCustomer extends Customer {
  mergedCustomerIds: number[];
}
interface Payment {
  id: number;
  customer_id: number | null;
  plan_id: number | null;
  amount: number;
  payment_method: string;
  reference: string | null;
  mpesa_receipt?: string | null;
  notes?: string | null;
  status: string;
  created_at: string;
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
function fmtTableDateTime(d?: string | null) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function fromDateTimeLocal(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function paymentLabel(payment?: Payment) {
  if (!payment) return "—";
  const method = payment.payment_method.toLowerCase();
  const transactionId = transactionDisplayId(payment);
  const notes = (payment.notes ?? "").toLowerCase();
  if (method.includes("till") || notes.includes("till")) return `MpesatillStk-${transactionId}`;
  if (method.includes("paybill") || notes.includes("paybill")) return `MpesapaybillStk-${transactionId}`;
  if (method.includes("bank") || notes.includes("bank")) return `BankStk-${transactionId}`;
  if (method.includes("mpesa")) return `MpesaStk-${transactionId}`;
  if (method.includes("cash") || method.includes("manual")) return `Cash-${transactionId}`;
  return `${payment.payment_method}-${transactionId}`;
}
function customerPackageId(user: Customer, paymentMap: Record<number, Payment>) {
  return paymentMap[user.id]?.plan_id ?? user.plan_id ?? null;
}
function formatUsageBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  let value = Math.max(0, bytes) / 1_000_000;
  const units = ["MB", "GB", "TB", "PB"];
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }
  return `${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })} ${units[unitIndex]}`;
}
function customerUsageBytes(user: Customer, liveUsage: Map<string, number>) {
  const isVlan = String(user.type ?? "").toLowerCase() === "vlan";
  const live = [user.username, user.pppoe_username, user.ip_address, purchaseUsername(user)]
    .map(normalizeLiveIdentity)
    .map(identity => liveUsage.get(identity))
    .find(value => value !== undefined);
  if (isVlan && !user.last_seen) return null;
  if (isVlan) {
    const rawBytes = user.data_used_bytes;
    const vlanBytes = rawBytes === null || rawBytes === undefined || rawBytes === "" ? Number.NaN : Number(rawBytes);
    if (Number.isFinite(vlanBytes)) return Math.max(0, vlanBytes);
    if (user.data_used_mb === null || user.data_used_mb === undefined) return null;
    const vlanMb = Number(user.data_used_mb);
    return Number.isFinite(vlanMb) ? Math.max(0, vlanMb * 1_000_000) : null;
  }
  const rawPersisted = user.data_used_bytes;
  const persisted = rawPersisted === null || rawPersisted === undefined || rawPersisted === ""
    ? Number.NaN
    : Number(rawPersisted);
  if (Number.isFinite(persisted)) return Math.max(0, persisted, live ?? 0);
  const mb = Number.isFinite(user.data_used_mb) ? Number(user.data_used_mb) : Number.NaN;
  if (Number.isFinite(mb)) return Math.max(0, mb * 1_000_000, live ?? 0);
  return live ?? null;
}
function isExpired(d?: string | null) {
  if (!d) return false;
  const expiry = Date.parse(d);
  return Number.isFinite(expiry) && expiry <= Date.now();
}
function hasUnexpiredPaidAccess(user: Customer) {
  return getCustomerServiceStatus(user) === "active";
}
function isCustomerExpired(user: Customer) {
  return getCustomerServiceStatus(user) === "expired";
}

const TYPE_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hotspot: { label: "Hotspot", color: "var(--isp-accent)", bg: "var(--isp-accent-glow)",  icon: <Wifi    size={10} /> },
  pppoe:   { label: "PPPoE",   color: "var(--isp-accent)", bg: "var(--isp-accent-glow)", icon: <Network size={10} /> },
  static:  { label: "Static",  color: "#34d399", bg: "rgba(16,185,129,0.12)", icon: <Globe   size={10} /> },
  vlan:    { label: "VLAN",    color: "#818cf8", bg: "rgba(129,140,248,0.12)", icon: <Network size={10} /> },
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
    .select("id,name,type,price,speed_down,speed_up,validity,validity_days,validity_unit,data_limit_mb,router_id,port_id,is_active")
    .eq("admin_id", ADMIN_ID)
    .is("owner_reseller_id", null);
  return (data ?? []) as Plan[];
}
async function fetchRouters(): Promise<Router[]> {
  return (await fetchAdminRouterContext()).routers.map(router => ({
    ...router,
    bridge_ip: router.bridge_ip,
  }));
}
async function fetchPayments(customerIds: number[]): Promise<Payment[]> {
  if (!customerIds.length) return [];
  const { data, error } = await supabase
    .from("isp_transactions")
    .select("id,customer_id,plan_id,amount,payment_method,reference,mpesa_receipt,notes,status,created_at")
    .eq("admin_id", ADMIN_ID)
    .not("payment_method", "in", "(mpesa_registration,manual_registration,mpesa_platform_billing)")
    .in("customer_id", customerIds)
    .in("status", ["completed", "paid", "success"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

function iconButton(color: string): React.CSSProperties {
  return {
    width: 27, height: 27, display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: 0, borderRadius: 6, border: `1px solid ${color}55`, color, background: `${color}16`,
    cursor: "pointer",
  };
}

function planExpiryInput(plan?: Plan): string {
  if (!plan) return "";
  const amount = Number(plan.validity || plan.validity_days);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const unit = String(plan.validity_unit ?? "days").toLowerCase();
  const seconds = unit.startsWith("min") ? amount * 60
    : unit.startsWith("hour") || unit.startsWith("hr") ? amount * 3600
      : unit.startsWith("week") ? amount * 7 * 86400
        : unit.startsWith("month") ? amount * 30 * 86400
          : amount * 86400;
  return toDateTimeLocal(new Date(Date.now() + seconds * 1000).toISOString());
}

function AddVlanPrepaidDialog({
  plans, routers, onClose, onCreated,
}: {
  plans: Plan[];
  routers: Router[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const vlanPlans = plans.filter(plan =>
    String(plan.type).toLowerCase() === "vlan"
    && plan.router_id != null
    && plan.port_id != null
    && plan.is_active === true,
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [planId, setPlanId] = useState(String(vlanPlans[0]?.id ?? ""));
  const selectedPlan = vlanPlans.find(plan => String(plan.id) === planId);
  const [expiresAt, setExpiresAt] = useState(() => planExpiryInput(vlanPlans[0]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "0.6rem 0.7rem", borderRadius: 7,
    background: "var(--isp-input-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)",
    font: "inherit", fontSize: "0.8rem",
  };

  const submit = async () => {
    setError("");
    if (!name.trim() || !phone.trim() || !ipAddress.trim() || !selectedPlan) {
      setError("Enter the customer details, assigned IP, and an active existing VLAN plan.");
      return;
    }
    if (expiresAt && !fromDateTimeLocal(expiresAt)) {
      setError("Choose a valid expiry date and time.");
      return;
    }
    setSaving(true);
    try {
      const token = getAdminApiToken();
      const response = await fetch(apiUrl("/api/customers"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          adminId: ADMIN_ID,
          name: name.trim(),
          phone: phone.trim(),
          planId: selectedPlan.id,
          routerId: selectedPlan.router_id,
          portId: selectedPlan.port_id,
          type: "vlan",
          ipAddress: ipAddress.trim(),
          status: "active",
          expiryDate: fromDateTimeLocal(expiresAt),
        }),
      });
      const payload = await parseJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `VLAN user could not be added (${response.status}).`);
      await onCreated();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "VLAN user could not be added.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="prepaid-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="prepaid-modal" role="dialog" aria-modal="true" aria-labelledby="add-vlan-prepaid-title">
        <div className="prepaid-modal-heading">
          <div>
            <h2 id="add-vlan-prepaid-title">Add VLAN prepaid user</h2>
            <p>Uses an existing VLAN plan and service port; it does not create a new VLAN.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} style={iconButton("#94a3b8")} aria-label="Close add VLAN user dialog"><X size={15} /></button>
        </div>
        {vlanPlans.length === 0 ? (
          <div role="status" className="prepaid-help">
            No active VLAN plans with an assigned router and VLAN service port are available. Create or activate a VLAN plan first.
          </div>
        ) : (
          <>
            <div className="prepaid-form-grid">
              <label>
                Customer name
                <input autoFocus style={inputStyle} value={name} onChange={event => setName(event.target.value)} />
              </label>
              <label>
                Phone number
                <input style={inputStyle} type="tel" value={phone} onChange={event => setPhone(event.target.value)} />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Assigned IP address
                <input style={inputStyle} inputMode="decimal" value={ipAddress} onChange={event => setIpAddress(event.target.value)} placeholder="For example, 10.20.30.45" />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Existing VLAN plan
                <select
                  style={inputStyle}
                  value={planId}
                  onChange={event => {
                    const nextPlanId = event.target.value;
                    setPlanId(nextPlanId);
                    setExpiresAt(planExpiryInput(vlanPlans.find(plan => String(plan.id) === nextPlanId)));
                  }}
                >
                  <option value="">Choose a VLAN plan</option>
                  {vlanPlans.map(plan => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · VLAN port #{plan.port_id} · {plan.speed_down}/{plan.speed_up} Mbps · KSh {Number(plan.price).toLocaleString("en-KE")}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Router / VLAN scope
                <input
                  style={inputStyle}
                  readOnly
                  value={selectedPlan
                    ? `${routers.find(router => router.id === selectedPlan.router_id)?.name ?? `Router #${selectedPlan.router_id}`} · VLAN service port #${selectedPlan.port_id}`
                    : ""}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Expires at
                <input style={inputStyle} type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
                <span className="prepaid-help">Defaults to the selected plan validity. The individual plan speed is enforced below the VLAN’s aggregate cap.</span>
              </label>
            </div>
            {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", marginTop: 12 }}>{error}</div>}
          </>
        )}
        <div className="prepaid-modal-actions">
          <button type="button" onClick={onClose} disabled={saving} className="prepaid-secondary-button">Cancel</button>
          {vlanPlans.length > 0 && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !name.trim() || !phone.trim() || !ipAddress.trim() || !selectedPlan}
              className="prepaid-primary-button"
            >
              {saving ? <Loader2 size={13} className="prepaid-spin" /> : <PlusCircle size={13} />}
              {saving ? "Adding…" : "Add prepaid user"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
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
  const isVlan = String(user.type ?? "").toLowerCase() === "vlan";
  const isHotspot = ["hotspot", "trial", "trials"].includes(String(user.type ?? "").toLowerCase());
  const [name, setName] = useState(user.name ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [username, setUsername] = useState(user.username ?? user.pppoe_username ?? "");
  const [ipAddress, setIpAddress] = useState(user.ip_address ?? "");
  const [planId, setPlanId] = useState(String(user.plan_id ?? ""));
  const [routerId, setRouterId] = useState(String(user.router_id ?? ""));
  const [expiresAt, setExpiresAt] = useState(() => toDateTimeLocal(user.expires_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedPlan = plans.find(plan => String(plan.id) === planId);
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "0.6rem 0.7rem", borderRadius: 7,
    background: "var(--isp-input-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)",
    font: "inherit", fontSize: "0.8rem",
  };
  const submit = async () => {
    if (!name.trim() || (isVlan ? !ipAddress.trim() : !username.trim())) return;
    if (isVlan && (!selectedPlan || !selectedPlan.router_id || !selectedPlan.port_id)) return;
    if (expiresAt && !fromDateTimeLocal(expiresAt)) return;
    setError("");
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        phone: phone.trim(),
        ...(isVlan
          ? { ip_address: ipAddress.trim() }
          : user.type === "pppoe" ? { pppoe_username: username.trim() } : { username: username.trim() }),
        plan_id: planId ? Number(planId) : null,
        router_id: isVlan ? selectedPlan?.router_id ?? null : routerId ? Number(routerId) : null,
        expires_at: fromDateTimeLocal(expiresAt),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this user.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="prepaid-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="prepaid-modal" role="dialog" aria-modal="true" aria-labelledby="edit-prepaid-user-title">
        <div className="prepaid-modal-heading">
          <div>
            <h2 id="edit-prepaid-user-title">Edit prepaid user</h2>
            <p>{purchaseUsername(user)}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} style={iconButton("#94a3b8")} aria-label="Close edit dialog"><X size={15} /></button>
        </div>
        <div className="prepaid-form-grid">
          <label>Name<input style={inputStyle} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Phone used for purchase<input style={inputStyle} value={phone} onChange={event => setPhone(event.target.value)} />
            {isHotspot && <span className="prepaid-help">Changing this phone also changes the Hotspot login on MikroTik.</span>}
          </label>
          {isVlan
            ? <label>Assigned IP address<input style={inputStyle} inputMode="decimal" value={ipAddress} onChange={event => setIpAddress(event.target.value)} /></label>
            : <label>{isHotspot ? "Username (linked to phone)" : "Username"}
                <input style={inputStyle} value={username} readOnly={isHotspot} onChange={event => setUsername(event.target.value)} />
              </label>}
          <label>Plan<select style={inputStyle} value={planId} onChange={event => setPlanId(event.target.value)}>
            <option value="">{isVlan ? "Choose a VLAN plan" : "No plan"}</option>
              {plans.filter(plan =>
                (!user.type || prepaidServiceType(plan.type) === prepaidServiceType(user.type))
                && (plan.is_active || plan.id === user.plan_id)
                && (!user.router_id || plan.router_id === user.router_id)
                && (!user.port_id || plan.port_id === user.port_id)
              ).map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {plan.price.toFixed(2)}</option>)}
          </select></label>
          {isVlan
            ? <label>Assigned router / VLAN port<input style={inputStyle} readOnly value={selectedPlan ? `${routers.find(router => router.id === selectedPlan.router_id)?.name ?? `Router #${selectedPlan.router_id}`} · VLAN service port #${selectedPlan.port_id}` : "Select a VLAN plan"} /></label>
            : <label>Router<select style={inputStyle} value={routerId} disabled={Boolean(user.router_id)} onChange={event => setRouterId(event.target.value)}>
                <option value="">Unassigned</option>
                {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
              </select><span className="prepaid-help">Moving to another router requires a separate service migration.</span></label>}
          <label style={{ gridColumn: "1 / -1" }}>
            Expiry date and time
            <input
              style={inputStyle}
              type="datetime-local"
              value={expiresAt}
              onChange={event => setExpiresAt(event.target.value)}
            />
            <span className="prepaid-help">Use the local date and time shown on this admin panel. Leave blank only for an account with no expiry.</span>
          </label>
        </div>
        {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", marginTop: 12 }}>{error}</div>}
        <div className="prepaid-modal-actions">
          <button type="button" onClick={onClose} disabled={saving} className="prepaid-secondary-button">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving || !name.trim() || (isVlan ? !ipAddress.trim() || !selectedPlan?.router_id || !selectedPlan?.port_id : !username.trim())} className="prepaid-primary-button">
            {saving ? <Loader2 size={13} className="prepaid-spin" /> : <Save size={13} />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustExpiryDialog({
  user, onClose, onSave,
}: { user: Customer; onClose: () => void; onSave: (expiresAt: string) => Promise<void> }) {
  const currentExpiryLocal = toDateTimeLocal(user.expires_at);
  const [expiresAt, setExpiresAt] = useState(currentExpiryLocal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextExpiry = fromDateTimeLocal(expiresAt);
  const nextExpiryMs = nextExpiry ? Date.parse(nextExpiry) : Number.NaN;
  const unchanged = expiresAt === currentExpiryLocal;
  const willExpireImmediately = Number.isFinite(nextExpiryMs)
    && nextExpiryMs <= Date.now()
    && user.status !== "expired"
    && !isExpired(user.expires_at);
  const submit = async () => {
    const normalizedExpiry = fromDateTimeLocal(expiresAt);
    if (!normalizedExpiry) {
      setError("Choose a valid expiry date and time.");
      return;
    }
    if (willExpireImmediately && !window.confirm(
      `This will expire ${purchaseUsername(user)} immediately and disconnect their service. Continue?`,
    )) return;
    setError("");
    setSaving(true);
    try {
      await onSave(normalizedExpiry);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not adjust this user's expiry.");
    } finally {
      setSaving(false);
    }
  };
  const currentExpiryMs = user.expires_at ? Date.parse(user.expires_at) : Number.NaN;
  const direction = !Number.isFinite(nextExpiryMs)
    ? ""
    : !Number.isFinite(currentExpiryMs) || nextExpiryMs > currentExpiryMs
      ? "This moves expiry later and extends access."
      : nextExpiryMs < currentExpiryMs
        ? "This moves expiry earlier and shortens access."
        : "The expiry is unchanged.";
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "0.6rem 0.7rem", borderRadius: 7,
    background: "var(--isp-input-bg)", border: "1px solid var(--isp-border)", color: "var(--isp-text)",
    font: "inherit", fontSize: "0.8rem",
  };
  return (
    <div className="prepaid-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="prepaid-modal prepaid-small-modal" role="dialog" aria-modal="true" aria-labelledby="adjust-prepaid-user-title">
        <div className="prepaid-modal-heading">
          <div><h2 id="adjust-prepaid-user-title">Adjust access time</h2><p>{purchaseUsername(user)}</p></div>
          <button type="button" onClick={onClose} disabled={saving} style={iconButton("#94a3b8")} aria-label="Close expiry adjustment"><X size={15} /></button>
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <div>
            <div className="prepaid-help" style={{ marginBottom: 3 }}>Current expiry</div>
            <div style={{ color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 650 }}>
              {user.expires_at ? fmtDate(user.expires_at) : "No expiry set"}
            </div>
          </div>
          <label>
            New expiry date and time
            <input
              autoFocus
              required
              style={inputStyle}
              type="datetime-local"
              step={60}
              value={expiresAt}
              onChange={event => setExpiresAt(event.target.value)}
            />
          </label>
          {direction && <p className="prepaid-help" style={{ margin: 0 }}>{direction}</p>}
          {willExpireImmediately && (
            <p role="alert" style={{ margin: 0, color: "#f87171", fontSize: "0.74rem" }}>
              This date is in the past. Saving will expire the service and disconnect the user.
            </p>
          )}
          <p className="prepaid-help" style={{ margin: 0 }}>
            Use the local time shown on this admin panel. Changing expiry keeps a suspended account suspended.
          </p>
        </div>
        {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", marginTop: 12 }}>{error}</div>}
        <div className="prepaid-modal-actions">
          <button type="button" onClick={onClose} disabled={saving} className="prepaid-secondary-button">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving || !nextExpiry || unchanged} className="prepaid-primary-button">
            {saving ? <Loader2 size={13} className="prepaid-spin" /> : <Save size={13} />} Save expiry
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
  const reconnectMutation = useReconnectPrepaidHotspot();

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
  const planMap   = useMemo(() => Object.fromEntries(plans.map(p   => [p.id,   p  ])), [plans]);
  const routerMap = useMemo(() => Object.fromEntries(routers.map(r => [r.id,   r  ])), [routers]);
  const displayCustomers = useMemo(
    () => mergeCustomerServiceIdentities(customers, planMap),
    [customers, planMap],
  );
  const paymentsByCustomerId = useMemo(() => {
    const grouped = new Map<number, Payment[]>();
    const latestFirst = [...payments].sort((a, b) => {
      const dateDifference = Date.parse(b.created_at) - Date.parse(a.created_at);
      return (Number.isFinite(dateDifference) ? dateDifference : 0) || b.id - a.id;
    });
    latestFirst.forEach(payment => {
      if (payment.customer_id === null) return;
      const customerPayments = grouped.get(payment.customer_id) ?? [];
      customerPayments.push(payment);
      grouped.set(payment.customer_id, customerPayments);
    });
    return grouped;
  }, [payments]);
  const paymentMap = useMemo(() => {
    const grouped: Record<number, Payment> = {};
    displayCustomers.forEach(customer => {
      const payment = customer.mergedCustomerIds
        .map(customerId => paymentsByCustomerId.get(customerId)?.[0])
        .filter((value): value is Payment => Boolean(value))
        .sort((a, b) => {
          const dateDifference = Date.parse(b.created_at) - Date.parse(a.created_at);
          return (Number.isFinite(dateDifference) ? dateDifference : 0) || b.id - a.id;
        })[0];
      if (payment) grouped[customer.id] = payment;
    });
    return grouped;
  }, [paymentsByCustomerId, displayCustomers]);
  const packageOptions = useMemo(() => {
    const ids = new Set<number>(plans.map(plan => plan.id));
    displayCustomers.forEach(customer => {
      const planId = customerPackageId(customer, paymentMap);
      if (planId !== null) ids.add(planId);
    });
    return [...ids]
      .map(id => ({ id, name: planMap[id]?.name ?? `Plan #${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }, [plans, displayCustomers, paymentMap, planMap]);
  const hasUnassignedPackage = useMemo(
    () => displayCustomers.some(customer => customerPackageId(customer, paymentMap) === null),
    [displayCustomers, paymentMap],
  );
  const liveQueries = usePrepaidLiveQueries(routers);
  const livePresenceByRouter = useMemo(() => {
    return buildLivePresenceByRouter(routers, liveQueries);
  }, [routers, liveQueries]);
  const liveSnapshotKey = liveQueries
    .map(query => query.data?.fetchedAt ?? "")
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!liveSnapshotKey) return;
    // The live endpoint persists router counters and connection state; reload
    // the customer rows after each successful snapshot so the table reflects
    // that durable state, including for users who are currently offline.
    void qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
  }, [qc, liveSnapshotKey]);
  const liveUsage = useMemo(() => {
    const usage = new Map<string, number>();
    const add = (identity?: string, bytesIn?: number, bytesOut?: number) => {
      const key = normalizeLiveIdentity(identity);
      if (!key) return;
      usage.set(key, (usage.get(key) ?? 0) + Math.max(0, Number(bytesIn) || 0) + Math.max(0, Number(bytesOut) || 0));
    };
    liveQueries.forEach(query => {
      query.data?.hotspotUsers?.forEach(user => add(user.user, user.bytesIn, user.bytesOut));
      query.data?.pppoeUsers?.forEach(user => add(user.name, user.bytesIn, user.bytesOut));
    });
    return usage;
  }, [liveQueries]);
  const reconnectEligibleUsers = useMemo(() => displayCustomers.filter(user => {
    const plan = user.plan_id ? planMap[user.plan_id] : null;
    const routerId = user.router_id ?? plan?.router_id ?? null;
    const normalizedMac = String(user.mac_address ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
    return prepaidServiceType(user.type) === "hotspot"
      && hasUnexpiredPaidAccess(user)
      && !customerIsOnline(user, livePresenceByRouter, planMap)
      && Boolean(user.plan_id && plan && routerId && routerMap[routerId])
      && normalizedMac.length === 12;
  }), [displayCustomers, planMap, routerMap, livePresenceByRouter]);
  const reconnectEligibleIds = useMemo(
    () => new Set(reconnectEligibleUsers.map(user => user.id)),
    [reconnectEligibleUsers],
  );
  /* ── UI state ── */
  const [search,      setSearch]      = useState("");
  const [statusTab,   setStatusTab]   = useState<StatusFilter>("all");
  const [typeFilter,  setTypeFilter]  = useState("");
  const [packageFilter, setPackageFilter] = useState("");
  const [routerFilter, setRouterFilter] = useState("");
  const [entries,     setEntries]     = useState(PAGE_SIZE);
  const [page,        setPage]        = useState(1);
  const [detailUser,  setDetailUser]  = useState<Customer | null>(null);
  const [editingUser, setEditingUser] = useState<Customer | null>(null);
  const [extendingUser, setExtendingUser] = useState<Customer | null>(null);
  const [adjustingExpiryUser, setAdjustingExpiryUser] = useState<Customer | null>(null);
  const [rechargePickerOpen, setRechargePickerOpen] = useState(false);
  const [addingVlanUser, setAddingVlanUser] = useState(false);
  const [rechargeTargetId, setRechargeTargetId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [reconnectingIds, setReconnectingIds] = useState<Set<number>>(() => new Set());
  const [reconnectProgress, setReconnectProgress] = useState<{
    completed: number;
    total: number;
    results: HotspotReconnectResult[];
    running: boolean;
  } | null>(null);
  const reconnectBatchBusyRef = useRef(false);
  const reconnectOutcomes = useMemo(() => {
    const results = reconnectProgress?.results ?? [];
    return {
      connected: results.filter(result => result.status === "connected" || result.status === "already_connected").length,
      notVisible: results.filter(result => result.status === "device_not_found").length,
      notEligible: results.filter(result => ["not_eligible", "session_limit", "depleted"].includes(result.status)).length,
      routerErrors: results.filter(result => ["router_rejected", "router_unavailable"].includes(result.status)).length,
    };
  }, [reconnectProgress]);

  function reconnectRouterId(user: DisplayCustomer): number | null {
    const plan = user.plan_id ? planMap[user.plan_id] : null;
    const routerId = user.router_id ?? plan?.router_id ?? null;
    return routerId && routerMap[routerId] ? routerId : null;
  }

  async function refreshReconnectData(routerIds: number[]) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] }),
      ...[...new Set(routerIds)].map(routerId =>
        qc.invalidateQueries({ queryKey: ["prepaid_live", routerId] }),
      ),
    ]);
  }

  async function reconnectOne(user: DisplayCustomer) {
    if (reconnectBatchBusyRef.current) return;
    setActionError("");
    setReconnectProgress({ completed: 0, total: 1, results: [], running: true });
    setReconnectingIds(current => new Set(current).add(user.id));
    reconnectBatchBusyRef.current = true;
    try {
      const result = await reconnectMutation.mutateAsync({ id: user.id });
      setReconnectProgress({ completed: 1, total: 1, results: [result], running: false });
    } catch (error) {
      const result: HotspotReconnectResult = {
        status: "router_unavailable",
        message: error instanceof Error ? error.message : "The router could not be reached.",
      };
      setReconnectProgress({ completed: 1, total: 1, results: [result], running: false });
    } finally {
      setReconnectingIds(current => {
        const next = new Set(current);
        next.delete(user.id);
        return next;
      });
      reconnectBatchBusyRef.current = false;
      const routerId = reconnectRouterId(user);
      await refreshReconnectData(routerId ? [routerId] : []);
    }
  }

  async function reconnectAllEligible() {
    if (reconnectBatchBusyRef.current || reconnectEligibleUsers.length === 0) return;

    const targets = reconnectEligibleUsers
      .map(user => ({ user, routerId: reconnectRouterId(user) }))
      .filter((target): target is { user: DisplayCustomer; routerId: number } => target.routerId !== null);
    if (targets.length === 0) return;

    const queuesByRouter = new Map<number, DisplayCustomer[]>();
    for (const { user, routerId } of targets) {
      const queue = queuesByRouter.get(routerId) ?? [];
      queue.push(user);
      queuesByRouter.set(routerId, queue);
    }
    const routerQueues = [...queuesByRouter.values()];
    const targetIds = new Set(targets.map(({ user }) => user.id));
    const routerIds = [...queuesByRouter.keys()];
    const results: HotspotReconnectResult[] = [];
    let completed = 0;
    let nextQueueIndex = 0;

    setActionError("");
    setReconnectProgress({ completed: 0, total: targets.length, results: [], running: true });
    setReconnectingIds(targetIds);
    reconnectBatchBusyRef.current = true;

    try {
      // Run no more than one account per router at a time, with a small global
      // cap so a manual batch cannot overload MikroTik API connections.
      while (routerQueues.some(queue => queue.length > 0)) {
        const batch: DisplayCustomer[] = [];
        let queuesVisited = 0;
        while (batch.length < 3 && queuesVisited < routerQueues.length) {
          const queueIndex = nextQueueIndex % routerQueues.length;
          nextQueueIndex = (queueIndex + 1) % routerQueues.length;
          queuesVisited += 1;
          const user = routerQueues[queueIndex].shift();
          if (user) batch.push(user);
        }
        if (batch.length === 0) break;

        const batchResults = await Promise.all(batch.map(async user => {
          try {
            return await reconnectMutation.mutateAsync({ id: user.id });
          } catch (error) {
            return {
              status: "router_unavailable" as const,
              message: error instanceof Error ? error.message : "The router could not be reached.",
            };
          }
        }));
        results.push(...batchResults);
        completed += batch.length;
        setReconnectProgress({
          completed,
          total: targets.length,
          results: [...results],
          running: completed < targets.length,
        });
      }
    } finally {
      setReconnectingIds(new Set());
      reconnectBatchBusyRef.current = false;
      await refreshReconnectData(routerIds);
    }
  }

  /* Sync state */
  const [showSyncPicker,  setShowSyncPicker]  = useState(false);
  const [pickedRouter,    setPickedRouter]     = useState("");
  const [syncing,         setSyncing]         = useState(false);
  const syncBusyRef = useRef(false);
  const [syncLogs,        setSyncLogs]        = useState<string[] | null>(null);
  const [syncReport, setSyncReport] = useState<{
    total: number; processed: number; users: PrepaidSyncResult[];
    routerName: string; error?: string;
  } | null>(null);

  async function updateUser(user: Customer, updates: Record<string, unknown>) {
    setActionError("");
    setActionNotice("");
    setActionBusy(user.id);
    try {
      const token = getAdminApiToken();
      if (!token) throw new Error("Your admin session has expired. Sign in again before editing this user.");
      const response = await fetch(apiUrl(`/api/customers/${user.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adminId: ADMIN_ID, ...updates }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        mikrotikSynced?: boolean;
        syncedRouter?: string | null;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "The live router account could not be updated.");
      if (!payload?.mikrotikSynced) throw new Error("The server did not confirm that MikroTik was updated. Refresh this user before trying again.");
      await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
      setActionNotice(`Saved and applied to MikroTik${payload.syncedRouter ? ` (${payload.syncedRouter})` : ""}.`);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(user: DisplayCustomer) {
    const groupedRecordNote = user.mergedCustomerIds.length > 1
      ? ` This row groups ${user.mergedCustomerIds.length} matching records; only the newest will be deleted, and the remaining records may appear afterward.`
      : "";
    if (!window.confirm(`Delete ${purchaseUsername(user)}?${groupedRecordNote} This cannot be undone.`)) return;
    try {
      setActionBusy(user.id);
      const response = await fetch(apiUrl(`/api/customers/${user.id}?adminId=${ADMIN_ID}`), {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not delete this user.");
      await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
      await qc.invalidateQueries({ queryKey: ["isp_transactions"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this user.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleAdjustExpiry(user: Customer, expiresAt: string) {
    await updateUser(user, { expires_at: expiresAt });
    setAdjustingExpiryUser(null);
  }

  async function handleExtend(user: Customer, days: number) {
    const current = user.expires_at && !isExpired(user.expires_at) ? new Date(user.expires_at) : new Date();
    current.setDate(current.getDate() + days);
    try {
      await updateUser(user, { expires_at: current.toISOString() });
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
    total:     displayCustomers.length,
    active:    displayCustomers.filter(hasUnexpiredPaidAccess).length,
    expired:   displayCustomers.filter(isCustomerExpired).length,
    suspended: displayCustomers.filter(c => c.status === "suspended").length,
  }), [displayCustomers]);

  /* ── Filter ── */
  const filtered = useMemo(() => {
    let list = displayCustomers;
    if (statusTab === "online") list = list.filter(c => customerIsOnline(c, livePresenceByRouter, planMap));
    else if (statusTab === "active") list = list.filter(hasUnexpiredPaidAccess);
    else if (statusTab === "expired") list = list.filter(isCustomerExpired);
    else if (statusTab !== "all") list = list.filter(c => c.status === statusTab);
    if (typeFilter) list = list.filter(c => prepaidServiceType(c.type) === typeFilter);
    if (packageFilter === "none") {
      list = list.filter(c => customerPackageId(c, paymentMap) === null);
    } else if (packageFilter) {
      list = list.filter(c => String(customerPackageId(c, paymentMap)) === packageFilter);
    }
    if (routerFilter) {
      list = list.filter(c => {
        const planId = customerPackageId(c, paymentMap);
        return String(c.router_id ?? (planId ? planMap[planId]?.router_id : "") ?? "") === routerFilter;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.name   ?? "").toLowerCase().includes(q) ||
        (c.username ?? "").toLowerCase().includes(q) ||
        (c.pppoe_username ?? "").toLowerCase().includes(q) ||
        (c.phone  ?? "").includes(q) ||
        (c.email  ?? "").toLowerCase().includes(q) ||
        (c.ip_address ?? "").toLowerCase().includes(q) ||
        (c.mac_address ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [displayCustomers, statusTab, typeFilter, packageFilter, paymentMap, routerFilter, search, livePresenceByRouter, planMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / entries));
  const pageRows   = filtered.slice((page - 1) * entries, page * entries);

  /* ── Sync handler ── */
  async function handleSync() {
    if (syncBusyRef.current) return;
    if (!pickedRouter) return;
    const router = routers.find(r => String(r.id) === pickedRouter);
    if (!router) return;
    syncBusyRef.current = true;
    setSyncing(true);
    setSyncLogs([]);
    setShowSyncPicker(false);
    setSyncReport({ total: 0, processed: 0, users: [], routerName: router.name });
    const logs: string[] = [];
    const log = (m: string) => { logs.push(m); setSyncLogs([...logs]); };
    try {
      const result = await syncActiveAccountsToRouter({
        router,
        users: displayCustomers.map(customer => ({
          ...customer,
          plan_id: customerPackageId(customer, paymentMap) ?? customer.plan_id,
        })),
        plans,
        endpoint: apiUrl("/api/admin/sync/users"),
        adminId: ADMIN_ID,
        token: getAdminApiToken() || "",
        onLog: log,
        onProgress: (total, processed, users) => setSyncReport({
          total, processed, users, routerName: router.name,
        }),
      });
      setSyncReport({ ...result, routerName: router.name });
      void qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
      const routerIndex = routers.findIndex(item => item.id === router.id);
      if (routerIndex >= 0) void liveQueries[routerIndex]?.refetch();
    } catch (error) {
      setSyncReport(previous => previous ? {
        ...previous,
        error: error instanceof Error ? error.message : "Sync could not be completed.",
      } : null);
    } finally {
      syncBusyRef.current = false;
      setSyncing(false);
    }
  }

  /* ── Export CSV ── */
  function exportCSV() {
    const header = "Name,Username / IP,Phone,Type,Plan,Status,Expires";
    const rows   = filtered.map(c => [
      c.name ?? "", c.username ?? c.pppoe_username ?? c.ip_address ?? "", c.phone ?? "",
      c.type ?? "", customerPackageId(c, paymentMap)
        ? (planMap[customerPackageId(c, paymentMap)!]?.name ?? `Plan #${customerPackageId(c, paymentMap)}`)
        : "",
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
    background: "#fff",
    border: "1px solid #cbd5e1", borderRadius: 5,
    padding: "0.48rem 0.7rem", color: "#1e293b",
    fontSize: "0.82rem", fontFamily: "inherit", outline: "none",
  };
  const TH: React.CSSProperties = {
    padding: "0.5rem 0.58rem", fontSize: "0.68rem", fontWeight: 600,
    color: "var(--isp-text-muted)", textTransform: "uppercase",
    letterSpacing: "0.06em", textAlign: "left",
    background: "var(--isp-section)",
    borderBottom: "1px solid var(--isp-border)",
    borderRight: "1px solid var(--isp-border)",
  };
  const TD: React.CSSProperties = {
    padding: "0.32rem 0.58rem", fontSize: "0.74rem", lineHeight: 1.2,
    color: "var(--isp-text)", borderBottom: "1px solid var(--isp-border)",
    verticalAlign: "middle",
  };

  const TABS: { key: StatusFilter; label: string; count: number; color: string }[] = [
    { key: "all",       label: "All",       count: stats.total,     color: "#94a3b8" },
    { key: "active",    label: "Active",    count: stats.active,    color: "#4ade80" },
    { key: "expired",   label: "Expired",   count: stats.expired,   color: "#f87171" },
    { key: "suspended", label: "Suspended", count: stats.suspended, color: "#fbbf24" },
    { key: "online",    label: "Online",    count: displayCustomers.filter(c => customerIsOnline(c, livePresenceByRouter, planMap)).length, color: "#22c55e" },
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
        .prepaid-toolbar-card{position:relative;background:var(--isp-card);border:1px solid var(--isp-border);border-radius:8px;padding:12px;box-shadow:var(--shadow-card)}
        .prepaid-filter-grid{display:grid;grid-template-columns:minmax(260px,2fr) minmax(160px,1fr) minmax(100px,.65fr) minmax(160px,1fr);gap:10px;align-items:end}
        .prepaid-filter-field{display:flex;flex-direction:column;gap:5px;min-width:0}
        .prepaid-filter-label{color:var(--isp-text-muted);font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
        .prepaid-search-control{display:flex;min-width:0}
        .prepaid-search-control input{width:100%;min-width:0;border-radius:5px 0 0 5px!important;border-right:0!important}
        .prepaid-search-control button{border:1px solid var(--isp-accent);border-radius:0 5px 5px 0;background:var(--isp-accent);color:#fff;padding:0 15px;font:600 .76rem inherit;cursor:pointer}
        .prepaid-search-control button:hover{background:var(--isp-accent-strong)}
        .prepaid-recharge-wrap{display:flex;min-width:0}
        .prepaid-recharge-button{width:100%;min-height:34px;border:1px solid #007bef;border-radius:5px;background:#007bef;color:#fff;padding:0 12px;font:700 .76rem inherit;cursor:pointer}
        .prepaid-recharge-button:hover{background:#006ddd}
        .prepaid-recharge-picker{position:absolute;right:12px;top:74px;z-index:60;width:min(290px,calc(100% - 24px));padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:5px;box-shadow:0 10px 25px rgba(15,23,42,.15)}
        .prepaid-recharge-picker select{width:100%;margin-bottom:8px}
        .prepaid-recharge-picker button{width:100%;border:0;border-radius:4px;background:#007bef;color:#fff;padding:8px;font:700 .74rem inherit;cursor:pointer}
        .prepaid-recharge-picker button:disabled{opacity:.45;cursor:not-allowed}
        .prepaid-secondary-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--isp-border)}
        .prepaid-status-tabs{display:flex;gap:2px;background:var(--isp-section);border:1px solid var(--isp-border);border-radius:5px;padding:3px}
        .prepaid-status-tabs button{border:0;border-radius:3px;background:transparent;padding:5px 9px;color:var(--isp-text-muted);font:400 .72rem inherit;cursor:pointer}
        .prepaid-status-tabs button.active{background:var(--isp-card);color:var(--isp-accent);box-shadow:0 1px 2px rgba(15,23,42,.08)}
        .prepaid-table-shell{background:var(--isp-card)!important;border:1px solid var(--isp-border)!important;border-radius:8px!important;box-shadow:var(--shadow-card)}
        .prepaid-table-shell tbody tr{background:var(--isp-card)}
        .prepaid-table-shell tbody tr:hover{background:var(--isp-hover)}
        .prepaid-table-shell tbody tr.prepaid-row-expired{box-shadow:inset 5px 0 0 #ef4444}
        .prepaid-table-shell tbody tr.prepaid-row-expired>td{background:color-mix(in srgb,var(--isp-card) 78%,#ef4444);border-bottom-color:rgba(239,68,68,.38)}
        .prepaid-table-shell tbody tr.prepaid-row-expired:hover>td{background:color-mix(in srgb,var(--isp-hover) 70%,#ef4444)}
        .prepaid-table-shell tbody td{border-right:1px solid var(--isp-border)}
        .prepaid-table-shell .prepaid-table th,.prepaid-table-shell .prepaid-table td{white-space:nowrap}
        .prepaid-username-link{display:block;max-width:170px;overflow:hidden;text-overflow:ellipsis;border:0;background:transparent;color:var(--isp-accent);padding:0;font:400 .76rem var(--font-mono);white-space:nowrap;cursor:pointer;text-align:left}
        .prepaid-username-link:hover{text-decoration:underline;color:var(--isp-accent-strong)}
        .prepaid-plain-value{font-weight:400;color:var(--isp-text);white-space:nowrap}
        .prepaid-plain-muted{font-weight:400;color:var(--isp-text-muted);white-space:nowrap}
        .prepaid-cell-ellipsis{display:block;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .prepaid-table-date{font-size:.69rem;font-variant-numeric:tabular-nums;white-space:nowrap}
        .prepaid-plain-status{font-weight:400;color:var(--isp-text);white-space:nowrap}
        .prepaid-plain-status::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;background:var(--isp-text-sub)}
        .prepaid-plain-status--online::before{background:var(--isp-green)}
        .prepaid-plain-status--offline::before{background:#c66b5f}
        .prepaid-table-shell tbody tr.prepaid-row-expired .prepaid-plain-status{color:#ef4444}
        .prepaid-table-shell tbody tr.prepaid-row-expired .prepaid-plain-status::before{background:#ef4444}
        .prepaid-table-shell th,.prepaid-table-shell td{border-right:1px solid var(--isp-border)}
        .prepaid-reconnect-report{border:1px solid var(--isp-accent-border);border-radius:10px;background:color-mix(in srgb,var(--isp-card) 94%,var(--isp-accent));padding:12px 14px}
        .prepaid-reconnect-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}
        .prepaid-reconnect-count{border:1px solid var(--isp-border);border-radius:7px;background:var(--isp-inner-card);padding:8px 10px;min-width:0}
        .prepaid-reconnect-count strong{display:block;font-size:1rem;color:var(--isp-text)}
        .prepaid-reconnect-count span{display:block;margin-top:2px;color:var(--isp-text-muted);font-size:.66rem;line-height:1.3}
        .prepaid-reconnect-progress{height:5px;margin-top:10px;border-radius:8px;overflow:hidden;background:var(--isp-border)}
        .prepaid-reconnect-progress span{display:block;height:100%;background:var(--isp-accent);transition:width .2s ease}
        .prepaid-reconnect-detail{margin:8px 0 0;color:var(--isp-text-muted);font-size:.72rem;line-height:1.45}
        .prepaid-reconnect-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:27px;padding:4px 8px;border:1px solid var(--isp-accent-border);border-radius:6px;background:var(--isp-accent-glow);color:var(--isp-accent-strong);font:700 .68rem inherit;cursor:pointer;white-space:nowrap}
        .prepaid-reconnect-button:hover:not(:disabled){background:var(--isp-accent);color:#fff}
        .prepaid-reconnect-button:disabled{opacity:.55;cursor:wait}
        .prepaid-action-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:27px;padding:4px 7px;border:1px solid var(--isp-border);border-radius:6px;background:var(--isp-inner-card);font:700 .66rem inherit;cursor:pointer;white-space:nowrap}
        .prepaid-action-button:disabled{opacity:.48;cursor:not-allowed}
        .prepaid-action-button:focus-visible{outline:2px solid var(--isp-accent);outline-offset:2px}
        .prepaid-action-button:hover:not(:disabled){filter:brightness(1.1)}
        .prepaid-action-button--extend{border-color:rgba(192,132,252,.45);background:rgba(192,132,252,.1);color:#c084fc}
        .prepaid-action-button--pause{border-color:rgba(245,158,11,.45);background:rgba(245,158,11,.1);color:#d97706}
        .prepaid-action-button--resume{border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1);color:#16a34a}
        .prepaid-reconnect-button:focus-visible{outline:2px solid var(--isp-accent);outline-offset:2px}
        @media(max-width:1150px){.prepaid-table-shell .prepaid-col-optional{display:none}.prepaid-table-shell table{min-width:820px!important}}
        @media(max-width:900px){.prepaid-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:520px){.prepaid-filter-grid{grid-template-columns:1fr}.prepaid-recharge-picker{position:static;width:auto;margin-top:10px}}
        @media(max-width:680px){.prepaid-form-grid{grid-template-columns:1fr}.prepaid-table-shell{margin-right:-16px;border-right:0;border-radius:10px 0 0 10px}}
        @media(max-width:600px){.prepaid-reconnect-counts{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>

      {actionError && (
        <div role="alert" style={{ marginBottom: "1rem", padding: "0.7rem 0.9rem", borderRadius: 8, color: "#fca5a5", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError("")} style={{ ...iconButton("#f87171"), flexShrink: 0 }} aria-label="Dismiss error"><X size={13} /></button>
        </div>
      )}
      {actionNotice && (
        <div role="status" style={{ marginBottom: "1rem", padding: "0.7rem 0.9rem", borderRadius: 8, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice("")} style={{ ...iconButton("#16a34a"), flexShrink: 0 }} aria-label="Dismiss update notice"><X size={13} /></button>
        </div>
      )}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          plans={plans}
          routers={routers}
          onClose={() => setEditingUser(null)}
          onSave={updates => updateUser(editingUser, updates)}
        />
      )}
      {addingVlanUser && (
        <AddVlanPrepaidDialog
          plans={plans}
          routers={routers}
          onClose={() => setAddingVlanUser(false)}
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
            setActionError("");
            setActionNotice("VLAN prepaid user added and applied to the existing VLAN service.");
          }}
        />
      )}
      {adjustingExpiryUser && (
        <AdjustExpiryDialog
          user={adjustingExpiryUser}
          onClose={() => setAdjustingExpiryUser(null)}
          onSave={expiresAt => handleAdjustExpiry(adjustingExpiryUser, expiresAt)}
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
              Manage prepaid access and sync router issues without interrupting valid online sessions. Sync results list only accounts confirmed active on MikroTik.
            </p>
          </div>

          <span
            role="status"
            title="The production API checks eligible Hotspot accounts automatically; the Prepaid Users page does not need to stay open."
            style={{
              ...BTN("color-mix(in srgb,var(--isp-green) 12%,var(--isp-card))", "var(--isp-green)"),
              borderColor: "color-mix(in srgb,var(--isp-green) 42%,var(--isp-border))",
              cursor: "default",
            }}
          >
            <RotateCw size={13} /> Server-managed reconnect
          </span>

          <button
            type="button"
            onClick={() => void reconnectAllEligible()}
            disabled={reconnectEligibleUsers.length === 0 || Boolean(reconnectProgress?.running)}
            title="Manually retry all eligible disconnected Hotspot devices. The batch is limited to one device per router at a time."
            aria-label={`Manually reconnect all ${reconnectEligibleUsers.length} eligible disconnected Hotspot devices`}
            style={{
              ...BTN(reconnectEligibleUsers.length > 0 && !reconnectProgress?.running ? "var(--isp-accent)" : "rgba(255,255,255,0.06)"),
              opacity: reconnectEligibleUsers.length === 0 || reconnectProgress?.running ? 0.6 : 1,
              cursor: reconnectEligibleUsers.length === 0 || reconnectProgress?.running ? "not-allowed" : "pointer",
            }}
          >
            {reconnectProgress?.running
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <RotateCw size={13} />}
            Reconnect all offline ({reconnectEligibleUsers.length})
          </button>

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
                      {r.name} · {r.status === "online" ? "Online" : "Offline"}
                    </option>
                  ))}
                </select>
                <p style={{ margin: "0 0 0.65rem", fontSize: "0.72rem", lineHeight: 1.5, color: "var(--isp-text-muted)" }}>
                  Only active prepaid accounts on this router are synced. Expired, suspended, and data-depleted accounts are excluded.
                </p>
                <button onClick={handleSync} disabled={!pickedRouter || syncing}
                  style={{ ...BTN(pickedRouter ? "var(--isp-accent)" : "rgba(255,255,255,0.06)"), width: "100%", justifyContent: "center" }}>
                  {syncing ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={12} />}
                  Sync active accounts
                </button>
              </div>
            )}
          </div>

           <button onClick={exportCSV} style={BTN("var(--isp-accent)")}>
            <Download size={13} /> Export CSV
          </button>

          <button onClick={() => qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] })}
            style={BTN("rgba(255,255,255,0.06)", "var(--isp-text-muted)")}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setAddingVlanUser(true)}
            title="Add a prepaid user to an existing VLAN service"
            style={{
              ...BTN("var(--isp-accent)"),
              ...(!plans.some(plan => plan.type === "vlan" && plan.router_id != null && plan.port_id != null && plan.is_active === true)
                ? { opacity: 0.65 }
                : {}),
            }}
          >
            <PlusCircle size={13} /> Add VLAN user
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

        {reconnectProgress && (
          <section className="prepaid-reconnect-report" aria-labelledby="prepaid-reconnect-title" aria-live="polite">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h2 id="prepaid-reconnect-title" style={{ margin: 0, fontSize: ".82rem", fontWeight: 800, color: "var(--isp-text)" }}>
                  {reconnectProgress.running
                    ? "Reconnecting Hotspot devices"
                    : "Reconnect attempt complete"}
                </h2>
                <p style={{ margin: "3px 0 0", color: "var(--isp-text-muted)", fontSize: ".7rem" }}>
                  {reconnectProgress.completed} of {reconnectProgress.total} canonical account{reconnectProgress.total === 1 ? "" : "s"} processed
                  {reconnectProgress.running ? " · applying router access and connection" : ""}
                </p>
              </div>
              {!reconnectProgress.running && (
                <button type="button" onClick={() => setReconnectProgress(null)} style={iconButton("#64748b")} aria-label="Dismiss reconnect results">
                  <X size={13} />
                </button>
              )}
            </div>
            {reconnectProgress.running && (
              <div
                className="prepaid-reconnect-progress"
                role="progressbar"
                aria-label="Hotspot reconnect progress"
                aria-valuemin={0}
                aria-valuemax={reconnectProgress.total}
                aria-valuenow={reconnectProgress.completed}
              >
                <span style={{ width: `${reconnectProgress.total ? reconnectProgress.completed / reconnectProgress.total * 100 : 0}%` }} />
              </div>
            )}
            <div className="prepaid-reconnect-counts">
              <div className="prepaid-reconnect-count"><strong>{reconnectOutcomes.connected}</strong><span>Connected / already connected</span></div>
              <div className="prepaid-reconnect-count"><strong>{reconnectOutcomes.notVisible}</strong><span>Device not visible on router</span></div>
              <div className="prepaid-reconnect-count"><strong>{reconnectOutcomes.notEligible}</strong><span>Not eligible, quota, or session limit</span></div>
              <div className="prepaid-reconnect-count"><strong>{reconnectOutcomes.routerErrors}</strong><span>Router errors</span></div>
            </div>
            {reconnectProgress.results.length > 0 && (
              <p className="prepaid-reconnect-detail">
                Latest result: {reconnectProgress.results[reconnectProgress.results.length - 1].message}
              </p>
            )}
          </section>
        )}

        {syncReport && (
          <PrepaidSyncReport
            {...syncReport}
            running={syncing}
            logs={syncLogs ?? []}
            onDismiss={() => { setSyncReport(null); setSyncLogs(null); }}
          />
        )}

        {/* ── Compact filter toolbar ── */}
        <div className="prepaid-toolbar-card">
          <div className="prepaid-filter-grid">
            <label className="prepaid-filter-field">
              <span className="prepaid-filter-label">Username / IP Search</span>
              <span className="prepaid-search-control">
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search name, username, IP, phone…"
                  style={INPUT} />
                <button type="button" onClick={() => setPage(1)}>Search</button>
              </span>
            </label>

            <label className="prepaid-filter-field">
              <span className="prepaid-filter-label">Router</span>
              <select value={routerFilter} onChange={e => { setRouterFilter(e.target.value); setPage(1); }}
                style={{ ...INPUT, cursor: "pointer" }}>
                <option value="">All routers</option>
                {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
              </select>
            </label>

            <label className="prepaid-filter-field">
              <span className="prepaid-filter-label">Entries</span>
              <select value={entries} onChange={e => { setEntries(Number(e.target.value)); setPage(1); }}
                style={{ ...INPUT, cursor: "pointer" }}>
                {[10, 20, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>

            <div className="prepaid-recharge-wrap">
              <button type="button" className="prepaid-recharge-button" onClick={() => setRechargePickerOpen(open => !open)}>
                + Recharge Account
              </button>
            </div>
          </div>

          {rechargePickerOpen && (
            <div className="prepaid-recharge-picker">
              <select value={rechargeTargetId} onChange={event => setRechargeTargetId(event.target.value)} style={INPUT}>
                <option value="">Choose an account to recharge</option>
                {filtered.map(user => <option key={user.id} value={user.id}>{purchaseUsername(user)} — {user.name || "Unnamed"}</option>)}
              </select>
              <button type="button" disabled={!rechargeTargetId} onClick={() => {
                const target = displayCustomers.find(user => user.id === Number(rechargeTargetId));
                if (target) {
                  setExtendingUser(target);
                  setRechargePickerOpen(false);
                }
              }}>
                Continue to recharge
              </button>
            </div>
          )}

          <div className="prepaid-secondary-filters">
            {/* Status tabs */}
            <div className="prepaid-status-tabs">
            {TABS.map(t => (
              <button key={t.key} className={statusTab === t.key ? "active" : undefined} onClick={() => { setStatusTab(t.key); setPage(1); }}
                style={{
                  color: statusTab === t.key ? t.color : undefined,
                }}>
                {t.label}
                <span style={{
                  marginLeft: "0.35rem", fontSize: "0.6rem", fontWeight: 700,
                  background: statusTab === t.key ? "#e0f2fe" : "#f1f5f9",
                  padding: "0.1rem 0.4rem", borderRadius: 3,
                  color: statusTab === t.key ? t.color : "#64748b",
                }}>
                  {t.count}
                </span>
              </button>
            ))}
            </div>

            <div style={{ position: "relative" }}>
              <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                style={{ ...INPUT, paddingRight: "1.75rem", cursor: "pointer", appearance: "none" }}>
                <option value="">All types</option>
                <option value="hotspot">Hotspot</option>
                <option value="pppoe">PPPoE</option>
                <option value="static">Static IP</option>
                <option value="vlan">VLAN</option>
              </select>
              <Filter size={11} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", color: "#64748b", pointerEvents: "none" }} />
            </div>
            <select
              aria-label="Filter by package"
              title="Filter by package"
              value={packageFilter}
              onChange={event => { setPackageFilter(event.target.value); setPage(1); }}
              style={{ ...INPUT, minWidth: 170, maxWidth: 280, cursor: "pointer" }}
            >
              <option value="">All packages</option>
              {hasUnassignedPackage && <option value="none">No package</option>}
              {packageOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Table ── */}
        <div id="prepaid-users-table" className="prepaid-table-shell" style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 10, overflowX: "auto" }}>
             <table className="prepaid-table" style={{ width: "100%", minWidth: 1160, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={TH}>User / IP</th>
                <th style={TH}>Type</th>
                <th style={TH}>Plan</th>
                 <th className="prepaid-col-optional" style={TH}>Created (date &amp; time)</th>
                <th style={TH}>Expires (date &amp; time)</th>
                 <th className="prepaid-col-optional" style={TH}>Method</th>
                <th style={TH}>Router</th>
                <th style={TH}>Plan status</th>
                <th style={TH}>Internet connection</th>
                 <th className="prepaid-col-optional" style={TH}>Last seen</th>
                 <th className="prepaid-col-optional" style={TH}>Data used</th>
                 <th className="prepaid-col-optional" style={TH}>FUP</th>
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
                    {search || typeFilter || packageFilter || statusTab !== "all"
                      ? "No users match this filter."
                      : "No prepaid users yet. Add a VLAN user here, or add Hotspot, PPPoE, and Static customers from the Customers section."}
                  </td>
                </tr>
              ) : (
                pageRows.map(user => {
                  const packageId = customerPackageId(user, paymentMap);
                  const plan   = packageId ? planMap[packageId] : null;
                  const routerId = user.router_id ?? plan?.router_id ?? null;
                  const router = routerId ? routerMap[routerId] : null;
                  const payment = paymentMap[user.id];
                  const displayedPlan = plan;
                  const username = purchaseUsername(user);
                  const online = customerIsOnline(user, livePresenceByRouter, planMap);
                  const fup = user.fup_limit_mb ?? plan?.data_limit_mb ?? null;
                  const expired  = isCustomerExpired(user);
                  const planStatus = expired
                    ? "Expired"
                    : user.status === "suspended"
                      ? "Suspended"
                      : hasUnexpiredPaidAccess(user)
                        ? "Active"
                        : user.status === "pending"
                          ? "Pending"
                          : "Inactive";
                  const usageBytes = customerUsageBytes(user, liveUsage);
                  return (
                    <tr key={user.id}
                       className={expired ? "prepaid-row-expired" : undefined}
                      style={{ transition: "background 0.1s" }}
                    >
                      <td style={TD}>
                        <button type="button" className="prepaid-username-link" onClick={() => setDetailUser(user)} title={`View ${username}`}>
                          {username}
                        </button>
                      </td>
                      <td style={TD}><span className="prepaid-plain-value">{TYPE_META[user.type ?? ""]?.label ?? user.type ?? "—"}</span></td>
                      <td style={TD}>
                        <div className="prepaid-plain-value prepaid-cell-ellipsis" title={displayedPlan?.name || (packageId ? `Plan #${packageId}` : "No plan")}>
                          {displayedPlan?.name || (packageId ? `Plan #${packageId}` : "No plan")}
                        </div>
                      </td>
                      <td className="prepaid-col-optional" style={{ ...TD, fontVariantNumeric: "tabular-nums" }} title={fmtDate(user.created_at)}>
                        <span className="prepaid-table-date">{fmtTableDateTime(user.created_at)}</span>
                      </td>
                      <td style={TD}>
                        <span title={fmtDate(user.expires_at)} className="prepaid-table-date" style={{ fontWeight: 600, color: expired ? "#ef4444" : "var(--isp-text-muted)" }}>
                          {fmtTableDateTime(user.expires_at)}
                        </span>
                      </td>
                      <td className="prepaid-col-optional" style={{ ...TD, minWidth: 180, maxWidth: 220 }}>
                        <span className="prepaid-plain-muted prepaid-cell-ellipsis" title={paymentLabel(payment)} style={{ fontSize: "0.7rem" }}>
                          {paymentLabel(payment)}
                        </span>
                      </td>
                      <td style={TD}>
                        {router ? (
                           <span className="prepaid-plain-muted prepaid-cell-ellipsis" title={router.name}>{router.name}</span>
                        ) : (
                          <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>Unassigned</span>
                        )}
                      </td>
                      <td style={TD}><span className="prepaid-plain-status">{planStatus}</span></td>
                      <td style={TD}>
                        <span
                          className={`prepaid-plain-status ${online ? "prepaid-plain-status--online" : "prepaid-plain-status--offline"}`}
                          title="Based on the latest RouterOS session; the last saved status is kept while the router is loading or unavailable."
                        >
                          {online ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td className="prepaid-col-optional" style={{ ...TD, fontSize: "0.68rem", fontVariantNumeric: "tabular-nums" }}>{online ? "Online" : fmtTableDateTime(user.last_seen ?? (expired ? user.expires_at : null))}</td>
                      <td className="prepaid-col-optional" style={{ ...TD, whiteSpace: "nowrap" }}>
                         <span className="prepaid-plain-muted" title={usageBytes === null ? undefined : `${Math.floor(usageBytes).toLocaleString("en-US")} bytes`}>
                           {formatUsageBytes(usageBytes)}
                         </span>
                      </td>
                        <td className="prepaid-col-optional" style={{ ...TD, whiteSpace: "nowrap", fontSize: "0.72rem" }}>
                          <span className="prepaid-plain-muted">{fup !== null && Number(fup) > 0 ? "Enabled" : "Disabled"}</span>
                       </td>
                      <td style={{ ...TD, textAlign: "center" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {reconnectEligibleIds.has(user.id) && (
                            <button
                              type="button"
                              className="prepaid-reconnect-button"
                              title="Reconnect this entitled Hotspot device"
                              aria-label={`Reconnect Hotspot device for ${username}`}
                              onClick={() => void reconnectOne(user)}
                              disabled={reconnectingIds.has(user.id) || Boolean(reconnectProgress?.running) || actionBusy === user.id}
                            >
                              {reconnectingIds.has(user.id) ? <Loader2 size={12} className="prepaid-spin" /> : <RotateCw size={12} />}
                              <span className="prepaid-reconnect-label">Reconnect</span>
                            </button>
                          )}
                          <button title="Edit user" aria-label={`Edit ${username}`} onClick={() => setEditingUser(user)} disabled={actionBusy === user.id}
                            style={{ ...iconButton("#60a5fa"), opacity: actionBusy === user.id ? 0.5 : 1 }}><Edit3 size={13} /></button>
                          <button type="button" title="Extend access" aria-label={`Extend ${username}`} onClick={() => setExtendingUser(user)} disabled={actionBusy === user.id}
                            className="prepaid-action-button prepaid-action-button--extend"><PlusCircle size={12} /><span>Extend</span></button>
                          <button title="Adjust access time" aria-label={`Adjust access time for ${username}`} onClick={() => setAdjustingExpiryUser(user)} disabled={actionBusy === user.id}
                            style={iconButton("#a78bfa")}><CalendarDays size={13} /></button>
                          <button
                            type="button"
                            title={user.status === "suspended" ? "Resume this user's access" : "Pause this user's access"}
                            aria-label={`${user.status === "suspended" ? "Resume" : "Pause"} ${username}`}
                            onClick={() => {
                              const resume = user.status === "suspended";
                              const nextStatus = resume ? "active" : "suspended";
                              const action = resume ? "Resume" : "Pause";
                              const explanation = resume
                                ? "Access will return only if the plan is still valid and has remaining data."
                                : "This suspends the account and disconnects its active session; it does not extend the plan.";
                              if (window.confirm(`${action} ${username}? ${explanation}`)) {
                                void handleStatus(user, nextStatus);
                              }
                            }}
                            disabled={actionBusy === user.id || isCustomerExpired(user) || !["active", "suspended"].includes(user.status)}
                            className={`prepaid-action-button ${user.status === "suspended" ? "prepaid-action-button--resume" : "prepaid-action-button--pause"}`}
                          >
                            {user.status === "suspended" ? <CheckCircle2 size={12} /> : <Power size={12} />}
                            <span>{user.status === "suspended" ? "Resume" : "Pause"}</span>
                          </button>
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
                  {detailUser.name || detailUser.ip_address || detailUser.username || `User #${detailUser.id}`}
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
                { icon: <Users size={13} />,       label: detailUser.type === "vlan" ? "VLAN identity" : "Username", value: detailUser.type === "vlan" ? detailUser.ip_address || "—" : detailUser.pppoe_username || detailUser.username || "—" },
                { icon: <Phone size={13} />,       label: "Phone",      value: detailUser.phone || "—" },
                { icon: <Mail  size={13} />,       label: "Email",      value: detailUser.email || "—" },
                { icon: <Server size={13} />,      label: "IP Address", value: detailUser.ip_address || "—" },
                { icon: <Wifi  size={13} />,       label: "MAC",        value: detailUser.mac_address || "—" },
                { icon: <CalendarDays size={13} />,label: "Expires",    value: fmtDate(detailUser.expires_at) },
                { icon: <CalendarDays size={13} />,label: "Created",    value: fmtDate(detailUser.created_at) },
                { icon: <Network size={13} />,     label: "Data Used",  value: formatUsageBytes(customerUsageBytes(detailUser, liveUsage)) },
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
