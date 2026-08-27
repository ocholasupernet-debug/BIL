-- New ISP accounts share the temporary "admin" username within their own
-- subdomain. Existing administrators keep their current credentials.
alter table if exists public.isp_admins
  add column if not exists must_change_password boolean not null default false;

alter table if exists public.isp_admins
  drop constraint if exists isp_admins_username_key;

drop index if exists public.isp_admins_username_key;

create unique index if not exists isp_admins_subdomain_username_key
  on public.isp_admins(subdomain, username)
  where username is not null;

notify pgrst, 'reload schema';