import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renewalVoucherError, type RenewalVoucherState } from "./admin-renewal-voucher-policy.js";

const base: RenewalVoucherState = {
  status: "active",
  targetAdminId: 12,
  expiresAt: "2099-01-01T00:00:00.000Z",
  maxUses: 2,
  redemptionCount: 0,
  redeemedInvoiceIds: [],
};

test("a targeted voucher is not previewed for another admin", () => {
  assert.equal(renewalVoucherError(base, 13, 44), "not_for_account");
  assert.equal(renewalVoucherError(base, 12, 44), null);
});

test("expired and revoked vouchers fail validation", () => {
  assert.equal(renewalVoucherError({ ...base, expiresAt: "2020-01-01T00:00:00.000Z" }, 12, 44, Date.parse("2021-01-01")), "expired");
  assert.equal(renewalVoucherError({ ...base, status: "revoked" }, 12, 44), "revoked");
});

test("voucher max uses and per-invoice duplicate use are rejected", () => {
  assert.equal(renewalVoucherError({ ...base, redemptionCount: 2 }, 12, 44), "usage_limit");
  assert.equal(renewalVoucherError({ ...base, redeemedInvoiceIds: [44] }, 12, 44), "already_redeemed");
});

test("SQL redemption locks rows and enforces the use limit in one transaction", async () => {
  const sql = await readFile(new URL("../../migrations/2026_admin_renewal_vouchers.sql", import.meta.url), "utf8");
  const redemption = sql.slice(sql.indexOf("create or replace function public.redeem_admin_renewal_voucher"));
  assert.match(redemption, /for update/i);
  assert.match(redemption, /used >= v\.max_uses/i);
  assert.match(redemption, /v\.expires_at <= now\(\)/i);
  assert.match(redemption, /v\.target_admin_id <> p_account_id/i);
  assert.match(sql, /unique \(billing_invoice_id\)/i);
  assert.match(sql, /unique \(voucher_id, billing_invoice_id\)/i);
  assert.match(sql, /update platform_billing_invoices set status='paid',paid_amount=0,payment_source='voucher'/i);
  assert.match(sql, /paid_amount>0/i, "voucher-settled invoices must not count as cash revenue");
});

test("voucher feature uses only platform invoice tables, not customer voucher systems", async () => {
  const [sql, route] = await Promise.all([
    readFile(new URL("../../migrations/2026_admin_renewal_vouchers.sql", import.meta.url), "utf8"),
    readFile(new URL("../routes/admin-renewal-vouchers-route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sql, /isp_vouchers|isp_radius_vouchers|hotspot_voucher/i);
  assert.doesNotMatch(route, /isp_vouchers|isp_radius_vouchers|hotspot-vouchers-route/i);
});

test("renewal voucher migration is included in the existing migration runner", async () => {
  const runner = await readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /2026_admin_renewal_vouchers\.sql/);
});
