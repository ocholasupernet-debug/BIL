import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─── Auth helpers ─── */
function _getStoredAdminId(): number {
  try { const v = localStorage.getItem("ochola_admin_id"); return v ? parseInt(v) : 5; } catch { return 5; }
}

export let ADMIN_ID: number = _getStoredAdminId();

export function setAdminAuth(id: number, username: string, name: string) {
  ADMIN_ID = id;
  try {
    localStorage.setItem("ochola_admin_id", String(id));
    localStorage.setItem("ochola_admin_username", username);
    localStorage.setItem("ochola_admin_name", name);
    window.dispatchEvent(new CustomEvent("ochola-auth-change", { detail: { id } }));
  } catch {}
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
  model: string | null;
  ros_version: string | null;
  status: string;
  last_seen: string | null;
  router_username: string;
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
