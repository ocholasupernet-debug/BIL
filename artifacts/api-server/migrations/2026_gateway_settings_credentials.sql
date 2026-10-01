ALTER TABLE public.isp_admins
  ADD COLUMN IF NOT EXISTS gateway_settings_otp_phone_e164 text,
  ADD COLUMN IF NOT EXISTS gateway_settings_otp_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS gateway_settings_password_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'isp_admins_gateway_settings_otp_phone_e164_check'
       AND conrelid = 'public.isp_admins'::regclass
  ) THEN
    ALTER TABLE public.isp_admins
      ADD CONSTRAINT isp_admins_gateway_settings_otp_phone_e164_check
      CHECK (
        gateway_settings_otp_phone_e164 IS NULL
        OR gateway_settings_otp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      );
  END IF;
END $$;