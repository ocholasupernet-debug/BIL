-- Persisted router self-install timeline.
-- One row per step update reported by the MikroTik install scripts.
-- Used by the admin "Install history" view to debug past failures.
create table if not exists isp_router_install_events (
  id                 bigserial primary key,
  router_id          integer not null,
  admin_id           integer not null,
  router_name        text,
  install_started_at timestamptz not null,
  step               integer not null,
  step_name          text,
  phase              text not null,
  error              text,
  done               boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists isp_router_install_events_admin_router_idx
  on isp_router_install_events(admin_id, router_id, install_started_at desc);

create index if not exists isp_router_install_events_created_at_idx
  on isp_router_install_events(created_at desc);
