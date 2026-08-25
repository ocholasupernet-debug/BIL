-- The registration payment recipient is separate from the ISP contact number.
-- It is intentionally not unique: one M-Pesa number may pay for any number
-- of ISP registrations.

alter table public.isp_admins
  add column if not exists payment_phone text;