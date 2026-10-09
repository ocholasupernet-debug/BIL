# Supabase RLS hardening plan

**Status: Phase 1 browser-query migration implemented and verified. No RLS settings or production data were changed.**

This remains a rollout plan, not an executable migration. Do not enable RLS on the listed tables until the server-credential, authorization, and acceptance-test phases below are complete.

## Findings

- The Supabase inventory reported 27 public tables with row-level security disabled.
- The web client creates its Supabase client with `VITE_SUPABASE_KEY`, the public anon key.
- Admin sessions are the app's own signed API tokens, stored by the browser and sent to the API. They are not Supabase Auth access tokens, so Supabase policies based on `auth.uid()` cannot identify the signed-in tenant.
- Browser-side direct table access to these tables has been removed from the web and mobile app sources. Admin pages now use authenticated API routes; sign-in and registration use narrow public company-lookup endpoints:
  - `isp_admins`
  - `isp_customers`
  - `isp_plans`
  - `isp_routers`
  - `isp_transactions`
  - `radcheck`
  - `radusergroup`
- Router, customer, transaction, profile, and Super Admin data paths now derive scope or authorization on the server. The authenticated router-management route returns only its explicit UI allowlist rather than passing every router-table field to the browser.
- Recheck for direct Supabase calls before adding RLS; new pages can reintroduce the same exposure if they query tables from the browser.
- The server-side Supabase REST helper currently falls back to the public anon key when neither `SUPABASE_SERVICE_ROLE_KEY` nor `SUPABASE_SERVICE_KEY` is configured. That fallback must not be relied on for the post-RLS server path.

## Tables reported without RLS

`isp_activity_logs`, `isp_admins`, `isp_bandwidth`, `isp_customers`, `isp_hotspot_roaming_rules`, `isp_hotspot_users`, `isp_ip_pools`, `isp_loyalty_accounts`, `isp_loyalty_ledger`, `isp_loyalty_plan_rules`, `isp_loyalty_settings`, `isp_plans`, `isp_ppp_secrets`, `isp_pppoe_users`, `isp_router_install_events`, `isp_routers`, `isp_transactions`, `isp_vouchers`, `isp_vpn_peers`, `isp_vpn_servers`, `isp_webhook_events`, `nas`, `radacct`, `radcheck`, `radgroupreply`, `radreply`, and `radusergroup`.

Recheck this inventory against the live Supabase catalog immediately before writing the final migration; schema state can change between this audit and rollout.

## Required rollout

### 1. Move browser data access behind the authenticated API

Replace all browser `.from(...)` reads and mutations with narrowly scoped API routes. Do not add a generic table/query proxy.

**Implementation status:** complete for the current browser code. Customer, plan, router, transaction, profile, login/registration lookup, and Super Admin accesses use dedicated API routes. These routes require the signed admin or Super Admin session, derive tenant scope from it, and restrict returned fields. API type checks and route authorization tests must continue to pass before any RLS migration is considered.

- Move `isp_admins` sign-in, registration, account management, and admin-profile reads to server routes. Password verification and account state checks must remain server-side.
- Move customer, plan, router, transaction, and RADIUS operations to API routes that derive the tenant from the validated session. Ignore or reject tenant IDs supplied by the browser unless the route explicitly verifies them.
- Move public Hotspot reads to purpose-built endpoints that expose only the fields needed for the tenant/router/service in the signed portal context.
- Give Super Admin operations separate explicit routes and authorization checks; do not broaden normal tenant-admin access.

### 2. Make trusted server database access fail closed

- Require a server-only Supabase service-role credential for privileged API data access; never put it in a `VITE_` variable.
- Remove anon-key fallback from operations that must continue after public table access is revoked. Return an explicit server configuration error if the privileged credential is absent.
- Keep billing's separately scoped service key limited to billing routes. Do not use it as a general-purpose database credential.
- Audit every API route using the privileged client: RLS is bypassed by the service role, so route authentication, tenant ownership checks, and input validation remain mandatory.

### 3. Add and test the lockout migration

Only after steps 1 and 2 pass, add an idempotent migration which enables RLS and revokes direct `PUBLIC`, `anon`, and `authenticated` table privileges on the confirmed list above. Do not add public policies to preserve old browser access. Prefer the default-deny behavior for direct clients; give any required public functionality a narrowly scoped server endpoint or database function instead.

Register the migration in `artifacts/api-server/scripts/apply-deployment-migrations.mjs` and keep the schema snapshot consistent. The deployment runner replays its migration list, so every statement must be safe to run more than once.

### 4. Acceptance checks before production

- Anonymous/public-key requests cannot select, insert, update, or delete rows in each protected table.
- Tenant A cannot read or mutate Tenant B's customers, plans, routers, transactions, vouchers, or related RADIUS rows through any API route.
- A normal tenant admin cannot call Super Admin operations.
- Authorized tenant operations still work through the API with the server-only database credential.
- Public Hotspot purchase, portal display, and callback flows continue to work through their narrow scoped endpoints.
- Missing server service-role configuration causes an explicit health/configuration failure, never a silent empty result or anonymous database fallback.
- Run the API authorization tests and end-to-end smoke checks against a non-production Supabase project before production.

## Important enforcement boundary

With the current architecture, RLS will deny direct access from the browser but the Supabase service role bypasses RLS. The API must enforce each tenant boundary. If database-level tenant enforcement against API mistakes is also required, add a separate non-bypass runtime database role with transaction-scoped, server-verified tenant context; do not claim service-role-backed RLS alone provides that guarantee.

## Rollback safety

Do not deploy the lockout migration before the API conversion is complete. After the migration, prefer fixing forward or rolling back the application while preserving the lockout. Disabling RLS or restoring anon grants reopens every affected table and requires a separately reviewed incident action.
