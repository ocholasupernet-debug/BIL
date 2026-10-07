-- Tie public payment retries and provider checkout IDs to a single payment row,
-- and retain the transaction that first created each paid Hotspot account.
alter table public.isp_transactions
  add column if not exists payment_intent_id text,
  add column if not exists provider_checkout_id text;

alter table public.isp_customers
  add column if not exists hotspot_purchase_transaction_id bigint;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'isp_customers_hotspot_purchase_transaction_fkey'
       and conrelid = 'public.isp_customers'::regclass
  ) then
    alter table public.isp_customers
      add constraint isp_customers_hotspot_purchase_transaction_fkey
      foreign key (hotspot_purchase_transaction_id)
      references public.isp_transactions(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists isp_transactions_payment_intent_id_uidx
  on public.isp_transactions(payment_intent_id)
  where payment_intent_id is not null;

create unique index if not exists isp_transactions_provider_checkout_id_uidx
  on public.isp_transactions(provider_checkout_id)
  where provider_checkout_id is not null;

create unique index if not exists isp_customers_hotspot_purchase_transaction_id_uidx
  on public.isp_customers(hotspot_purchase_transaction_id)
  where hotspot_purchase_transaction_id is not null;

notify pgrst, 'reload schema';
