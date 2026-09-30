import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const outdir = "tests/.migration-build";
await build({ entryPoints: ["src/lib/router-migration-exporter.ts", "src/lib/router-migration-importer.ts", "src/lib/router-migration-export-script.ts", "src/lib/migration-tunnel.ts", "src/lib/router-migration-vpn.ts", "src/lib/vpn-utils.ts"], outdir, bundle: true, platform: "node", format: "cjs", outExtension: { ".js": ".cjs" }, external: ["node-routeros"], logLevel: "silent" });
const exporter = await import(path.resolve(outdir, "router-migration-exporter.cjs"));
const importer = await import(path.resolve(outdir, "router-migration-importer.cjs"));
const exportScript = await import(path.resolve(outdir, "router-migration-export-script.cjs"));
const tunnelScript = await import(path.resolve(outdir, "migration-tunnel.cjs"));
const migrationVpn = await import(path.resolve(outdir, "router-migration-vpn.cjs"));
const vpnUtils = await import(path.resolve(outdir, "vpn-utils.cjs"));
await rm(outdir, { recursive: true, force: true });

test("temporary migration provisioning requires the complete backup auth directive", () => {
  const script = migrationVpn.buildRouterMigrationVpnProvisionScript({
    username: "ochola-mig-1",
    password: "temporary-secret-123456789012",
    assignedIp: "10.8.6.42",
  });
  assert.match(
    script,
    /grep -Fqx 'auth-user-pass-verify \/etc\/openvpn\/verify-router-backup-pass\.sh via-env'/,
  );
  assert.match(script, /grep -Fqx 'PASSFILE="\/etc\/openvpn\/router-backup-passwd"'/);
  assert.doesNotMatch(script, /auth-user-pass-verify \/etc\/openvpn\/verify-router-backup-pass\.sh \/etc\/openvpn\/router-backup-passwd via-env/);
  assert.doesNotMatch(script, /auth-user-pass-verify \/etc\/openvpn\/verify-router-pass\.sh/);
});

test("backup CCD scan is read-only and strictly parses occupied net30 pairs", () => {
  const script = migrationVpn.buildRouterMigrationVpnCcdScanScript();
  assert.match(script, /ochola-router-backup-ccd/);
  assert.match(script, /auth-user-pass-verify \/etc\/openvpn\/verify-router-backup-pass\.sh via-env/);
  assert.match(script, /PASSFILE="\/etc\/openvpn\/router-backup-passwd"/);
  assert.match(script, /printf "PAIR=%d\\n", int\(host \/ 2\)/);
  assert.match(script, /COUNT=%s/);
  assert.doesNotMatch(script, /\b(?:systemd-run|flock|rm|mv|touch|restart)\b/);
  assert.doesNotMatch(script, /\bsort\b/);

  assert.deepEqual(
    migrationVpn.parseRouterMigrationVpnCcdPairs("PAIR=6\nPAIR=6\nPAIR=7\nCOUNT=3\n"),
    [6, 7],
  );
  assert.deepEqual(migrationVpn.parseRouterMigrationVpnCcdPairs("COUNT=0\n"), []);
  for (const output of [
    "",
    "PAIR=6\n",
    "PAIR=6\nCOUNT=2\n",
    "PAIR=6\nPAIR=6\nCOUNT=1\n",
    "PAIR=127\nCOUNT=1\n",
    "unexpected\nCOUNT=0\n",
    "COUNT=1\nextra\n",
  ]) {
    assert.throws(() => migrationVpn.parseRouterMigrationVpnCcdPairs(output));
  }
});

test("one-shot OpenVPN setup keeps auth arguments valid and binds each helper to its own file", () => {
  for (const { vpnRole, routerTunnelIp, authFile } of [
    { vpnRole: "primary", routerTunnelIp: "10.8.5.42", authFile: "router-passwd" },
    { vpnRole: "backup", routerTunnelIp: "10.8.6.42", authFile: "router-backup-passwd" },
  ]) {
    const script = vpnUtils.generateVpsOvpnSetupScript({
      vpsPublicIp: "vpn.example.test",
      vpnUsername: "router-auth-test",
      vpnPassword: "temporary-auth-test-password",
      routerTunnelIp,
      vpnRole,
    });
    assert.match(script, /echo "auth-user-pass-verify \$AUTHSCRIPT via-env"/);
    assert.doesNotMatch(script, /auth-user-pass-verify \$AUTHSCRIPT \$AUTHFILE via-env/);
    assert.ok(script.includes(`AUTHFILE="/etc/openvpn/${authFile}"`));
    assert.match(script, /PASSFILE="\$AUTHFILE"/);
  }
});

test("source allowlist excludes files and mutations", () => {
  assert.ok(exporter.SOURCE_PRINT_COMMANDS.every(x => x.endsWith("/print") && !x.startsWith("/file")));
  assert.doesNotThrow(() => exporter.assertSourceCommand("/system/routerboard/print"));
  assert.doesNotThrow(() => exporter.assertSourceCommand("/system/license/print"));
  assert.throws(() => exporter.assertSourceCommand("/file/print"));
  assert.throws(() => exporter.assertSourceCommand("/ip/address/add"));
});
test("downloadable helper is read-only and does not create a router file", () => {
  assert.match(exportScript.READ_ONLY_ROUTER_EXPORT_SCRIPT, /\/export show-sensitive terse/);
  assert.doesNotMatch(exportScript.READ_ONLY_ROUTER_EXPORT_SCRIPT, /file\s*=/i);
  assert.doesNotMatch(exportScript.READ_ONLY_ROUTER_EXPORT_SCRIPT, /\/file\//i);
  assert.doesNotMatch(exportScript.READ_ONLY_ROUTER_EXPORT_SCRIPT, /\/interface ovpn-client add/);
});
test("domain collector uses HTTP POST data chunks instead of unsupported HTTP file upload", () => {
  const script = exportScript.buildDomainRouterExportScript("https://isplatty.org/api/router-migrations/collector-upload?token=test");
  assert.match(script, /\/export show-sensitive terse file=\$exportFile/);
  assert.match(script, /http-method=post/);
  assert.match(script, /http-data=\$chunk/);
  assert.match(script, /chunkIndex/);
  assert.match(script, /https:\/\/isplatty\.org\/api\/router-migrations\/collector-upload\?token=test&chunk=/);
  assert.doesNotMatch(script, /\$safeUploadUrl/);
  assert.doesNotMatch(script, /upload=yes/);
  assert.doesNotMatch(script, /http-header-field="Content-Type: application\/octet-stream"/);
});
test("temporary tunnel script is address-bound and self-removing", () => {
  const script = tunnelScript.buildMigrationTunnelScript({
    endpoint: "vpn.example.test",
      port: 1197,
    username: "ochola-mig-1-abcd",
    password: "one-time-secret",
      tunnelIp: "10.8.6.42",
    interfaceName: "ochola-mig-1-abcd",
    firewallComment: "ochola-migration-42",
    schedulerName: "ochola-migration-expiry-42",
    apiUsername: "ochola-mig-api-42",
    apiPassword: "temporary-api-password-42",
  });
  assert.match(script, /migrationExpectedTunnelIp "10\.8\.6\.42"/);
  assert.match(script, /:local migrationTunnelInterfaceName "ochola-mig-1-abcd"/);
  assert.match(script, /\/interface ovpn-client add name=\$migrationTunnelInterfaceName connect-to="vpn\.example\.test"/);
  assert.match(script, /Temporary migration VPN did not connect/);
  assert.match(script, /interval=1h/);
  assert.match(script, /\/user add name="ochola-mig-api-42"/);
  assert.match(script, /set migrationCleanup.*user remove/);
  assert.match(script, /\/interface ovpn-client remove/);
  assert.match(script, /\/ip firewall filter remove/);
  assert.match(script, /dst-port=8728 src-address=10\.8\.6\.1 in-interface=\$migrationTunnelInterfaceName/);
  assert.doesNotMatch(script, /\/ip route add/);
});
test("collector export script stays separate from the connection script", () => {
  const script = exportScript.buildDomainRouterExportScript(
    "https://isplatty.org/api/router-migrations/collector-upload?token=test",
  );
  assert.match(script, /Run the separate migration-tunnel script first/);
  assert.match(script, /\/export show-sensitive terse file=\$exportFile/);
  assert.doesNotMatch(script, /\/interface ovpn-client add/);
  assert.doesNotMatch(script, /\/ip firewall filter add/);
  assert.doesNotMatch(script, /\/ip route add/);
});
test("terminal export parser keeps sensitive values server-side and maps portable sections", () => {
  const pkg = exporter.parseRouterOsExport(`
# generated by RouterOS
/ip pool
add name=customers ranges=10.0.0.2-10.0.0.254
/ppp profile
add name=basic rate-limit=10M/5M session-timeout=1h
/ppp secret
add name=alice password=secret profile=basic service=pppoe
`);
  assert.equal(pkg.ip_pools[0].name, "customers");
  assert.equal(pkg.ppp_profiles[0]["session-timeout"], "1h");
  assert.equal(pkg.ppp_secrets[0].password, "secret");
  assert.equal(pkg.raw_export, undefined);
});
test("export redacts secret fields and never reads files", async () => {
  const seen = [];
  const pkg = await exporter.exportRouterMigration({ host: "x", port: 8728, username: "u", password: "p" }, async c => {
    seen.push(c[0]); return [{ name: "a", password: "leak", private_key: "key" }];
  });
  assert.equal(pkg.interfaces[0].password, exporter.MANUAL);
  assert.equal(pkg.interfaces[0].private_key, exporter.MANUAL);
  assert.ok(!seen.some(x => x.startsWith("/file")));
});
test("dry run sends zero writes", async () => {
  const plan = importer.buildMigrationPlan({ ip_pools: [{ name: "p", ranges: "10.0.0.2-10.0.0.3" }] });
  let calls = 0;
  const r = await importer.executeMigrationPlan(plan, async () => { calls++; return []; }, ["ip_pools:0"], true);
  assert.equal(calls, 0); assert.equal(r.commands.length, 1);
});
test("source and target overlap is rejected", () => {
  assert.throws(() => importer.assertDistinctTargets({ id: 1, host: "a" }, { id: 2, host: "a" }));
});
test("only approved explicitly mapped entities are written", async () => {
  const plan = importer.buildMigrationPlan({ ip_pools: [{ name: "p", ranges: "a" }], queues: [{ name: "no" }] });
  const calls = [];
  await importer.executeMigrationPlan(plan, async c => { calls.push(c); return []; }, [], false);
  assert.equal(calls.filter(c => c[0].endsWith("/add")).length, 0);
  assert.equal(plan.unsupported[0].category, "queues");
});
test("import stops at first critical failure", async () => {
  const plan = importer.buildMigrationPlan({ ip_pools: [{ name: "p", ranges: "a" }], ppp_profiles: [{ name: "q" }] });
  const result = await importer.executeMigrationPlan(plan, async c => {
    if (c[0] === "/ip/pool/add") throw new Error("nope"); return [];
  }, ["ip_pools:0", "ppp_profiles:0"], false);
  assert.equal(result.stopped, true); assert.equal(result.applied.length, 0);
});
test("target state is redacted and persisted before the first write", async () => {
  const plan = importer.buildMigrationPlan({ ip_pools: [{ name: "p", ranges: "10.0.0.2-10.0.0.3" }] });
  const events = [];
  await importer.executeMigrationPlan(
    plan,
    async c => {
      events.push(c[0].endsWith("/print") ? "read" : "write");
      return c[0].endsWith("/print") ? [{ name: "existing", password: "must-not-persist" }] : [];
    },
    ["ip_pools:0"],
    false,
    async state => {
      events.push("persist");
      assert.equal(state.ip_pools[0].password, exporter.MANUAL);
    },
  );
  assert.deepEqual(events.slice(0, 3), ["read", "persist", "write"]);
});
test("local billing assets compile credentials and mapped reseller queues", () => {
  const plan = importer.buildMigrationPlan({
    local_assets: {
      plans: [{ id: 11, name: "Home 20", type: "pppoe", speed_down: 20, speed_up: 10 }],
      ppp_secrets: [{ username: "alice", password: "secret", profile: "home-20", ip_address: "10.0.0.10", port_id: 4 }],
      customers: [{ username: "alice", type: "pppoe", ip_address: "10.0.0.10", port_id: 4 }],
      hotspot_users: [],
    },
  }, {
    portMapping: [{ sourcePortId: 4, targetPortId: 9 }],
    targetPorts: [{ id: 9, interface_name: "ether4", reseller_id: 22, bandwidth_cap_mbps: 30 }],
  });
  const secret = plan.items.find(item => item.category === "local_ppp_secrets");
  const rootQueue = plan.items.find(item => item.category === "migration_queues" && item.command.includes("=name=RESELLER_ROOT_ether4"));
  const queue = plan.items.find(item => item.category === "migration_queues" && item.command.includes("=parent=RESELLER_ROOT_ether4"));
  assert.ok(secret);
  assert.ok(rootQueue);
  assert.ok(rootQueue.command.includes("=target=ether4"));
  assert.ok(rootQueue.command.includes("=max-limit=30M/30M"));
  assert.ok(secret.command.includes("=password=secret"));
  assert.ok(queue);
  assert.ok(queue.command.includes("=parent=RESELLER_ROOT_ether4"));
  assert.ok(queue.command.includes("=max-limit=30M/30M"));
  const stored = importer.redactMigrationPlan(plan);
  assert.ok(stored.items.every(item => !item.command.some(word => word === "=password=secret")));
  assert.ok(stored.items.some(item => item.command.includes("=password=REQUIRES_MANUAL_CONFIGURATION")));
});
test("approved named resources update instead of duplicating target rows", async () => {
  const plan = importer.buildMigrationPlan({ ip_pools: [{ name: "pool-a", ranges: "10.0.0.2-10.0.0.3" }] });
  const writes = [];
  await importer.executeMigrationPlan(plan, async command => {
    if (command[0] === "/ip/pool/print") return [{ ".id": "*1", name: "pool-a" }];
    writes.push(command);
    return [];
  }, ["ip_pools:0"], false);
  assert.equal(writes[0][0], "/ip/pool/set");
  assert.equal(writes[0][1], "=.id=*1");
});
test("database schema enforces one expiring lease per target router", async () => {
  const sql = await readFile("migrations/2026_router_migration_jobs.sql", "utf8");
  assert.match(sql, /target_router_id bigint primary key/);
  assert.match(sql, /on conflict \(target_router_id\) do nothing/);
  assert.match(sql, /expires_at <= now\(\)/);
  assert.match(sql, /renew_router_migration_target_lease/);
  assert.match(sql, /tunnel_lease_id bigint references router_migration_tunnel_leases/);
});
test("authenticated migration access is tenant-scoped", async () => {
  const route = await readFile("src/routes/router-migrations-route.ts", "utf8");
  assert.match(route, /router\.use\("\/router-migrations", requireAuth\(\)\)/);
  assert.doesNotMatch(route, /router\.use\("\/router-migrations", requireAdmin\(\)\)/);
  assert.match(route, /"isp_routers",\s*`id=eq\.\$\{id\}\$\{ownerFilter\}&select=/);
  assert.match(route, /"router_migration_jobs",\s*`id=eq\.\$\{id\}\$\{ownerFilter\}&select=/);
  assert.match(route, /admin_id=eq\.\$\{adminId\}/);
});
test("migration browser API uses the signed-in session without tenant headers", async () => {
  const api = await readFile("../ochola-supernet/src/pages/admin/network/migration/api.ts", "utf8");
  assert.match(api, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(api, /X-Impersonated-Admin-Id/);
});
test("collector handoff requires the authenticated RouterOS preflight", async () => {
  const route = await readFile("src/routes/router-migrations-route.ts", "utf8");
  assert.equal((route.match(/if \(!tunnel \|\| tunnel\.status !== "connected"\)/g) || []).length, 2);
  const page = await readFile("../ochola-supernet/src/pages/admin/network/NetworkMigration.tsx", "utf8");
  assert.match(page, /Verify RouterOS API/);
  assert.match(page, /Download both/);
  assert.match(page, /setCurrentStep\(2\)/);
});
test("unlisted source registration is tenant-bound, retry-safe, and never a replacement target", async () => {
  const route = await readFile("src/routes/router-migrations-route.ts", "utf8");
  const migration = await readFile("migrations/2026_router_migration_source_registration.sql", "utf8");
  const schemaSnapshot = await readFile("migrations/supabase_schema.sql", "utf8");
  const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");
  const ensure = await readFile("src/routes/router-ensure-route.ts", "utf8");
  assert.match(route, /req\.body\?\.registerSource === true/);
  assert.match(route, /registration_key_hash=eq\.\$\{keyHash\}/);
  assert.match(route, /create_router_migration_source_stub/);
  assert.match(route, /sourceRegistrationComplete:\s*Boolean\(job\.registration_key_hash\)/);
  assert.match(route, /if \(target\.migration_source_only\)/);
  assert.match(route, /serial=eq\.\$\{encodeURIComponent\(serial\)\}/);
  assert.match(migration, /add column if not exists identity text/);
  assert.match(migration, /add column if not exists serial text/);
  assert.match(migration, /migration_source_only,\s*description/);
  assert.match(migration, /true,\s*'Pending identity verification through RouterOS migration/);
  assert.match(migration, /registration_key_hash/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /isp_routers_serial_unique_uidx/);
  assert.match(schemaSnapshot, /public\.create_router_migration_source_stub/);
  assert.match(runner, /2026_router_migration_source_registration\.sql/);
  assert.match(ensure, /migration_source_only=eq\.false/);
});

test("migration allocator collision fix is registered after copy flow", async () => {
  const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");
  const copyFlow = runner.indexOf("2026_router_migration_copy_flow.sql");
  const collisionFix = runner.indexOf("2026_router_migration_tunnel_allocator_collision_fix.sql");
  const ccdReservations = runner.indexOf("2026_router_migration_tunnel_ccd_reservations.sql");
  const sourceRegistration = runner.indexOf("2026_router_migration_source_registration.sql");
  assert.ok(copyFlow >= 0);
  assert.ok(collisionFix > copyFlow && ccdReservations > collisionFix && ccdReservations < sourceRegistration);
});

test("migration allocator globally locks and reserves failed address pairs", async () => {
  const migration = await readFile(
    "migrations/2026_router_migration_tunnel_allocator_collision_fix.sql",
    "utf8",
  );
  assert.match(migration, /router-migration-vpn-address-pool/);
  assert.match(migration, /where id = p_source_router_id and admin_id = p_admin_id/);
  assert.match(migration, /where admin_id = p_admin_id\s+and source_router_id = p_source_router_id/);
  assert.match(migration, /split_part\(split_part\(r\.vpn_ip::text, '\/', 1\), '\.', 1\) = '10'/);
  assert.match(migration, /split_part\(split_part\(r\.vpn_ip::text, '\/', 1\), '\.', 2\) = '8'/);
  assert.match(migration, /split_part\(split_part\(r\.vpn_ip::text, '\/', 1\), '\.', 3\) = '5'/);
  assert.doesNotMatch(migration, /r\.admin_id\s*=\s*p_admin_id/);
  assert.match(migration, /'server_unavailable'/);
  assert.match(migration, /status in \(\s*'issued', 'script_issued', 'connected', 'exported',\s*'server_unavailable'/s);
  assert.match(migration, /revoke all on function issue_router_migration_tunnel_lease/);
  assert.match(migration, /from public, service_role/);
  assert.doesNotMatch(migration, /grant execute on function issue_router_migration_tunnel_lease/);
});

test("migration allocator requires and excludes live backup CCD pair reservations", async () => {
  const migration = await readFile(
    "migrations/2026_router_migration_tunnel_ccd_reservations.sql",
    "utf8",
  );
  assert.match(migration, /p_backup_ccd_pairs integer\[\]/);
  assert.match(migration, /Live backup CCD reservation scan is required/);
  assert.match(migration, /host_no \/ 2 = any\(coalesce\(p_backup_ccd_pairs, '\{\}'::integer\[\]\)\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(migration, /'server_unavailable'/);
  assert.match(migration, /grant execute on function public\.issue_router_migration_tunnel_lease/);
  assert.match(migration, /timestamptz,\s*integer\[\]\s*\)\s+to service_role/);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});

test("migration job scans the live backup CCD before creating a source, job, or lease", async () => {
  const route = await readFile("src/routes/router-migrations-route.ts", "utf8");
  const registrationLookup = route.indexOf("await findRegistrationJob(adminId, registrationKeyHash)");
  const ccdScan = route.indexOf("await readRouterMigrationVpnCcdPairs()");
  const pendingSource = route.indexOf("source = await createPendingMigrationSource(adminId)");
  const jobInsert = route.indexOf('sbInsertStrict<MigrationJob>("router_migration_jobs"');
  const leaseRpc = route.indexOf('"issue_router_migration_tunnel_lease"');
  assert.ok(registrationLookup >= 0 && registrationLookup < ccdScan);
  assert.ok(ccdScan >= 0 && ccdScan < pendingSource);
  assert.ok(ccdScan < jobInsert && ccdScan < leaseRpc);
  assert.match(route, /p_backup_ccd_pairs:\s*backupCcdPairs/);
});
