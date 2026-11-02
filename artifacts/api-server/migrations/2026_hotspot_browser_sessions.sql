CREATE TABLE IF NOT EXISTS public.isp_hotspot_browser_sessions (
  token_hash text PRIMARY KEY,
  customer_id bigint NOT NULL,
  admin_id bigint NOT NULL,
  router_id bigint NOT NULL,
  port_id bigint,
  current_mac_address text,
  current_ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS isp_hotspot_browser_sessions_expiry_idx
  ON public.isp_hotspot_browser_sessions (expires_at);
CREATE INDEX IF NOT EXISTS isp_hotspot_browser_sessions_customer_scope_idx
  ON public.isp_hotspot_browser_sessions (customer_id, admin_id, router_id, port_id);

ALTER TABLE public.isp_hotspot_browser_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.isp_hotspot_browser_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.isp_hotspot_browser_sessions TO service_role;
