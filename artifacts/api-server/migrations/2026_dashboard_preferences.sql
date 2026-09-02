-- Per-ISP dashboard appearance preferences.
create table if not exists isp_dashboard_preferences (
  admin_id     bigint primary key references isp_admins(id) on delete cascade,
  accent_color text not null default '#d96835',
  layout       text not null default 'balanced'
    check (layout in ('balanced', 'focus', 'compact')),
  card_shape   text not null default 'rounded'
    check (card_shape in ('rounded', 'soft-square', 'compact', 'pill', 'circle', 'leaf', 'arch', 'bevel', 'notched', 'hexagon', 'ticket', 'squircle')),
  updated_at   timestamptz not null default now()
);

alter table isp_dashboard_preferences enable row level security;
revoke all on table isp_dashboard_preferences from anon, authenticated;
grant select, insert, update on table isp_dashboard_preferences to service_role;