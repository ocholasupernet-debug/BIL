---
name: Authorization test contracts
description: Avoid false authorization regressions when deployment reconciliation preserves Hotspot roaming
---

Tenant authorization tests should verify scoped ownership, denied results, and absence of unauthorized router writes, rather than require physical router/port filters on every candidate-plan read.

**Why:** During release reconciliation, a legacy query-shape assertion failed despite correctly rejecting a sibling account. Authorized Hotspot roaming requires inspecting tenant-owned plans whose purchase origin may differ from the current service.

**How to apply:** Keep tenant restrictions mandatory on candidate reads and test service/roaming authorization outcomes separately. Do not remove rejection or zero-write assertions just to pass a release check.
