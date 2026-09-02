import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import { ISRG_ROOT_X1_PEM } from "../lib/router-https-trust.js";
import { routerManagementClientInterfaceName } from "../lib/router-management-vpn.js";

const router: IRouter = Router();

function routerOsCertificateContents(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\r\\n");
}

/*
 * Standalone Main ISP configuration script supplied for the ISP configuration
 * page. This is intentionally independent of the existing router onboarding bundle.
 *
 * Branding changes applied to the supplied file are limited to the requested
 * platform hostname and router interface name.
 */
const MAIN_ISP_CONFIGURATION_RSC = String.raw`# OcholaSuperNet Main ISP Configuration Script (mainhotspot.rsc)
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.

:local version ""
:do { :set version [/system resource get version] } on-error={
    :do { :set version [/system package get [find name=routeros] version] } on-error={}
}
:local firstDot [:find $version "."]
:if ([:len $version] = 0 || $firstDot < 1) do={
    :error "Could not parse the installed RouterOS version."
}
:local majorText [:pick $version 0 $firstDot]
:local remainder [:pick $version ($firstDot + 1) [:len $version]]
:local secondDot [:find $remainder "."]
:local minorText $remainder
:if ($secondDot >= 0) do={ :set minorText [:pick $remainder 0 $secondDot] }
:local majorVersion 0
:local minorVersion 0
:do {
    :set majorVersion [:tonum $majorText]
    :set minorVersion [:tonum $minorText]
} on-error={ :error ("Unsupported RouterOS version format: " . $version) }
:if ($majorVersion < 6 || ($majorVersion = 6 && $minorVersion < 48)) do={
    :put "RouterOS version 6.48 or higher is required."
    :error "RouterOS version 6.48 or higher is required."
}
:put ("Detected RouterOS " . $version . " (major=" . $majorVersion . ", minor=" . $minorVersion . ")")
:local internetReachable false
:foreach internetTarget in={"1.1.1.1";"8.8.8.8";"9.9.9.9"} do={
    :if (!$internetReachable) do={
        :do {
            :if ([/ping $internetTarget count=2] > 0) do={ :set internetReachable true }
        } on-error={}
    }
}
:if (!$internetReachable) do={
    :error "No usable internet connection was found after testing multiple destinations."
}
:local failures 0
:local optionalFailures 0
:global ocholaFetchImportMain do={
    :local label $1
    :local url $2
    :local dst $3
    :put ("Downloading " . $label . "...")
    :do { /file remove [find name=$dst] } on-error={}
    :do {
        /tool fetch url=$url dst-path=$dst keep-result=yes mode=https check-certificate=yes
        :local fetchedFile [/file find name=$dst]
        :if ([:len $fetchedFile] = 0) do={ :error ("download did not create " . $dst) }
        :if ([/file get $fetchedFile type] = "directory") do={ :error ($dst . " is a directory") }
        :if ([:tonum [/file get $fetchedFile size]] <= 0) do={ :error ($dst . " is empty") }
    } on-error={
        :local fetchError $error
        :error ($label . " download failed: " . $fetchError)
    }
    :do { /import $dst } on-error={
        :local importError $error
        :error ($label . " import failed: " . $importError)
    }
    :do { /file remove [find name=$dst] } on-error={}
    :put ($label . " completed.")
}
:do {
    :local caName "ochola-isrg-root-x1"
    :if ([:len [/certificate find name=$caName]] = 0) do={
        :local caFile "ochola-isrg-root-x1.pem"
        :do { /file remove [find name=$caFile] } on-error={}
        :local fetchedViaTrustedStore false
        :do {
            /tool fetch url="https://bil.isplatty.org/scripts/ochola-isrg-root-x1.pem" dst-path=$caFile keep-result=yes mode=https check-certificate=yes
            :set fetchedViaTrustedStore true
        } on-error={}
        :if (!$fetchedViaTrustedStore) do={
            :put "RouterOS built-in trust did not validate the CA endpoint; using the embedded ISRG Root X1 trust anchor."
            /file add name=$caFile contents="__EMBEDDED_ISRG_ROOT_X1__"
        }
        :if ([:tonum [/file get [/file find name=$caFile] size]] <= 0) do={ :error "public CA source was empty" }
        /certificate import file-name=$caFile name=$caName trusted=yes
        :do { /file remove [find name=$caFile] } on-error={}
    }
    :if ([:len [/certificate find name=$caName]] = 0) do={ :error "public HTTPS CA was not installed" }
} on-error={
    :error ("HTTPS trust bootstrap failed: " . $error)
}
:do {
    :local vpnUrl
    :if ($majorVersion = 7) do={
        :set vpnUrl "https://bil.isplatty.org/scripts/vpn7.rsc"
    } else={
        :if ($majorVersion = 6) do={
            :set vpnUrl "https://bil.isplatty.org/scripts/vpn6.rsc"
        } else={
            :error ("Unsupported RouterOS major version: " . $majorVersion)
        }
    }
    :do { $ocholaFetchImportMain "VPN configuration" $vpnUrl "vpnsetup.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED VPN step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "hotspot configuration" "https://bil.isplatty.org/scripts/hotspotsetup.rsc" "hotspotsetup.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED hotspot step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "PPPoE configuration" "https://bil.isplatty.org/scripts/pppoesetup.rsc" "pppoesetup.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED PPPoE step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "users configuration" "https://bil.isplatty.org/scripts/users.rsc" "users.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED users step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "sync-users firewalls" "https://bil.isplatty.org/scripts/syncusers.rsc" "syncusers.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED sync-users step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "heartbeat firewalls" "https://bil.isplatty.org/scripts/heartbeat.rsc" "heartbeat.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED heartbeat step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "sync-full script" "https://bil.isplatty.org/scripts/syncfull.rsc" "syncfull.rsc" } on-error={
        :set failures ($failures + 1)
        :put ("  REQUIRED sync-full step failed: " . $error)
    }
    :do {
      $ocholaFetchImportMain "log-push script" "https://bil.isplatty.org/scripts/logpush.rsc" "logpush.rsc"
    } on-error={
      :set optionalFailures ($optionalFailures + 1)
      :put ("  OPTIONAL log-push step skipped: " . $error)
    }

    # API lockdown - a real firewall block on 8728,8729,21 with ACCEPT-gateways-first
    # then DROP everyone else. Applied on-router via /import (accept lands before the drop atomically),
    # so it cannot sever the install session. Leaves /ip/service www UNTOUCHED (WebFig/local login
    # stays open). The seclogpush.rsc block also HEALS any leftover old rules + retired scripts.
     # Runs inside :do{}on-error so a hiccup is reported as a required failure.
    :do {
      $ocholaFetchImportMain "API lockdown" "https://bil.isplatty.org/scripts/seclogpush.rsc" "seclogpush.rsc"
    } on-error={
       :set failures ($failures + 1)
       :put ("  REQUIRED API lockdown step failed: " . $error)
    }

     :put "Setting up DNS cache flush scheduler..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
    /ip dns cache flush
     :put "DNS cache flush scheduler installed. DNS cache will be flushed every 6 hours."

    # REPORT VPN IP TO PROXY
     # The canonical management ovpn-client was added at the top of this run, so it
    # already has an IP. Read it and POST (sub, name, ip) to the proxy.
    :local reportedIp ""
     :local proxyRegistrationSucceeded false
    :for vpnIpAttempt from=1 to=12 do={
        :if ($reportedIp = "") do={
             :foreach a in=[/ip address find where interface="__MANAGEMENT_INTERFACE_NAME__"] do={
                :local candidate [/ip address get $a address]
                :local slashPos [:find $candidate "/"]
                :if ($slashPos >= 0) do={ :set candidate [:pick $candidate 0 $slashPos] }
                 :if ([:len $candidate] >= 8 && [:pick $candidate 0 7] = "10.8.5." && $candidate != "10.8.5.1") do={ :set reportedIp $candidate }
            }
            :if ($reportedIp = "") do={ :delay 5s }
        }
    }
    :if ($reportedIp != "") do={
        :local proxyReportUrl "https://proxyserver.isplatty.org/ipp.php"
        :do {
            /tool fetch mode=https http-method=post \
              http-data=("action=register&sub=bil&name=bil1&ip=" . $reportedIp) \
              url=$proxyReportUrl \
              output=user
             :set proxyRegistrationSucceeded true
            :put ("Reported VPN IP " . $reportedIp . " to proxy")
        } on-error={
            :put "Primary proxyserver report failed; trying proxyvpn backup..."
            :do {
                /tool fetch mode=https http-method=post \
                  http-data=("action=register&sub=bil&name=bil1&ip=" . $reportedIp) \
                  url="https://proxyvpn.isplatty.org/ipp.php" \
                  output=user
                 :set proxyRegistrationSucceeded true
                :put ("Reported VPN IP " . $reportedIp . " through proxyvpn backup")
            } on-error={
                 :set failures ($failures + 1)
                 :put "FAILED: Proxy report and proxyvpn backup failed; heartbeat will retry, but production readiness is blocked."
            }
        }
    } else={
        :set failures ($failures + 1)
         :put "FAILED: management VPN interface has no valid 10.8.5.x IP; proxy registration was not attempted."
    }

    :put "Suppressing script warnings in system log..."
    :do {
        # A script-warning entry carries both the script and warning topics.
        # Exact-match the default topic strings so the two sets stay idempotent.
        /system logging set [find topics="warning"] topics=warning,!script
        /system logging set [find topics="script"] topics=script,!warning
        :put "Log script-warning suppression applied"
    } on-error={ :put "Log suppress skipped (non-fatal)" }

     :if ($failures = 0 && $optionalFailures = 0) do={
         :put "SUCCESS: VPN connected; VPN IP obtained; API lockdown installed; proxy registration successful."
    } else={
        :if ($failures = 0) do={
             :put ("PARTIAL: core configuration installed, but " . $optionalFailures . " optional component(s) need attention.")
        } else={
             :put ("FAILED: " . $failures . " required failure(s) and " . $optionalFailures . " optional issue(s); production readiness is blocked.")
        }
    }
} on-error={
    :put "Error occurred during configuration:"
    :put $error
}
`;

const TENANT_SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeRouterScriptUrl(value: string): string {
  return value
    .trim()
    .replace(/^(?:https?:\/\/)+/i, "https://")
    .replace(/\/+$/, "");
}

export function buildMainIspConfigurationRsc(
  tenantSubdomain = "bil",
  requestedRouterName?: string,
  routerVpnBaseUrl?: string,
  routerId?: number,
): string {
  const subdomain = tenantSubdomain.trim().toLowerCase();
  if (!TENANT_SUBDOMAIN_RE.test(subdomain)) {
    throw new Error("A valid company subdomain is required for the Main ISP script.");
  }

  const routerName = (requestedRouterName?.trim().toLowerCase() || `${subdomain}1`);
  const escapedSubdomain = subdomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escapedSubdomain}[0-9]+$`).test(routerName)) {
    throw new Error("The router name must use the company subdomain followed by a number.");
  }

  const companyHost = `${subdomain}.isplatty.org`;
  let script = MAIN_ISP_CONFIGURATION_RSC
    .replaceAll("bil.isplatty.org", companyHost)
    .replaceAll("sub=bil&name=bil1", `sub=${subdomain}&name=${routerName}`)
    .replaceAll(
      "__EMBEDDED_ISRG_ROOT_X1__",
      routerOsCertificateContents(ISRG_ROOT_X1_PEM),
    )
    .replaceAll(
      "__MANAGEMENT_INTERFACE_NAME__",
      routerId && Number.isSafeInteger(routerId)
        ? routerManagementClientInterfaceName(routerId)
        : "ochola-mgmt-vpn",
    );

  if (routerVpnBaseUrl) {
    const vpnBase = normalizeRouterScriptUrl(routerVpnBaseUrl);
    const queryBootstrap = /^https:\/\/[a-z0-9.-]+\/(?:api\/)?scripts\/router-vpn\.rsc\?rid=[0-9]+&token=[A-Za-z0-9_-]{8,128}&mode=coexist$/;
    const pathBootstrap = /^https:\/\/[a-z0-9.-]+\/(?:api\/)?scripts\/router-vpn-bootstrap\/[0-9]+\/[A-Za-z0-9_-]{8,128}$/;
    if (!queryBootstrap.test(vpnBase) && !pathBootstrap.test(vpnBase)) {
      throw new Error("The router VPN bootstrap URL is invalid.");
    }
    const routerVpn6Url = pathBootstrap.test(vpnBase) ? `${vpnBase}/6.rsc` : `${vpnBase}&ros-version=6`;
    const routerVpn7Url = pathBootstrap.test(vpnBase) ? `${vpnBase}/7.rsc` : `${vpnBase}&ros-version=7`;
    script = script
      .replaceAll(`https://${companyHost}/scripts/vpn7.rsc`, routerVpn7Url)
      .replaceAll(`https://${companyHost}/scripts/vpn6.rsc`, routerVpn6Url);
  }

  return script;
}

router.get("/admin/isp-configuration/mainhotspot.rsc", requireAdmin(), (_req, res): void => {
  res
    .status(410)
    .type("text/plain")
    .set("Cache-Control", "no-store")
    .send("# This legacy installer has been retired.\n# Generate a router-scoped Main ISP command from Add Router (Script) so VPN bootstrap authorization and per-router URLs are included.\n");
});

export default router;