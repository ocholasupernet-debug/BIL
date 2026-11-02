---
name: Supabase REST tenant-list pagination
description: Avoid silently incomplete tenant-wide reads through Supabase PostgREST.
---

Tenant-wide Supabase REST reads can be capped at 1,000 rows. For full customer lists, fetch stable batches using an ascending primary-key cursor rather than one unbounded request or mutable offsets.

**Why:** The production ISP tenant has more than 3,000 prepaid records; a single REST response silently omitted newer purchases while the UI appeared to load normally.

**How to apply:** Review tenant-wide reads for explicit bounds and pagination. Prefer keyset pagination, propagate query failures instead of returning an empty list, and add a test that exceeds one page.
