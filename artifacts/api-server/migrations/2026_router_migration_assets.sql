-- Router migration asset ownership. These fields let a migration preserve the
-- source port and reseller relationship while creating destination records.
alter table public.isp_plans
  add column if not exists router_id bigint references public.isp_routers(id) on delete set null;

alter table public.isp_customers
  add column if not exists router_id bigint references public.isp_routers(id) on delete set null,
  add column if not exists port_id bigint references public.isp_reseller_ports(id) on delete set null,
  add column if not exists assigned_reseller_id bigint references public.isp_admins(id) on delete set null;

alter table public.isp_ppp_secrets
  add column if not exists port_id bigint references public.isp_reseller_ports(id) on delete set null,
  add column if not exists assigned_reseller_id bigint references public.isp_admins(id) on delete set null;

alter table public.isp_hotspot_users
  add column if not exists port_id bigint references public.isp_reseller_ports(id) on delete set null,
  add column if not exists assigned_reseller_id bigint references public.isp_admins(id) on delete set null;

create index if not exists isp_customers_port_id_idx on public.isp_customers(port_id);
create index if not exists isp_ppp_secrets_port_id_idx on public.isp_ppp_secrets(port_id);
create index if not exists isp_hotspot_users_port_id_idx on public.isp_hotspot_users(port_id);