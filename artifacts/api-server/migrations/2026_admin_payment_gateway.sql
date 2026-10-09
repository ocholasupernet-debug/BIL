-- ISP admins choose their active M-Pesa gateway independently.
alter table if exists isp_admins
  add column if not exists payment_gateway text not null default 'mpesa_paybill';

-- This migration is replayed on deployment; keep the list aligned with PAYMENT_GATEWAY_IDS.
update isp_admins
set payment_gateway = 'mpesa_paybill'
where payment_gateway is null
   or payment_gateway not in (
     'mpesa_paybill',
     'mpesa_till_push',
     'bank_stk_push',
     'airtel',
     'azampay',
     'custom_paybill',
     'dpo_payments',
     'flutterwave',
     'intasend',
     'pesapal',
     'stripe',
     'paypal',
     'tigopesa',
     'xendit',
     'bank_transfer',
     'manual'
   );

notify pgrst, 'reload schema';