-- Explicit units for the plan speed values used when creating RouterOS
-- profiles and rate queues. Existing plans are stored in Mbps.
alter table public.isp_plans
  add column if not exists speed_down_unit text not null default 'Mbps',
  add column if not exists speed_up_unit text not null default 'Mbps';