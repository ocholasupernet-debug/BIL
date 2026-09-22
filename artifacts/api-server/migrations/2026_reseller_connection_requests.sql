-- Independent resellers can request to connect to an ISP tenant.
-- Approval establishes the account hierarchy; physical-port provisioning remains
-- a separate, explicit ISP operation.

create table if not exists public.isp_reseller_connection_requests (
  id              bigserial primary key,
  reseller_id     bigint not null references public.isp_admins(id) on delete cascade,
  isp_admin_id    bigint not null references public.isp_admins(id) on delete cascade,
  note            text,
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists reseller_connection_requests_isp_idx
  on public.isp_reseller_connection_requests(isp_admin_id, status, created_at desc);

create index if not exists reseller_connection_requests_reseller_idx
  on public.isp_reseller_connection_requests(reseller_id, status, created_at desc);

alter table public.isp_reseller_connection_requests enable row level security;

revoke all on table public.isp_reseller_connection_requests from anon, authenticated;
grant select, insert, update on table public.isp_reseller_connection_requests to service_role;
grant usage, select on sequence public.isp_reseller_connection_requests_id_seq to service_role;

notify pgrst, 'reload schema';