-- Keep the shared RADIUS accounting relation aligned with the fields used by
-- voucher inventory, voucher recovery, and Hotspot session management.
ALTER TABLE IF EXISTS public.radacct
  ADD COLUMN IF NOT EXISTS acctstarttime timestamptz,
  ADD COLUMN IF NOT EXISTS callingstationid text,
  ADD COLUMN IF NOT EXISTS acctinputgigawords bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acctoutputgigawords bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acctterminatecause text;
