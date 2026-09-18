-- Hierarchical reseller accounts, physical-port ownership, gateway settings,
-- and sales attribution. Resellers remain accounts in isp_admins so the
-- existing signed-session and tenant-host model can authenticate them.

alter table public.isp_admins
  add column if not exists parent_id bigint references public.isp_admins(id) on delete cascade,
  add column if not exists company_name text,
  add column if not exists earnings_balance numeric(12,2) not null default 0;

create index if not exists isp_admins_parent_id_idx
  on public.isp_admins(parent_id);

create table if not exists public.isp_reseller_ports (
  id                    bigserial primary key,
  admin_id              bigint not null references public.isp_admins(id) on delete cascade,
  reseller_id           bigint not null references public.isp_admins(id) on delete cascade,
  router_id             bigint not null references public.isp_routers(id) on delete cascade,
  interface_name        text not null,
  bridge_name           text,
  hotspot_enabled       boolean not null default false,
  hotspot_template_path text,
  pppoe_enabled         boolean not null default false,
  subnet_range          text,
  bandwidth_cap_mbps    integer not null check (bandwidth_cap_mbps > 0 and bandwidth_cap_mbps <= 100000),
  status                text not null default 'pending'
    check (status in ('pending', 'active', 'failed', 'disabled')),
  provisioning_error    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (router_id, interface_name),
  unique (reseller_id, router_id, interface_name)
);

create index if not exists isp_reseller_ports_admin_idx
  on public.isp_reseller_ports(admin_id, router_id);
create index if not exists isp_reseller_ports_reseller_idx
  on public.isp_reseller_ports(reseller_id, status);

create table if not exists public.isp_reseller_gateways (
  id           bigserial primary key,
  admin_id     bigint not null references public.isp_admins(id) on delete cascade,
  reseller_id  bigint not null references public.isp_admins(id) on delete cascade,
  gateway_type text not null,
  config_json  jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (reseller_id, gateway_type)
);

create table if not exists public.isp_reseller_sales (
  id             bigserial primary key,
  admin_id       bigint not null references public.isp_admins(id) on delete cascade,
  reseller_id    bigint not null references public.isp_admins(id) on delete cascade,
  reseller_port_id bigint not null references public.isp_reseller_ports(id) on delete restrict,
  client_reference text not null,
  client_ip       inet,
  amount         numeric(12,2) not null check (amount >= 0),
  gateway_type   text not null,
  payment_reference text not null,
  status         text not null default 'completed'
    check (status in ('pending', 'completed', 'failed', 'refunded')),
  created_at     timestamptz not null default now(),
  unique (gateway_type, payment_reference)
);

create index if not exists isp_reseller_sales_reseller_idx
  on public.isp_reseller_sales(reseller_id, created_at desc);

create or replace function public.add_reseller_earnings(
  p_admin_id bigint,
  p_reseller_id bigint,
  p_amount numeric
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(12,2);
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid reseller earnings amount';
  end if;
  update public.isp_admins
  set earnings_balance = coalesce(earnings_balance, 0) + p_amount,
      updated_at = now()
  where id = p_reseller_id
    and parent_id = p_admin_id
    and role = 'reseller'
    and is_active = true
  returning earnings_balance into new_balance;
  if new_balance is null then
    raise exception 'Reseller account is not owned by this ISP';
  end if;
  return new_balance;
end;
$$;

alter table public.isp_reseller_ports enable row level security;
alter table public.isp_reseller_gateways enable row level security;
alter table public.isp_reseller_sales enable row level security;

revoke all on table public.isp_reseller_ports from anon, authenticated;
revoke all on table public.isp_reseller_gateways from anon, authenticated;
revoke all on table public.isp_reseller_sales from anon, authenticated;
grant select, insert, update, delete on table public.isp_reseller_ports to service_role;
grant select, insert, update, delete on table public.isp_reseller_gateways to service_role;
grant select, insert, update on table public.isp_reseller_sales to service_role;
grant usage, select on sequence public.isp_reseller_ports_id_seq to service_role;
grant usage, select on sequence public.isp_reseller_gateways_id_seq to service_role;
grant usage, select on sequence public.isp_reseller_sales_id_seq to service_role;
grant execute on function public.add_reseller_earnings(bigint, bigint, numeric) to service_role;

insert into public.platform_role_permissions (role_name, permission_key, enabled)
select role_name, permission_key, enabled
from (values
  ('isp_admin', 'Manage Resellers', true),
  ('isp_admin', 'Manage Reseller Ports', true),
  ('reseller', 'View Reseller Dashboard', true),
  ('reseller', 'Manage Reseller Gateway', true)
) as seeded(role_name, permission_key, enabled)
on conflict (role_name, permission_key) do update
set enabled = excluded.enabled, updated_at = now();