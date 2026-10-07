BEGIN;

ALTER TABLE public.isp_radius_vouchers
  ADD COLUMN IF NOT EXISTS service_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_by_phone text,
  ADD COLUMN IF NOT EXISTS redeemed_mac_address text,
  ADD COLUMN IF NOT EXISTS prepaid_customer_id bigint
    REFERENCES public.isp_customers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS isp_radius_vouchers_prepaid_customer_uidx
  ON public.isp_radius_vouchers(prepaid_customer_id)
  WHERE prepaid_customer_id IS NOT NULL;

-- Only backfill expiry when the original redemption time was actually recorded.
UPDATE public.isp_radius_vouchers AS voucher
   SET service_expires_at = coalesce(
     (
       SELECT customer.expires_at
         FROM public.isp_customers AS customer
        WHERE customer.id = voucher.prepaid_customer_id
     ),
     voucher.redeemed_at + make_interval(mins => voucher.validity_mins)
   )
 WHERE service_expires_at IS NULL
    AND voucher.redeemed_at IS NOT NULL
    AND voucher.validity_mins > 0;

-- A voucher has exactly one prepaid identity. Do not silently merge any
-- pre-existing duplicates; resolve them before applying this migration.
CREATE UNIQUE INDEX IF NOT EXISTS isp_customers_voucher_admin_username_uidx
  ON public.isp_customers(admin_id, username)
  WHERE type = 'voucher' AND username IS NOT NULL;

-- Existing linked vouchers appear in the voucher filter without changing
-- account credentials, live sessions, or accumulated RADIUS usage.
UPDATE public.isp_customers AS customer
   SET type = 'voucher'
  FROM public.isp_radius_vouchers AS voucher
 WHERE voucher.prepaid_customer_id = customer.id
   AND customer.type IS DISTINCT FROM 'voucher'
   AND NOT EXISTS (
     SELECT 1
       FROM public.isp_customers AS duplicate
      WHERE duplicate.admin_id = customer.admin_id
        AND duplicate.type = 'voucher'
        AND duplicate.username = customer.username
        AND duplicate.id <> customer.id
   );

CREATE OR REPLACE FUNCTION public.activate_hotspot_voucher(
  p_admin_id bigint,
  p_code text,
  p_mac_address text,
  p_contact text,
  p_router_id bigint,
  p_port_id bigint,
  p_redeemed_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  out_voucher_admin_id bigint,
  out_account_admin_id bigint,
  out_voucher_code text,
  out_plan_name text,
  out_validity_mins integer,
  out_data_limit_mb numeric,
  out_data_cap_mode text,
  out_router_id bigint,
  out_port_id bigint,
  out_service_expires_at timestamptz,
  out_customer_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  voucher_row public.isp_radius_vouchers%ROWTYPE;
  plan_row public.isp_plans%ROWTYPE;
  customer_row public.isp_customers%ROWTYPE;
  account_admin_id bigint;
  resolved_router_id bigint;
  resolved_port_id bigint;
  normalized_mac text;
  contact_value text;
  redemption_time timestamptz;
  service_expiry timestamptz;
  saved_customer_id bigint;
  linked_customer_found boolean := false;
BEGIN
  normalized_mac := regexp_replace(upper(coalesce(p_mac_address, '')), '[^0-9A-F]', '', 'g');
  IF length(normalized_mac) <> 12 THEN
    RAISE EXCEPTION 'Reconnect this device from its hotspot sign-in page so its MAC address can be verified.';
  END IF;

  SELECT * INTO voucher_row
    FROM public.isp_radius_vouchers AS voucher
   WHERE voucher.admin_id = p_admin_id
     AND upper(voucher.code) = upper(btrim(coalesce(p_code, '')))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found. Check the code and try again.';
  END IF;

  IF voucher_row.expires_at IS NOT NULL
     AND voucher_row.redeemed_at IS NULL
     AND voucher_row.expires_at <= now() THEN
    RAISE EXCEPTION 'This voucher has expired.';
  END IF;

  SELECT * INTO plan_row
    FROM public.isp_plans AS plan
   WHERE plan.id = voucher_row.plan_id
     AND plan.admin_id = voucher_row.admin_id
   FOR SHARE;
  IF NOT FOUND OR lower(coalesce(plan_row.type, '')) <> 'hotspot' THEN
    RAISE EXCEPTION 'This voucher is not linked to an active Hotspot plan.';
  END IF;

  account_admin_id := coalesce(plan_row.owner_reseller_id, voucher_row.admin_id);
  resolved_router_id := coalesce(voucher_row.router_id, plan_row.router_id, p_router_id);
  IF resolved_router_id IS NULL
     OR (p_router_id IS NOT NULL AND resolved_router_id IS DISTINCT FROM p_router_id)
     OR (plan_row.router_id IS NOT NULL AND plan_row.router_id IS DISTINCT FROM resolved_router_id)
     OR NOT EXISTS (
       SELECT 1
         FROM public.isp_routers AS router
        WHERE router.id = resolved_router_id
          AND router.admin_id = plan_row.admin_id
     ) THEN
    RAISE EXCEPTION 'This voucher is not assigned to the Hotspot router for this device.';
  END IF;

  IF plan_row.port_id IS NOT NULL
     AND p_port_id IS NOT NULL
     AND plan_row.port_id IS DISTINCT FROM p_port_id THEN
    RAISE EXCEPTION 'This voucher is not assigned to the Hotspot service for this device.';
  END IF;
  resolved_port_id := coalesce(plan_row.port_id, p_port_id);

  redemption_time := coalesce(voucher_row.redeemed_at, p_redeemed_at, now());

  IF voucher_row.redeemed_mac_address IS NOT NULL
     AND regexp_replace(upper(voucher_row.redeemed_mac_address), '[^0-9A-F]', '', 'g')
       IS DISTINCT FROM normalized_mac THEN
    RAISE EXCEPTION 'This voucher is already linked to another device.';
  END IF;

  contact_value := nullif(left(btrim(coalesce(p_contact, '')), 120), '');
  IF voucher_row.prepaid_customer_id IS NOT NULL THEN
    -- The previous portal flow linked redeemed vouchers to a phone-based
    -- Hotspot account. Reuse that exact account so redemption retries do not
    -- create a second prepaid identity or reset its RouterOS usage history.
    SELECT * INTO customer_row
      FROM public.isp_customers AS customer
     WHERE customer.id = voucher_row.prepaid_customer_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The prepaid account linked to this voucher is missing. Ask the ISP to restore the account.';
    END IF;
    IF customer_row.admin_id <> voucher_row.admin_id
       AND customer_row.admin_id <> account_admin_id THEN
      RAISE EXCEPTION 'The prepaid account linked to this voucher belongs to a different account.';
    END IF;
    account_admin_id := customer_row.admin_id;
    linked_customer_found := true;
  ELSE
    SELECT * INTO customer_row
      FROM public.isp_customers AS customer
     WHERE customer.admin_id = account_admin_id
       AND customer.type = 'voucher'
       AND customer.username = voucher_row.code
      FOR UPDATE;
    linked_customer_found := FOUND;
  END IF;

  IF linked_customer_found THEN
    IF customer_row.mac_address IS NOT NULL
       AND regexp_replace(upper(customer_row.mac_address), '[^0-9A-F]', '', 'g')
         IS DISTINCT FROM normalized_mac THEN
      RAISE EXCEPTION 'This voucher is already linked to another device.';
    END IF;
    IF customer_row.plan_id IS DISTINCT FROM voucher_row.plan_id
       OR (customer_row.router_id IS NOT NULL AND customer_row.router_id IS DISTINCT FROM resolved_router_id)
       OR (customer_row.port_id IS NOT NULL AND customer_row.port_id IS DISTINCT FROM resolved_port_id) THEN
      RAISE EXCEPTION 'This voucher is already linked to a different Hotspot account or service.';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.isp_customers AS duplicate
       WHERE duplicate.admin_id IN (voucher_row.admin_id, account_admin_id)
         AND duplicate.type = 'voucher'
         AND duplicate.username = voucher_row.code
         AND duplicate.id <> customer_row.id
    ) THEN
      RAISE EXCEPTION 'Multiple prepaid accounts are already linked to this voucher. Ask the ISP to review the voucher before reconnecting.';
    END IF;
  END IF;

  IF voucher_row.redeemed_at IS NOT NULL
     AND voucher_row.service_expires_at IS NULL
     AND p_redeemed_at IS NULL
     AND voucher_row.validity_mins > 0
     AND (NOT linked_customer_found OR customer_row.expires_at IS NULL) THEN
    RAISE EXCEPTION 'The original voucher start time is unavailable. Ask the ISP to restore this voucher without changing its expiry.';
  END IF;
  service_expiry := coalesce(
    voucher_row.service_expires_at,
    CASE WHEN linked_customer_found THEN customer_row.expires_at ELSE NULL END,
    CASE
      WHEN voucher_row.validity_mins > 0
        THEN redemption_time + make_interval(mins => voucher_row.validity_mins)
      ELSE NULL
    END
  );
  IF service_expiry IS NOT NULL AND service_expiry <= now() THEN
    RAISE EXCEPTION 'This voucher package has expired.';
  END IF;

  IF linked_customer_found THEN
    saved_customer_id := customer_row.id;
    UPDATE public.isp_customers AS customer
       SET type = 'voucher',
           mac_address = coalesce(customer.mac_address, normalized_mac),
           router_id = coalesce(customer.router_id, resolved_router_id),
           port_id = coalesce(customer.port_id, resolved_port_id),
           expires_at = service_expiry,
           updated_at = now()
     WHERE customer.id = saved_customer_id;
  ELSE
    INSERT INTO public.isp_customers (
      admin_id, name, phone, username, password, plan_id,
      router_id, port_id, type, mac_address, status, expires_at,
      depletion_reason, created_at, updated_at
    ) VALUES (
      account_admin_id,
      coalesce(contact_value, 'Voucher ' || voucher_row.code),
      CASE
        WHEN contact_value ~ '^(\+?254|0)?[17][0-9]{8}$' THEN contact_value
        ELSE voucher_row.code
      END,
      voucher_row.code,
      voucher_row.code,
      voucher_row.plan_id,
      resolved_router_id,
      resolved_port_id,
      'voucher',
      normalized_mac,
      'active',
      service_expiry,
      NULL,
      now(),
      now()
    )
    RETURNING id INTO saved_customer_id;
  END IF;

  UPDATE public.isp_radius_vouchers AS voucher
     SET redeemed_at = coalesce(voucher.redeemed_at, redemption_time),
         redeemed_by_phone = coalesce(voucher.redeemed_by_phone, contact_value),
         redeemed_mac_address = coalesce(voucher.redeemed_mac_address, normalized_mac),
         service_expires_at = service_expiry,
         prepaid_customer_id = coalesce(voucher.prepaid_customer_id, saved_customer_id)
   WHERE voucher.id = voucher_row.id;

  RETURN QUERY
  SELECT
    voucher_row.admin_id,
    account_admin_id,
    voucher_row.code,
    voucher_row.plan_name,
    voucher_row.validity_mins,
    voucher_row.data_limit_mb,
    coalesce(voucher_row.data_cap_mode, 'disconnect'),
    resolved_router_id,
    resolved_port_id,
    service_expiry,
    saved_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_hotspot_voucher(bigint, text, text, text, bigint, bigint, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.activate_hotspot_voucher(bigint, text, text, text, bigint, bigint, timestamptz) TO service_role;

COMMIT;
