-- Move only ledger-supported legacy points to the payer's two most recently
-- used, unambiguous device MACs. The legacy phone balances remain untouched;
-- the existing customer view subtracts device balances when showing the
-- remaining legacy amount.
create table if not exists public.isp_loyalty_device_legacy_allocations (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  legacy_phone text not null,
  device_mac text not null check (device_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  points_delta numeric(14,2) not null check (points_delta > 0),
  source_ledger_ids text[] not null,
  source_last_activity timestamptz not null,
  created_at timestamptz not null default now(),
  unique (admin_id, legacy_phone, device_mac)
);

alter table public.isp_loyalty_device_legacy_allocations enable row level security;
revoke all on public.isp_loyalty_device_legacy_allocations from anon, authenticated;
grant all on public.isp_loyalty_device_legacy_allocations to service_role;
grant usage, select on sequence public.isp_loyalty_device_legacy_allocations_id_seq to service_role;

-- Stage exact allocations first, and abort rather than applying an unexpected
-- amount if production data changed after the reviewed preview.
create temporary table loyalty_legacy_mac_allocations as
with legacy as (
  select a.admin_id,
         case
           when regexp_replace(a.phone, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
             then '254' || substr(regexp_replace(a.phone, '\D', '', 'g'), 2)
           else regexp_replace(a.phone, '\D', '', 'g')
         end as phone,
         sum(a.points_balance + a.fractional_balance) as balance
    from public.isp_loyalty_accounts a
   group by a.admin_id, 2
), device_totals as (
  select d.admin_id,
         case
           when regexp_replace(d.phone, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
             then '254' || substr(regexp_replace(d.phone, '\D', '', 'g'), 2)
           else regexp_replace(d.phone, '\D', '', 'g')
         end as phone,
         sum(d.points_balance + d.fractional_balance) as balance
    from public.isp_loyalty_device_accounts d
   where d.phone is not null
   group by d.admin_id, 2
), residual as (
  select l.admin_id, l.phone,
         greatest(0, l.balance - coalesce(d.balance, 0)) as remaining
    from legacy l
    left join device_totals d using (admin_id, phone)
   where greatest(0, l.balance - coalesce(d.balance, 0)) > 0
), mac_totals as (
  select l.admin_id,
         case
           when regexp_replace(l.phone, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
             then '254' || substr(regexp_replace(l.phone, '\D', '', 'g'), 2)
           else regexp_replace(l.phone, '\D', '', 'g')
         end as phone,
         upper(regexp_replace(t.mac_address, '[^0-9A-F]', '', 'gi')) as compact_mac,
         sum(l.points_delta) as net_points,
         array_agg(l.id::text order by l.created_at, l.id) as source_ledger_ids,
         max(l.created_at) as last_activity
    from public.isp_loyalty_ledger l
    join public.isp_transactions t on t.id = l.transaction_id
   where upper(regexp_replace(coalesce(t.mac_address, ''), '[^0-9A-F]', '', 'gi'))
         ~ '^[0-9A-F]{12}$'
   group by l.admin_id, 2, upper(regexp_replace(t.mac_address, '[^0-9A-F]', '', 'gi'))
), ranked as (
  select m.*,
         row_number() over (
           partition by m.admin_id, m.phone
           order by m.last_activity desc, m.compact_mac
         ) as device_rank,
         exists (
           select 1 from mac_totals other
            where other.admin_id = m.admin_id
              and other.compact_mac = m.compact_mac
              and other.phone <> m.phone
         ) as shared_mac,
         coalesce(a.points_balance + a.fractional_balance, 0) as current_device_balance
    from mac_totals m
    left join public.isp_loyalty_device_accounts a
      on a.admin_id = m.admin_id
     and a.device_mac =
         substr(m.compact_mac, 1, 2) || ':' || substr(m.compact_mac, 3, 2) || ':' ||
         substr(m.compact_mac, 5, 2) || ':' || substr(m.compact_mac, 7, 2) || ':' ||
         substr(m.compact_mac, 9, 2) || ':' || substr(m.compact_mac, 11, 2)
), eligible as (
  select r.admin_id, r.phone, r.remaining, m.compact_mac, m.device_rank,
         m.net_points, m.source_ledger_ids, m.last_activity,
         greatest(m.net_points - m.current_device_balance, 0) as available
    from residual r
    join ranked m using (admin_id, phone)
   where m.device_rank <= 2
     and not m.shared_mac
     and m.net_points > 0
), credited as (
  select e.*,
         least(
           e.available,
           greatest(
             e.remaining - coalesce(
               sum(e.available) over (
                 partition by e.admin_id, e.phone
                 order by e.device_rank
                 rows between unbounded preceding and 1 preceding
               ),
               0
             ),
             0
           )
         ) as credit
    from eligible e
)
select admin_id, phone as legacy_phone,
       substr(compact_mac, 1, 2) || ':' || substr(compact_mac, 3, 2) || ':' ||
       substr(compact_mac, 5, 2) || ':' || substr(compact_mac, 7, 2) || ':' ||
       substr(compact_mac, 9, 2) || ':' || substr(compact_mac, 11, 2) as device_mac,
       credit as points_delta, source_ledger_ids, last_activity as source_last_activity
  from credited
 where credit > 0;

do $$
declare
  allocation_count integer;
  allocation_total numeric(14,2);
begin
  if not exists (select 1 from public.isp_loyalty_device_legacy_allocations) then
    select count(*), coalesce(round(sum(points_delta), 2), 0)
      into allocation_count, allocation_total
      from loyalty_legacy_mac_allocations;
    if allocation_count <> 3 or allocation_total <> 1.83 then
      raise exception 'Legacy loyalty preview changed; expected 3 allocations totaling 1.83 points, found % totaling %.',
        allocation_count, allocation_total;
    end if;
  end if;
end $$;

with inserted_allocations as (
  insert into public.isp_loyalty_device_legacy_allocations
    (admin_id, legacy_phone, device_mac, points_delta, source_ledger_ids, source_last_activity)
  select admin_id, legacy_phone, device_mac, points_delta, source_ledger_ids, source_last_activity
    from loyalty_legacy_mac_allocations
   where not exists (
     select 1 from public.isp_loyalty_device_legacy_allocations
   )
  on conflict (admin_id, legacy_phone, device_mac) do nothing
  returning admin_id, legacy_phone, device_mac, points_delta
)
insert into public.isp_loyalty_device_accounts
  (admin_id, device_mac, phone, points_balance, fractional_balance, updated_at)
select admin_id, device_mac, legacy_phone,
       floor(points_delta)::bigint,
       (points_delta - floor(points_delta))::numeric(3,2),
       now()
  from inserted_allocations
on conflict (admin_id, device_mac) do update
  set points_balance = floor(
        public.isp_loyalty_device_accounts.points_balance
        + public.isp_loyalty_device_accounts.fractional_balance
        + excluded.points_balance
        + excluded.fractional_balance
      )::bigint,
      fractional_balance = (
        public.isp_loyalty_device_accounts.points_balance
        + public.isp_loyalty_device_accounts.fractional_balance
        + excluded.points_balance
        + excluded.fractional_balance
        - floor(
            public.isp_loyalty_device_accounts.points_balance
            + public.isp_loyalty_device_accounts.fractional_balance
            + excluded.points_balance
            + excluded.fractional_balance
          )
      )::numeric(3,2),
      phone = coalesce(public.isp_loyalty_device_accounts.phone, excluded.phone),
      updated_at = now();
