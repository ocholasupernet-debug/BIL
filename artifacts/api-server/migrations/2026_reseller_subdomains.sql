-- Give reseller accounts their own first-level tenant hostname. Existing
-- reseller rows were historically created without a subdomain, which made
-- them fall back to the parent ISP hostname.
do $$
declare
  reseller record;
  base text;
  candidate text;
  suffix integer;
begin
  for reseller in
    select id, coalesce(nullif(company_name, ''), nullif(name, ''), nullif(username, ''), 'reseller') as source
    from public.isp_admins
    where role = 'reseller'
      and subdomain is null
    order by id
  loop
    base := lower(regexp_replace(reseller.source, '[^a-z0-9]+', '-', 'g'));
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    base := left(base, 58);
    if base = '' or base in ('www', 'api', 'vpn', 'register', 'latex', 'proxyvpn', 'mail', 'admin') then
      base := 'reseller';
    end if;

    candidate := base;
    suffix := 2;
    while exists (
      select 1
      from public.isp_admins existing
      where lower(existing.subdomain) = candidate
        and existing.id <> reseller.id
    ) loop
      candidate := left(base, 63 - length(suffix::text) - 1) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;

    update public.isp_admins
    set subdomain = candidate,
        updated_at = now()
    where id = reseller.id
      and subdomain is null;
  end loop;
end
$$;