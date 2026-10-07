BEGIN;

ALTER TABLE public.isp_radius_vouchers
  ADD COLUMN IF NOT EXISTS data_limit_mb numeric(14, 2),
  ADD COLUMN IF NOT EXISTS data_cap_mode text NOT NULL DEFAULT 'disconnect';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'isp_radius_vouchers_data_cap_mode_check'
      AND conrelid = 'public.isp_radius_vouchers'::regclass
  ) THEN
    ALTER TABLE public.isp_radius_vouchers
      ADD CONSTRAINT isp_radius_vouchers_data_cap_mode_check
      CHECK (data_cap_mode IN ('disconnect', 'throttle'));
  END IF;
END
$$;

UPDATE public.isp_radius_vouchers AS voucher
SET data_limit_mb = NULLIF(plan.data_limit_mb, 0),
    data_cap_mode = CASE
      WHEN COALESCE(plan.data_limit_mb, 0) > 0 THEN COALESCE(plan.data_cap_mode, 'disconnect')
      ELSE 'disconnect'
    END
FROM public.isp_plans AS plan
WHERE voucher.plan_id = plan.id
  AND voucher.data_limit_mb IS NULL;

COMMENT ON COLUMN public.isp_radius_vouchers.data_limit_mb IS
  'Data allowance snapshot for this voucher; NULL means unlimited.';
COMMENT ON COLUMN public.isp_radius_vouchers.data_cap_mode IS
  'Hotspot plan data-cap behavior captured when the voucher was generated.';

COMMIT;
