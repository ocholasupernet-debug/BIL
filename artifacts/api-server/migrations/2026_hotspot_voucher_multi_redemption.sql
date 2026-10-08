BEGIN;

ALTER TABLE public.isp_radius_vouchers
  ADD COLUMN IF NOT EXISTS max_redemptions integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'isp_radius_vouchers_max_redemptions_check'
       AND conrelid = 'public.isp_radius_vouchers'::regclass
  ) THEN
    ALTER TABLE public.isp_radius_vouchers
      ADD CONSTRAINT isp_radius_vouchers_max_redemptions_check
      CHECK (max_redemptions BETWEEN 1 AND 500);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.isp_radius_voucher_redemptions (
  id                    bigserial PRIMARY KEY,
  admin_id              bigint NOT NULL REFERENCES public.isp_admins(id) ON DELETE CASCADE,
  voucher_id            bigint NOT NULL REFERENCES public.isp_radius_vouchers(id) ON DELETE CASCADE,
  identity_key          text NOT NULL,
  prepaid_customer_id   bigint REFERENCES public.isp_customers(id) ON DELETE SET NULL,
  redeemed_by_phone     text,
  redeemed_mac_address  text,
  redeemed_at           timestamptz NOT NULL DEFAULT now(),
  service_expires_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS isp_radius_voucher_redemptions_identity_uidx
  ON public.isp_radius_voucher_redemptions(voucher_id, identity_key);
CREATE UNIQUE INDEX IF NOT EXISTS isp_radius_voucher_redemptions_customer_uidx
  ON public.isp_radius_voucher_redemptions(voucher_id, prepaid_customer_id)
  WHERE prepaid_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS isp_radius_voucher_redemptions_mac_uidx
  ON public.isp_radius_voucher_redemptions(voucher_id, redeemed_mac_address)
  WHERE redeemed_mac_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS isp_radius_voucher_redemptions_admin_created_idx
  ON public.isp_radius_voucher_redemptions(admin_id, created_at DESC);

ALTER TABLE public.isp_radius_voucher_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.isp_radius_voucher_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.isp_radius_voucher_redemptions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.isp_radius_voucher_redemptions_id_seq TO service_role;

-- Reserve one use for every voucher that had already been redeemed before
-- per-redemption records existed. The records retain the existing customer
-- link where one is known; unknown historic uses still consume capacity.
INSERT INTO public.isp_radius_voucher_redemptions (
  admin_id,
  voucher_id,
  identity_key,
  prepaid_customer_id,
  redeemed_by_phone,
  redeemed_mac_address,
  redeemed_at,
  service_expires_at
)
SELECT
  voucher.admin_id,
  voucher.id,
  CASE
    WHEN phone.digits ~ '^254[17][0-9]{8}$' THEN 'phone:' || phone.digits
    WHEN phone.digits ~ '^0[17][0-9]{8}$' THEN 'phone:254' || substring(phone.digits FROM 2)
    WHEN phone.digits ~ '^[17][0-9]{8}$' THEN 'phone:254' || phone.digits
    WHEN mac.compact <> '' THEN 'mac:' || mac.compact
    ELSE 'legacy:' || voucher.id::text
  END,
  voucher.prepaid_customer_id,
  voucher.redeemed_by_phone,
  voucher.redeemed_mac_address,
  voucher.redeemed_at,
  voucher.service_expires_at
FROM public.isp_radius_vouchers AS voucher
CROSS JOIN LATERAL (
  SELECT regexp_replace(coalesce(voucher.redeemed_by_phone, ''), '\D', '', 'g') AS digits
) AS phone
CROSS JOIN LATERAL (
  SELECT regexp_replace(upper(coalesce(voucher.redeemed_mac_address, '')), '[^0-9A-F]', '', 'g') AS compact
) AS mac
WHERE voucher.redeemed_at IS NOT NULL
ON CONFLICT (voucher_id, identity_key) DO NOTHING;

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
  redemption_row public.isp_radius_voucher_redemptions%ROWTYPE;
  account_admin_id bigint;
  resolved_router_id bigint;
  resolved_port_id bigint;
  normalized_mac text;
  phone_digits text;
  normalized_phone text;
  identity_key text;
  contact_value text;
  redemption_time timestamptz;
  service_expiry timestamptz;
  saved_customer_id bigint;
  redemption_count integer;
  next_redemption_number integer;
  account_username text;
  account_password text;
BEGIN
  normalized_mac := regexp_replace(upper(coalesce(p_mac_address, '')), '[^0-9A-F]', '', 'g');
  IF length(normalized_mac) <> 12 THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_INVALID_DEVICE';
  END IF;

  SELECT * INTO voucher_row
    FROM public.isp_radius_vouchers AS voucher
   WHERE voucher.admin_id = p_admin_id
     AND upper(voucher.code) = upper(btrim(coalesce(p_code, '')))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_NOT_FOUND';
  END IF;

  SELECT * INTO plan_row
    FROM public.isp_plans AS plan
   WHERE plan.id = voucher_row.plan_id
     AND plan.admin_id = voucher_row.admin_id
     AND lower(coalesce(plan.type, '')) = 'hotspot'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This voucher is not linked to a Hotspot plan.';
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

  contact_value := nullif(left(btrim(coalesce(p_contact, '')), 120), '');
  phone_digits := regexp_replace(coalesce(contact_value, ''), '\D', '', 'g');
  normalized_phone := CASE
    WHEN phone_digits ~ '^254[17][0-9]{8}$' THEN phone_digits
    WHEN phone_digits ~ '^0[17][0-9]{8}$' THEN '254' || substring(phone_digits FROM 2)
    WHEN phone_digits ~ '^[17][0-9]{8}$' THEN '254' || phone_digits
    ELSE NULL
  END;
  identity_key := CASE
    WHEN normalized_phone IS NOT NULL THEN 'phone:' || normalized_phone
    ELSE 'mac:' || normalized_mac
  END;

  -- The voucher row lock serializes claims for the code. These identity
  -- lookups make retries idempotent and prevent one person/device from using
  -- multiple slots on the same code.
  SELECT * INTO redemption_row
    FROM public.isp_radius_voucher_redemptions AS redemption
   WHERE redemption.voucher_id = voucher_row.id
     AND redemption.identity_key = identity_key
   FOR UPDATE;

  IF FOUND THEN
    IF redemption_row.prepaid_customer_id IS NULL THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_LEGACY_USE_UNLINKED';
    END IF;
    SELECT * INTO customer_row
      FROM public.isp_customers AS customer
     WHERE customer.id = redemption_row.prepaid_customer_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ACCOUNT_MISSING';
    END IF;
    IF customer_row.admin_id <> voucher_row.admin_id
       AND customer_row.admin_id <> account_admin_id THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ACCOUNT_SCOPE_INVALID';
    END IF;
    IF redemption_row.redeemed_mac_address IS DISTINCT FROM normalized_mac
       OR (customer_row.mac_address IS NOT NULL
           AND regexp_replace(upper(customer_row.mac_address), '[^0-9A-F]', '', 'g') <> normalized_mac) THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ALREADY_LINKED_TO_DEVICE';
    END IF;
    IF customer_row.plan_id IS DISTINCT FROM voucher_row.plan_id
       OR (customer_row.router_id IS NOT NULL AND customer_row.router_id IS DISTINCT FROM resolved_router_id)
       OR (customer_row.port_id IS NOT NULL AND customer_row.port_id IS DISTINCT FROM resolved_port_id) THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ACCOUNT_SCOPE_INVALID';
    END IF;

    service_expiry := coalesce(redemption_row.service_expires_at, customer_row.expires_at);
    IF service_expiry IS NOT NULL AND service_expiry <= now() THEN
       RAISE EXCEPTION 'HOTSPOT_VOUCHER_SERVICE_EXPIRED_AT:%',
         to_char(service_expiry AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    IF customer_row.status = 'suspended' OR customer_row.depletion_reason = 'data_limit' THEN
      RAISE EXCEPTION 'HOTSPOT_VOUCHER_ACCOUNT_NOT_ENTITLED';
    END IF;

    account_admin_id := customer_row.admin_id;
    RETURN QUERY
    SELECT voucher_row.admin_id, account_admin_id, voucher_row.code, voucher_row.plan_name,
           voucher_row.validity_mins, voucher_row.data_limit_mb,
           coalesce(voucher_row.data_cap_mode, 'disconnect'), resolved_router_id,
           resolved_port_id, service_expiry, customer_row.id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.isp_radius_voucher_redemptions AS redemption
     WHERE redemption.voucher_id = voucher_row.id
       AND redemption.redeemed_mac_address = normalized_mac
  ) THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_ALREADY_LINKED_TO_DEVICE';
  END IF;

  IF voucher_row.expires_at IS NOT NULL AND voucher_row.expires_at <= now() THEN
     RAISE EXCEPTION 'HOTSPOT_VOUCHER_EXPIRED_AT:%',
       to_char(voucher_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;

  SELECT count(*)::integer INTO redemption_count
    FROM public.isp_radius_voucher_redemptions AS redemption
   WHERE redemption.voucher_id = voucher_row.id;
  -- Fail closed if an older redeemed row could not be backfilled for any
  -- reason; it must still consume its original single-use slot.
  IF redemption_count = 0 AND voucher_row.redeemed_at IS NOT NULL THEN
    redemption_count := 1;
  END IF;
  IF redemption_count >= greatest(1, voucher_row.max_redemptions) THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_REDEMPTION_LIMIT:%:%',
      redemption_count, greatest(1, voucher_row.max_redemptions);
  END IF;

  redemption_time := coalesce(p_redeemed_at, now());
  service_expiry := CASE
    WHEN voucher_row.validity_mins > 0
      THEN redemption_time + make_interval(mins => voucher_row.validity_mins)
    ELSE NULL
  END;
  next_redemption_number := redemption_count + 1;
  account_username := 'VCH' || voucher_row.id::text || '_' || next_redemption_number::text;
  account_password := replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.isp_customers (
    admin_id, name, phone, username, password, plan_id,
    router_id, port_id, type, mac_address, status, expires_at,
    depletion_reason, created_at, updated_at
  ) VALUES (
    account_admin_id,
    coalesce(
      CASE WHEN normalized_phone IS NOT NULL THEN 'Hotspot ' || normalized_phone END,
      contact_value,
      'Voucher ' || voucher_row.code || ' user ' || next_redemption_number::text
    ),
    normalized_phone,
    account_username,
    account_password,
    voucher_row.plan_id,
    resolved_router_id,
    resolved_port_id,
    'hotspot',
    normalized_mac,
    'active',
    service_expiry,
    NULL,
    redemption_time,
    now()
  )
  RETURNING id INTO saved_customer_id;

  INSERT INTO public.isp_radius_voucher_redemptions (
    admin_id, voucher_id, identity_key, prepaid_customer_id,
    redeemed_by_phone, redeemed_mac_address, redeemed_at, service_expires_at
  ) VALUES (
    voucher_row.admin_id, voucher_row.id, identity_key, saved_customer_id,
    normalized_phone, normalized_mac, redemption_time, service_expiry
  );

  UPDATE public.isp_radius_vouchers AS voucher
     SET redeemed_at = coalesce(voucher.redeemed_at, redemption_time),
         redeemed_by_phone = coalesce(voucher.redeemed_by_phone, normalized_phone, contact_value),
         redeemed_mac_address = coalesce(voucher.redeemed_mac_address, normalized_mac),
         service_expires_at = coalesce(voucher.service_expires_at, service_expiry),
         prepaid_customer_id = coalesce(voucher.prepaid_customer_id, saved_customer_id)
   WHERE voucher.id = voucher_row.id;

  RETURN QUERY
  SELECT voucher_row.admin_id, account_admin_id, voucher_row.code, voucher_row.plan_name,
         voucher_row.validity_mins, voucher_row.data_limit_mb,
         coalesce(voucher_row.data_cap_mode, 'disconnect'), resolved_router_id,
         resolved_port_id, service_expiry, saved_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_hotspot_voucher(bigint, text, text, text, bigint, bigint, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_hotspot_voucher(bigint, text, text, text, bigint, bigint, timestamptz)
  TO service_role;

-- Keep the older account-activation endpoint on the same atomic redemption
-- path, so it cannot bypass the redemption counter or create a second account.
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  activation_row record;
  voucher_id_value bigint;
  identity_phone text;
  identity_key_value text;
  was_already_claimed boolean;
BEGIN
  IF p_admin_id IS NULL
     OR p_router_id IS NULL
     OR p_phone !~ '^254[17][0-9]{8}$'
     OR p_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
     OR length(p_code) > 32
     OR p_password IS NULL OR length(p_password) < 12
     OR p_mac_address !~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'
     OR p_ip_address !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
  THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_INVALID_INPUT';
  END IF;

  SELECT voucher.id
    INTO voucher_id_value
    FROM public.isp_radius_vouchers AS voucher
   WHERE voucher.admin_id = p_admin_id
     AND upper(voucher.code) = upper(p_code)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOTSPOT_VOUCHER_NOT_FOUND';
  END IF;

  identity_phone := 'phone:' || p_phone;
  SELECT EXISTS (
    SELECT 1
      FROM public.isp_radius_voucher_redemptions AS redemption
     WHERE redemption.voucher_id = voucher_id_value
       AND redemption.identity_key = identity_phone
  ) INTO was_already_claimed;

  SELECT * INTO activation_row
    FROM public.activate_hotspot_voucher(
      p_admin_id,
      p_code,
      p_mac_address,
      p_phone,
      p_router_id,
      NULL,
      now()
    );

  UPDATE public.isp_customers AS customer
     SET ip_address = p_ip_address,
         updated_at = now()
   WHERE customer.id = activation_row.out_customer_id;

  RETURN jsonb_build_object(
    'customer_id', activation_row.out_customer_id,
    'account_admin_id', activation_row.out_account_admin_id,
    'created', NOT was_already_claimed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_hotspot_voucher_account(bigint, text, text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hotspot_voucher_account(bigint, text, text, text, bigint, text, text)
  TO service_role;

COMMENT ON COLUMN public.isp_radius_vouchers.max_redemptions IS
  'Maximum distinct prepaid Hotspot accounts that may be created from this voucher code.';
COMMENT ON TABLE public.isp_radius_voucher_redemptions IS
  'One idempotent prepaid-account claim per person/device redemption of a Hotspot voucher.';

COMMIT;
