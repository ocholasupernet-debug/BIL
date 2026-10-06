import assert from "node:assert/strict";
import test from "node:test";
import { planHotspotChatWalledGardenAdds } from "./hotspot-chat-walled-garden.js";

test("selected-router Tawk sync adds only missing global allows and preserves deny rules", () => {
  const plan = planHotspotChatWalledGardenAdds([
    { server: "all", "dst-host": "*.tawk.to", action: "allow" },
    { server: "all", "dst-host": "*.tawk.link", action: "deny" },
    { server: "all", "dst-host": "ocholasupernet.isplatty.org", action: "deny", disabled: "true" },
    { server: "hotspot1", "dst-host": "ocholasupernet.isplatty.org", action: "deny" },
  ]);

  assert.deepEqual(plan.alreadyAllowed, ["*.tawk.to"]);
  assert.deepEqual(plan.conflicts, ["*.tawk.link"]);
  assert.deepEqual(
    plan.commands.map((command) => command.find((argument) => argument.startsWith("=dst-host="))),
    ["=dst-host=ocholasupernet.isplatty.org"],
  );
  assert.ok(plan.commands.every((command) => command[0] === "/ip/hotspot/walled-garden/add"));
  assert.ok(plan.commands.every((command) => !command.some((argument) => argument.startsWith("=server="))));
});

test("server-scoped Tawk sync ignores rules for other hotspot services", () => {
  const plan = planHotspotChatWalledGardenAdds(
    [{ server: "hotspot2", "dst-host": "*.tawk.to", action: "deny" }],
    "hotspot1",
  );

  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.commands.length, 3);
  assert.ok(plan.commands.every((command) => command.includes("=server=hotspot1")));
});
