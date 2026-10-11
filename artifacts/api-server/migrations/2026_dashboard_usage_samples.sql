-- Hourly counters observed during existing dashboard live-session reads.
-- These are explicitly session-counter observations, not full interface totals.
create table if not exists public.dashboard_usage_samples (
  id bigserial primary key,
  account_id bigint not null references public.isp_admins(id) on delete cascade,
  router_id bigint not null references public.isp_routers(id) on delete cascade,
  scope_key text not null default 'all',
  sampled_at timestamptz not null,
  upload_bytes bigint not null default 0 check (upload_bytes >= 0),
  download_bytes bigint not null default 0 check (download_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (account_id, router_id, scope_key, sampled_at)
);
create index if not exists dashboard_usage_samples_window_idx
  on public.dashboard_usage_samples(account_id, scope_key, sampled_at desc);
alter table public.dashboard_usage_samples enable row level security;
revoke all on table public.dashboard_usage_samples from anon, authenticated;
grant select, insert, update, delete on table public.dashboard_usage_samples to service_role;
grant usage, select on sequence public.dashboard_usage_samples_id_seq to service_role;
