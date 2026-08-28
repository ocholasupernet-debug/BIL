-- Tenant hostnames are first-level labels under isplatty.org. Platform
-- service labels must remain available for their dedicated endpoints.
alter table if exists public.isp_admins
  drop constraint if exists isp_admins_reserved_subdomain_check;

alter table if exists public.isp_admins
  add constraint isp_admins_reserved_subdomain_check
  check (
    subdomain is null
    or lower(subdomain) not in ('www', 'api', 'vpn', 'register', 'proxyvpn', 'mail', 'admin')
  ) not valid;

notify pgrst, 'reload schema';