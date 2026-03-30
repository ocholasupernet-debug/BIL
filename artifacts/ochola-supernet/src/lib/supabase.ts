import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string) || "";

function makeClient() {
  try {
    if (SUPABASE_URL && SUPABASE_KEY) return createClient(SUPABASE_URL, SUPABASE_KEY);
    console.warn("[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_KEY not set — Supabase calls will be skipped.");
    return createClient("https://placeholder.supabase.co", "placeholder-anon-key");
  } catch (e) {
    console.warn("[supabase] createClient failed:", e);
    return createClient("https://placeholder.supabase.co", "placeholder-anon-key");
  }
}

export const supabase = makeClient();

/* ─── Auth helpers ─── */
function _getStoredAdminId(): number {
  try { const v = localStorage.getItem("ochola_admin_id"); return v ? parseInt(v) : 5; } catch { return 5; }
}

export let ADMIN_ID: number = _getStoredAdminId();

export function setAdminAuth(id: number, username: string, name: string, role?: string) {
  ADMIN_ID = id;
  try {
    localStorage.setItem("ochola_admin_id", String(id));
    localStorage.setItem("ochola_admin_username", username);
    localStorage.setItem("ochola_admin_name", name);
    if (role) localStorage.setItem("ochola_admin_role", role);
    window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id } }));
  } catch {}
}

export function getAdminRole(): string {
  try { return localStorage.getItem("ochola_admin_role") || "isp_admin"; } catch { return "isp_admin"; }
}

export function isSuperAdmin(): boolean {
  return getAdminRole() === "superadmin";
}

export function clearAdminAuth() {
  ADMIN_ID = 5;
  try {
    localStorage.removeItem("ochola_admin_id");
    localStorage.removeItem("ochola_admin_username");
    localStorage.removeItem("ochola_admin_name");
    window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id: null } }));
  } catch {}
}

export function getAdminName(): string {
  try { return localStorage.getItem("ochola_admin_name") || ""; } catch { return ""; }
}

export function isLoggedIn(): boolean {
  try { return !!localStorage.getItem("ochola_admin_id"); } catch { return false; }
}

/* ─── Impersonation helpers ─── */
export function startImpersonation(id: number, username: string, name: string) {
  try {
    // Save the impersonation marker so the admin layout can show the banner
    localStorage.setItem("ochola_impersonating", "true");
    localStorage.setItem("ochola_impersonate_name", name);
    localStorage.setItem("ochola_impersonate_username", username);
  } catch {}
  setAdminAuth(id, username, name);
}

export function stopImpersonation() {
  try {
    localStorage.removeItem("ochola_impersonating");
    localStorage.removeItem("ochola_impersonate_name");
    localStorage.removeItem("ochola_impersonate_username");
    localStorage.removeItem("ochola_admin_id");
    localStorage.removeItem("ochola_admin_username");
    localStorage.removeItem("ochola_admin_name");
  } catch {}
}

export function isImpersonating(): boolean {
  try { return localStorage.getItem("ochola_impersonating") === "true"; } catch { return false; }
}

export function getImpersonatedName(): string {
  try { return localStorage.getItem("ochola_impersonate_name") || ""; } catch { return ""; }
}

/* ─── Payment gateway preference ─── */
export const GATEWAY_OPTIONS: { id: string; label: string; emoji: string; color: string }[] = [
  { id: "mpesa",       label: "M-Pesa STK Push",   emoji: "🟢", color: "#00a651" },
  { id: "airtel",      label: "Airtel Money",       emoji: "🔴", color: "#ef4444" },
  { id: "stripe",      label: "Stripe",             emoji: "💳", color: "#635bff" },
  { id: "flutterwave", label: "Flutterwave",        emoji: "🦋", color: "#f5a623" },
  { id: "paypal",      label: "PayPal",             emoji: "🔵", color: "#003087" },
  { id: "pesalink",    label: "PesaLink",           emoji: "🏦", color: "#1d4ed8" },
  { id: "manual",      label: "Cash / Manual",      emoji: "💵", color: "#64748b" },
];

export function getPaymentGateway(): string {
  try { return localStorage.getItem("ochola_payment_gateway") || "mpesa"; } catch { return "mpesa"; }
}

export function setPaymentGateway(id: string): void {
  try { localStorage.setItem("ochola_payment_gateway", id); } catch {}
}

/* ─── isp_plans row shape ─── */
export interface DbPlan {
  id: number;
  admin_id: number;
  name: string;
  type: string;
  bandwidth_id: number | null;
  speed_down: number;
  speed_up: number;
  price: number;
  plan_type: string;
  validity: number;
  validity_unit: string;
  validity_days: number;
  data_limit_mb: number | null;
  burst_limit: string | null;
  shared_users: number;
  client_can_purchase: boolean;
  router_id: number | null;
  active_ip_pool: string | null;
  expired_ip_pool: string | null;
  static_ip_range: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/* ─── isp_routers row shape ─── */
export interface DbRouter {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  ip_address: string | null;
  bridge_ip: string | null;
  router_secret: string | null;
  router_username: string;
  description: string | null;
  model: string | null;
  serial: string | null;
  ros_version: string | null;
  status: string;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

/* ─── isp_transactions row shape ─── */
export interface DbTransaction {
  id: number;
  customer_id: number | null;
  plan_id: number | null;
  amount: number;
  payment_method: string;
  reference: string;
  status: string;
  notes: string | null;
  created_at: string;
}

/* ─── isp_customers row shape ─── */
export interface DbCustomer {
  id: number;
  admin_id: number;
  name: string | null;
  username: string | null;
  password: string | null;
  email: string | null;
  phone: string | null;
  type: string | null;           // 'hotspot' | 'pppoe' | 'static'
  plan_id: number | null;
  status: string;                // 'active' | 'expired' | 'suspended'
  ip_address: string | null;
  mac_address: string | null;
  pppoe_username: string | null;
  data_used_mb: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ─── isp_bandwidth row shape ─── */
export interface DbBandwidth {
  id: number;
  admin_id: number;
  name: string;
  speed_down: number;
  speed_up: number;
  speed_down_unit: string;
  speed_up_unit: string;
  burst_enabled: boolean;
  burst_down: number | null;
  burst_up: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
