ALTER TABLE public.isp_plans
  ADD COLUMN IF NOT EXISTS tethering_allowed boolean NOT NULL DEFAULT false;
