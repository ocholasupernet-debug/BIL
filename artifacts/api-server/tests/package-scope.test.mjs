import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dirname, "..");
const webRoot = resolve(apiRoot, "../ochola-supernet");

test("authenticated package context separates ISP and reseller plans", async () => {
  const plansRoute = await readFile(resolve(apiRoot, "src/routes/plans.ts"), "utf8");
  assert.match(
    plansRoute,
    /context\.account\.role === "reseller"[\s\S]*?context\.allowedPortIds!\.has\(Number\(plan\.port_id\)\)[\s\S]*?allPlans\.filter\(plan => plan\.port_id == null\)/,
  );
});

test("ISP hotspot exports never request a reseller port package scope", async () => {
  const hotspotSettings = await readFile(resolve(webRoot, "src/pages/admin/HotspotSettings.tsx"), "utf8");
  assert.match(
    hotspotSettings,
    /portId: isResellerAccount \? Number\(selectedAssignedPortId\) : undefined/,
  );
});

test("ISP admin package pickers exclude port-assigned reseller plans", async () => {
  for (const file of ["Customers.tsx", "PrepaidUsers.tsx", "Vouchers.tsx", "TransactionGraphs.tsx"]) {
    const source = await readFile(resolve(webRoot, "src/pages/admin", file), "utf8");
    assert.match(source, /\.is\("port_id", null\)/, `${file} must exclude port-assigned plans`);
  }
});