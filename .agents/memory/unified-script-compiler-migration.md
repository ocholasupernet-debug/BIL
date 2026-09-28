---
name: Unified RouterOS script compiler migration
description: Introduce the unified compiler without deleting production installer families before hardware validation.
---

The unified RouterOS compiler must be migrated into existing Self Install, VPN recovery, portal, migration, and legacy Main ISP script callers incrementally. Do not purge those families in one destructive change.

**Why:** They have separate tenant scopes, authorization grants, RouterOS 6/7 compatibility rules, recovery semantics, and deployed URL contracts; removing them before hardware validation can disconnect or strand installed routers.

**How to apply:** Keep the compiler isolated and admin-protected while callers migrate. Validate each generated profile on RouterOS 6 and 7, preserve legacy endpoint contracts during the transition, then retire a generator only after its callers and deployment paths are covered.