-- Restore gateway configuration access for ISP Admins and Resellers by default.
-- Super Admins can still revoke this permission through the role editor.
create table if not exists public.platform_migration_markers (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);
alter table public.platform_migration_markers enable row level security;
revoke all on table public.platform_migration_markers from anon, authenticated;

do $$
begin
  -- The deployment runner replays idempotent migrations on each publish. Apply
  -- this role default once, then preserve later Super Admin permission changes.
  if not exists (
    select 1
      from public.platform_migration_markers
     where migration_key = 'restore_default_gateway_access'
  ) then
    insert into public.platform_role_permissions
      (role_name, permission_key, enabled, updated_by, updated_at)
    values
      ('isp_admin', 'Manage Gateways', true, 'migration-default', now()),
      ('reseller', 'Manage Gateways', true, 'migration-default', now())
    on conflict (role_name, permission_key)
    do update set
      enabled = excluded.enabled,
      updated_by = excluded.updated_by,
      updated_at = now();

    insert into public.platform_migration_markers (migration_key)
    values ('restore_default_gateway_access')
    on conflict (migration_key) do nothing;
  end if;
end
$$;