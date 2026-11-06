# RouterOS `mainhotspot.rsc` Audit and Implementation Plan

**Scope:** Read-only audit of the current BIL RouterOS installer, provisioning
routes, generated scripts, router-management code, and schema. No production
router or production database was accessed or changed.

## Audit findings

### Existing installer and script delivery

- There is no active `mainhotspot.rsc` source package or `/scripts/mainhotspot.rsc`
  endpoint. The remaining `router-takeover-template` helper validates a legacy
  reference file; it does not serve an installer.
- Self Install currently returns separate network, VPN, and service scripts,
  plus Hotspot assets. Greenfield and Brownfield use different generated paths.
  Zero-Touch was intentionally left blank and its API path currently returns
  `410`.
- The Self Install API performs side effects during generation: it may persist
  a router registration token and reconcile the VPS management VPN before it
  returns script steps.
- One-time file sources are held in process memory for five minutes. Some
  routes use random bearer tokens; Self Install also has deterministic
  router-ID/filename URLs with bounded fetch retries. Neither path persists a
  provisioning audit trail or provides durable replay state across API restarts.
- Generated Self Install content can contain management VPN, API, or RADIUS
  values. The current network generator creates an API user in RouterOS group
  `full`, rather than the requested dedicated least-privilege automation user.

### Existing configuration behavior

- The network generator checks RouterOS major version 6 or 7 and reports
  board, memory, and storage; it does not feature-detect every operation.
  Existing rules are generally tagged and managed additively, but there is no
  consolidated discovery → backup/export → diff → staged apply workflow.
- Existing direct service generation uses Hotspot `192.168.180.0/22` and
  PPPoE `192.168.99.0/24` with expired pool `192.168.191.0/24`.
  Brownfield/Coexistence uses a separate `172.16.99.0/24` service plane.
  These current paths are not being changed by this audit.
- Existing inventory endpoints can read interfaces, Hotspot users, and PPPoE
  sessions. They do not yet form the complete, version-aware snapshot required
  to safely validate WAN, VLAN/OLT, DHCP, routes, firewall, services, and VPN
  before a new install.
- OpenVPN management and separate WireGuard/IPsec fallback code already exist.
  The new installer must reuse or explicitly preserve those resources rather
  than creating duplicate interfaces or replacing certificates and routes.

### Existing schema and authorization

- `isp_routers` is tenant-owned (`admin_id`) and records router identity,
  model, RouterOS version, connection fields, API settings, and status.
- VPN fallback secrets have separate encrypted storage. The audit did not find
  a dedicated durable installer-token, installer-version, backup, or
  provisioning-download history structure.
- Admin-facing router APIs and existing in-memory sources are not a suitable
  replacement for a signed, short-lived, tenant/router-bound token with
  durable replay protection and audit logging.

## Safe implementation plan

1. Add an isolated `mainhotspot.rsc` compiler/package. Keep current installer
   families and every existing Hotspot layout file unchanged.
2. Add tenant-scoped admin generation for a concise HTTPS fetch-and-import
   command. Use an opaque, short-lived, router-bound token; record issuance,
   fetch, expiry, replay, and outcome without logging the token or secrets.
3. Make the script perform read-only identity/version/interface/service
   discovery, create a backup and export, validate address/interface/VLAN
   conflicts, and stop before configuration when any unsafe conflict exists.
4. Add version/hardware-specific module builders for WAN, bridge, Hotspot,
   PPPoE, firewall/NAT, VPN, API access, RADIUS, DNS/time, and diagnostics.
   Reconcile only explicitly BIL-owned resources; preserve unrelated and
   customer-owned configuration.
5. Extend the tenant UI with router settings, preview/diff, version/checksum,
   copy/download, and staged-run status/history. Keep explicit apply
   confirmation and rollback guidance.
6. Add unit and route tests for generated script syntax/contracts,
   authorization, tenant isolation, token expiry/replay, conflicts, and
   failure behavior; run builds. Do not claim hardware testing without an
   actual RouterOS 6/7 device test.

## Constraints

- No production database migration will be applied automatically.
- No installer script will be run on a production router during development.
- A staging build/test cannot establish compatibility with every MikroTik
  model or RouterOS patch release. Hardware validation remains a separate
  required release gate.
