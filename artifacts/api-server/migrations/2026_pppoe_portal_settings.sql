create table if not exists isp_pppoe_portal_settings (
  admin_id bigint primary key references isp_admins(id) on delete cascade,
  renewal_signin_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table isp_pppoe_portal_settings enable row level security;
revoke all on table isp_pppoe_portal_settings from anon, authenticated;
grant select, insert, update on table isp_pppoe_portal_settings to service_role;
