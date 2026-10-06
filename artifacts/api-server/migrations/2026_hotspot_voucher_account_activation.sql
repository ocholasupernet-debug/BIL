BEGIN;

ALTER TABLE public.isp_radius_vouchers
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_by_phone text,
  ADD COLUMN IF NOT EXISTS prepaid_customer_id bigint
    REFERENCES public.isp_customers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS isp_radius_vouchers_prepaid_customer_uidx
  ON public.isp_radius_vouchers(prepaid_customer_id)
  WHERE prepaid_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_hotspot_voucher_account(
  p_admin_id bigint,
  p_code text,
  p_phone text,
  p_password text,
  p_router_id bigint,
  p_mac_address text,
  p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  voucher_row public.isp_radius_vouchers%ROWTYPE;
  plan_row public.isp_plans%ROWTYPE;
  customer_row public.isp_customers%ROWTYPE;
  phone_local text;
BEGIN
  IF p_admin_id IS NULL OR p_router_id IS NULL
    OR p_phone !~ '^254[17][0-9]{8}$'
    OR p_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
    OR length(p_code) > 32
    OR p_password IS NULL OR length(p_password) < 12
    OR p_mac_address !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'
    OR p_ip_address !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
  THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_INVALID_INPUT';
  END IF;

  -- Serialize redemptions for one tenant/phone so two different codes cannot
  -- create concurrent duplicate phone usernames.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_admin_id::text || ':' || p_phone, 0));

  SELECT *
    INTO voucher_row
    FROM public.isp_radius_vouchers
   WHERE admin_id = p_admin_id
     AND upper(code) = upper(p_code)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_NOT_FOUND';
  END IF;

  IF voucher_row.redeemed_at IS NOT NULL THEN
    IF voucher_row.redeemed_by_phone <> p_phone
      OR voucher_row.prepaid_customer_id IS NULL
    THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ALREADY_REDEEMED';
    END IF;
    SELECT *
      INTO customer_row
      FROM public.isp_customers
     WHERE id = voucher_row.prepaid_customer_id
       AND admin_id = p_admin_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ACCOUNT_MISSING';
    END IF;
    RETURN jsonb_build_object(
      'customer_id', customer_row.id,
      'created', false
    );
  END IF;

  IF voucher_row.expires_at IS NOT NULL AND voucher_row.expires_at <= now() THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_EXPIRED';
  END IF;
  IF voucher_row.validity_mins <= 0 OR voucher_row.plan_id IS NULL THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_PLAN_INVALID';
  END IF;
  IF voucher_row.router_id IS NOT NULL AND voucher_row.router_id <> p_router_id THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_WRONG_ROUTER';
  END IF;

  SELECT *
    INTO plan_row
    FROM public.isp_plans
   WHERE id = voucher_row.plan_id
     AND admin_id = p_admin_id
     AND type IN ('hotspot', 'trial', 'trials')
     AND is_active IS TRUE
     AND port_id IS NULL
     AND (router_id IS NULL OR router_id = p_router_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_PLAN_INVALID';
  END IF;

  phone_local := '0' || substring(p_phone from 4);
  IF EXISTS (
    SELECT 1
      FROM public.isp_customers existing
     WHERE existing.admin_id = p_admin_id
       AND lower(coalesce(existing.type, '')) IN ('hotspot', 'trial', 'trials')
       AND (
         existing.username = p_phone
         OR regexp_replace(coalesce(existing.phone, ''), '\D', '', 'g') IN (
           p_phone,
           substring(p_phone from 4),
           phone_local
         )
       )
  ) THEN
    RAISE EXCEPTION 'HOTSPOT_PHONE_ACCOUNT_EXISTS';
  END IF;

  INSERT INTO public.isp_customers (
    admin_id, name, phone, username, password, plan_id, router_id, port_id,
    type, status, expires_at, ip_address, mac_address, data_used_bytes,
    service_online, last_seen, created_at, updated_at
  )
  VALUES (
    p_admin_id,
    'Hotspot ' || p_phone,
    p_phone,
    p_phone,
    p_password,
    plan_row.id,
    p_router_id,
    NULL,
    'hotspot',
    'active',
    now() + make_interval(mins => voucher_row.validity_mins),
    p_ip_address,
    p_mac_address,
    0,
    false,
    NULL,
    now(),
    now()
  )
  RETURNING * INTO customer_row;

  UPDATE public.isp_radius_vouchers
     SET redeemed_at = now(),
         redeemed_by_phone = p_phone,
         prepaid_customer_id = customer_row.id
   WHERE id = voucher_row.id
     AND redeemed_at IS NULL;

  RETURN jsonb_build_object(
    'customer_id', customer_row.id,
    'created', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_hotspot_voucher_account(
  bigint, text, text, text, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hotspot_voucher_account(
  bigint, text, text, text, bigint, text, text
) TO service_role;

COMMIT;
