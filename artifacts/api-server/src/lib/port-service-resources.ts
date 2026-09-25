import { randomUUID } from "node:crypto";

export type PortServiceResourceInput = {
  id: number;
  router_id: number;
  interface_name: string;
  bridge_name?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  reseller_id?: number | null;
  assigned_reseller_id?: number | null;
  vlan_tag?: string | null;
};

export type PortServiceResourceOptions = {
  companyName?: string | null;
  routerName?: string | null;
};

export type PortServiceResourceNames = {
  identity: string;
  portName: string;
  resourceName: string;
  defaultDnsName: string;
  assetKey: string;
  hotspotDirectory: string;
  pppoeDirectory: string;
  bridgeName: string;
  hotspotPool: string;
  pppoePool: string;
  hotspotServer: string;
  hotspotProfile: string;
  hotspotDhcp: string;
  pppoeService: string;
  pppoeProfile: string;
  parentQueue: string;
  commentPrefix: string;
};

export type PlanServiceType = "hotspot" | "trials" | "pppoe" | string;

export type VlanServiceIdentityInput = Pick<
  PortServiceResourceInput,
  "reseller_id" | "assigned_reseller_id" | "vlan_tag"
>;

export type VlanIngressMode = "tagged" | "untagged";

export type VlanIngressMembership = {
  tagged: string;
  untagged: string;
};

export class VlanIngressConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VlanIngressConflictError";
  }
}

export type VlanIngressPortRow = {
  ".id"?: string;
  interface?: string;
  bridge?: string;
  disabled?: string;
  pvid?: string;
};

export type VlanBridgeEntryRow = {
  ".id"?: string;
  bridge?: string;
  "vlan-ids"?: string;
  tagged?: string;
  untagged?: string;
};

export type VlanIngressModeChangePlan = {
  bridgePortId: string;
  previousPvid: string;
  nextPvid: string;
  vlanEntryId: string;
  previousTagged: string;
  previousUntagged: string;
  tagged: string;
  untagged: string;
};

function vlanEntryIncludesId(value: unknown, vlanId: number): boolean {
  return String(value ?? "").split(",").some((part) => {
    const entry = part.trim();
    if (/^\d+$/.test(entry)) return Number(entry) === vlanId;
    const range = /^(\d+)-(\d+)$/.exec(entry);
    if (!range) return false;
    const start = Number(range[1]);
    const end = Number(range[2]);
    return start <= vlanId && vlanId <= end;
  });
}

function portListIncludes(value: unknown, interfaceName: string): boolean {
  return String(value ?? "").split(",").some((port) => port.trim() === interfaceName);
}

/**
 * Builds a scoped bridge-port/VLAN rule update after checking all RouterOS
 * state that can make the requested ingress mode unsafe.
 */
export function planVlanIngressModeChange(input: {
  bridgeName: string;
  ingressInterface: string;
  vlanId: number;
  mode: VlanIngressMode;
  bridgePorts: VlanIngressPortRow[];
  bridgeVlans: VlanBridgeEntryRow[];
}): VlanIngressModeChangePlan {
  const { bridgeName, ingressInterface, vlanId, mode, bridgePorts, bridgeVlans } = input;
  const ingressRows = bridgePorts.filter((row) => row.interface === ingressInterface);
  if (ingressRows.length !== 1) {
    throw new VlanIngressConflictError(
      `XPON VLAN ingress ${ingressInterface} must belong to exactly one bridge port entry.`,
    );
  }
  const ingressPort = ingressRows[0];
  if (ingressPort.bridge !== bridgeName) {
    throw new VlanIngressConflictError(
      `XPON VLAN ingress ${ingressInterface} is no longer assigned to bridge ${bridgeName}.`,
    );
  }
  if (!ingressPort[".id"]) {
    throw new VlanIngressConflictError(
      `RouterOS did not return the bridge-port identity for ${ingressInterface}; no changes were made.`,
    );
  }

  const matchingVlans = bridgeVlans.filter((row) =>
    row.bridge === bridgeName && vlanEntryIncludesId(row["vlan-ids"], vlanId),
  );
  if (matchingVlans.length !== 1) {
    throw new VlanIngressConflictError(
      matchingVlans.length
        ? `VLAN ${vlanId} matches multiple bridge VLAN rules on ${bridgeName}; resolve the duplicate rules before changing ingress mode.`
        : `VLAN ${vlanId} has no existing bridge VLAN rule on ${bridgeName}; no changes were made.`,
    );
  }
  const vlanEntry = matchingVlans[0];
  const vlanSelectors = String(vlanEntry["vlan-ids"] ?? "").split(",").map((value) => value.trim());
  if (
    vlanSelectors.length !== 1
    || !/^\d+$/.test(vlanSelectors[0] ?? "")
    || Number(vlanSelectors[0]) !== vlanId
  ) {
    throw new VlanIngressConflictError(
      `VLAN ${vlanId} shares a bridge VLAN rule with other VLAN IDs on ${bridgeName}; split the rule before changing ingress mode.`,
    );
  }
  if (!vlanEntry[".id"]) {
    throw new VlanIngressConflictError(
      `RouterOS did not return the bridge VLAN rule identity for VLAN ${vlanId}; no changes were made.`,
    );
  }

  const conflictingUntaggedRule = bridgeVlans.find((row) =>
    row.bridge === bridgeName
    && row !== vlanEntry
    && portListIncludes(row.untagged, ingressInterface),
  );
  if (conflictingUntaggedRule) {
    throw new VlanIngressConflictError(
      `XPON VLAN ingress ${ingressInterface} is already untagged in another VLAN rule on ${bridgeName}; resolve that membership before changing this VLAN.`,
    );
  }

  const membership = mergeVlanIngressMembership(
    vlanEntry.tagged,
    vlanEntry.untagged,
    bridgeName,
    ingressInterface,
    mode,
  );
  return {
    bridgePortId: ingressPort[".id"],
    previousPvid: String(ingressPort.pvid ?? "1"),
    nextPvid: mode === "untagged" ? String(vlanId) : "1",
    vlanEntryId: vlanEntry[".id"],
    previousTagged: String(vlanEntry.tagged ?? ""),
    previousUntagged: String(vlanEntry.untagged ?? ""),
    tagged: membership.tagged,
    untagged: membership.untagged,
  };
}

export type VlanIngressModeChangeResult =
  | { status: 200; body: { ok: true; handoff: unknown; message: string } }
  | { status: 409 | 502; body: { ok: false; error: string } };

export type VlanIngressModeLockStore = {
  acquire: (token: string, leaseMs: number) => Promise<boolean>;
  renew: (token: string, leaseMs: number) => Promise<boolean>;
  release: (token: string) => Promise<void>;
};

export class VlanIngressLockLostError extends VlanIngressConflictError {
  constructor() {
    super("The VLAN mode lock could not be confirmed. No further RouterOS changes were made; reload before retrying.");
    this.name = "VlanIngressLockLostError";
  }
}

/**
 * Creates one worker-local queue. When a shared lock store is supplied, the
 * store coordinates this queue with other API workers using a renewable lease.
 */
export function createVlanIngressModeLockCoordinator(options: {
  leaseMs?: number;
  renewEveryMs?: number;
  retryEveryMs?: number;
  acquireTimeoutMs?: number;
} = {}) {
  const locks = new Map<string, Promise<void>>();
  const leaseMs = options.leaseMs ?? 90_000;
  const renewEveryMs = options.renewEveryMs ?? 20_000;
  const retryEveryMs = options.retryEveryMs ?? 250;
  const acquireTimeoutMs = options.acquireTimeoutMs ?? 120_000;

  return async function withVlanIngressModeLock<T>(
    key: string,
    operation: (assertLock: () => Promise<void>) => Promise<T>,
    store?: VlanIngressModeLockStore,
  ): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let releaseLocal!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const queued = previous.then(() => current);
    locks.set(key, queued);

    await previous;
    let token: string | undefined;
    let sharedLockAcquired = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatStopped = false;
    let lockLost = false;
    let renewalInFlight: Promise<boolean> | undefined;
    const assertLock = async (): Promise<void> => {
      if (!store) return;
      if (lockLost || !sharedLockAcquired || !token) throw new VlanIngressLockLostError();
      try {
        if (!renewalInFlight) {
          renewalInFlight = store.renew(token, leaseMs).finally(() => {
            renewalInFlight = undefined;
          });
        }
        if (!await renewalInFlight) lockLost = true;
      } catch {
        lockLost = true;
      }
      if (lockLost) throw new VlanIngressLockLostError();
    };

    try {
      if (store) {
        token = randomUUID();
        const deadline = Date.now() + acquireTimeoutMs;
        do {
          sharedLockAcquired = await store.acquire(token, leaseMs);
          if (sharedLockAcquired) break;
          if (Date.now() >= deadline) {
            throw new VlanIngressConflictError("Another VLAN mode update is still running. Retry shortly.");
          }
          await new Promise((resolve) => setTimeout(resolve, retryEveryMs));
        } while (!sharedLockAcquired);

        const renewInBackground = async (): Promise<void> => {
          if (heartbeatStopped || lockLost) return;
          try {
            await assertLock();
          } catch {
            lockLost = true;
          }
          if (!heartbeatStopped && !lockLost) {
            heartbeatTimer = setTimeout(() => void renewInBackground(), renewEveryMs);
            heartbeatTimer.unref?.();
          }
        };
        heartbeatTimer = setTimeout(() => void renewInBackground(), renewEveryMs);
        heartbeatTimer.unref?.();
      }

      const result = await operation(assertLock);
      await assertLock();
      return result;
    } finally {
      heartbeatStopped = true;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (renewalInFlight) await renewalInFlight.catch(() => false);
      try {
        if (store && token && sharedLockAcquired) {
          await store.release(token);
        }
      } finally {
        releaseLocal();
        if (locks.get(key) === queued) {
          locks.delete(key);
        }
      }
    }
  };
}

const processVlanIngressModeLock = createVlanIngressModeLockCoordinator();
export const withVlanIngressModeLock = processVlanIngressModeLock;

/**
 * Executes the validated RouterOS mode change and compensates router state if
 * a later RouterOS write fails. A stale compare-and-set must not restore state
 * over a newer assignment change.
 */
export async function changeVlanIngressMode(input: {
  bridgeName: string;
  ingressInterface: string;
  vlanId: number;
  mode: VlanIngressMode;
  readRouterCommand: (command: string[]) => Promise<unknown>;
  writeRouterCommand: (command: string[]) => Promise<unknown>;
  updateAssignment: () => Promise<Array<unknown>>;
  assertLock?: () => Promise<void>;
}): Promise<VlanIngressModeChangeResult> {
  try {
    const assertLock = input.assertLock ?? (async () => undefined);
    const [bridgeRows, ingressRows, bridgePortRows, bridgeVlanRows] = await Promise.all([
      input.readRouterCommand([
        "/interface/print",
        "=.proplist=name,type,disabled",
        `?name=${input.bridgeName}`,
      ]),
      input.readRouterCommand([
        "/interface/print",
        "=.proplist=name,type,disabled",
        `?name=${input.ingressInterface}`,
      ]),
      input.readRouterCommand([
        "/interface/bridge/port/print",
        "=.proplist=.id,interface,bridge,disabled,pvid",
        `?interface=${input.ingressInterface}`,
      ]),
      input.readRouterCommand([
        "/interface/bridge/vlan/print",
        "=.proplist=.id,bridge,vlan-ids,tagged,untagged",
        `?bridge=${input.bridgeName}`,
      ]),
    ]);
    const asRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
      ? value as Record<string, unknown>[]
      : [];
    const bridge = asRows(bridgeRows).find((row) => String(row.name ?? "") === input.bridgeName);
    if (!bridge || String(bridge.type ?? "").toLowerCase() !== "bridge") {
      throw new VlanIngressConflictError(`The saved bridge ${input.bridgeName} no longer exists; no RouterOS changes were made.`);
    }
    const ingress = asRows(ingressRows).find((row) => String(row.name ?? "") === input.ingressInterface);
    if (
      !ingress
      || String(ingress.disabled ?? "").toLowerCase() === "true"
      || String(ingress.type ?? "").toLowerCase() === "bridge"
    ) {
      throw new VlanIngressConflictError(`The saved physical ingress ${input.ingressInterface} is missing, disabled, or is no longer a physical interface.`);
    }

    const plan = planVlanIngressModeChange({
      bridgeName: input.bridgeName,
      ingressInterface: input.ingressInterface,
      vlanId: input.vlanId,
      mode: input.mode,
      bridgePorts: asRows(bridgePortRows),
      bridgeVlans: asRows(bridgeVlanRows),
    });
    const normalizedPorts = (value: string) =>
      value.split(",").map((item) => item.trim()).filter(Boolean).sort().join(",");
    const vlanMembershipChanged = normalizedPorts(plan.previousTagged) !== normalizedPorts(plan.tagged)
      || normalizedPorts(plan.previousUntagged) !== normalizedPorts(plan.untagged);
    let routerMutationStarted = false;
    let assignmentUpdateRejected = false;
    try {
      if (plan.previousPvid !== plan.nextPvid) {
        await assertLock();
        routerMutationStarted = true;
        await input.writeRouterCommand([
          "/interface/bridge/port/set",
          `=.id=${plan.bridgePortId}`,
          `=pvid=${plan.nextPvid}`,
        ]);
      }
      if (vlanMembershipChanged) {
        await assertLock();
        routerMutationStarted = true;
        await input.writeRouterCommand([
          "/interface/bridge/vlan/set",
          `=.id=${plan.vlanEntryId}`,
          `=tagged=${plan.tagged}`,
          `=untagged=${plan.untagged}`,
        ]);
      }
      await assertLock();
      const updated = await input.updateAssignment();
      if (!updated[0]) {
        assignmentUpdateRejected = true;
        throw new VlanIngressConflictError("The assignment changed while this edit was being saved. RouterOS settings were left unchanged to avoid overwriting the newer mode; reload and try again.");
      }
      return {
        status: 200,
        body: {
          ok: true,
          handoff: updated[0],
          message: `VLAN ${input.vlanId} ingress mode changed to ${input.mode === "tagged" ? "tagged" : "untagged"}.`,
        },
      };
    } catch (error) {
      if (!routerMutationStarted || assignmentUpdateRejected) throw error;
      try {
        await assertLock();
      } catch {
        throw new VlanIngressLockLostError();
      }
      const rollbackErrors: string[] = [];
      try {
        await assertLock();
        await input.writeRouterCommand([
          "/interface/bridge/vlan/set",
          `=.id=${plan.vlanEntryId}`,
          `=tagged=${plan.previousTagged}`,
          `=untagged=${plan.previousUntagged}`,
        ]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : "VLAN membership restore failed.");
      }
      try {
        await assertLock();
        await input.writeRouterCommand([
          "/interface/bridge/port/set",
          `=.id=${plan.bridgePortId}`,
          `=pvid=${plan.previousPvid}`,
        ]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : "PVID restore failed.");
      }
      if (rollbackErrors.length) {
        const cause = error instanceof Error ? error.message : "The ingress mode update failed.";
        throw new Error(`${cause} RouterOS rollback was incomplete: ${rollbackErrors.join(" ")}`);
      }
      throw error;
    }
  } catch (error) {
    const conflict = error instanceof VlanIngressConflictError;
    return {
      status: conflict ? 409 : 502,
      body: {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to change the VLAN ingress mode.",
      },
    };
  }
}

export function mergeVlanIngressMembership(
  taggedPorts: string | null | undefined,
  untaggedPorts: string | null | undefined,
  bridgeName: string,
  ingressInterface: string,
  mode: VlanIngressMode,
): VlanIngressMembership {
  const tagged = new Set(String(taggedPorts ?? "").split(",").map(value => value.trim()).filter(Boolean));
  const untagged = new Set(String(untaggedPorts ?? "").split(",").map(value => value.trim()).filter(Boolean));
  tagged.add(bridgeName);
  if (mode === "tagged") {
    tagged.add(ingressInterface);
    untagged.delete(ingressInterface);
  } else {
    tagged.delete(ingressInterface);
    untagged.add(ingressInterface);
  }
  return { tagged: [...tagged].join(","), untagged: [...untagged].join(",") };
}

/**
 * Plans use the pool owned by their scoped service. A plan must not create a
 * second range inside the VLAN subnet: the service pool is already the
 * authoritative DHCP/PPPoE allocation range for that port.
 */
export function planServicePoolName(
  planType: PlanServiceType,
  resources?: Pick<PortServiceResourceNames, "hotspotPool" | "pppoePool">,
): string | null {
  const type = String(planType ?? "hotspot").trim().toLowerCase();
  if (type === "pppoe") return resources?.pppoePool ?? "pppoe";
  if (type === "hotspot" || type === "trials" || type === "trial") {
    return resources?.hotspotPool ?? "hotspot pool";
  }
  return null;
}

function resourceSegment(value: string, fallback: string, maxLength = 24): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result.slice(0, maxLength) || fallback;
}

function vlanResourceSegment(value: string, fallback: string, maxLength = 48): string {
  const result = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return result.slice(0, maxLength) || fallback;
}

export function vlanServiceOwnerId(port: VlanServiceIdentityInput): number {
  const ownerId = Number(port.assigned_reseller_id ?? port.reseller_id);
  if (!Number.isSafeInteger(ownerId) || ownerId < 1) {
    throw new Error("A VLAN service requires a valid assigned reseller account.");
  }
  return ownerId;
}

export function vlanServiceSegment(port: VlanServiceIdentityInput): string {
  const ownerId = vlanServiceOwnerId(port);
  const fallback = `RS${ownerId}_VLAN`;
  return vlanResourceSegment(`${fallback}${port.vlan_tag ?? "0"}`, fallback);
}

export function vlanServiceInterfaceName(
  port: VlanServiceIdentityInput & { username?: string | null },
): string {
  const ownerId = vlanServiceOwnerId(port);
  const fallback = `OCHOLA_RS${ownerId}_VLAN${port.vlan_tag ?? "0"}`;
  return vlanResourceSegment(port.username?.trim() || fallback, fallback, 55);
}

export function vlanServicePoolRanges(subnetRange: string | null | undefined): {
  hotspot: string;
  pppoe: string;
} {
  const octets = String(subnetRange ?? "").split("/")[0]?.split(".").map(Number) ?? [];
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error("A VLAN service requires a valid private /24 network before its IP pools can be configured.");
  }
  const prefix = octets.slice(0, 3).join(".");
  return {
    hotspot: `${prefix}.10-${prefix}.199`,
    pppoe: `${prefix}.200-${prefix}.254`,
  };
}

export function portServiceResourceNames(
  port: PortServiceResourceInput,
  options: PortServiceResourceOptions = {},
): PortServiceResourceNames {
  const company = resourceSegment(options.companyName ?? "", "", 18);
  const router = resourceSegment(options.routerName ?? "", `router-${port.router_id}`, 18);
  const identity = resourceSegment([company, router].filter(Boolean).join("-"), router, 28);
  const portName = resourceSegment(port.interface_name, `port-${port.id}`, 18);
  const resourceName = resourceSegment(`${identity}-${portName}`, `router-${port.router_id}-${portName}`, 42);
  const dnsLabel = company || router;
  const assetKey = resourceSegment(`p${port.id}-${portName}`, `port-${port.id}`, 32);
  const explicitBridge = (port.bridge_name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  const bridgeName = explicitBridge || `${resourceName}-bridge`;
  const ownerId = port.assigned_reseller_id ?? port.reseller_id;
  if (port.handoff_mode === "vlan_services" && ownerId && port.vlan_tag) {
    const segment = `RS${ownerId}_VLAN${port.vlan_tag}`
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 48);
    return {
      identity,
      portName,
      resourceName: segment,
      defaultDnsName: `${dnsLabel}.com`,
      assetKey,
      /* Keep each VLAN service's portal files isolated. RouterOS selects the
         Hotspot server by interface, not by the requested DNS hostname, so a
         shared directory would make the last deployed portal appear everywhere. */
      hotspotDirectory: `flash/hotspot/ochola_${segment}`,
      pppoeDirectory: `flash/hotspot/ochola_${segment}`,
      bridgeName,
      hotspotPool: `HS_POOL_${segment}`,
      pppoePool: `PPPOE_POOL_${segment}`,
      hotspotServer: `HS_${segment}`,
      hotspotProfile: `HS_PROFILE_${segment}`,
      hotspotDhcp: `HS_DHCP_${segment}`,
      pppoeService: `PPPoE_${segment}`,
      pppoeProfile: `PPPOE_PROFILE_${segment}`,
      parentQueue: `RESELLER_ROOT_${segment}`,
      commentPrefix: `OcholaSupernet_${segment}`,
    };
  }

  return {
    identity,
    portName,
    resourceName,
    defaultDnsName: `${dnsLabel}.com`,
    assetKey,
    hotspotDirectory: `flash/hotspot/hs_${assetKey}`,
    pppoeDirectory: `flash/hotspot/pppoe_${assetKey}`,
    bridgeName,
    hotspotPool: `HS_POOL_${resourceName}`,
    pppoePool: `PPPOE_POOL_${resourceName}`,
    hotspotServer: `HS_${resourceName}`,
    hotspotProfile: `HS_PROFILE_${resourceName}`,
    hotspotDhcp: `HS_DHCP_${resourceName}`,
    pppoeService: `PPPoE_${resourceName}`,
    pppoeProfile: `PPPOE_ALERT_${resourceName}`,
    parentQueue: `SERVICE_ROOT_${resourceName}`,
    commentPrefix: `${resourceName}_service`,
  };
}