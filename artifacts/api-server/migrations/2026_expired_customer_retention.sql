-- Retain only a tenant-scoped aggregate when safely purging old expired
-- prepaid customer rows. Transaction-linked records and admin accounts are
-- deliberately outside the deletion scope.
begin;

create table if not exists public.isp_expired_customer_history (
  admin_id bigint primary key,
  permanently_deleted_count bigint not null default 0 check (permanently_deleted_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on public.isp_expired_customer_history from public, anon, authenticated;
grant select, insert, update on public.isp_expired_customer_history to service_role;

create or replace function public.purge_expired_prepaid_customers(
  p_grace_days integer default 180,
  p_batch_size integer default 500
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint := 0;
begin
  if p_grace_days < 180 or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'Invalid expired-customer retention parameters';
  end if;

  with candidates as (
    select c.id, c.admin_id
    from public.isp_customers c
    where c.admin_id is not null
      and lower(coalesce(c.status, '')) <> 'suspended'
      and (
        lower(coalesce(c.status, '')) = 'expired'
        or lower(coalesce(c.depletion_reason, '')) = 'data_limit'
        or (c.expires_at is not null and c.expires_at <= now())
      )
      and coalesce(c.expires_at, c.updated_at, c.created_at) <= now() - make_interval(days => p_grace_days)
      -- Protect the dedicated Hotspot admin-grant identity.
      and coalesce(c.username, '') !~* '^tv[0-9]+[0-9a-f]{12}$'
      -- Never detach payment rows or change their customer_id linkage.
      and not exists (
        select 1
        from public.isp_transactions t
        where t.customer_id = c.id
           or t.id = c.hotspot_purchase_transaction_id
      )
    order by coalesce(c.expires_at, c.updated_at, c.created_at), c.id
    limit p_batch_size
    for update of c skip locked
  ),
  deleted as (
    delete from public.isp_customers c
    using candidates x
    where c.id = x.id and c.admin_id = x.admin_id
    returning c.admin_id
  ),
  counts as (
    select admin_id, count(*)::bigint as deleted_count
    from deleted
    group by admin_id
  ),
  saved as (
    insert into public.isp_expired_customer_history (admin_id, permanently_deleted_count, updated_at)
    select admin_id, deleted_count, now() from counts
    on conflict (admin_id) do update
      set permanently_deleted_count =
            public.isp_expired_customer_history.permanently_deleted_count + excluded.permanently_deleted_count,
          updated_at = now()
    returning permanently_deleted_count
  )
  select coalesce(sum(deleted_count), 0)::bigint into v_deleted from counts;

  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_prepaid_customers(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_prepaid_customers(integer, integer) to service_role;

commit;
