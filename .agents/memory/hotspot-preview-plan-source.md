---
name: Hotspot preview plan source
description: How generated hotspot previews should treat embedded packages versus live RouterOS portal refreshes.
---

Local hotspot previews must treat the embedded package list as authoritative and skip the live plan refresh. Installed router portals may refresh from the scoped API, where an empty successful response is meaningful.

**Why:** The preview runs with browser-visible tenant and router context that may not match a live assigned service. A successful empty response can otherwise erase valid packages already embedded for the administrator.

**How to apply:** Mark preview exports explicitly in the portal bootstrap configuration. Gate only the preview refresh path; preserve strict router/assigned-port scope for downloads and deployed portal files.