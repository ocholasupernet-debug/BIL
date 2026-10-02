CREATE TABLE IF NOT EXISTS public.isp_admin_page_passwords (
  admin_id bigint NOT NULL REFERENCES public.isp_admins(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature ~ '^[a-z0-9.-]+$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, feature)
);

ALTER TABLE public.isp_admin_page_passwords ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.isp_admin_page_passwords FROM anon;
REVOKE ALL ON TABLE public.isp_admin_page_passwords FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.isp_admin_page_passwords TO service_role;

INSERT INTO public.isp_admin_page_passwords (admin_id, feature, password_hash, created_at, updated_at)
SELECT admin_id, 'network.routers', password_hash, created_at, updated_at
FROM public.isp_admin_router_page_passwords
ON CONFLICT (admin_id, feature) DO NOTHING;