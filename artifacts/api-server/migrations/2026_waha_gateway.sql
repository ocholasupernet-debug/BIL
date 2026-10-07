-- WAHA is a separately configured WhatsApp HTTP API gateway. Its API key is
-- encrypted by the API server and this table is service-role-only.
create table if not exists platform_waha_gateway_settings (
  id text primary key check (id = 'global_waha'),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists platform_waha_gateway_credentials (
  id text primary key check (id = 'global_waha'),
  api_key jsonb,
  updated_at timestamptz not null default now()
);

alter table platform_waha_gateway_settings enable row level security;
alter table platform_waha_gateway_credentials enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table platform_waha_gateway_settings from anon;
    revoke all on table platform_waha_gateway_credentials from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table platform_waha_gateway_settings from authenticated;
    revoke all on table platform_waha_gateway_credentials from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table platform_waha_gateway_settings to service_role;
    grant select, insert, update, delete on table platform_waha_gateway_credentials to service_role;
  end if;
end $$;
