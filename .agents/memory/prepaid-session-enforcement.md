---
name: Prepaid session enforcement
description: Durable RouterOS behavior for prepaid speed, data, and expiry changes
---

RouterOS applies hotspot and PPPoE profile policy when a session is established. Administrative policy changes must disconnect affected sessions and refresh the wall-clock expiry scheduler. A same-checkout paid-access retry is different: preserve an already-active session and its counters until the package expiry scheduler disconnects it.

**Why:** Updating the database, RADIUS rows, or RouterOS user record alone does not reliably change an already-authenticated session, and hotspot users do not have a native wall-clock expiry field. Reconnecting a paid session must not shorten or interrupt the access the customer has already purchased.

**How to apply:** Keep prepaid admin changes behind server-side RouterOS reconciliation. Disable and disconnect suspended or expired users, set local byte limits where configured, and schedule future expiry on the management router. In paid access and receipt-retry paths, reuse the same checkout expiry, avoid counter resets and disconnects, and report active only after the router confirms the target device session.