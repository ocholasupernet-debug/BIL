import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const markerPath = process.argv[2];
if (!markerPath) throw new Error("A one-time VLAN provisioning retry marker is required.");

const marker = JSON.parse(readFileSync(markerPath, "utf8"));
const markerId = String(marker.id ?? "");
const adminId = Number(marker.adminId);
const portId = Number(marker.portId);
const routerId = Number(marker.routerId);
const vlanTag = Number(marker.vlanTag);
const handoffInterface = String(marker.handoffInterface ?? "").trim();
if (!/^[a-z0-9-]{1,80}$/.test(markerId)) throw new Error("Invalid VLAN provisioning retry marker ID.");
if (!Number.isSafeInteger(adminId) || adminId < 1) throw new Error("Invalid ISP account ID in VLAN retry marker.");
if (!Number.isSafeInteger(portId) || portId < 1) throw new Error("Invalid port ID in VLAN retry marker.");
if (!Number.isSafeInteger(routerId) || routerId < 1) throw new Error("Invalid router ID in VLAN retry marker.");
if (!Number.isSafeInteger(vlanTag) || vlanTag < 1 || vlanTag > 4094) throw new Error("Invalid VLAN tag in VLAN retry marker.");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(handoffInterface)) {
  throw new Error("Invalid physical handoff interface in VLAN retry marker.");
}

const stateDirectory = process.env.OCHOLA_DEPLOY_STATE_DIR || "/var/lib/ocholasupernet";
const completionPath = join(stateDirectory, `vlan-provisioning-retry-${markerId}.done`);
if (existsSync(completionPath)) {
  console.log("::notice title=VLAN 200 provisioning retry::This one-time provisioning retry already ran; skipping.");
  process.exit(0);
}

function recordCompletion(state) {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o750 });
  const temporaryPath = `${completionPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify({
    id: markerId,
    completedAt: new Date().toISOString(),
    ...state,
  }), { mode: 0o640 });
  renameSync(temporaryPath, completionPath);
}

function resultAnnotation(level, summary) {
  console.log(`::${level} title=VLAN 200 provisioning retry::${JSON.stringify(summary).slice(0, 4000)}`);
}

function routerBoolean(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (value === true || ["true", "yes", "1"].includes(normalized)) return true;
  if (value === false || ["false", "no", "0"].includes(normalized)) return false;
  return null;
}

try {
  const signingSecret = process.env.TOKEN_SIGNING_SECRET || process.env.SESSION_SECRET;
  if (!signingSecret) throw new Error("The production admin token signing secret is not available.");

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `a.${adminId}.${issuedAt}`;
  const signature = createHmac("sha256", signingSecret).update(payload).digest("hex");
  const token = `${payload}.${signature}`;
  const apiOrigin = "https://come.isplatty.org";
  const headers = { authorization: `Bearer ${token}` };

  async function apiRequest(path, { method = "GET", body, timeoutMs = 60_000 } = {}) {
    const response = await fetch(`${apiOrigin}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    return { status: response.status, ok: response.ok, data };
  }

  const inventoryResponse = await apiRequest("/api/admin/resellers");
  if (
    !inventoryResponse.ok
    || inventoryResponse.data?.ok !== true
    || !Array.isArray(inventoryResponse.data.ports)
    || !Array.isArray(inventoryResponse.data.resellers)
  ) {
    throw new Error(`The production port inventory returned HTTP ${inventoryResponse.status}.`);
  }
  const port = inventoryResponse.data.ports.find(row => Number(row.id) === portId);
  if (
    !port
    || Number(port.router_id) !== routerId
    || Number(port.vlan_tag) !== vlanTag
    || String(port.handoff_mode ?? "") !== "vlan_services"
    || String(port.handoff_interface ?? "") !== handoffInterface
  ) {
    const summary = { portId, routerId, vlanTag, retryExecuted: false, reason: "target_assignment_changed" };
    resultAnnotation("warning", summary);
    recordCompletion({ status: "skipped", reason: summary.reason });
  } else if (port.status === "active" && port.link_status === "active") {
    const summary = { portId, routerId, vlanTag, retryExecuted: false, reason: "assignment_already_active" };
    resultAnnotation("notice", summary);
    recordCompletion({ status: "skipped", reason: summary.reason });
  } else if (port.status !== "failed" || port.link_status !== "pending") {
    const summary = {
      portId,
      routerId,
      vlanTag,
      retryExecuted: false,
      reason: "assignment_state_changed",
      status: port.status ?? null,
      linkStatus: port.link_status ?? null,
    };
    resultAnnotation("warning", summary);
    recordCompletion({ status: "skipped", reason: summary.reason });
  } else {
    const ownerResellerId = Number(port.assigned_reseller_id ?? port.reseller_id);
    const ownerReseller = inventoryResponse.data.resellers.find(row => Number(row.id) === ownerResellerId);
    const aggregateCapMbps = Number(port.reseller_bandwidth_cap ?? port.bandwidth_cap_mbps);
    if (!Number.isSafeInteger(ownerResellerId) || ownerResellerId < 1) {
      const summary = { portId, routerId, vlanTag, retryExecuted: false, reason: "assigned_reseller_missing" };
      resultAnnotation("warning", summary);
      recordCompletion({ status: "skipped", reason: summary.reason });
    } else if (!Number.isSafeInteger(aggregateCapMbps) || aggregateCapMbps < 1 || aggregateCapMbps > 100_000) {
      const summary = { portId, routerId, vlanTag, retryExecuted: false, reason: "aggregate_cap_invalid" };
      resultAnnotation("warning", summary);
      recordCompletion({ status: "skipped", reason: summary.reason });
    } else if (
      !ownerReseller
      || ownerReseller.is_active !== true
      || String(ownerReseller.status ?? "").toLowerCase() !== "active"
    ) {
      const summary = { portId, routerId, vlanTag, retryExecuted: false, reason: "assigned_reseller_not_active" };
      resultAnnotation("warning", summary);
      recordCompletion({ status: "skipped", reason: summary.reason });
    } else {
      const requestResponse = await apiRequest("/api/isp/reseller-connection-requests");
      if (!requestResponse.ok || requestResponse.data?.ok !== true || !Array.isArray(requestResponse.data.requests)) {
        throw new Error(`The tenant connection-request check returned HTTP ${requestResponse.status}.`);
      }
      const pendingRequests = requestResponse.data.requests.filter(request =>
        Number(request.reseller_id) === ownerResellerId
        && Number(request.isp_admin_id) === adminId
        && String(request.status ?? "").toLowerCase() === "pending",
      );
      if (pendingRequests.length > 0) {
        const summary = {
          portId,
          routerId,
          vlanTag,
          retryExecuted: false,
          reason: "pending_reseller_connection_request",
          pendingRequestCount: pendingRequests.length,
        };
        resultAnnotation("warning", summary);
        recordCompletion({ status: "skipped", reason: summary.reason, pendingRequestCount: pendingRequests.length });
      } else {
        const preflightResponse = await apiRequest(
          `/api/admin/reseller-handoffs/${portId}/diagnostics`,
          { timeoutMs: 120_000 },
        );
        const diagnostics = preflightResponse.data;
        const bridge = diagnostics?.bridge?.find(row => row.name === diagnostics.assignment?.parentBridge);
        const vlanInterface = diagnostics?.vlanInterfaces?.find(row => row.name === diagnostics.assignment?.vlanInterface);
        const actualVlanTag = Number(vlanInterface?.["vlan-id"] ?? vlanInterface?.vlan_id);
        const handoffLink = diagnostics?.handoffLink;
        const hardwareReady = preflightResponse.ok
          && diagnostics?.ok === true
          && Number(diagnostics.assignment?.routerId) === routerId
          && Number(diagnostics.assignment?.vlanTag) === vlanTag
          && routerBoolean(bridge?.running) === true
          && routerBoolean(vlanInterface?.running) === true
          && actualVlanTag === vlanTag
          && handoffLink?.exists === true
          && handoffLink?.running === true
          && handoffLink?.disabled === false;
        if (!hardwareReady) {
          const summary = {
            portId,
            routerId,
            vlanTag,
            retryExecuted: false,
            reason: "hardware_preflight_not_ready",
            diagnosticsHttpStatus: preflightResponse.status,
            bridgeRunning: bridge ? routerBoolean(bridge.running) : null,
            vlanInterfaceRunning: vlanInterface ? routerBoolean(vlanInterface.running) : null,
            routerVlanTag: Number.isSafeInteger(actualVlanTag) ? actualVlanTag : null,
            handoffLinkExists: handoffLink?.exists ?? null,
            handoffLinkRunning: handoffLink?.running ?? null,
            handoffLinkDisabled: handoffLink?.disabled ?? null,
          };
          resultAnnotation("warning", summary);
          recordCompletion({ status: "skipped", reason: summary.reason });
        } else {
          recordCompletion({ status: "started", portId, routerId, vlanTag });
          const pushResponse = await apiRequest(
            `/api/admin/reseller-handoffs/${portId}/push`,
            { method: "POST", body: {}, timeoutMs: 240_000 },
          );
          const afterInventoryResponse = await apiRequest("/api/admin/resellers");
          const afterPort = afterInventoryResponse.data?.ports?.find(row => Number(row.id) === portId);
          const afterDiagnosticsResponse = await apiRequest(
            `/api/admin/reseller-handoffs/${portId}/diagnostics`,
            { timeoutMs: 120_000 },
          );
          const afterDiagnostics = afterDiagnosticsResponse.data;
          const aggregateQueue = afterDiagnostics?.aggregateQueue ?? null;
          const afterBridge = afterDiagnostics?.bridge?.find(row => row.name === afterDiagnostics.assignment?.parentBridge);
          const afterVlanInterface = afterDiagnostics?.vlanInterfaces?.find(row => row.name === afterDiagnostics.assignment?.vlanInterface);
          const afterActualVlanTag = Number(afterVlanInterface?.["vlan-id"] ?? afterVlanInterface?.vlan_id);
          const afterHardwareReady = afterDiagnosticsResponse.ok
            && afterDiagnostics?.ok === true
            && routerBoolean(afterBridge?.running) === true
            && routerBoolean(afterVlanInterface?.running) === true
            && afterActualVlanTag === vlanTag
            && afterDiagnostics.handoffLink?.exists === true
            && afterDiagnostics.handoffLink?.running === true
            && afterDiagnostics.handoffLink?.disabled === false;
          const summary = {
            portId,
            routerId,
            vlanTag,
            aggregateCapMbps,
            retryExecuted: true,
            pushHttpStatus: pushResponse.status,
            pushSucceeded: pushResponse.ok && pushResponse.data?.ok === true,
            pushError: pushResponse.data?.error
              ? String(pushResponse.data.error).replace(/[\r\n]+/g, " ").slice(0, 500)
              : null,
            status: afterPort?.status ?? null,
            linkStatus: afterPort?.link_status ?? null,
            provisioningError: afterPort?.provisioning_error
              ? String(afterPort.provisioning_error).replace(/[\r\n]+/g, " ").slice(0, 500)
              : null,
            bridgeRunning: afterBridge ? routerBoolean(afterBridge.running) : null,
            vlanInterfaceRunning: afterVlanInterface ? routerBoolean(afterVlanInterface.running) : null,
            routerVlanTag: Number.isSafeInteger(afterActualVlanTag) ? afterActualVlanTag : null,
            handoffLinkRunning: afterDiagnostics?.handoffLink?.running ?? null,
            aggregateQueue,
            customerQueueCount: Array.isArray(afterDiagnostics?.customerQueues) ? afterDiagnostics.customerQueues.length : null,
            queueDiagnosticsError: afterDiagnostics?.queueDiagnosticsError ?? null,
          };
          const successful = summary.pushSucceeded
            && summary.status === "active"
            && summary.linkStatus === "active"
            && afterHardwareReady
            && aggregateQueue !== null
            && !summary.queueDiagnosticsError;
          resultAnnotation(successful ? "notice" : "warning", summary);
          recordCompletion({ status: successful ? "provisioned" : "push_attempted", pushHttpStatus: pushResponse.status });
        }
      }
    }
  }
} catch (error) {
  const detail = String(error instanceof Error ? error.message : error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 700);
  resultAnnotation("warning", { portId, routerId, vlanTag, retryExecuted: false, error: detail });
  recordCompletion({ status: "warning", message: detail });
}