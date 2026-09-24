alter table if exists public.isp_plans
  add column if not exists owner_reseller_id bigint
    references public.isp_admins(id) on delete cascade;

create index if not exists isp_plans_owner_reseller_idx
  on public.isp_plans(admin_id, owner_reseller_id);

notify pgrst, 'reload schema';