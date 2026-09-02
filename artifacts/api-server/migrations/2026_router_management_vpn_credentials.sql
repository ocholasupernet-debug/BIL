-- Per-router management OpenVPN identities.
-- Password material is encrypted by the API with SESSION_SECRET before storage.
alter table if exists isp_routers
  add column if not exists management_vpn_username text;
alter table if exists isp_routers
  add column if not exists management_vpn_password_ciphertext text;
alter table if exists isp_routers
  add column if not exists management_vpn_password_iv text;
alter table if exists isp_routers
  add column if not exists management_vpn_password_auth_tag text;

create unique index if not exists isp_routers_management_vpn_username_idx
  on isp_routers(management_vpn_username)
  where management_vpn_username is not null;