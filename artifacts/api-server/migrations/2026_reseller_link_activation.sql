-- Manual wholesale-link lifecycle is separate from RouterOS provisioning status.
-- `status` on isp_reseller_ports continues to describe whether the port service
-- was provisioned; link_status describes whether wholesale customer traffic is
-- allowed for the assigned reseller.

alter table if exists public.isp_reseller_ports
  add column if not exists link_status text not null default 'pending',
  add column if not exists vlan_tag text,
  add column if not exists link_provisioning_error text;

update public.isp_reseller_ports
set link_status = case
  when status = 'active' and assigned_reseller_id is not null then 'active'
  else 'pending'
end
where link_status is null
   or link_status not in ('pending', 'active', 'suspended');

-- Older migrations copied reseller_id into assigned_reseller_id for every row.
-- An ISP-owned multiport service may retain reseller_id for compatibility, but
-- it must not be treated as a reseller payment route.
update public.isp_reseller_ports as port
set assigned_reseller_id = null
where port.assigned_reseller_id = port.admin_id
  and exists (
    select 1
    from public.isp_admins as owner
    where owner.id = port.admin_id
      and owner.role <> 'reseller'
  );

alter table public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_link_status_check;

alter table public.isp_reseller_ports
  add constraint isp_reseller_ports_link_status_check
  check (link_status in ('pending', 'active', 'suspended'));

create index if not exists isp_reseller_ports_link_status_idx
  on public.isp_reseller_ports(admin_id, assigned_reseller_id, link_status);

notify pgrst, 'reload schema';