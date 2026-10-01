CREATE TABLE IF NOT EXISTS public.isp_admin_router_page_passwords (
  admin_id bigint PRIMARY KEY REFERENCES public.isp_admins(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.isp_admin_router_page_passwords ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.isp_admin_router_page_passwords FROM anon;
REVOKE ALL ON TABLE public.isp_admin_router_page_passwords FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.isp_admin_router_page_passwords TO service_role;