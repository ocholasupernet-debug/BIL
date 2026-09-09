import { validateGeneratedRouterScript } from "./router-script-validation.js";

export type ManagementRepairPhase =
  | "preflight"
  | "identity"
  | "api"
  | "firewall"
  | "verify"
  | "all";

export interface ManagementRepairScriptOptions {
  routerName: string;
  routerPassword: string;
  phase?: ManagementRepairPhase;
}

function rosString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/"/g, "\\\"");
}

function phaseHeader(phase: ManagementRepairPhase, title: string): string {
  return [
    ``,
    `# === OcholaSupernet management repair: ${phase} ===`,
    `:put "OCHOLASUPERNET_PHASE=${phase}"`,
    `:put "${title}"`,
  ].join("\n");
}

function phaseList(phase: ManagementRepairPhase): ManagementRepairPhase[] {
  if (phase === "all") return ["preflight", "identity", "api", "firewall", "verify"];
  return [phase];
}

/**
 * Small, independently runnable RouterOS repair script.
 *
 * This is deliberately separate from the full installer. Each phase can be
 * downloaded/imported on its own while watching the router terminal output.
 * It only reconciles resources owned by OcholaSupernet and never removes a
 * user, service, interface, or firewall rule.
 */
export function buildManagementApiRepairScript(
  options: ManagementRepairScriptOptions,
): string {
  const phase = options.phase ?? "all";
  const routerName = rosString(options.routerName);
  const password = rosString(options.routerPassword);
  const managementComment = "DO NOT DELETE - OcholaSupernet management API";
  const backupComment = "DO NOT DELETE - OcholaSupernet backup management API";
  const routerComment = `DO NOT DELETE - ${routerName} router management API`;
  const lines: string[] = [
    "# OcholaSupernet - phased MikroTik management/API repair",
    "# Run one phase at a time first: preflight, identity, api, firewall, verify",
    "# This script is idempotent and does not delete existing resources.",
    `:local ocholaPassword "${password}"`,
    `:local ocholaComment "${managementComment}"`,
  ];

  for (const current of phaseList(phase)) {
    if (current === "preflight") {
      lines.push(
        phaseHeader(current, "Read-only inspection; no changes will be made."),
        `:put "Router name: ${routerName}"`,
        `:put "Users:"`,
        `/user print detail where name="ocholasupernet"`,
        `/user print detail where name="${rosString(options.routerName)}"`,
        `:put "API services:"`,
        `/ip service print detail where name="api"`,
        `/ip service print detail where name="api-ssl"`,
        `:put "Owned API firewall rules:"`,
        `/ip firewall filter print detail where comment~"DO NOT DELETE - OcholaSupernet"`,
        `:put "OCHOLASUPERNET_STATUS=PREFLIGHT_COMPLETE"`,
      );
    }

    if (current === "identity") {
      lines.push(
        phaseHeader(current, "Creating or refreshing the named API user."),
        `:put "User policy: group=full (includes api, read, write, and management access)"`,
        `:local ocholaUser [/user find where name="ocholasupernet"]`,
        `:if ([:len $ocholaUser] = 0) do={`,
        `  /user add name="ocholasupernet" password=$ocholaPassword group=full disabled=no address="" comment=$ocholaComment`,
        `  :put "Created user ocholasupernet"`,
        `} else={`,
        `  /user set $ocholaUser password=$ocholaPassword group=full disabled=no address="" comment=$ocholaComment`,
        `  :put "Refreshed user ocholasupernet"`,
        `}`,
        `:local routerUser [/user find where name="${rosString(options.routerName)}"]`,
        `:if ([:len $routerUser] > 0) do={`,
        `  /user set $routerUser comment="${routerComment}"`,
        `  :put "Marked existing router management user ${routerName}"`,
        `}`,
        `:put "OCHOLASUPERNET_STATUS=IDENTITY_COMPLETE"`,
      );
    }

    if (current === "api") {
      lines.push(
        phaseHeader(current, "Enabling the RouterOS API services for management networks."),
        `:local apiService [/ip service find where name="api"]`,
        `:if ([:len $apiService] > 0) do={`,
        `  /ip service set $apiService disabled=no address=10.8.5.0/24,10.8.6.0/24`,
        `  :put "Enabled api on management networks"`,
        `} else={ :put "WARN: api service was not found" }`,
        `:local apiSslService [/ip service find where name="api-ssl"]`,
        `:if ([:len $apiSslService] > 0) do={`,
        `  /ip service set $apiSslService disabled=no address=10.8.5.0/24,10.8.6.0/24`,
        `  :put "Enabled api-ssl on management networks"`,
        `} else={ :put "WARN: api-ssl service was not found" }`,
        `:put "OCHOLASUPERNET_STATUS=API_COMPLETE"`,
      );
    }

    if (current === "firewall") {
      lines.push(
        phaseHeader(current, "Adding only missing management API accept rules."),
        `:local primaryRule [/ip firewall filter find where comment="${managementComment}"]`,
        `:if ([:len $primaryRule] = 0) do={`,
        `  /ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728,8729 src-address=10.8.5.0/24 comment="${managementComment}" place-before=0`,
        `  :put "Added primary management API rule"`,
        `} else={ :put "Primary management API rule already exists" }`,
        `:local backupRule [/ip firewall filter find where comment="${backupComment}"]`,
        `:if ([:len $backupRule] = 0) do={`,
        `  /ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728,8729 src-address=10.8.6.0/24 comment="${backupComment}" place-before=0`,
        `  :put "Added backup management API rule"`,
        `} else={ :put "Backup management API rule already exists" }`,
        `:put "OCHOLASUPERNET_STATUS=FIREWALL_COMPLETE"`,
      );
    }

    if (current === "verify") {
      lines.push(
        phaseHeader(current, "Read-back verification; no changes will be made."),
        `:local verifiedUser [/user find where name="ocholasupernet" comment="${managementComment}"]`,
        `:if ([:len $verifiedUser] = 0) do={ :put "OCHOLASUPERNET_STATUS=FAILED"; :put "FAILED_COMPONENT=identity"; :error "ocholasupernet was not verified" }`,
        `:if ([:tostr [/user get $verifiedUser group]] != "full") do={ :put "OCHOLASUPERNET_STATUS=FAILED"; :put "FAILED_COMPONENT=user-policy"; :error "ocholasupernet is not in the full API-capable group" }`,
        `:if ([:tostr [/user get $verifiedUser address]] != "") do={ :put "OCHOLASUPERNET_STATUS=FAILED"; :put "FAILED_COMPONENT=user-address"; :error "ocholasupernet still has a user-level address restriction" }`,
        `:local verifiedApi [/ip service find where name="api" disabled=no]`,
        `:if ([:len $verifiedApi] = 0) do={ :put "OCHOLASUPERNET_STATUS=FAILED"; :put "FAILED_COMPONENT=api"; :error "api service was not verified" }`,
        `:local verifiedRule [/ip firewall filter find where comment="${managementComment}" disabled=no]`,
        `:if ([:len $verifiedRule] = 0) do={ :put "OCHOLASUPERNET_STATUS=FAILED"; :put "FAILED_COMPONENT=firewall"; :error "primary API rule was not verified" }`,
        `:put "OCHOLASUPERNET_STATUS=SUCCESS"`,
      );
    }
  }

  const script = `${lines.join("\n")}\n`;
  validateGeneratedRouterScript(script);
  return script;
}