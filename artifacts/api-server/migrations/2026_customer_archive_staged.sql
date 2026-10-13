-- Reversible archive support for prepaid customer records.
-- This migration does not delete or modify customer or transaction rows.

begin;

alter table public.isp_customers
  add column if not exists archived_at timestamptz;

create index if not exists isp_customers_unarchived_admin_created_idx
  on public.isp_customers(admin_id, created_at desc)
  where archived_at is null;

commit;
