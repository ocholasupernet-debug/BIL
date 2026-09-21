-- Tenant-scoped captive portal appearance choices.
alter table if exists isp_dashboard_preferences
  add column if not exists portal_background text not null default 'midnight';

alter table if exists isp_dashboard_preferences
  add column if not exists portal_package_shape text not null default 'rounded';

alter table if exists isp_dashboard_preferences
  drop constraint if exists isp_dashboard_preferences_portal_background_check;

alter table if exists isp_dashboard_preferences
  add constraint isp_dashboard_preferences_portal_background_check
  check (portal_background in ('midnight', 'ocean', 'aurora', 'forest', 'sunset', 'sand'));

alter table if exists isp_dashboard_preferences
  drop constraint if exists isp_dashboard_preferences_portal_package_shape_check;

alter table if exists isp_dashboard_preferences
  add constraint isp_dashboard_preferences_portal_package_shape_check
  check (portal_package_shape in ('rounded', 'soft-square', 'compact', 'square', 'circle', 'pill', 'hexagon', 'octagon', 'squircle'));