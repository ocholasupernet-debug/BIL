---
name: Hotspot file confirmation
description: Authorization and confirmation policy for tenant RouterOS Hotspot file changes.
---

Any admin already authorized for the tenant and router can explicitly confirm Hotspot portal file overwrites or removals. No separate Super Admin approval step is required. Preserve tenant/router authorization and the explicit confirmation before destructive file changes.

**Why:** the user selected any authorized admin to confirm Hotspot file overwrites and removals.

**How to apply:** Use this rule for portal deployment, replacement, and Hotspot file cleanup when unassigning a port. Do not add a Super Admin-only approval gate.