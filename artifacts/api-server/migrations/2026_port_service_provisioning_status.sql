-- Port-service deployments persist an intermediate provisioning state while
-- RouterOS resources are being applied. Keep the database check aligned with
-- the API state machine so a failed or in-flight deployment can be recorded.
alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_status_check;

alter table if exists public.isp_reseller_ports
  add constraint isp_reseller_ports_status_check
  check (status in ('pending', 'provisioning', 'active', 'failed', 'disabled'));

notify pgrst, 'reload schema';