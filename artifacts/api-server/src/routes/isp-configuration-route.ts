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
:if ($majorVersion != 6 && $majorVersion != 7) do={
    :error ("Unsupported RouterOS major version: " . $majorVersion . ". Only RouterOS 6.48+ and 7.x are supported.")
}
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
    :local temp ($dst . ".download")
    :put ("Downloading " . $label . "...")
    :do { /file remove [find name=$temp] } on-error={}
    :do {
        /tool fetch url=$url dst-path=$temp keep-result=yes mode=https check-certificate=yes
        :local fetchedFile [/file find name=$temp]
        :if ([:len $fetchedFile] = 0) do={ :error ("download did not create " . $dst) }
        :if ([/file get $fetchedFile type] = "directory") do={ :error ($dst . " is a directory") }
        :if ([:tonum [/file get $fetchedFile size]] <= 0) do={ :error ($dst . " is empty") }
        :do { /import $temp } on-error={
            :local importError $error
            :error ($label . " import failed: " . $importError)
        }
        :do { /file remove [find name=$dst] } on-error={}
        /file set $fetchedFile name=$dst
    } on-error={
        :local stageError $error
        :do { /file remove [find name=("failed-" . $dst)] } on-error={}
        :do { /file set [find name=$temp] name=("failed-" . $dst) } on-error={}
        :error ($label . " download/import failed: " . $stageError)
    }
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
    :local caCert [/certificate find name=$caName]
    :if ([:len $caCert] = 0) do={ :error "public HTTPS CA was not installed" }
    :if ([/certificate get $caCert trusted] != true) do={ :error "public HTTPS CA was imported but is not trusted" }
} on-error={
    :error ("HTTPS trust bootstrap failed: " . $error)
}
:local vpnStatus "FAILED"
:local vpnIp ""
:local proxyRegistrationSucceeded false
:local apiLockdownActive false
:local dnsSchedulerActive false
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
    :for vpnAttempt from=1 to=12 do={
        :if ($vpnStatus != "CONNECTED") do={
            :foreach vpnClient in=[/interface ovpn-client find where name="__MANAGEMENT_INTERFACE_NAME__"] do={
                :if ([/interface ovpn-client get $vpnClient running] = true) do={
                    :foreach addressId in=[/ip address find where interface="__MANAGEMENT_INTERFACE_NAME__"] do={
                        :local addressValue [/ip address get $addressId address]
                        :local slashPos [:find $addressValue "/"]
                        :local candidateIp $addressValue
                        :if ($slashPos >= 0) do={ :set candidateIp [:pick $addressValue 0 $slashPos] }
                        :if ([:len $candidateIp] >= 8 && [:pick $candidateIp 0 7] = "10.8.5." && $candidateIp != "10.8.5.1") do={
                            :set vpnIp $candidateIp
                            :set vpnStatus "CONNECTED"
                        }
                    }
                }
            }
            :if ($vpnStatus != "CONNECTED") do={ :delay 5s }
        }
    }
    :if ($vpnStatus != "CONNECTED") do={
        :set failures ($failures + 1)
        :error "Required management VPN client __MANAGEMENT_INTERFACE_NAME__ did not reach running=yes with a valid 10.8.5.x address."
    }
    :put ("VPN_STATUS=CONNECTED")
    :put ("VPN_IP=" . $vpnIp)
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
       :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - management API allow" && action=accept && chain=input]] = 0) do={ :error "API lockdown allow rule was not installed" }
       :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - public management port drop" && action=drop && chain=input]] < 3) do={ :error "API lockdown drop rules were not installed" }
       :set apiLockdownActive true
    } on-error={
       :set failures ($failures + 1)
       :put ("  REQUIRED API lockdown step failed: " . $error)
    }

     :put "Setting up DNS cache flush scheduler..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
     :if ([:len [/system scheduler find where name="dns-flush"]] = 0) do={ :error "DNS flush scheduler was not created" }
     :set dnsSchedulerActive true
    /ip dns cache flush
     :put "DNS cache flush scheduler installed. DNS cache will be flushed every 6 hours."

    # REPORT VPN IP TO PROXY
     # The canonical management ovpn-client was added at the top of this run, so it
    # already has an IP. Read it and POST (sub, name, ip) to the proxy.
    :local reportedIp ""
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

      :local proxyStatus "FAILED"
      :local apiLockdownStatus "FAILED"
      :local dnsSchedulerStatus "FAILED"
      :if ($proxyRegistrationSucceeded) do={ :set proxyStatus "REGISTERED" }
      :if ($apiLockdownActive) do={ :set apiLockdownStatus "ACTIVE" }
      :if ($dnsSchedulerActive) do={ :set dnsSchedulerStatus "ACTIVE" }
      :if ($failures = 0 && $optionalFailures = 0 && $vpnStatus = "CONNECTED" && $proxyRegistrationSucceeded && $apiLockdownActive && $dnsSchedulerActive) do={
          :put "INSTALLATION_STATUS=SUCCESS"
          :put ("VPN_STATUS=" . $vpnStatus)
          :put ("VPN_IP=" . $vpnIp)
          :put "PROXY_STATUS=REGISTERED"
          :put "API_LOCKDOWN=ACTIVE"
          :put "DNS_SCHEDULER=ACTIVE"
          :put "SUCCESS: VPN connected; VPN IP obtained; API lockdown installed; proxy registration successful."
    } else={
        :if ($failures = 0) do={
               :put "INSTALLATION_STATUS=PARTIAL"
               :put ("VPN_STATUS=" . $vpnStatus)
               :put ("VPN_IP=" . $vpnIp)
               :put ("PROXY_STATUS=" . $proxyStatus)
               :put ("API_LOCKDOWN=" . $apiLockdownStatus)
               :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
             :put ("PARTIAL: core configuration installed, but " . $optionalFailures . " optional component(s) need attention.")
        } else={
               :put "INSTALLATION_STATUS=FAILED"
               :put ("VPN_STATUS=" . $vpnStatus)
               :put ("VPN_IP=" . $vpnIp)
               :put ("PROXY_STATUS=" . $proxyStatus)
               :put ("API_LOCKDOWN=" . $apiLockdownStatus)
               :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
             :put ("FAILED: " . $failures . " required failure(s) and " . $optionalFailures . " optional issue(s); production readiness is blocked.")
        }
    }
} on-error={
    :set failures ($failures + 1)
    :put ("REQUIRED_UNHANDLED_FAILURE=" . $error)
    :put "INSTALLATION_STATUS=FAILED"
    :put ("VPN_STATUS=" . $vpnStatus)
    :put ("VPN_IP=" . $vpnIp)
    :local proxyStatus "FAILED"
    :local apiLockdownStatus "FAILED"
    :local dnsSchedulerStatus "FAILED"
    :if ($proxyRegistrationSucceeded) do={ :set proxyStatus "REGISTERED" }
    :if ($apiLockdownActive) do={ :set apiLockdownStatus "ACTIVE" }
    :if ($dnsSchedulerActive) do={ :set dnsSchedulerStatus "ACTIVE" }
    :put ("PROXY_STATUS=" . $proxyStatus)
    :put ("API_LOCKDOWN=" . $apiLockdownStatus)
    :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
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