-- Permit a contact email and phone to be shared by up to seven top-level
-- registrations, without allowing concurrent requests to exceed that limit.

create or replace function public.registration_phone_key(p_phone text, p_phone_e164 text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  source_phone text;
  digits text;
begin
  source_phone := coalesce(
    nullif(btrim(p_phone_e164), ''),
    nullif(btrim(p_phone), ''),
    ''
  );
  digits := regexp_replace(
    source_phone,
    '\D',
    '',
    'g'
  );
  if digits = '' then
    return null;
  end if;
  if left(digits, 2) = '00' then
    return substr(digits, 3);
  end if;
  if left(source_phone, 1) = '+' or nullif(btrim(p_phone_e164), '') is not null then
    return digits;
  end if;
  if left(digits, 1) = '0' then
    return '254' || substr(digits, 2);
  end if;
  if left(digits, 3) = '254' then
    return digits;
  end if;
  return '254' || digits;
end;
$$;

create index if not exists isp_admins_registration_email_usage_idx
  on public.isp_admins ((lower(btrim(coalesce(email, '')))))
  where parent_id is null
    and role in ('isp_admin', 'reseller')
    and status::text is distinct from 'payment_failed';

create index if not exists isp_admins_registration_phone_usage_idx
  on public.isp_admins (public.registration_phone_key(phone, phone_e164))
  where parent_id is null
    and role in ('isp_admin', 'reseller')
    and status::text is distinct from 'payment_failed';

create or replace function public.registration_contact_capacity(
  p_email text,
  p_phone text
)
returns table (allowed boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_phone text := public.registration_phone_key(p_phone, null);
  email_count bigint := 0;
  phone_count bigint := 0;
begin
  if normalized_email <> '' then
    select count(*) into email_count
    from public.isp_admins a
    where a.parent_id is null
      and a.role in ('isp_admin', 'reseller')
      and a.status::text is distinct from 'payment_failed'
      and lower(btrim(coalesce(a.email, ''))) = normalized_email;
  end if;

  if normalized_phone is not null then
    select count(*) into phone_count
    from public.isp_admins a
    where a.parent_id is null
      and a.role in ('isp_admin', 'reseller')
      and a.status::text is distinct from 'payment_failed'
      and public.registration_phone_key(a.phone, a.phone_e164) = normalized_phone;
  end if;

  return query select email_count < 7 and phone_count < 7;
end;
$$;

revoke all on function public.registration_contact_capacity(text, text) from public;
grant execute on function public.registration_contact_capacity(text, text) to service_role;

create or replace function public.enforce_registration_contact_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  normalized_email text := lower(btrim(coalesce(new.email, '')));
  normalized_phone text := public.registration_phone_key(new.phone, new.phone_e164);
  email_lock bigint;
  phone_lock bigint;
  lock_key bigint;
  email_count bigint := 0;
  phone_count bigint := 0;
begin
  if new.parent_id is not null
    or new.role is null
    or new.role not in ('isp_admin', 'reseller')
    or new.status::text = 'payment_failed' then
    return new;
  end if;

  if normalized_email <> '' then
    email_lock := hashtextextended('registration-email:' || normalized_email, 0);
  end if;
  if normalized_phone is not null then
    phone_lock := hashtextextended('registration-phone:' || normalized_phone, 0);
  end if;

  for lock_key in
    select distinct candidate
    from unnest(array[email_lock, phone_lock]) as locks(candidate)
    where candidate is not null
    order by candidate
  loop
    perform pg_advisory_xact_lock(lock_key);
  end loop;

  if normalized_email <> '' then
    select count(*) into email_count
    from public.isp_admins a
    where a.parent_id is null
      and a.role in ('isp_admin', 'reseller')
      and a.status::text is distinct from 'payment_failed'
      and lower(btrim(coalesce(a.email, ''))) = normalized_email
      and a.id is distinct from new.id;
    if email_count >= 7 then
      raise exception using errcode = 'P0001', message = 'registration_contact_limit';
    end if;
  end if;

  if normalized_phone is not null then
    select count(*) into phone_count
    from public.isp_admins a
    where a.parent_id is null
      and a.role in ('isp_admin', 'reseller')
      and a.status::text is distinct from 'payment_failed'
      and public.registration_phone_key(a.phone, a.phone_e164) = normalized_phone
      and a.id is distinct from new.id;
    if phone_count >= 7 then
      raise exception using errcode = 'P0001', message = 'registration_contact_limit';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_registration_contact_limit() from public;

drop trigger if exists isp_admins_registration_contact_limit on public.isp_admins;
create trigger isp_admins_registration_contact_limit
before insert or update of email, phone, phone_e164, parent_id, role, status
on public.isp_admins
for each row
execute function public.enforce_registration_contact_limit();

notify pgrst, 'reload schema';