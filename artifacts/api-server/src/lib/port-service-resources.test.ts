import test from "node:test";
import assert from "node:assert/strict";
import {
  changeVlanIngressMode,
  createVlanIngressModeLockCoordinator,
  mergeVlanIngressMembership,
  planVlanIngressModeChange,
  planServicePoolName,
  portServiceResourceNames,
  VlanIngressConflictError,
  withVlanIngressModeLock,
  vlanServiceInterfaceName,
  vlanServiceOwnerId,
  vlanServiceSegment,
} from "./port-service-resources.js";
import { compileResellerActivation, compileResellerSuspension } from "../services/scriptCompiler.js";

function createIngressModeHarness(options: {
  bridgeRows?: unknown;
  ingressRows?: unknown;
  bridgePorts?: unknown;
  bridgeVlans?: unknown;
  writeRouterCommand?: (command: string[]) => Promise<unknown>;
  updateAssignment?: () => Promise<Array<unknown>>;
} = {}) {
  const writes: string[][] = [];
  const reads: string[][] = [];
  const readResponses: Record<string, unknown> = {
    "/interface/print?name=isp-hotspot": options.bridgeRows ?? [{ name: "isp-hotspot", type: "bridge" }],
    "/interface/print?name=ether7": options.ingressRows ?? [{ name: "ether7", type: "ether" }],
    "/interface/bridge/port/print?interface=ether7": options.bridgePorts ?? [
      { ".id": "*1", interface: "ether7", bridge: "isp-hotspot", pvid: "210" },
    ],
    "/interface/bridge/vlan/print?bridge=isp-hotspot": options.bridgeVlans ?? [
      { ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "210", tagged: "isp-hotspot", untagged: "ether7" },
    ],
  };
  const readRouterCommand = async (command: string[]) => {
    reads.push(command);
    const key = `${command[0]}${command.find((part) => part.startsWith("?")) ?? ""}`;
    return readResponses[key] ?? [];
  };
  const writeRouterCommand = async (command: string[]) => {
    writes.push(command);
    return options.writeRouterCommand ? options.writeRouterCommand(command) : undefined;
  };
  const updateAssignment = options.updateAssignment ?? (async () => [{ id: 12, vlan_ingress_mode: "tagged" }]);
  const run = () => changeVlanIngressMode({
    bridgeName: "isp-hotspot",
    ingressInterface: "ether7",
    vlanId: 210,
    mode: "tagged",
    readRouterCommand,
    writeRouterCommand,
    updateAssignment,
  });
  return { run, reads, writes };
}

test("VLAN ingress membership changes preserve unrelated bridge ports", () => {
  assert.deepEqual(
    mergeVlanIngressMembership("isp-hotspot,ether2", "ether5", "isp-hotspot", "ether7", "tagged"),
    { tagged: "isp-hotspot,ether2,ether7", untagged: "ether5" },
  );
  assert.deepEqual(
    mergeVlanIngressMembership("isp-hotspot,ether2,ether7", "ether5", "isp-hotspot", "ether7", "untagged"),
    { tagged: "isp-hotspot,ether2", untagged: "ether5,ether7" },
  );
});

test("VLAN ingress mode change updates only the saved ingress and matching VLAN rule", () => {
  const plan = planVlanIngressModeChange({
    bridgeName: "isp-hotspot",
    ingressInterface: "ether7",
    vlanId: 210,
    mode: "untagged",
    bridgePorts: [{ ".id": "*1", interface: "ether7", bridge: "isp-hotspot", pvid: "1" }],
    bridgeVlans: [
      { ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "210", tagged: "isp-hotspot,ether2", untagged: "ether5" },
      { ".id": "*3", bridge: "isp-hotspot", "vlan-ids": "300", tagged: "isp-hotspot,ether7", untagged: "ether6" },
    ],
  });

  assert.deepEqual(plan, {
    bridgePortId: "*1",
    previousPvid: "1",
    nextPvid: "210",
    vlanEntryId: "*2",
    previousTagged: "isp-hotspot,ether2",
    previousUntagged: "ether5",
    tagged: "isp-hotspot,ether2",
    untagged: "ether5,ether7",
  });
  assert.throws(
    () => planVlanIngressModeChange({
      bridgeName: "isp-hotspot",
      ingressInterface: "ether7",
      vlanId: 210,
      mode: "untagged",
      bridgePorts: [{ ".id": "*1", interface: "ether7", bridge: "isp-hotspot", pvid: "1" }],
      bridgeVlans: [{ ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "200-220", tagged: "isp-hotspot", untagged: "" }],
    }),
    (error) => error instanceof VlanIngressConflictError && /shares a bridge VLAN rule/i.test(error.message),
  );
});

test("VLAN ingress mode preflight rejects moved ingress and untagged conflicts", () => {
  const base = {
    bridgeName: "isp-hotspot",
    ingressInterface: "ether7",
    vlanId: 210,
    mode: "tagged" as const,
    bridgePorts: [{ ".id": "*1", interface: "ether7", bridge: "other-bridge", pvid: "210" }],
    bridgeVlans: [{ ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "210", tagged: "isp-hotspot", untagged: "" }],
  };

  assert.throws(
    () => planVlanIngressModeChange(base),
    (error) => error instanceof VlanIngressConflictError && /no longer assigned to bridge/i.test(error.message),
  );
  assert.throws(
    () => planVlanIngressModeChange({
      ...base,
      bridgePorts: [{ ".id": "*1", interface: "ether7", bridge: "isp-hotspot", pvid: "210" }],
      bridgeVlans: [
        ...base.bridgeVlans,
        { ".id": "*3", bridge: "isp-hotspot", "vlan-ids": "300", tagged: "isp-hotspot", untagged: "ether7" },
      ],
    }),
    (error) => error instanceof VlanIngressConflictError && /already untagged/i.test(error.message),
  );
});

test("VLAN ingress mode conflicts stop before any RouterOS write", async (t) => {
  const conflicts = [
    {
      name: "missing bridge",
      options: { bridgeRows: [] },
      message: /bridge .* no longer exists/i,
    },
    {
      name: "missing physical ingress",
      options: { ingressRows: [] },
      message: /physical ingress .* missing/i,
    },
    {
      name: "ingress moved to another bridge",
      options: {
        bridgePorts: [{ ".id": "*1", interface: "ether7", bridge: "other-bridge", pvid: "210" }],
      },
      message: /no longer assigned to bridge/i,
    },
    {
      name: "VLAN rule shared with another VLAN",
      options: {
        bridgeVlans: [{ ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "200-220", tagged: "isp-hotspot", untagged: "ether7" }],
      },
      message: /shares a bridge VLAN rule/i,
    },
  ];

  for (const conflict of conflicts) {
    await t.test(conflict.name, async () => {
      const harness = createIngressModeHarness(conflict.options);
      const result = await harness.run();

      assert.equal(result.status, 409);
      if (result.status === 409) assert.match(result.body.error, conflict.message);
      assert.equal(harness.writes.length, 0, "preflight conflicts must not write to RouterOS");
      assert.equal(harness.reads.length, 4, "all current RouterOS state is read before preflight");
    });
  }
});

test("VLAN ingress mode restores PVID and membership when the VLAN write fails after the PVID write", async () => {
  let failedTargetVlanWrite = false;
  const harness = createIngressModeHarness({
    writeRouterCommand: async (command) => {
      if (
        command[0] === "/interface/bridge/vlan/set"
        && command.includes("=tagged=isp-hotspot,ether7")
        && !failedTargetVlanWrite
      ) {
        failedTargetVlanWrite = true;
        throw new Error("VLAN membership write failed");
      }
    },
  });

  const result = await harness.run();

  assert.equal(result.status, 502);
  if (result.status === 502) assert.match(result.body.error, /VLAN membership write failed/);
  assert.deepEqual(harness.writes, [
    ["/interface/bridge/port/set", "=.id=*1", "=pvid=1"],
    ["/interface/bridge/vlan/set", "=.id=*2", "=tagged=isp-hotspot,ether7", "=untagged="],
    ["/interface/bridge/vlan/set", "=.id=*2", "=tagged=isp-hotspot", "=untagged=ether7"],
    ["/interface/bridge/port/set", "=.id=*1", "=pvid=210"],
  ]);
});

test("a stale VLAN assignment update does not restore over a newer RouterOS mode", async () => {
  const harness = createIngressModeHarness({ updateAssignment: async () => [] });

  const result = await harness.run();

  assert.equal(result.status, 409);
  if (result.status === 409) {
    assert.match(result.body.error, /assignment changed while this edit was being saved/i);
    assert.match(result.body.error, /left unchanged to avoid overwriting the newer mode/i);
  }
  assert.deepEqual(harness.writes, [
    ["/interface/bridge/port/set", "=.id=*1", "=pvid=1"],
    ["/interface/bridge/vlan/set", "=.id=*2", "=tagged=isp-hotspot,ether7", "=untagged="],
  ]);
});

test("a VLAN assignment persistence exception restores RouterOS and returns a failure", async () => {
  const harness = createIngressModeHarness({
    updateAssignment: async () => {
      throw new Error("VLAN assignment persistence failed");
    },
  });

  const result = await harness.run();

  assert.equal(result.status, 502);
  if (result.status === 502) {
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, /VLAN assignment persistence failed/);
    assert.doesNotMatch(result.body.error, /assignment changed while this edit was being saved/i);
    assert.doesNotMatch(result.body.error, /mode changed to/i);
  }
  assert.deepEqual(harness.writes, [
    ["/interface/bridge/port/set", "=.id=*1", "=pvid=1"],
    ["/interface/bridge/vlan/set", "=.id=*2", "=tagged=isp-hotspot,ether7", "=untagged="],
    ["/interface/bridge/vlan/set", "=.id=*2", "=tagged=isp-hotspot", "=untagged=ether7"],
    ["/interface/bridge/port/set", "=.id=*1", "=pvid=210"],
  ]);
});

test("overlapping VLAN mode requests re-read the saved mode before changing RouterOS", async () => {
  let savedMode: "tagged" | "untagged" = "untagged";
  let pvid = "210";
  let tagged = "isp-hotspot";
  let untagged = "ether7";
  let pauseFirstVlanWrite = true;
  let signalVlanWriteStarted!: () => void;
  const vlanWriteStarted = new Promise<void>((resolve) => {
    signalVlanWriteStarted = resolve;
  });
  let releaseFirstVlanWrite!: () => void;
  const firstVlanWriteGate = new Promise<void>((resolve) => {
    releaseFirstVlanWrite = resolve;
  });
  const writes: string[][] = [];

  const readRouterCommand = async (command: string[]) => {
    const query = command.find((part) => part.startsWith("?")) ?? "";
    if (query === "?name=isp-hotspot") return [{ name: "isp-hotspot", type: "bridge" }];
    if (query === "?name=ether7") return [{ name: "ether7", type: "ether" }];
    if (query === "?interface=ether7") {
      return [{ ".id": "*1", interface: "ether7", bridge: "isp-hotspot", pvid }];
    }
    if (query === "?bridge=isp-hotspot") {
      return [{ ".id": "*2", bridge: "isp-hotspot", "vlan-ids": "210", tagged, untagged }];
    }
    return [];
  };
  const writeRouterCommand = async (command: string[]) => {
    writes.push(command);
    if (command[0] === "/interface/bridge/vlan/set" && pauseFirstVlanWrite) {
      pauseFirstVlanWrite = false;
      signalVlanWriteStarted();
      await firstVlanWriteGate;
    }
    for (const part of command) {
      if (part.startsWith("=pvid=")) pvid = part.slice("=pvid=".length);
      if (part.startsWith("=tagged=")) tagged = part.slice("=tagged=".length);
      if (part.startsWith("=untagged=")) untagged = part.slice("=untagged=".length);
    }
  };
  const runRequest = () => withVlanIngressModeLock("admin:12", async () => {
    // Match the route behavior: read the assignment only after acquiring its lock.
    const expectedMode = savedMode;
    return changeVlanIngressMode({
      bridgeName: "isp-hotspot",
      ingressInterface: "ether7",
      vlanId: 210,
      mode: "tagged",
      readRouterCommand,
      writeRouterCommand,
      updateAssignment: async () => {
        if (savedMode !== expectedMode) return [];
        savedMode = "tagged";
        return [{ id: 12, vlan_ingress_mode: savedMode }];
      },
    });
  });

  const first = runRequest();
  await vlanWriteStarted;
  const second = runRequest();
  releaseFirstVlanWrite();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 200);
  assert.equal(savedMode, "tagged");
  assert.equal(pvid, "1");
  assert.equal(tagged, "isp-hotspot,ether7");
  assert.equal(untagged, "");
  assert.equal(writes.length, 2, "the second request should observe the already-applied mode without RouterOS writes");
});

test("independent API workers serialize VLAN mode changes through the shared lease store", async () => {
  const workerOne = createVlanIngressModeLockCoordinator({
    leaseMs: 1_000,
    renewEveryMs: 100,
    retryEveryMs: 1,
    acquireTimeoutMs: 1_000,
  });
  const workerTwo = createVlanIngressModeLockCoordinator({
    leaseMs: 1_000,
    renewEveryMs: 100,
    retryEveryMs: 1,
    acquireTimeoutMs: 1_000,
  });
  let activeToken: string | null = null;
  let signalSecondAttempt!: () => void;
  const secondAttempt = new Promise<void>((resolve) => {
    signalSecondAttempt = resolve;
  });
  let attempts = 0;
  const makeStore = () => ({
    acquire: async (token: string) => {
      attempts += 1;
      if (activeToken) {
        if (attempts >= 2) signalSecondAttempt();
        return false;
      }
      activeToken = token;
      return true;
    },
    renew: async (token: string) => activeToken === token,
    release: async (token: string) => {
      if (activeToken === token) activeToken = null;
    },
  });

  let savedMode: "tagged" | "untagged" = "untagged";
  let signalFirstWrite!: () => void;
  const firstWriteStarted = new Promise<void>((resolve) => {
    signalFirstWrite = resolve;
  });
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let secondEntered = false;

  const first = workerOne("admin:12", async (assertLock) => {
    const expectedMode = savedMode;
    await assertLock();
    signalFirstWrite();
    await firstWriteGate;
    await assertLock();
    assert.equal(savedMode, expectedMode);
    savedMode = "tagged";
    return "first";
  }, makeStore());

  await firstWriteStarted;
  const second = workerTwo("admin:12", async (assertLock) => {
    secondEntered = true;
    await assertLock();
    assert.equal(savedMode, "tagged", "the second worker reads the committed mode only after acquiring the shared lease");
    return "second";
  }, makeStore());

  await secondAttempt;
  assert.equal(secondEntered, false, "the second worker must wait while the first owns the database lease");
  releaseFirstWrite();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.equal(savedMode, "tagged");
  assert.equal(secondEntered, true);
  assert.equal(activeToken, null, "the shared lease is released after both workers finish");
});

test("plan pool mapping uses the existing scoped service pools", () => {
  const resources = portServiceResourceNames({
    id: 12,
    router_id: 4,
    interface_name: "ether5",
    handoff_mode: "vlan_services",
    assigned_reseller_id: 9,
    vlan_tag: "210",
  });

  assert.equal(planServicePoolName("hotspot", resources), "HS_POOL_RS9_VLAN210");
  assert.equal(planServicePoolName("trials", resources), "HS_POOL_RS9_VLAN210");
  assert.equal(planServicePoolName("pppoe", resources), "PPPOE_POOL_RS9_VLAN210");
  assert.equal(resources.parentQueue, "RESELLER_ROOT_RS9_VLAN210");
});

test("router-wide plans retain the installed default pool names", () => {
  assert.equal(planServicePoolName("hotspot"), "hotspot pool");
  assert.equal(planServicePoolName("pppoe"), "pppoe");
  assert.equal(planServicePoolName("static"), null);
});

test("VLAN identity follows the assigned reseller rather than the original reseller", () => {
  const assignment = {
    reseller_id: 9,
    assigned_reseller_id: 42,
    vlan_tag: "210",
  };

  assert.equal(vlanServiceOwnerId(assignment), 42);
  assert.equal(vlanServiceSegment(assignment), "RS42_VLAN210");
  assert.equal(vlanServiceInterfaceName(assignment), "OCHOLA_RS42_VLAN210");
  const resources = portServiceResourceNames({
    id: 12,
    router_id: 4,
    interface_name: "reseller-login",
    handoff_mode: "vlan_services",
    ...assignment,
  });
  assert.equal(resources.parentQueue, "RESELLER_ROOT_RS42_VLAN210");
  assert.equal(
    compileResellerActivation(vlanServiceSegment(assignment), 40, "7", "OCHOLA_RS42_VLAN210").queueName,
    resources.parentQueue,
  );
  assert.equal(
    compileResellerSuspension(vlanServiceSegment(assignment), "7", "OCHOLA_RS42_VLAN210").queueName,
    resources.parentQueue,
  );
  assert.equal(vlanServiceSegment({ ...assignment, assigned_reseller_id: null }), "RS9_VLAN210");
  assert.throws(
    () => vlanServiceOwnerId({ reseller_id: null, assigned_reseller_id: null, vlan_tag: "210" }),
    /valid assigned reseller account/i,
  );
});
