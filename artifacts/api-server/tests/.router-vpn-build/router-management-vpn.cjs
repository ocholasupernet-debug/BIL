"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/router-management-vpn.ts
var router_management_vpn_exports = {};
__export(router_management_vpn_exports, {
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT: () => ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT,
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME: () => ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME,
  ROUTER_MANAGEMENT_VPN: () => ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP: () => ROUTER_MANAGEMENT_VPN_BACKUP,
  readRouterManagementCaCertificate: () => readRouterManagementCaCertificate,
  routerManagementBackupIp: () => routerManagementBackupIp,
  routerManagementClientInterfaceName: () => routerManagementClientInterfaceName,
  routerManagementOvpnCredentials: () => routerManagementOvpnCredentials,
  routerManagementVpnContract: () => routerManagementVpnContract,
  routerManagementVpnPort: () => routerManagementVpnPort,
  routerManagementVpnPortForRouter: () => routerManagementVpnPortForRouter,
  routerManagementVpnReadiness: () => routerManagementVpnReadiness
});
module.exports = __toCommonJS(router_management_vpn_exports);
var import_fs = require("fs");
var ROUTER_MANAGEMENT_VPN = {
  port: 1196,
  publicPortBase: 11960,
  protocol: "tcp",
  tunnelBase: "10.8.5",
  network: "10.8.5.0/24",
  gateway: "10.8.5.1",
  interfaceName: "tun-router",
  configPath: "/etc/openvpn/server/ochola-router.conf",
  authFilePath: "/etc/openvpn/router-passwd",
  authScriptPath: "/etc/openvpn/verify-router-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-ccd",
  statusPath: "/var/log/openvpn/ochola-router-status.log",
  ippPath: "/etc/openvpn/router-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt"
  ]
};
var ROUTER_MANAGEMENT_VPN_BACKUP = {
  port: 1197,
  protocol: "tcp",
  tunnelBase: "10.8.6",
  network: "10.8.6.0/24",
  gateway: "10.8.6.1",
  // Linux/OpenVPN truncates TUN device names longer than 15 characters.
  // Keep this name short so the configured and observed interface match.
  interfaceName: "tun-router-bkp",
  configPath: "/etc/openvpn/server/ochola-router-backup.conf",
  authFilePath: "/etc/openvpn/router-backup-passwd",
  authScriptPath: "/etc/openvpn/verify-router-backup-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-backup-ccd",
  statusPath: "/var/log/openvpn/ochola-router-backup-status.log",
  ippPath: "/etc/openvpn/router-backup-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt"
  ]
};
var ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME = "ocholasupernet";
var ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT = "mainbillingvpn";
function routerManagementClientInterfaceName(routerId, role = "primary") {
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    throw new Error("A valid router id is required to name the management VPN interface.");
  }
  return `ochola-mgmt-vpn-${routerId}${role === "backup" ? "-backup" : ""}`;
}
function routerManagementVpnContract(role = "primary") {
  return role === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
}
function readRouterManagementCaCertificate() {
  const caPath = ROUTER_MANAGEMENT_VPN.caPaths.find((path) => (0, import_fs.existsSync)(path));
  if (!caPath) return null;
  try {
    const pem = (0, import_fs.readFileSync)(caPath, "utf8").trim();
    return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem) ? pem : null;
  } catch {
    return null;
  }
}
function routerManagementBackupIp(primaryIp) {
  const match = /^10\.8\.5\.(\d+)$/.exec(String(primaryIp ?? "").trim());
  const host = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(host) || host < 2 || host > 254) {
    throw new Error(`Router management address cannot map to the backup pool: ${primaryIp}`);
  }
  return `10.8.6.${host}`;
}
function routerManagementOvpnCredentials(routerName) {
  const username = String(routerName ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(username)) {
    throw new Error(
      "Router name must be 1-63 characters and contain only letters, numbers, dot, underscore, or hyphen for OpenVPN."
    );
  }
  return {
    username,
    /* Deliberately simple compatibility credential requested for the
       router-management tunnel: the password matches the router name. */
    password: username
  };
}
function routerManagementVpnPort() {
  const raw = process.env.ROUTER_OPENVPN_PORT?.trim();
  if (!raw) return ROUTER_MANAGEMENT_VPN.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ROUTER_OPENVPN_PORT must be an integer between 1 and 65535");
  }
  return port;
}
function routerManagementVpnPortForRouter(routerId) {
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    throw new Error("A valid router id is required to allocate its management VPN port.");
  }
  const configuredBase = process.env.ROUTER_OPENVPN_PUBLIC_PORT_BASE?.trim();
  const base = configuredBase ? Number(configuredBase) : ROUTER_MANAGEMENT_VPN.publicPortBase;
  if (!Number.isInteger(base) || base < 1024 || base > 65534) {
    throw new Error("ROUTER_OPENVPN_PUBLIC_PORT_BASE must be an integer between 1024 and 65534");
  }
  const port = base + (routerId - 1) % 1e3;
  if (port > 65535) {
    throw new Error(`Router ${routerId} cannot be assigned a management VPN port.`);
  }
  return port;
}
function configuredEndpoint() {
  return process.env.ROUTER_OPENVPN_ENDPOINT?.trim() || process.env.VPS_HOST?.trim() || "";
}
function hasConfiguredEndpoint() {
  const endpoint = configuredEndpoint().replace(/^https?:\/\//i, "").split("/")[0].replace(/:\d+$/, "").trim();
  return /^[A-Za-z0-9:._-]+$/.test(endpoint);
}
function routerManagementVpnReadiness(options = {}) {
  const serverReadyOverride = process.env.ROUTER_OPENVPN_SERVER_READY === "true" || options.remoteReady === true;
  const filesystemChecksRequired = process.env.NODE_ENV === "production" && !serverReadyOverride && process.env.ROUTER_OPENVPN_CHECK_FILESYSTEM !== "false";
  const endpointConfigured = process.env.NODE_ENV !== "production" || hasConfiguredEndpoint();
  const checks = {
    caCertificate: ROUTER_MANAGEMENT_VPN.caPaths.some((path) => (0, import_fs.existsSync)(path)),
    easyRsa: (0, import_fs.existsSync)(ROUTER_MANAGEMENT_VPN.easyRsaPath),
    dedicatedConfig: (0, import_fs.existsSync)(ROUTER_MANAGEMENT_VPN.configPath),
    authFile: (0, import_fs.existsSync)(ROUTER_MANAGEMENT_VPN.authFilePath),
    ccdDirectory: (0, import_fs.existsSync)(ROUTER_MANAGEMENT_VPN.ccdPath)
  };
  const missing = [];
  if (!endpointConfigured) missing.push("ROUTER_OPENVPN_ENDPOINT or VPS_HOST");
  if (filesystemChecksRequired) {
    if (!checks.caCertificate) missing.push("OpenVPN CA certificate");
    if (!checks.easyRsa) missing.push("Easy-RSA client certificate tooling");
    if (!checks.dedicatedConfig) missing.push(ROUTER_MANAGEMENT_VPN.configPath);
    if (!checks.authFile) missing.push(ROUTER_MANAGEMENT_VPN.authFilePath);
    if (!checks.ccdDirectory) missing.push(ROUTER_MANAGEMENT_VPN.ccdPath);
  }
  let port = ROUTER_MANAGEMENT_VPN.port;
  try {
    port = routerManagementVpnPort();
  } catch {
    missing.push("a valid ROUTER_OPENVPN_PORT");
  }
  return {
    ready: missing.length === 0,
    endpointConfigured,
    serverReadyOverride,
    filesystemChecksRequired,
    checks,
    missing,
    port,
    network: ROUTER_MANAGEMENT_VPN.network
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_COMMENT,
  ROUTER_MANAGEMENT_CLIENT_INTERFACE_NAME,
  ROUTER_MANAGEMENT_VPN,
  ROUTER_MANAGEMENT_VPN_BACKUP,
  readRouterManagementCaCertificate,
  routerManagementBackupIp,
  routerManagementClientInterfaceName,
  routerManagementOvpnCredentials,
  routerManagementVpnContract,
  routerManagementVpnPort,
  routerManagementVpnPortForRouter,
  routerManagementVpnReadiness
});
