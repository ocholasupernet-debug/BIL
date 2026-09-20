-- Keep prepaid usernames unique even when a phone number is reused.
-- Existing duplicate values are made unique before the indexes are created.
with duplicate_usernames as (
  select
    id,
    username,
    row_number() over (partition by lower(trim(username)) order by id) as duplicate_number
  from public.isp_customers
  where username is not null and trim(username) <> ''
)
update public.isp_customers as customer
set username = trim(duplicate_usernames.username) || '-' || customer.id
from duplicate_usernames
where customer.id = duplicate_usernames.id
  and duplicate_usernames.duplicate_number > 1;

create unique index if not exists isp_customers_username_unique_idx
  on public.isp_customers (lower(trim(username)))
  where username is not null and trim(username) <> '';

create unique index if not exists isp_customers_pppoe_username_unique_idx
  on public.isp_customers (lower(trim(pppoe_username)))
  where pppoe_username is not null and trim(pppoe_username) <> '';