-- ISP admins choose their active M-Pesa gateway independently.
alter table if exists isp_admins
  add column if not exists payment_gateway text not null default 'mpesa_paybill';

update isp_admins
set payment_gateway = 'mpesa_paybill'
where payment_gateway is null
   or payment_gateway not in ('mpesa_paybill', 'mpesa_till_push');

notify pgrst, 'reload schema';