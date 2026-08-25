-- Keep deferred M-Pesa callback reconciliation bounded and efficient.
-- The application only retries recent received events in small batches, then
-- marks unmatched events ignored before purging old terminal records.

create index if not exists isp_webhook_events_mpesa_received_idx
  on public.isp_webhook_events(gateway, status, created_at asc);