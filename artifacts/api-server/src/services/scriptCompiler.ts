export type RouterOsMajor = 6 | 7;
export type RouterCommand = string[];

export interface ResellerScriptBlock {
  queueName: string;
  natComment?: string;
  commands: RouterCommand[];
}

function routerOsMajor(value: unknown): RouterOsMajor {
  return String(value ?? "").startsWith("6") ? 6 : 7;
}

function safePortSegment(portName: string): string {
  const segment = portName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!segment || segment.length > 64) {
    throw new Error("The reseller port name is invalid.");
  }
  return segment;
}

function safeTargetName(targetName: string): string {
  const target = targetName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(target)) {
    throw new Error("The reseller router target is invalid.");
  }
  return target;
}

function capValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) {
    throw new Error("The reseller bandwidth cap must be between 1 and 100000 Mbps.");
  }
  return value;
}

/**
 * RouterOS 6 and 7 expose the same API paths for simple queues and firewall
 * NAT. Keep the version dispatch here so future syntax differences stay in
 * the compiler instead of leaking into the tenant-management route.
 */
function commandPath(rosVersion: unknown, operation: "queueAdd" | "natAdd"): string {
  const major = routerOsMajor(rosVersion);
  const paths: Record<RouterOsMajor, Record<"queueAdd" | "natAdd", string>> = {
    6: { queueAdd: "/queue/simple/add", natAdd: "/ip/firewall/nat/add" },
    7: { queueAdd: "/queue/simple/add", natAdd: "/ip/firewall/nat/add" },
  };
  return paths[major][operation];
}

export function compileResellerActivation(
  portName: string,
  maxBandwidthCap: number,
  rosVersion: unknown,
  targetName = portName,
): ResellerScriptBlock {
  const port = safePortSegment(portName);
  const target = safeTargetName(targetName);
  const cap = capValue(maxBandwidthCap);
  const queueName = `RESELLER_ROOT_${port}`;

  return {
    queueName,
    commands: [[
      commandPath(rosVersion, "queueAdd"),
      `=name=${queueName}`,
      `=target=${target}`,
      `=max-limit=${cap}M/${cap}M`,
      "=priority=2/2",
      `=comment=OcholaSupernet_${port}_reseller_root`,
    ]],
  };
}

export function compileResellerSuspension(
  portName: string,
  rosVersion: unknown,
  targetName = portName,
): ResellerScriptBlock {
  const port = safePortSegment(portName);
  const target = safeTargetName(targetName);
  const queueName = `RESELLER_ROOT_${port}`;
  const natComment = `OcholaSupernet_${port}_payment_notice_redirect`;

  return {
    queueName,
    natComment,
    commands: [
      [
        commandPath(rosVersion, "queueAdd"),
        `=name=${queueName}`,
        `=target=${target}`,
        "=max-limit=1k/1k",
        "=priority=8/8",
        `=comment=OcholaSupernet_${port}_suspended_reseller_root`,
      ],
      [
        commandPath(rosVersion, "natAdd"),
        "=chain=dstnat",
        `=in-interface=${target}`,
        "=protocol=tcp",
        "=dst-port=80",
        "=action=redirect",
        "=to-ports=80",
        `=comment=${natComment}`,
      ],
    ],
  };
}

export function compileResellerPaymentNoticeNatComment(portName: string): string {
  return `OcholaSupernet_${safePortSegment(portName)}_payment_notice_redirect`;
}