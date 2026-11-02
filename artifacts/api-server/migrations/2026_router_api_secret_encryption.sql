alter table public.isp_routers
  add column if not exists router_secret_lookup_hash text;

create index if not exists isp_routers_router_secret_lookup_hash_idx
  on public.isp_routers (router_secret_lookup_hash)
  where router_secret_lookup_hash is not null;
