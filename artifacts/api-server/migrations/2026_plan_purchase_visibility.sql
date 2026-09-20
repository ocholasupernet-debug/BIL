-- Customer purchase visibility for ISP plans.
-- Keep this idempotent because the deployment runner replays all migrations.
alter table public.isp_plans
  add column if not exists client_can_purchase boolean not null default true;