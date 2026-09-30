---
name: Prepaid session enforcement
description: Durable RouterOS behavior for prepaid speed, data, and expiry changes
---

RouterOS applies hotspot and PPPoE profile policy when a session is established. Administrative policy changes must disconnect affected sessions and refresh the wall-clock expiry scheduler. A same-checkout paid-access retry is different: preserve an already-active session and its counters until the package expiry scheduler disconnects it.

After the expiry scheduler returns a user to the ordinary RouterOS login page, automatically check the latest purchase for that tenant and device MAC and explain an expired or depleted package with a new-package sign-in action. Keep this display lookup database-only; every actual login must still run the full server-side quota check.

For cumulative Hotspot usage, read the persistent `/ip/hotspot/user` counters rather than active-session counters. Routine sync and refresh must not reset counters or reduce stored usage; a new verified checkout is the reset boundary. FUP throttle packages must not carry a hard byte cap into RouterOS.

**Why:** Updating the database, RADIUS rows, or RouterOS user record alone does not reliably change an already-authenticated session, and hotspot users do not have a native wall-clock expiry field. Session counters can reset on reconnect; routine resets or lower observations can restore depleted access, while retry-based expiry recomputation can extend purchased access. A disconnect without an explanation looks like a network failure, while router quota reads on every landing page add avoidable API traffic.

**How to apply:** Keep prepaid admin changes behind server-side RouterOS reconciliation. Disable and disconnect suspended or expired users, set local byte limits where configured, and schedule future expiry on the management router. Use a database-only lookup for the landing-page notice, but always enforce hard-cap usage before login. Only reset usage for a new verified purchase. In same-checkout retry paths, reuse the original expiry, avoid counter resets and disconnects, and report active only after RouterOS confirms the target device session.