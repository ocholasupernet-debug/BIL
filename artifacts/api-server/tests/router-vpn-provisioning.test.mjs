import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const provisioning = await readFile("src/lib/router-vpn-provisioning.ts", "utf8");
const ssh = await readFile("src/lib/vps-ssh.ts", "utf8");
const migrationRunner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");
const migration = await readFile("migrations/2026_router_vpn_fallbacks.sql", "utf8");
const mikrotik = await readFile("src/lib/mikrotik.ts", "utf8");

test("VPS reconciliation is server-side, additive, and idempotent", () => {
  assert.match(provisioning, /export function generateVpsReconciliationScript/);
  assert.match(provisioning, /flock -n 9/);
  assert.match(provisioning, /wg syncconf/);
  assert.match(provisioning, /router-\$ROUTER_ID\.conf/);
  assert.match(provisioning, /resolution=merge-duplicates/);
  assert.match(provisioning, /OCHOLA_VPN_READY=true/);
  assert.match(provisioning, /does not include \/etc\/ipsec\.d/);
  assert.match(provisioning, /does not include \/etc\/ipsec\.secrets\.d/);
  assert.doesNotMatch(provisioning, /console\.log\([^)]*(private|psk|password)/i);
});

test("VPS SSH transport cleans temporary credentials and bounds execution", () => {
  assert.match(ssh, /\/tmp\/ochola-vps-key-\$\{randomUUID\(\)\}/);
  assert.match(ssh, /unlinkSync\(keyPath\)/);
  assert.match(ssh, /unlinkSync\(askPassPath\)/);
  assert.match(ssh, /child\.kill\("SIGKILL"\)/);
  assert.match(ssh, /OUTPUT_LIMIT/);
  assert.doesNotMatch(ssh, /console\.log/);
});

test("fallback persistence is service-role-only and migration runner applies it", () => {
  assert.match(migration, /router_vpn_fallbacks/);
  assert.match(migration, /router_vpn_fallback_secrets/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table router_vpn_fallbacks/);
  assert.match(migrationRunner, /2026_router_vpn_fallbacks\.sql/);
});

test("IPsec fallback uses per-router identities for unique server PSKs", () => {
  assert.match(provisioning, /leftid=@ochola-router-\$ROUTER_ID-server/);
  assert.match(provisioning, /rightid=@router-\$ROUTER_ID/);
  assert.match(mikrotik, /my-id=fqdn:router-\$\{routerId\}/);
  assert.match(mikrotik, /remote-id=fqdn:ochola-router-\$\{routerId\}-server/);
});

test("legacy and migration VPN networks remain explicitly separate", () => {
  assert.match(provisioning, /customer OpenVPN \(1194\/10\.8\.0\.x\)/);
  assert.match(provisioning, /migration VPN \(temporary leases\)/);
  assert.match(provisioning, /10\.8\.5\.0\/24/);
});