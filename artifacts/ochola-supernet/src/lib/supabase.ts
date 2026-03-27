import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://lijposnfdhlrfwdmbpge.supabase.co";
const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpanBvc25mZGhscmZ3ZG1icGdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE0Njk3NiwiZXhwIjoyMDg5NzIyOTc2fQ.4P1-ePDpjbHTxxUfW0sMnyFHHYeK014SOl5QmpTKLUQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─── Shared admin id for this ISP instance ─── */
export const ADMIN_ID = 5;

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
