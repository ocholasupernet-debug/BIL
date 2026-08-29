-- Per-ISP dashboard financial amount visibility.
alter table if exists isp_dashboard_preferences
  add column if not exists hide_amounts boolean not null default false;