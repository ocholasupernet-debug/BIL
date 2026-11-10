import assert from "node:assert/strict";
import test from "node:test";
import { resolvePageVerificationMethods } from "./page-verification-policy.js";

test("uses the explicit server decision when the catalog map omits a new page", () => {
  const methods = resolvePageVerificationMethods(
    { ok: true, role: "isp_admin", feature: "network.new-page", method: "none", methods: {} },
    "network.new-page",
    "isp_admin",
  );
  assert.equal(methods["network.new-page"], "none");
});

test("uses the complete page map when an older server omits the feature decision", () => {
  const methods = resolvePageVerificationMethods(
    { ok: true, role: "reseller", methods: { "billing.transactions": "password" } },
    "billing.transactions",
    "reseller",
  );
  assert.equal(methods["billing.transactions"], "password");
});

test("does not accept a decision for a different page or role", () => {
  assert.throws(
    () => resolvePageVerificationMethods(
      { ok: true, role: "isp_admin", feature: "network.other", method: "none", methods: {} },
      "network.new-page",
      "isp_admin",
    ),
    /incomplete/,
  );
  assert.throws(
    () => resolvePageVerificationMethods(
      { ok: true, role: "reseller", feature: "network.new-page", method: "none" },
      "network.new-page",
      "isp_admin",
    ),
    /security policy/,
  );
});
