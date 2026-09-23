-- Reseller-owned collection accounts.  Secrets are encrypted by the API in
-- config_ciphertext; config_preview contains only non-secret display fields.
create table if not exists public.reseller_payment_gateway_routes (
  id                bigserial primary key,
  admin_id          bigint not null references public.isp_admins(id) on delete cascade,
  reseller_id       bigint not null references public.isp_admins(id) on delete cascade,
  router_id         bigint references public.isp_routers(id) on delete cascade,
  port_id           bigint references public.isp_reseller_ports(id) on delete cascade,
  gateway_type      text not null,
  config_ciphertext text not null,
  config_preview    jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reseller_gateway_scope_check check (
    (router_id is null and port_id is null)
    or (router_id is not null and port_id is null)
    or (router_id is not null and port_id is not null)
  ),
  constraint reseller_gateway_type_check check (gateway_type in (
    'mpesa_paybill', 'mpesa_till_push', 'bank_stk_push', 'airtel',
    'azampay', 'custom_paybill', 'dpo_payments', 'flutterwave', 'intasend',
    'pesapal', 'stripe', 'paypal', 'tigopesa', 'xendit', 'manual'
  ))
);

create unique index if not exists reseller_payment_gateway_default_uq
  on public.reseller_payment_gateway_routes(reseller_id)
  where router_id is null and port_id is null;
create unique index if not exists reseller_payment_gateway_router_uq
  on public.reseller_payment_gateway_routes(reseller_id, router_id)
  where router_id is not null and port_id is null;
create unique index if not exists reseller_payment_gateway_port_uq
  on public.reseller_payment_gateway_routes(reseller_id, port_id)
  where port_id is not null;
create index if not exists reseller_payment_gateway_routes_scope_idx
  on public.reseller_payment_gateway_routes(reseller_id, is_active, updated_at desc);

alter table public.reseller_payment_gateway_routes enable row level security;
revoke all on table public.reseller_payment_gateway_routes from anon, authenticated;
grant select, insert, update, delete on table public.reseller_payment_gateway_routes to service_role;
grant usage, select on sequence public.reseller_payment_gateway_routes_id_seq to service_role;

notify pgrst, 'reload schema';