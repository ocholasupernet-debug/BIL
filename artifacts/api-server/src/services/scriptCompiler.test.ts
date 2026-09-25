import assert from "node:assert/strict";
import test from "node:test";
import {
  compileResellerActivation,
  compileResellerPaymentNoticeNatComment,
  compileResellerSuspension,
} from "./scriptCompiler.js";

test("activation compiles a capped parent queue for RouterOS 6 and 7", () => {
  for (const rosVersion of ["6.49.10", "7.16.2"]) {
    const block = compileResellerActivation("ether1", 40, rosVersion, "bridge-reseller-1");
    assert.equal(block.queueName, "RESELLER_ROOT_ether1");
    assert.deepEqual(block.commands[0], [
      "/queue/simple/add",
      "=name=RESELLER_ROOT_ether1",
      "=target=bridge-reseller-1",
      "=max-limit=40M/40M",
      "=priority=2/2",
      "=comment=OcholaSupernet_ether1_reseller_root",
    ]);
  }
});

test("activation and suspension accept generated custom VLAN interface names", () => {
  const interfaceName = "OCHOLA_RS42_VLAN210";

  const active = compileResellerActivation("RS42_VLAN210", 40, "7.16.2", interfaceName);
  const suspended = compileResellerSuspension("RS42_VLAN210", "7.16.2", interfaceName);

  assert.equal(active.queueName, "RESELLER_ROOT_RS42_VLAN210");
  assert.equal(active.commands[0][2], `=target=${interfaceName}`);
  assert.equal(suspended.queueName, active.queueName);
  assert.equal(suspended.commands[0][2], `=target=${interfaceName}`);
});

test("suspension compiles the 1k queue and local payment notice redirect", () => {
  const block = compileResellerSuspension("ether1", "7.16.2", "bridge-reseller-1");

  assert.deepEqual(block.commands[0], [
    "/queue/simple/add",
    "=name=RESELLER_ROOT_ether1",
    "=target=bridge-reseller-1",
    "=max-limit=1k/1k",
    "=priority=8/8",
    "=comment=OcholaSupernet_ether1_suspended_reseller_root",
  ]);
  assert.deepEqual(block.commands[1], [
    "/ip/firewall/nat/add",
    "=chain=dstnat",
    "=in-interface=bridge-reseller-1",
    "=protocol=tcp",
    "=dst-port=80",
    "=action=redirect",
    "=to-ports=80",
    "=comment=OcholaSupernet_ether1_payment_notice_redirect",
  ]);
  assert.equal(
    compileResellerPaymentNoticeNatComment("ether1"),
    "OcholaSupernet_ether1_payment_notice_redirect",
  );
});

test("compiler rejects unsafe targets and invalid caps", () => {
  assert.throws(() => compileResellerActivation("ether1", 0, "7"));
  assert.throws(() => compileResellerSuspension("ether1", "7", "bridge;remove"));
});