-- Master port-services expansion.
--
-- The application models authenticated users as isp_admins rather than a
-- separate users table. Keep the legacy role column for compatibility and add
-- an explicit three-tier account classification for new authorization work.

alter table if exists public.isp_admins
  add column if not exists account_tier text not null default 'isp_admin';

update public.isp_admins
set account_tier = case
  when role in ('superadmin', 'system_admin') then 'system_admin'
  when role = 'reseller' then 'reseller'
  else 'isp_admin'
end;

alter table if exists public.isp_admins
  drop constraint if exists isp_admins_account_tier_check;

alter table if exists public.isp_admins
  add constraint isp_admins_account_tier_check
  check (account_tier in ('system_admin', 'isp_admin', 'reseller'));

alter table if exists public.isp_reseller_ports
  add column if not exists assigned_reseller_id bigint references public.isp_admins(id) on delete set null,
  add column if not exists reseller_bandwidth_cap integer,
  add column if not exists hotspot_folder_path text,
  add column if not exists pppoe_folder_path text;

update public.isp_reseller_ports
set assigned_reseller_id = reseller_id
where assigned_reseller_id is null;

update public.isp_reseller_ports
set reseller_bandwidth_cap = bandwidth_cap_mbps
where reseller_bandwidth_cap is null;

update public.isp_reseller_ports
set hotspot_folder_path = hotspot_template_path
where hotspot_folder_path is null
  and hotspot_template_path is not null;

alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_bandwidth_cap_check;

alter table if exists public.isp_reseller_ports
  add constraint isp_reseller_ports_bandwidth_cap_check
  check (reseller_bandwidth_cap is null or (reseller_bandwidth_cap > 0 and reseller_bandwidth_cap <= 100000));

create index if not exists isp_reseller_ports_assigned_reseller_idx
  on public.isp_reseller_ports(assigned_reseller_id, status);

create table if not exists public.payment_gateways (
  id             bigserial primary key,
  user_id        bigint not null references public.isp_admins(id) on delete cascade,
  gateway_type   text not null check (gateway_type in ('stripe', 'paypal', 'mpesa')),
  -- The value is encrypted by the API before it is written. It is never
  -- returned to browser clients after creation.
  api_keys_json  text not null default '',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, gateway_type)
);

create index if not exists payment_gateways_user_idx
  on public.payment_gateways(user_id, is_active);

alter table public.payment_gateways enable row level security;
revoke all on table public.payment_gateways from anon, authenticated;
grant select, insert, update, delete on table public.payment_gateways to service_role;
grant usage, select on sequence public.payment_gateways_id_seq to service_role;

notify pgrst, 'reload schema';