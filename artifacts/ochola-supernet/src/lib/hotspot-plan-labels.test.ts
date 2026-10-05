import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHotspotDataAllowance,
  formatHotspotSharedDevices,
} from "./hotspot-plan-labels.js";

test("Hotspot allowance clearly distinguishes limited and unlimited plans", () => {
  assert.equal(
    formatHotspotDataAllowance({ data_limit_mb: 2500, data_cap_mode: "disconnect" }),
    "Limited · 2.5 GB cap · disconnects at the cap",
  );
  assert.equal(
    formatHotspotDataAllowance({ data_limit_mb: 1_000_000, data_cap_mode: "disconnect" }),
    "Limited · 1 TB cap · disconnects at the cap",
  );
  assert.equal(formatHotspotDataAllowance({ data_limit_mb: null }), "Unlimited data");
  assert.equal(formatHotspotDataAllowance({ data_limit_mb: 0 }), "Unlimited data");
});

test("throttled Hotspot plans show the data cap and reduced speeds", () => {
  assert.equal(
    formatHotspotDataAllowance({
      data_limit_mb: 5000,
      data_cap_mode: "throttle",
      fup_speed_down: 2,
      fup_speed_up: 1,
    }),
    "Limited · 5 GB cap · then 2 Mbps / 1 Mbps",
  );
});

test("Hotspot package sharing label matches the enforced device count", () => {
  assert.equal(formatHotspotSharedDevices(1), "1 device");
  assert.equal(formatHotspotSharedDevices(2), "Up to 2 devices");
  assert.equal(formatHotspotSharedDevices(null), "1 device");
});
