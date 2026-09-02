import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();

/*
 * Standalone Main ISP configuration script supplied for the ISP configuration
 * page. This is intentionally independent of the existing router onboarding bundle.
 *
 * Branding changes applied to the supplied file are limited to the requested
 * platform hostname and router interface name.
 */
const MAIN_ISP_CONFIGURATION_RSC = String.raw`# OcholaSuperNet Main ISP Configuration Script (mainhotspot.rsc)
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.

:global version [/system package update get installed-version]
:local majorVersion 0
:local minorVersion 0
:local dotPos [:find $version "."]
:if ([:len $dotPos] > 0) do={
    :set majorVersion [:tonum [:pick $version 0 $dotPos]]
    :local remaining [:pick $version ($dotPos + 1) [:len $version]]
    :set dotPos [:find $remaining "."]
    :if ([:len $dotPos] > 0) do={
        :set minorVersion [:tonum [:pick $remaining 0 $dotPos]]
    }
}
:if ($majorVersion < 6 || ($majorVersion = 6 && $minorVersion < 48)) do={
    :put "RouterOS version 6.48 or higher is required."
    :error "RouterOS version 6.48 or higher is required."
}
:if ([/ping 8.8.8.8 count=3] = 0) do={
    :error "No internet connection. Please check your internet connection and try again."
}
:do {
    :put "Downloading VPN configuration..."
    :local vpnUrl
    :if ($majorVersion = 7) do={
        :set vpnUrl "https://bil.isplatty.org/scripts/vpn7.rsc"
    } else={
        :set vpnUrl "https://bil.isplatty.org/scripts/vpn6.rsc"
    }
    /tool fetch url=$vpnUrl dst-path=vpnsetup.rsc mode=https
    :delay 2s
    :put "Applying VPN configuration..."
    /import vpnsetup.rsc
    /file remove vpnsetup.rsc
    :put "Downloading hotspot configuration..."
    /tool fetch url="https://bil.isplatty.org/scripts/hotspotsetup.rsc" dst-path=hotspotsetup.rsc mode=https
    :delay 2s
    :put "Applying hotspot configuration..."
    /import hotspotsetup.rsc
    /file remove hotspotsetup.rsc
    :put "Downloading PPPoE configuration..."
    /tool fetch url="https://bil.isplatty.org/scripts/pppoesetup.rsc" dst-path=pppoesetup.rsc mode=https
    :delay 2s
    :put "Applying PPPoE configuration..."
    /import pppoesetup.rsc
    /file remove pppoesetup.rsc
    :put "Downloading users configuration..."
    /tool fetch url="https://bil.isplatty.org/scripts/users.rsc" dst-path=users.rsc mode=https
    :delay 2s
    :put "Applying users configuration..."
    /import users.rsc
    /file remove users.rsc
    :put "Downloading sync-users firewalls..."
    /tool fetch url="https://bil.isplatty.org/scripts/syncusers.rsc" dst-path=syncusers.rsc mode=https
    :delay 2s
    :put "Applying sync-users firewalls..."
    /import syncusers.rsc
    /file remove syncusers.rsc
    :put "Downloading heartbeat firewalls..."
    /tool fetch url="https://bil.isplatty.org/scripts/heartbeat.rsc" dst-path=heartbeat.rsc mode=https
    :delay 2s
    :put "Applying heartbeat firewalls..."
    /import heartbeat.rsc
    /file remove heartbeat.rsc
    :put "Downloading sync-full script..."
    /tool fetch url="https://bil.isplatty.org/scripts/syncfull.rsc" dst-path=syncfull.rsc mode=https
    :delay 2s
    :put "Applying sync-full script..."
    /import syncfull.rsc
    /file remove syncfull.rsc
    :put "Downloading log-push script..."
    :do {
      /tool fetch url="https://bil.isplatty.org/scripts/logpush.rsc" dst-path=logpush.rsc mode=https
      :delay 2s
      :put "Applying log-push script..."
      /import logpush.rsc
      /file remove logpush.rsc
    } on-error={ :put "log-push install skipped (non-fatal)" }

    # API lockdown - a real firewall block on 8728,8729,21 with ACCEPT-gateways-first
    # then DROP everyone else. Applied on-router via /import (accept lands before the drop atomically),
    # so it cannot sever the install session. Leaves /ip/service www UNTOUCHED (WebFig/local login
    # stays open). The seclogpush.rsc block also HEALS any leftover old rules + retired scripts.
    # Runs inside :do{}on-error so a hiccup never aborts the install.
    :put "Downloading API block script..."
    :do {
      /tool fetch url="https://bil.isplatty.org/scripts/seclogpush.rsc" dst-path=seclogpush.rsc mode=https
      :delay 2s
      :put "Applying API block script..."
      /import seclogpush.rsc
      /file remove seclogpush.rsc
    } on-error={ :put "API block install skipped (non-fatal)" }

    :put "Setting up DNS flush firewalls..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
    /ip dns cache flush
    :put "DNS flush firewalls installed (every 6 hours)"

    # REPORT VPN IP TO PROXY
    # The ocholasupernet ovpn-client was added at the top of this run, so it
    # already has an IP. Read it and POST (sub, name, ip) to the proxy.
    :put "Reporting VPN IP to proxy..."
    :local reportedIp ""
    :foreach a in=[/ip address find where interface="ocholasupernet"] do={
        :set reportedIp [/ip address get $a address]
    }
    :if ($reportedIp != "") do={
        # Strip CIDR suffix (e.g. 10.8.0.6/24 -> 10.8.0.6)
        :local slashPos [:find $reportedIp "/"]
        :if ([:len $slashPos] > 0) do={ :set reportedIp [:pick $reportedIp 0 $slashPos] }
        :local proxyReportUrl "https://proxyserver.isplatty.org/ipp.php"
        :do {
            /tool fetch mode=https http-method=post \
              http-data=("action=register&sub=bil&name=bil1&ip=" . $reportedIp) \
              url=$proxyReportUrl \
              output=user
            :put ("Reported VPN IP " . $reportedIp . " to proxy")
        } on-error={
            :put "Primary proxyserver report failed; trying proxyvpn backup..."
            :do {
                /tool fetch mode=https http-method=post \
                  http-data=("action=register&sub=bil&name=bil1&ip=" . $reportedIp) \
                  url="https://proxyvpn.isplatty.org/ipp.php" \
                  output=user
                :put ("Reported VPN IP " . $reportedIp . " through proxyvpn backup")
            } on-error={ :put "Proxy report and proxyvpn backup failed (ignored)" }
        }
    } else={
        :put "ocholasupernet interface has no IP; skipping proxy report"
    }

    :put "Suppressing script warnings in system log..."
    :do {
        # A script-warning entry carries both the script and warning topics.
        # Exact-match the default topic strings so the two sets stay idempotent.
        /system logging set [find topics="warning"] topics=warning,!script
        /system logging set [find topics="script"] topics=script,!warning
        :put "Log script-warning suppression applied"
    } on-error={ :put "Log suppress skipped (non-fatal)" }

    :put "All configurations completed successfully."
} on-error={
    :put "Error occurred during configuration:"
    :put $error
}
`;

const TENANT_SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function buildMainIspConfigurationRsc(
  tenantSubdomain = "bil",
  requestedRouterName?: string,
  routerVpnBaseUrl?: string,
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
    .replaceAll("sub=bil&name=bil1", `sub=${subdomain}&name=${routerName}`);

  if (routerVpnBaseUrl) {
    const vpnBase = routerVpnBaseUrl.trim();
    const queryBootstrap = /^https:\/\/[a-z0-9.-]+\/(?:api\/)?scripts\/router-vpn\.rsc\?rid=[0-9]+&token=[A-Za-z0-9_-]{8,128}&mode=coexist$/;
    const pathBootstrap = /^https:\/\/[a-z0-9.-]+\/(?:api\/)?scripts\/router-vpn-bootstrap\/[0-9]+\/[A-Za-z0-9_-]{8,128}$/;
    if (!queryBootstrap.test(vpnBase) && !pathBootstrap.test(vpnBase)) {
      throw new Error("The router VPN bootstrap URL is invalid.");
    }
    const routerVpn6Url = pathBootstrap.test(vpnBase) ? `${vpnBase}/6.rsc` : `${vpnBase}&ros-version=6`;
    const routerVpn7Url = pathBootstrap.test(vpnBase) ? `${vpnBase}/7.rsc` : `${vpnBase}&ros-version=7`;
    script = script
      .replaceAll(`${companyHost}/scripts/vpn7.rsc`, routerVpn7Url)
      .replaceAll(`${companyHost}/scripts/vpn6.rsc`, routerVpn6Url);
  }

  return script;
}

router.get("/admin/isp-configuration/mainhotspot.rsc", requireAdmin(), (_req, res): void => {
  res
    .type("text/plain")
    .set("Content-Disposition", 'attachment; filename="mainhotspot.rsc"')
    .set("Cache-Control", "no-store")
    .send(buildMainIspConfigurationRsc());
});

export default router;