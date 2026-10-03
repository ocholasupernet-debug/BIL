---
name: Hotspot preview plan source
description: How generated hotspot previews should treat embedded packages versus live RouterOS portal refreshes.
---

Local hotspot previews must treat the embedded package list as authoritative and skip the live plan refresh. When an ISP router has no router-wide packages, an authenticated preview-only lookup may include eligible hotspot packages from that same router's assigned ports. Reseller previews remain limited to the selected assigned port. Downloads and deployed router portals must never use this broader preview fallback.

**Why:** A router-only package request returns only `port_id IS NULL`, so an ISP admin's local preview otherwise misses valid packages created against a service port. Falling back across routers or reseller-owned sibling ports would show packages that do not belong to the selected service.

**How to apply:** Mark preview exports explicitly in the portal bootstrap configuration. For a generic ISP router preview with no router-wide packages, gate the fallback behind an authenticated preview-only context request and validate the selected router server-side. Keep assigned-service previews exact-port scoped, including reseller fallback, and never use the broader fallback for downloads or deployed portal files.

Customer-facing Hotspot plan refreshes require tenant context and either router or assigned-port context. Missing scope is a non-success response; a successful empty list remains authoritative only for a valid scope.

**Why:** The portal treats a successful empty list as proof that no eligible packages exist and removes embedded packages. Missing scope is a failed lookup, not evidence that the scoped router has no plans.

**How to apply:** Validate tenant plus router/port scope before querying customer Hotspot plans. Test both missing-scope failure and valid-scope empty success.

Assigned-service previews must represent that exact service, unlike a generic branding preview that may show sample packages. Never substitute router-wide or sibling-port packages for an empty assigned-port list.

**Why:** A generic administrator plan listing and a customer-facing assigned-service listing have different visibility rules. Treating the former as a substitute made physical-port packages disappear from previews or risked displaying unrelated packages.

**How to apply:** Carry the selected router and assigned port together through preview, export, and consent-gated service deployment. Any authenticated reseller preview fallback must remain restricted to the same router and port. Preserve custom asset selections rather than silently replacing their templates.

Payment availability must disable checkout controls, not hide the package list. Hide packages only for maintenance or an explicit package-visibility setting.

**Why:** The asynchronous branding configuration can arrive after the embedded package list renders; coupling package visibility to the M-Pesa prompt setting makes valid packages flash and then disappear.

**How to apply:** Keep package-section visibility independent of payment readiness. Continue to fail closed for checkout until the scoped payment method is ready.
