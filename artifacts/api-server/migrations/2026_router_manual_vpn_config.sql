-- OpenVPN client settings entered through the Add Router manual flow.
-- Passwords inside this JSON document are encrypted by the API.
alter table isp_routers
  add column if not exists manual_vpn_config jsonb;