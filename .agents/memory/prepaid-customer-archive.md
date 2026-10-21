---
name: Prepaid customer retention
description: Retention, deletion, and history rules for expired prepaid accounts.
---

Automatically purge prepaid customer rows only after at least 180 days past expiry. Keep a tenant-scoped aggregate count for the dashboard, and never delete, alter, detach, or rewrite a linked transaction. Skip any account with a related payment row, including the purchase-transaction link; exclude suspended accounts and the generated Hotspot admin-grant login. Never delete from or change `isp_admins`. Manual archival remains reversible.

**Why:** The user asked for permanent deletion of old expired prepaid users while retaining dashboard history as aggregate counts only, and emphasized that the action must not affect admins.

**How to apply:** Use a conservative 180-day expiry grace period, recheck expiry and tenant scope in the database operation, and only delete rows with no transaction relationship. Keep identity-level details out of the durable history.
