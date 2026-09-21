-- Align the persisted default Hotspot pool name with the RouterOS shared
-- service contract. The runtime pool initializer also handles older rows named
-- "active" when a router is next reconciled.
update public.isp_ip_pools
set name = 'hotspot pool',
    updated_at = now()
where lower(trim(name)) = 'active';