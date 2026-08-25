-- Per-ISP BankStkPush details used to create a Daraja PayBill prompt.
alter table if exists isp_admins
  add column if not exists payment_gateway_config jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';