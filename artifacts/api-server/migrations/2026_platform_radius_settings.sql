-- Allow encrypted platform RADIUS credentials in the existing secure settings table.
alter table public.platform_secure_settings
  drop constraint if exists platform_secure_settings_single_global;

alter table public.platform_secure_settings
  add constraint platform_secure_settings_single_global
  check (id in ('global_daraja', 'global_email', 'global_radius'));
