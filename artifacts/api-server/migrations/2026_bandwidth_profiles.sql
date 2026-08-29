-- Bandwidth profiles used by service plans and RouterOS synchronization.
-- Safe to replay during deployment.
create table if not exists public.isp_bandwidth (
  id              bigserial primary key,
  admin_id        bigint not null references public.isp_admins(id) on delete cascade,
  name            text not null,
  speed_down      numeric(10,2) not null check (speed_down > 0),
  speed_up        numeric(10,2) not null check (speed_up > 0),
  speed_down_unit text not null default 'Mbps'
    check (speed_down_unit in ('Kbps', 'Mbps', 'Gbps')),
  speed_up_unit   text not null default 'Mbps'
    check (speed_up_unit in ('Kbps', 'Mbps', 'Gbps')),
  burst_enabled   boolean not null default false,
  burst_down      numeric(10,2),
  burst_up        numeric(10,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists isp_bandwidth_admin_id_idx
  on public.isp_bandwidth(admin_id);

grant select, insert, update, delete on table public.isp_bandwidth to anon, authenticated;
grant usage, select on sequence public.isp_bandwidth_id_seq to anon, authenticated;

notify pgrst, 'reload schema';