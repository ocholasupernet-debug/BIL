BEGIN;

CREATE TABLE IF NOT EXISTS public.isp_hotspot_mac_bypasses (
  id bigserial PRIMARY KEY,
  admin_id bigint NOT NULL REFERENCES public.isp_admins(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  mac_address text NOT NULL,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS isp_hotspot_mac_bypasses_admin_created_idx
  ON public.isp_hotspot_mac_bypasses(admin_id, created_at DESC);

ALTER TABLE public.isp_hotspot_mac_bypasses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.isp_hotspot_mac_bypasses FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.isp_hotspot_mac_bypasses TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.isp_hotspot_mac_bypasses_id_seq TO service_role;

COMMENT ON TABLE public.isp_hotspot_mac_bypasses IS
  'Tenant-owned index for MAC bypass credentials stored in the shared FreeRADIUS tables.';

-- Claim only legacy bypasses whose MAC maps to customers in exactly one ISP account.
-- Unknown and cross-account duplicate MACs remain unassigned.
WITH customer_macs AS (
  SELECT
    upper(regexp_replace(mac_address, '[^0-9A-F]', '', 'gi')) AS mac_key,
    min(admin_id) AS admin_id,
    count(DISTINCT admin_id) AS admin_count
  FROM public.isp_customers
  WHERE mac_address IS NOT NULL AND btrim(mac_address) <> ''
  GROUP BY upper(regexp_replace(mac_address, '[^0-9A-F]', '', 'gi'))
),
legacy_bypasses AS (
  SELECT
    username,
    upper(regexp_replace(substring(username FROM 8), '[^0-9A-F]', '', 'gi')) AS mac_key
  FROM public.radcheck
  WHERE attribute = 'Auth-Type'
    AND value = 'Accept'
    AND username ~* '^bypass:[0-9a-f-]+$'
  GROUP BY username
)
INSERT INTO public.isp_hotspot_mac_bypasses (
  admin_id, username, mac_address, ip_address
)
SELECT
  owners.admin_id,
  bypass.username,
  concat_ws(
    ':',
    substring(bypass.mac_key, 1, 2),
    substring(bypass.mac_key, 3, 2),
    substring(bypass.mac_key, 5, 2),
    substring(bypass.mac_key, 7, 2),
    substring(bypass.mac_key, 9, 2),
    substring(bypass.mac_key, 11, 2)
  ),
  (
    SELECT min(ip.value)
    FROM public.radcheck ip
    WHERE ip.username = bypass.username
      AND ip.attribute = 'Framed-IP-Address'
  )
FROM legacy_bypasses bypass
JOIN customer_macs owners ON owners.mac_key = bypass.mac_key
WHERE length(bypass.mac_key) = 12
  AND owners.admin_count = 1
ON CONFLICT (username) DO NOTHING;

COMMIT;