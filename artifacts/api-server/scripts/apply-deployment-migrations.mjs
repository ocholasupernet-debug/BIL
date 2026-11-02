import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";

function normalizeConnectionString(raw) {
  const schemeEnd = raw.indexOf("://");
  const userInfoStart = schemeEnd + 3;
  const passwordStart = raw.indexOf(":", userInfoStart);
  const hostStart = raw.lastIndexOf("@");
  if (schemeEnd < 0 || passwordStart < userInfoStart || hostStart < passwordStart) {
    throw new Error("SUPABASE_DB_URL is not a valid Postgres connection string.");
  }

  const decodeSafely = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const username = encodeURIComponent(decodeSafely(raw.slice(userInfoStart, passwordStart)));
  const password = encodeURIComponent(decodeSafely(raw.slice(passwordStart + 1, hostStart)));
  const normalized = `${raw.slice(0, userInfoStart)}${username}:${password}${raw.slice(hostStart)}`;
  const connectionUrl = new URL(normalized);
  connectionUrl.searchParams.set("uselibpqcompat", "true");
  connectionUrl.searchParams.set("sslmode", "require");
  return connectionUrl.toString();
}

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required.");
}

const migrationPaths = [
  fileURLToPath(new URL("../migrations/2026_admin_initial_password_setup.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_admin_page_visibility.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_admin_payment_gateway.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_secure_mpesa_callback_processing.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_tv_mac_address.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_vpn_ip.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_management_vpn_credentials.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_jobs.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_user_snapshots.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_user_import_data.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_copy_flow.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_tunnel_allocator_collision_fix.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_tunnel_ccd_reservations.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_source_registration.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_verified_registration_and_delete.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_vpn_management.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_tenant_subdomain_rules.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_vpn_fallbacks.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_dashboard_preferences.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_dashboard_amount_visibility.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_dashboard_shape_options.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_portal_appearance.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_admin_typography.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_hotspot_branding.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_prepaid_user_operations.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_plan_fup_policies.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_prepaid_presence_tracking.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_unique_prepaid_usernames.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_plan_purchase_visibility.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_prepaid_plan_entitlement_preservation.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_plan_ownership.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_plan_speed_units.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_bandwidth_profiles.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_bank_stk_push_config.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_bound_mpesa_callback_events.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_isp_router_install_events.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_registration_payment_phone.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_registration_payments.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_secure_daraja_settings.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_platform_email_settings.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_email_registration_otp.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_service_payment_routing.sql", import.meta.url)),
  // The base reseller-port table must exist before the additive port-service
  // columns and payment-gateway schema are applied.
  fileURLToPath(new URL("../migrations/2026_reseller_port_provisioning.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_migration_assets.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_master_port_services.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_payment_gateway_bridge.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_link_activation.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_connection_requests.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_isp_router_handoffs.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_vlan_ingress.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_vlan_ingress_mode.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_vlan_ingress_mode_locks.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_isp_customer_edit_locks.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_multiport_service_dns.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_tenant_storage_governance.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_load_balancing.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_multiwan_protocols.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_manual_vpn_config.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_manual_api_config.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_admin_settings_persistence.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_restore_default_gateway_access.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_shared_hotspot_resource_names.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_immutable_revenue_billing.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_revenue_summary_africa_nairobi.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_monthly_revenue_ledger_summary.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_billing_eligible_sales_summary.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_platform_income_reporting.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_revenue_summary.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_port_service_provisioning_status.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_vlan_service_ip_pools.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_plan_service_pools.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_scoped_payment_gateways.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_subdomains.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_whatsapp_integration.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_whatsapp_secure_credentials.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_email_gateway_settings_otp.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_whatsapp_security_events.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_waha_gateway.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_sms_integration.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_registration_contact_reuse_limit.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_platform_auth_security_controls.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_platform_page_auth_otp.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_gateway_settings_credentials.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_account_scoped_hotspot_vouchers.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_voucher_data_entitlements.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_account_scoped_hotspot_bindings.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_page_password.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_admin_page_passwords.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_reseller_port_nas_mapping.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_roaming_rules.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_prepaid_checkout_idempotency.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_prepaid_transaction_account_claim.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_voucher_account_activation.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_voucher_activation.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_voucher_multi_redemption.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_loyalty_points.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_fractional_loyalty_points.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_mac_loyalty_wallets.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_loyalty_legacy_mac_review_allocations.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_loyalty_repeat_remaining_to_unshared_macs.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_pppoe_portal_settings.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_radacct_standard_accounting_columns.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_chat_accounts.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_customer_archive_staged.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_hotspot_browser_sessions.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_router_api_secret_encryption.sql", import.meta.url)),
];
const client = new Client({ connectionString: normalizeConnectionString(databaseUrl) });

function routerSecretKey() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required to encrypt router API credentials.");
  return createHash("sha256")
    .update(`ochola-supernet:vpn-secrets:v1:${secret}`)
    .digest();
}

function encryptRouterSecret(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptRouterSecret(value, key) {
  if (!value.startsWith("enc:v1:")) return value;
  const [iv, authTag, ciphertext, ...extra] = value.slice("enc:v1:".length).split(":");
  if (!iv || !authTag || !ciphertext || extra.length) {
    throw new Error("A stored router API credential has an invalid encrypted format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function routerSecretLookupHash(value) {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required to index router API credentials.");
  return createHmac("sha256", secret)
    .update(`ochola-supernet:router-api-secret-lookup:v1:${value}`)
    .digest("hex");
}

async function encryptStoredRouterSecrets() {
  const key = routerSecretKey();
  await client.query("begin");
  try {
    const { rows } = await client.query(
      `select id, router_secret
         from public.isp_routers
        where router_secret is not null
          and router_secret <> ''
          and (router_secret not like 'enc:v1:%' or router_secret_lookup_hash is null)
        for update`,
    );
    for (const row of rows) {
      const plaintext = decryptRouterSecret(String(row.router_secret), key);
      const ciphertext = encryptRouterSecret(plaintext, key);
      const lookupHash = routerSecretLookupHash(plaintext);
      await client.query(
        `update public.isp_routers
            set router_secret = $2, router_secret_lookup_hash = $3
          where id = $1`,
        [row.id, ciphertext, lookupHash],
      );
    }
    await client.query("commit");
    if (rows.length > 0) {
      console.log(`[migration] encrypted ${rows.length} router API credential record(s)`);
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

try {
  await client.connect();
  for (const migrationPath of migrationPaths) {
    await client.query(await readFile(migrationPath, "utf8"));
  }
  await encryptStoredRouterSecrets();
} finally {
  await client.end();
}