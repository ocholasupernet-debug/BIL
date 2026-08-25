-- Global Daraja settings encrypted by the API before storage.
-- Apply in the Supabase SQL editor before enabling live M-Pesa.

create table if not exists platform_secure_settings (
  id         text primary key,
  ciphertext text not null,
  iv         text not null,
  auth_tag   text not null,
  updated_at timestamptz not null default now(),
  constraint platform_secure_settings_single_global
    check (id = 'global_daraja')
);

alter table platform_secure_settings enable row level security;

-- Hosted Supabase projects normally define these roles; local/managed
-- Postgres instances may not. RLS remains enabled with no public policies.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table platform_secure_settings from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table platform_secure_settings from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table platform_secure_settings to service_role;
  end if;
end $$;