BEGIN;

CREATE TABLE IF NOT EXISTS public.isp_radius_vouchers (
  id bigserial PRIMARY KEY,
  admin_id bigint NOT NULL REFERENCES public.isp_admins(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  plan_id bigint REFERENCES public.isp_plans(id) ON DELETE SET NULL,
  plan_name text NOT NULL,
  router_id bigint,
  router_name text NOT NULL DEFAULT 'Any',
  price numeric(12, 2) NOT NULL DEFAULT 0,
  validity_mins integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS isp_radius_vouchers_admin_created_idx
  ON public.isp_radius_vouchers(admin_id, created_at DESC);

ALTER TABLE public.isp_radius_vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.isp_radius_vouchers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.isp_radius_vouchers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.isp_radius_vouchers_id_seq TO service_role;

COMMENT ON TABLE public.isp_radius_vouchers IS
  'Tenant-owned index for hotspot voucher credentials stored in the shared FreeRADIUS tables.';

-- Safely claim legacy vouchers only when their RouterOS router or uniquely named
-- plan identifies one owning ISP account. Ambiguous vouchers remain unassigned.
WITH attributes AS (
  SELECT
    username,
    count(*) FILTER (WHERE attribute = 'Cleartext-Password') AS password_count,
    count(*) FILTER (WHERE attribute = 'Isp-Router-Id') AS router_id_count,
    min(value) FILTER (WHERE attribute = 'Isp-Router-Id') AS router_id_value,
    count(*) FILTER (WHERE attribute = 'Isp-Router-Name') AS router_name_count,
    min(value) FILTER (WHERE attribute = 'Isp-Router-Name') AS router_name_value,
    count(*) FILTER (WHERE attribute = 'Isp-Plan-Name') AS plan_name_count,
    min(value) FILTER (WHERE attribute = 'Isp-Plan-Name') AS plan_name,
    count(*) FILTER (WHERE attribute = 'Isp-Price') AS price_count,
    min(value) FILTER (WHERE attribute = 'Isp-Price') AS price_value,
    count(*) FILTER (WHERE attribute = 'Isp-Validity-Mins') AS validity_count,
    min(value) FILTER (WHERE attribute = 'Isp-Validity-Mins') AS validity_value,
    count(*) FILTER (WHERE attribute = 'Isp-Created-At') AS created_count,
    min(value) FILTER (WHERE attribute = 'Isp-Created-At') AS created_value,
    count(*) FILTER (WHERE attribute = 'Expiration') AS expiry_count,
    min(value) FILTER (WHERE attribute = 'Expiration') AS expiry_value
  FROM public.radcheck
  GROUP BY username
  HAVING count(*) FILTER (WHERE attribute = 'Cleartext-Password') = 1
),
plan_owners AS (
  SELECT
    name,
    min(id) AS plan_id,
    min(admin_id) AS admin_id,
    count(*) AS plan_count,
    count(DISTINCT admin_id) AS admin_count
  FROM public.isp_plans
  GROUP BY name
),
resolved AS (
  SELECT
    a.*,
    r.id AS resolved_router_id,
    r.admin_id AS router_admin_id,
    r.name AS resolved_router_name,
    p.plan_id AS candidate_plan_id,
    p.admin_id AS plan_admin_id,
    p.plan_count,
    p.admin_count,
    CASE
      WHEN a.router_id_count = 1 AND a.router_id_value ~ '^[1-9][0-9]{0,17}$'
        THEN r.admin_id
      WHEN a.router_id_count = 0
        OR (a.router_id_count = 1 AND a.router_id_value = '0')
        THEN CASE WHEN p.admin_count = 1 THEN p.admin_id END
      ELSE NULL
    END AS owner_admin_id
  FROM attributes a
  LEFT JOIN public.isp_routers r
    ON a.router_id_count = 1
   AND r.id = CASE
     WHEN a.router_id_value ~ '^[1-9][0-9]{0,17}$'
       THEN a.router_id_value::bigint
     ELSE NULL
   END
  LEFT JOIN plan_owners p
    ON a.plan_name_count = 1
   AND p.name = a.plan_name
)
INSERT INTO public.isp_radius_vouchers (
  admin_id, code, plan_id, plan_name, router_id, router_name,
  price, validity_mins, expires_at, created_at
)
SELECT
  owner_admin_id,
  username,
  CASE
    WHEN plan_count = 1 AND admin_count = 1 AND plan_admin_id = owner_admin_id
      THEN candidate_plan_id
    ELSE NULL
  END,
  plan_name,
  resolved_router_id,
  COALESCE(NULLIF(router_name_value, ''), resolved_router_name, 'Any'),
  CASE
    WHEN price_count = 1 AND price_value ~ '^[0-9]+(\.[0-9]+)?$'
      THEN price_value::numeric(12, 2)
    ELSE 0
  END,
  CASE
    WHEN validity_count = 1 AND validity_value ~ '^[0-9]{1,9}$'
      THEN validity_value::integer
    ELSE 0
  END,
  CASE
    WHEN expiry_count = 1 AND expiry_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN expiry_value::date::timestamptz
    ELSE NULL
  END,
  CASE
    WHEN created_count = 1 AND created_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN created_value::timestamptz
    ELSE now()
  END
FROM resolved
WHERE owner_admin_id IS NOT NULL
  AND plan_name_count = 1
  AND NULLIF(plan_name, '') IS NOT NULL
  AND router_id_count <= 1
  AND router_name_count = 1
  AND price_count = 1
  AND validity_count = 1
  AND created_count = 1
  AND expiry_count <= 1
ON CONFLICT (code) DO NOTHING;

COMMIT;