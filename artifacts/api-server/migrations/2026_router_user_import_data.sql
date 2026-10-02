alter table public.isp_customers
  add column if not exists router_import_data jsonb;