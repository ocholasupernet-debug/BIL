-- Explicit behavior after a hotspot plan's data cap is exhausted.
alter table public.isp_plans
  add column if not exists data_cap_mode text not null default 'disconnect',
  add column if not exists fup_speed_down numeric(10,2),
  add column if not exists fup_speed_up numeric(10,2);

alter table public.isp_customers
  add column if not exists depletion_reason text;

alter table public.isp_plans
  drop constraint if exists isp_plans_data_cap_mode_check;
alter table public.isp_plans
  add constraint isp_plans_data_cap_mode_check
  check (data_cap_mode in ('disconnect', 'throttle'));