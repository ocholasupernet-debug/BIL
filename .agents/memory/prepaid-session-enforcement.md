---
name: Prepaid session enforcement
description: Durable RouterOS behavior for prepaid speed, data, and expiry changes
---

RouterOS applies hotspot and PPPoE profile policy when a session is established. After changing a prepaid user's profile, byte cap, status, or expiry, disconnect all active sessions and refresh the wall-clock expiry scheduler.

**Why:** Updating the database, RADIUS rows, or RouterOS user record alone does not reliably change an already-authenticated session, and hotspot users do not have a native wall-clock expiry field.

**How to apply:** Keep prepaid admin and payment paths behind server-side RouterOS reconciliation. Disable and disconnect suspended or expired users, set local byte limits where configured, and schedule future expiry on the management router.