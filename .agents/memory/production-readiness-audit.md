---
name: Production readiness audit
description: Live readiness checks for tenant HTTPS, router VPN exposure, and deployment verification.
---

The application health endpoint and a successful GitHub deployment do not prove router-management readiness. Tenant/router hostnames must pass public TLS hostname verification, generated installers must use the verified tenant hostname, and the OpenVPN listener, tunnel address, firewall, credentials, and RouterOS API session still require a live VPS/router test.

**Why:** The VPS can serve a healthy API while exposing TCP forwarding ports without a verified OpenVPN handshake; RouterOS verified fetches also cannot safely follow a redirect from an untrusted or differently certified host.

**How to apply:** Test the exact generated hostnames with normal certificate validation, distinguish the shared listener from per-router forwarded ports, and require a real RouterOS 6 and 7 import/reconnect before claiming production readiness.