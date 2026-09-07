# Ochola SuperNet Main ISP Setup Script (mainhotspot.rsc)
# INSTALLER_REVISION=rmtql5n80
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.
# Router: come1
#
# INSTALL BUNDLE - downloaded in this order:
#   1. router VPN child scripts                 (OpenVPN -> backup OpenVPN -> WireGuard -> IPsec)
#   2. hotspotsetup.rsc -> hotspotsetup.rsc  (required)
#   3. pppoesetup.rsc   -> pppoesetup.rsc     (required)
#   4. users.rsc        -> users.rsc          (required)
#   5. syncusers.rsc    -> syncusers.rsc      (required)
#   6. heartbeat.rsc    -> heartbeat.rsc      (required)
#   7. syncfull.rsc     -> syncfull.rsc       (required)
#   8. logpush.rsc and seclogpush.rsc are optional diagnostics.
# Hotspot portal files are downloaded by the per-router configuration script
# into the selected root/hotspot, flash/hotspot, or disk1/hotspot directory.

:global IPProgUrl "https://come.isplatty.org/api/isp/router/install-progress/90?token=example"
:global IPRname "come1"
:global ocholaFormEncode
:global pg do={
    :global IPProgUrl
    :global IPRname
    :global ocholaFormEncode
    :local body ("step=" . [$ocholaFormEncode $1] . "&name=" . [$ocholaFormEncode $2] . "&phase=" . [$ocholaFormEncode $3] . "&err=" . [$ocholaFormEncode $4] . "&rname=" . [$ocholaFormEncode $IPRname])
    :do {
        /tool fetch url=$IPProgUrl http-method=post http-data=$body keep-result=no mode=https check-certificate=yes
    } on-error={}
}

:global ocholaFormEncode do={
    :return [:tostr $1]
}

# Takeover is a separate, destructive path. Its safety boundary runs first.
# TAKEOVER SAFETY BOUNDARY - no service resource is changed before both files exist.
:local takeoverBackup "ochola-takeover-1788745953745"
:do { /system backup save name=$takeoverBackup } on-error={ :error "Takeover stopped: RouterOS could not create the binary backup." }
:delay 3s
:if ([:len [/file find name="ochola-takeover-1788745953745.backup"]] = 0) do={ :error "Takeover stopped: the RouterOS binary backup could not be verified." }
:do { /export file=$takeoverBackup } on-error={ :error "Takeover stopped: RouterOS could not create the text export." }
:delay 2s
:if ([:len [/file find name="ochola-takeover-1788745953745.rsc"]] = 0) do={ :error "Takeover stopped: the RouterOS text export could not be verified." }
:put "TAKEOVER BACKUP VERIFIED - binary backup and text export are present."


# Bootstrap the public CA before any HTTPS download is verified.
# Install the public CA used by the VPS HTTPS certificate before verified fetches.
# The CA certificate is public; no private certificate key is downloaded.
:do {
    :local caFile "ochola-isrg-root-x1.pem"
    :local caCert [/certificate find name="ochola-isrg-root-x1"]
    :if ([:len $caCert] = 0) do={
        :do { /file remove [find name="$caFile"] } on-error={}
        :local fetchedViaTrustedStore false
        :do {
            /tool fetch url="https://come.isplatty.org/api/scripts/ochola-isrg-root-x1.pem" dst-path="$caFile" keep-result=yes mode=https check-certificate=yes
            :set fetchedViaTrustedStore true
        } on-error={}
        :if (!$fetchedViaTrustedStore) do={
            :put "      RouterOS built-in trust did not validate the CA endpoint; using the embedded ISRG Root X1 trust anchor."
            /file add name="$caFile" contents="-----BEGIN CERTIFICATE-----\r\nMIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\r\nTzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\r\ncmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\r\nWhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\r\nZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\r\nMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\r\nh77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\r\n0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\r\nA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\r\nT8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH\r\nB5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC\r\nB5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv\r\nKBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn\r\nOlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn\r\njh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw\r\nqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI\r\nrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\r\nHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\r\nhkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL\r\nubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ\r\n3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK\r\nNFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5\r\nORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur\r\nTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC\r\njNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc\r\noyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq\r\n4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\r\nmRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d\r\nemyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\r\n-----END CERTIFICATE-----\r\n"
        }
        /certificate import file-name="$caFile" name="ochola-isrg-root-x1"
        :do { /file remove [find name="$caFile"] } on-error={}
    }
    :set caCert [/certificate find name="ochola-isrg-root-x1"]
    :if ([:len $caCert] = 0) do={ :error "public HTTPS CA certificate was not imported" }
    /certificate set $caCert trusted=yes
    :put "      HTTPS certificate trust configured for verified downloads."
} on-error={
    :error ("HTTPS certificate trust setup failed - " . $error)
}



:put "INSTALLER_REVISION=rmtql5n80"


:global ocholaHotspotInstallMarker
:global ocholaPppoeInstallMarker
:global ocholaUsersInstallMarker
:global ocholaSyncUsersInstallMarker
:global ocholaHeartbeatInstallMarker
:global ocholaSyncFullInstallMarker
:set ocholaHotspotInstallMarker ""
:set ocholaPppoeInstallMarker ""
:set ocholaUsersInstallMarker ""
:set ocholaSyncUsersInstallMarker ""
:set ocholaHeartbeatInstallMarker ""
:set ocholaSyncFullInstallMarker ""

:local routerOsVersion [/system resource get version]
:local firstVersionDot [:find $routerOsVersion "."]
:if ([:len $routerOsVersion] = 0 || [:len $firstVersionDot] = 0) do={
    :error ("Unsupported RouterOS version format " . $routerOsVersion . ".")
}
:if ($firstVersionDot < 1) do={
    :error ("Unsupported RouterOS version format " . $routerOsVersion . ".")
}
:local routerOsMajorText [:pick $routerOsVersion 0 $firstVersionDot]
:local versionRemainder [:pick $routerOsVersion ($firstVersionDot + 1) [:len $routerOsVersion]]
:local secondVersionDot [:find $versionRemainder "."]
:local routerOsMinorText $versionRemainder
:if ([:len $secondVersionDot] > 0) do={
    :set routerOsMinorText [:pick $versionRemainder 0 $secondVersionDot]
}
:local majorVersion 0
:local minorVersion 0
:do {
    :set majorVersion [:tonum $routerOsMajorText]
    :set minorVersion [:tonum $routerOsMinorText]
} on-error={
    :error ("Unsupported RouterOS version format " . $routerOsVersion . ".")
}
:if ($majorVersion != 6 && $majorVersion != 7) do={
    :error ("Unsupported RouterOS version " . $routerOsVersion . ". Only RouterOS 6.48+ and 7.x are supported.")
}
:if ($majorVersion < 6 || ($majorVersion = 6 && $minorVersion < 48)) do={
    :put "RouterOS version 6.48 or higher is required."
    :error "RouterOS version 6.48 or higher is required."
}
:put ("ROUTEROS_VERSION=" . $routerOsVersion)
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
:put ("Detected RouterOS version: " . $routerOsVersion)
:local failures 0
:local optionalFailures 0
:local backendRegistrationSucceeded false
:local vpnStatus "FAILED"
:local vpnIp ""
:local apiLockdownActive false
:local dnsSchedulerActive false
:local hotspotStatus "FAILED"
:local pppoeStatus "FAILED"
:local usersStatus "FAILED"
:local syncUsersStatus "FAILED"
:local syncFullStatus "FAILED"
:local heartbeatStatus "FAILED"
:local failedComponent ""
:local lastError ""
:put "======================================================"
:put " Ochola SuperNet router setup"
:put "======================================================"

# --- Ordered router-management VPN fallback -----------------------------------
# Attempts primary OpenVPN first, then isolated backup OpenVPN, then WireGuard and IPsec. Each child must verify
# its own resources; a successful child prevents all later children from running.
:local openVpnUrl
:if ($majorVersion >= 7) do={ :set openVpnUrl "https://come.isplatty.org/api/scripts/vpn7.rsc" } else={ :set openVpnUrl "https://come.isplatty.org/api/scripts/vpn6.rsc" }
 :local openVpnBackupUrl
:set openVpnBackupUrl ""
  :local wireGuardUrl ""
  :local ipsecUrl ""
:local vpnConfigured false
:local vpnProtocol ""
:local vpnFailureSummary ""
  :set wireGuardUrl ""
  :set ipsecUrl ""
:if (!$vpnConfigured) do={
    :local attemptPhase "start"
    :do {
        :global ocholaVpnChildError
        :set ocholaVpnChildError ""
         :if ([:len $openVpnUrl] = 0) do={
             :error "openvpn: no compatible RouterOS child script was selected"
         }
        $pg 1 "vpn-openvpn" "downloading" ""
        :put "[1/7] Trying OPENVPN router-management VPN..."
        :do { /file remove [find name="vpn-openvpn.rsc.download"] } on-error={}
         :set attemptPhase "download"
        /tool fetch url=$openVpnUrl dst-path="vpn-openvpn.rsc.download" keep-result=yes mode=https check-certificate=yes
         :set attemptPhase "download verification"
        :local fetchedFile [/file find name="vpn-openvpn.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create vpn-openvpn.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: vpn-openvpn.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: vpn-openvpn.rsc.download" }
 :global ocholaVpnChildError
 :local fetchedContents ""
 :do { :set fetchedContents [/file get $fetchedFile contents] } on-error={
     :set ocholaVpnChildError "downloaded vpn-openvpn.rsc.download could not be inspected before import"
     :error $ocholaVpnChildError
 }
 :if ([:len $fetchedContents] >= [:len "# OCHOLA_ROUTER_VPN_ERROR"] && [:pick $fetchedContents 0 [:len "# OCHOLA_ROUTER_VPN_ERROR"]] = "# OCHOLA_ROUTER_VPN_ERROR") do={
     :set ocholaVpnChildError ("server rejected vpn-openvpn.rsc.download: " . $fetchedContents)
     :error $ocholaVpnChildError
 }
        :delay 2s
         :if ($majorVersion >= 7) do={
             :local preflightError ""
              :set attemptPhase "RouterOS 7 dry-run"
             :do {
                 /import "vpn-openvpn.rsc.download" verbose=yes dry-run
             } on-error={
                 :set preflightError $error
             }
             :if ([:len $preflightError] > 0) do={
                 :set ocholaVpnChildError ("openvpn: RouterOS 7 dry-run rejected the child script: " . $preflightError)
                 :error $ocholaVpnChildError
             }
         }
         :set attemptPhase "child import"
        :do {
            /import "vpn-openvpn.rsc.download" verbose=yes
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn: $attemptPhase failed; inspect failed-vpn-openvpn.rsc and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="vpn-openvpn.rsc"] } on-error={}
        /file set [find name="vpn-openvpn.rsc.download"] name="vpn-openvpn.rsc"
         :local fetchedFile [/file find name="vpn-openvpn.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create vpn-openvpn.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: vpn-openvpn.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: vpn-openvpn.rsc" }
        :set vpnConfigured true
        :set vpnProtocol "openvpn"
        :put "      OPENVPN router-management VPN verified."
        $pg 1 "vpn-openvpn" "applied" ""
    } on-error={
        :local rawVpnError $error
        :local vpnError $ocholaVpnChildError
        :if ([:len $vpnError] = 0) do={
            :if ([:len $rawVpnError] > 0) do={
                :set vpnError ("openvpn: " . $attemptPhase . " failed: " . $rawVpnError)
            } else={
                :set vpnError "openvpn: $attemptPhase failed. Check failed-vpn-openvpn.rsc and /log for the RouterOS error."
            }
        }
        :put ("  WARN [vpn-openvpn] FAILED: " . $vpnError)
        :put "  OpenVPN diagnostic state (credentials are intentionally omitted):"
         :do {
             :local ovpnIds [/interface ovpn-client find]
             :if ([:len $ovpnIds] > 0) do={
                 :foreach ovpnId in=$ovpnIds do={
                     :put ("    name=" . [/interface ovpn-client get $ovpnId name] . " running=" . [/interface ovpn-client get $ovpnId running] . " disabled=" . [/interface ovpn-client get $ovpnId disabled] . " connect-to=" . [/interface ovpn-client get $ovpnId connect-to] . " port=" . [/interface ovpn-client get $ovpnId port])
                 }
             } else={
                 :put "    no OpenVPN client interfaces were found."
             }
         } on-error={ :put "    RouterOS could not read OpenVPN interface state." }
         :put "  Recent RouterOS OpenVPN log entries (if supported):"
         :do { /log print where topics~"ovpn" } on-error={ :put "    RouterOS did not expose filtered OpenVPN logs." }
        :set vpnFailureSummary ($vpnFailureSummary . "openvpn: " . $vpnError . "; ")
        $pg 1 "vpn-openvpn" "failed" $vpnError
        :do { /file remove [find name="failed-vpn-openvpn.rsc"] } on-error={}
        :do { /file set [find name="vpn-openvpn.rsc.download"] name="failed-vpn-openvpn.rsc" } on-error={}
    }
}
:if (!$vpnConfigured) do={
    :local attemptPhase "start"
    :do {
        :global ocholaVpnChildError
        :set ocholaVpnChildError ""
         :if ([:len $openVpnBackupUrl] = 0) do={
             :error "openvpn-backup: no compatible RouterOS child script was selected"
         }
        $pg 1 "vpn-openvpn-backup" "downloading" ""
        :put "[1/7] Trying OPENVPN-BACKUP router-management VPN..."
        :do { /file remove [find name="vpn-openvpn-backup.rsc.download"] } on-error={}
         :set attemptPhase "download"
        /tool fetch url=$openVpnBackupUrl dst-path="vpn-openvpn-backup.rsc.download" keep-result=yes mode=https check-certificate=yes
         :set attemptPhase "download verification"
        :local fetchedFile [/file find name="vpn-openvpn-backup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create vpn-openvpn-backup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: vpn-openvpn-backup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: vpn-openvpn-backup.rsc.download" }
 :global ocholaVpnChildError
 :local fetchedContents ""
 :do { :set fetchedContents [/file get $fetchedFile contents] } on-error={
     :set ocholaVpnChildError "downloaded vpn-openvpn-backup.rsc.download could not be inspected before import"
     :error $ocholaVpnChildError
 }
 :if ([:len $fetchedContents] >= [:len "# OCHOLA_ROUTER_VPN_ERROR"] && [:pick $fetchedContents 0 [:len "# OCHOLA_ROUTER_VPN_ERROR"]] = "# OCHOLA_ROUTER_VPN_ERROR") do={
     :set ocholaVpnChildError ("server rejected vpn-openvpn-backup.rsc.download: " . $fetchedContents)
     :error $ocholaVpnChildError
 }
        :delay 2s
         :if ($majorVersion >= 7) do={
             :local preflightError ""
              :set attemptPhase "RouterOS 7 dry-run"
             :do {
                 /import "vpn-openvpn-backup.rsc.download" verbose=yes dry-run
             } on-error={
                 :set preflightError $error
             }
             :if ([:len $preflightError] > 0) do={
                 :set ocholaVpnChildError ("openvpn-backup: RouterOS 7 dry-run rejected the child script: " . $preflightError)
                 :error $ocholaVpnChildError
             }
         }
         :set attemptPhase "child import"
        :do {
            /import "vpn-openvpn-backup.rsc.download" verbose=yes
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn-backup: $attemptPhase failed; inspect failed-vpn-openvpn-backup.rsc and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="vpn-openvpn-backup.rsc"] } on-error={}
        /file set [find name="vpn-openvpn-backup.rsc.download"] name="vpn-openvpn-backup.rsc"
         :local fetchedFile [/file find name="vpn-openvpn-backup.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create vpn-openvpn-backup.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: vpn-openvpn-backup.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: vpn-openvpn-backup.rsc" }
        :set vpnConfigured true
        :set vpnProtocol "openvpn-backup"
        :put "      OPENVPN-BACKUP router-management VPN verified."
        $pg 1 "vpn-openvpn-backup" "applied" ""
    } on-error={
        :local rawVpnError $error
        :local vpnError $ocholaVpnChildError
        :if ([:len $vpnError] = 0) do={
            :if ([:len $rawVpnError] > 0) do={
                :set vpnError ("openvpn-backup: " . $attemptPhase . " failed: " . $rawVpnError)
            } else={
                :set vpnError "openvpn-backup: $attemptPhase failed. Check failed-vpn-openvpn-backup.rsc and /log for the RouterOS error."
            }
        }
        :put ("  WARN [vpn-openvpn-backup] FAILED: " . $vpnError)
        :put "  OpenVPN diagnostic state (credentials are intentionally omitted):"
         :do {
             :local ovpnIds [/interface ovpn-client find]
             :if ([:len $ovpnIds] > 0) do={
                 :foreach ovpnId in=$ovpnIds do={
                     :put ("    name=" . [/interface ovpn-client get $ovpnId name] . " running=" . [/interface ovpn-client get $ovpnId running] . " disabled=" . [/interface ovpn-client get $ovpnId disabled] . " connect-to=" . [/interface ovpn-client get $ovpnId connect-to] . " port=" . [/interface ovpn-client get $ovpnId port])
                 }
             } else={
                 :put "    no OpenVPN client interfaces were found."
             }
         } on-error={ :put "    RouterOS could not read OpenVPN interface state." }
         :put "  Recent RouterOS OpenVPN log entries (if supported):"
         :do { /log print where topics~"ovpn" } on-error={ :put "    RouterOS did not expose filtered OpenVPN logs." }
        :set vpnFailureSummary ($vpnFailureSummary . "openvpn-backup: " . $vpnError . "; ")
        $pg 1 "vpn-openvpn-backup" "failed" $vpnError
        :do { /file remove [find name="failed-vpn-openvpn-backup.rsc"] } on-error={}
        :do { /file set [find name="vpn-openvpn-backup.rsc.download"] name="failed-vpn-openvpn-backup.rsc" } on-error={}
    }
}


:if (!$vpnConfigured) do={
    :set failures ($failures + 1)
    :set failedComponent "management-vpn"
    :set lastError $vpnFailureSummary
    :put ("  ERROR: no router-management VPN protocol succeeded. " . $vpnFailureSummary)
    $pg 1 "vpn" "failed" $vpnFailureSummary
} else={
    :put ("      Selected router-management VPN: " . $vpnProtocol)
}

# Parent-level VPN verification. A child import is not enough: the selected
# management resource must be present, running where RouterOS exposes running,
# and assigned a non-server address from the expected management pool.
:local verifiedVpnInterface ""
:if ($vpnProtocol = "openvpn-backup") do={ :set verifiedVpnInterface "" }
:local expectedVpnPrefix "10.8.5."
:local expectedVpnGateway "10.8.5.1"
:if ($vpnProtocol = "openvpn-backup") do={
    :set expectedVpnPrefix "10.8.6."
    :set expectedVpnGateway "10.8.6.1"
}
:local vpnResourceReady false
:if ($vpnConfigured && ($vpnProtocol = "openvpn" || $vpnProtocol = "openvpn-backup")) do={
    :for vpnVerifyAttempt from=1 to=12 do={
        :if (!$vpnResourceReady) do={
            :foreach vpnClient in=[/interface ovpn-client find where name=$verifiedVpnInterface] do={
                :if ([/interface ovpn-client get $vpnClient running] = true) do={
                    :foreach addressId in=[/ip address find where interface=$verifiedVpnInterface] do={
                        :local addressValue [/ip address get $addressId address]
                        :local slashPos [:find $addressValue "/"]
                        :local candidateIp $addressValue
                        :if ($slashPos >= 0) do={ :set candidateIp [:pick $addressValue 0 $slashPos] }
                        :if ([:len $candidateIp] > [:len $expectedVpnPrefix] && [:pick $candidateIp 0 [:len $expectedVpnPrefix]] = $expectedVpnPrefix && $candidateIp != $expectedVpnGateway) do={
                            :set vpnIp $candidateIp
                            :set vpnResourceReady true
                            :set vpnStatus "CONNECTED"
                        }
                    }
                }
            }
            :if (!$vpnResourceReady) do={ :delay 5s }
        }
    }
} else={
    :if ($vpnConfigured && $vpnProtocol = "wireguard") do={
        :if ([:len [/interface wireguard find where name="ochola-wg"]] > 0 && [:len [/ip address find where interface="ochola-wg" && address~"^10\.8\.5\.[0-9]+/"]] > 0) do={
            :set vpnResourceReady true
            :set vpnStatus "CONNECTED"
            :foreach addressId in=[/ip address find where interface="ochola-wg"] do={
                :local addressValue [/ip address get $addressId address]
                :local slashPos [:find $addressValue "/"]
                :if ($slashPos >= 0) do={ :set vpnIp [:pick $addressValue 0 $slashPos] }
            }
        }
    }
    :if ($vpnConfigured && $vpnProtocol = "ipsec") do={
        :if ([:len [/ip ipsec policy find where comment~"IPsec management policy"]] > 0) do={
            :set vpnResourceReady true
            :set vpnStatus "CONFIGURED"
        }
    }
}
:if ($vpnConfigured && !$vpnResourceReady) do={
    :set failures ($failures + 1)
    :set vpnStatus "FAILED"
    :set failedComponent "management-vpn"
    :set lastError "Selected management VPN did not pass parent-level resource verification."
    :put ("  ERROR: selected " . $vpnProtocol . " management VPN did not pass parent-level resource verification.")
}
:put ("VPN_STATUS=" . $vpnStatus)
:put ("VPN_IP=" . $vpnIp)

# --- Hotspot configuration ----------------------------------------------------
:do {
    $pg 2 "hotspot" "downloading" ""
    :put "[2/7] Downloading hotspot configuration..."
    :do { /file remove [find name="hotspotsetup.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/hotspotsetup.rsc" dst-path="hotspotsetup.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="hotspotsetup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create hotspotsetup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: hotspotsetup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: hotspotsetup.rsc.download" }
    :delay 2s
    :put "      Applying hotspot configuration..."
    /import "hotspotsetup.rsc.download"
     :if ($ocholaHotspotInstallMarker != "hotspotsetup-v1") do={ :error "hotspotsetup.rsc did not report a completed import." }
     :local fetchedFile [/file find name="hotspotsetup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create hotspotsetup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: hotspotsetup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: hotspotsetup.rsc.download" }
     :if ([:len [/interface bridge find where name="hotspot-bridge"]] = 0) do={ :error "hotspotsetup.rsc import completed, but hotspot-bridge was not verified." }
     :if ([:len [/ip pool find where name="hspool"]] = 0) do={ :error "hotspotsetup.rsc import completed, but hspool was not verified." }
     :if ([:len [/ip hotspot profile find where name="default-hs"]] = 0) do={ :error "hotspotsetup.rsc import completed, but default-hs was not verified." }
     :if ([:len [/ip hotspot find where name="hotspot1"]] = 0) do={ :error "hotspotsetup.rsc import completed, but hotspot1 was not verified." }
    :do { /file remove [find name="hotspotsetup.rsc"] } on-error={}
    /file set [find name="hotspotsetup.rsc.download"] name="hotspotsetup.rsc"
     :local fetchedFile [/file find name="hotspotsetup.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create hotspotsetup.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: hotspotsetup.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: hotspotsetup.rsc" }
     :set hotspotStatus "OK"
    :put "      Hotspot configuration applied; saved as hotspotsetup.rsc."
    $pg 2 "hotspot" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "hotspot" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [hotspotsetup.rsc] FAILED: " . $error)
    $pg 2 "hotspot" "failed" $error
    :do { /file remove [find name=failed-hotspotsetup.rsc] } on-error={}
    :do { /file set [find name=hotspotsetup.rsc.download] name=failed-hotspotsetup.rsc } on-error={}
}

# --- PPPoE configuration ------------------------------------------------------
:do {
    $pg 3 "pppoe" "downloading" ""
    :put "[3/7] Downloading PPPoE configuration..."
    :do { /file remove [find name="pppoesetup.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/pppoesetup.rsc" dst-path="pppoesetup.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="pppoesetup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create pppoesetup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: pppoesetup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: pppoesetup.rsc.download" }
    :delay 2s
    :put "      Applying PPPoE configuration..."
    /import "pppoesetup.rsc.download"
     :if ($ocholaPppoeInstallMarker != "pppoe-v1") do={ :error "pppoesetup.rsc did not report a completed import." }
     :local fetchedFile [/file find name="pppoesetup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create pppoesetup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: pppoesetup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: pppoesetup.rsc.download" }
     :if ([:len [/ip pool find where name="pppoe-pool"]] = 0) do={ :error "pppoesetup.rsc import completed, but pppoe-pool was not verified." }
     :if ([:len [/ppp profile find where name="isp-profile"]] = 0) do={ :error "pppoesetup.rsc import completed, but isp-profile was not verified." }
     :if ([:len [/interface pppoe-server server find where service-name="isp-pppoe" && disabled=no]] = 0) do={ :error "pppoesetup.rsc import completed, but the PPPoE server was not verified." }
    :do { /file remove [find name="pppoesetup.rsc"] } on-error={}
    /file set [find name="pppoesetup.rsc.download"] name="pppoesetup.rsc"
     :local fetchedFile [/file find name="pppoesetup.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create pppoesetup.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: pppoesetup.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: pppoesetup.rsc" }
     :set pppoeStatus "OK"
    :put "      PPPoE configuration applied; saved as pppoesetup.rsc."
    $pg 3 "pppoe" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "pppoe" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [pppoesetup.rsc] FAILED: " . $error)
    $pg 3 "pppoe" "failed" $error
    :do { /file remove [find name=failed-pppoesetup.rsc] } on-error={}
    :do { /file set [find name=pppoesetup.rsc.download] name=failed-pppoesetup.rsc } on-error={}
}

# --- Users configuration ------------------------------------------------------
:do {
    $pg 4 "users" "downloading" ""
    :put "[4/7] Downloading users configuration..."
    :do { /file remove [find name="users.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/users.rsc" dst-path="users.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="users.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create users.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: users.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: users.rsc.download" }
    :delay 2s
    :put "      Applying users configuration..."
    /import "users.rsc.download"
     :if ($ocholaUsersInstallMarker != "users-v1") do={ :error "users.rsc did not report a completed import." }
     :local fetchedFile [/file find name="users.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create users.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: users.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: users.rsc.download" }
     :if ([:len [/ip hotspot user profile find where name="default"]] = 0) do={ :error "users.rsc import completed, but the default hotspot profile was not verified." }
    :do { /file remove [find name="users.rsc"] } on-error={}
    /file set [find name="users.rsc.download"] name="users.rsc"
     :local fetchedFile [/file find name="users.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create users.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: users.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: users.rsc" }
     :set usersStatus "OK"
    :put "      Users configuration applied; saved as users.rsc."
    $pg 4 "users" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "users" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [users.rsc] FAILED: " . $error)
    $pg 4 "users" "failed" $error
    :do { /file remove [find name=failed-users.rsc] } on-error={}
    :do { /file set [find name=users.rsc.download] name=failed-users.rsc } on-error={}
}

# --- Sync-users firewalls -----------------------------------------------------
:do {
    $pg 5 "syncusers" "downloading" ""
    :put "[5/7] Downloading sync-users firewalls..."
    :do { /file remove [find name="syncusers.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/syncusers.rsc" dst-path="syncusers.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="syncusers.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncusers.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncusers.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncusers.rsc.download" }
    :delay 2s
    :put "      Applying sync-users firewalls..."
    /import "syncusers.rsc.download"
     :if ($ocholaSyncUsersInstallMarker != "syncusers-v1") do={ :error "syncusers.rsc did not report a completed import." }
     :local fetchedFile [/file find name="syncusers.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncusers.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncusers.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncusers.rsc.download" }
     :if ([:len [/ip firewall filter find where comment="SafeNet - allow API sync" && action=accept && chain=input]] = 0) do={ :error "syncusers.rsc import completed, but its API firewall rule was not verified." }
    :do { /file remove [find name="syncusers.rsc"] } on-error={}
    /file set [find name="syncusers.rsc.download"] name="syncusers.rsc"
     :local fetchedFile [/file find name="syncusers.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncusers.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncusers.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncusers.rsc" }
     :set syncUsersStatus "OK"
    :put "      Sync-users firewalls applied; saved as syncusers.rsc."
    $pg 5 "syncusers" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "sync-users" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [syncusers.rsc] FAILED: " . $error)
    $pg 5 "syncusers" "failed" $error
    :do { /file remove [find name=failed-syncusers.rsc] } on-error={}
    :do { /file set [find name=syncusers.rsc.download] name=failed-syncusers.rsc } on-error={}
}

# --- Heartbeat firewalls ------------------------------------------------------
:do {
    $pg 6 "heartbeat" "downloading" ""
    :put "[6/7] Downloading heartbeat firewalls..."
    :do { /file remove [find name="heartbeat.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/heartbeat.rsc" dst-path="heartbeat.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="heartbeat.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create heartbeat.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: heartbeat.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: heartbeat.rsc.download" }
    :delay 2s
    :put "      Applying heartbeat firewalls..."
    /import "heartbeat.rsc.download"
     :if ($ocholaHeartbeatInstallMarker != "heartbeat-v1") do={ :error "heartbeat.rsc did not report a completed import." }
     :local fetchedFile [/file find name="heartbeat.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create heartbeat.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: heartbeat.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: heartbeat.rsc.download" }
     :if ([:len [/system script find where name="ochola-heartbeat-script"]] = 0) do={ :error "heartbeat.rsc import completed, but its system script was not verified." }
     :if ([:len [/system scheduler find where name="ochola-heartbeat"]] = 0) do={ :error "heartbeat.rsc import completed, but its scheduler was not verified." }
    :do { /file remove [find name="heartbeat.rsc"] } on-error={}
    /file set [find name="heartbeat.rsc.download"] name="heartbeat.rsc"
     :local fetchedFile [/file find name="heartbeat.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create heartbeat.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: heartbeat.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: heartbeat.rsc" }
     :set heartbeatStatus "OK"
    :put "      Heartbeat firewalls applied; saved as heartbeat.rsc."
    $pg 6 "heartbeat" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "heartbeat" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [heartbeat.rsc] FAILED: " . $error)
    $pg 6 "heartbeat" "failed" $error
    :do { /file remove [find name=failed-heartbeat.rsc] } on-error={}
    :do { /file set [find name=heartbeat.rsc.download] name=failed-heartbeat.rsc } on-error={}
}

# --- Router-specific heartbeat endpoint ---------------------------------------
# The generic heartbeat bootstrap intentionally has no router secret. Replace it
# here with this router's authenticated URL and run it once immediately so the
# saved-router gate receives a genuine connection proof.
# This generic script has no saved-router token, so its heartbeat remains disabled.

# --- Sync-full script ---------------------------------------------------------
:do {
    $pg 7 "syncfull" "downloading" ""
    :put "[7/7] Downloading sync-full script..."
    :do { /file remove [find name="syncfull.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/syncfull.rsc" dst-path="syncfull.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="syncfull.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncfull.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncfull.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncfull.rsc.download" }
    :delay 2s
    :put "      Applying sync-full script..."
    /import "syncfull.rsc.download"
     :if ($ocholaSyncFullInstallMarker != "syncfull-v1") do={ :error "syncfull.rsc did not report a completed import." }
     :local fetchedFile [/file find name="syncfull.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncfull.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncfull.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncfull.rsc.download" }
     :if ([:len [/system scheduler find where name="ochola-autoupdate"]] = 0) do={ :error "syncfull.rsc import completed, but its auto-update scheduler was not verified." }
    :do { /file remove [find name="syncfull.rsc"] } on-error={}
    /file set [find name="syncfull.rsc.download"] name="syncfull.rsc"
     :local fetchedFile [/file find name="syncfull.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create syncfull.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: syncfull.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: syncfull.rsc" }
     :set syncFullStatus "OK"
    :put "      Sync-full script applied; saved as syncfull.rsc."
    $pg 7 "syncfull" "applied" ""
} on-error={
    :set failures ($failures + 1)
     :if ([:len $failedComponent] = 0) do={ :set failedComponent "sync-full" }
     :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [syncfull.rsc] FAILED: " . $error)
    $pg 7 "syncfull" "failed" $error
    :do { /file remove [find name=failed-syncfull.rsc] } on-error={}
    :do { /file set [find name=syncfull.rsc.download] name=failed-syncfull.rsc } on-error={}
}

# --- Preserve the personalized installer on daily updates ---------------------
# syncfull.rsc installs a generic fallback scheduler. Replace it here only when
# this installer was bound to a validated router record, otherwise generic
# downloads must remain tokenless and unable to report as a saved router.
# Generic installers intentionally retain the tokenless update scheduler.

# --- Optional diagnostic logging ----------------------------------------------
:do {
    :put "Downloading diagnostic log-push script..."
    /tool fetch url="https://come.isplatty.org/api/scripts/logpush.rsc" dst-path=logpush.rsc keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="logpush.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create logpush.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: logpush.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: logpush.rsc" }
    :delay 2s
    /import logpush.rsc
    :put "Diagnostic log-push installed; saved as logpush.rsc."
} on-error={
    :set optionalFailures ($optionalFailures + 1)
    :put ("Diagnostic log-push install skipped; check logpush.rsc - " . $error)
}

# --- API hardening -------------------------------------------------------------
:do {
    :put "Downloading API security script..."
    /tool fetch url="https://come.isplatty.org/api/scripts/seclogpush.rsc" dst-path=seclogpush.rsc keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="seclogpush.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create seclogpush.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: seclogpush.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: seclogpush.rsc" }
    :delay 2s
    /import seclogpush.rsc
    :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - management API allow" && action=accept && chain=input]] = 0) do={ :error "API lockdown allow rule was not installed" }
    :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - public management port drop" && action=drop && chain=input]] < 3) do={ :error "API lockdown drop rules were not installed" }
    :set apiLockdownActive true
    :put "API security script installed; saved as seclogpush.rsc."
} on-error={
    :set failures ($failures + 1)
    :if ([:len $failedComponent] = 0) do={ :set failedComponent "api-lockdown" }
    :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [seclogpush.rsc] REQUIRED API hardening failed: " . $error)
}

# A backup OpenVPN client uses the isolated 10.8.6.0/24 pool. The static
# sync/security children intentionally target the primary pool, so correct the
# final API allow-list to the VPN that actually passed verification.


# --- DNS flush scheduler ------------------------------------------------------
:do {
    :put "Setting up DNS flush scheduler..."
    :foreach i in=[/system scheduler find where name="dns-flush"] do={ /system scheduler remove $i }
    /system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush" policy=read,write,test,ftp start-time=00:00:00
    :if ([:len [/system scheduler find where name="dns-flush"]] = 0) do={ :error "DNS flush scheduler was not created" }
    :set dnsSchedulerActive true
    /ip dns cache flush
    :put "DNS flush scheduler installed (every 6 hours)."
} on-error={
    :set failures ($failures + 1)
    :if ([:len $failedComponent] = 0) do={ :set failedComponent "dns-scheduler" }
    :if ([:len $lastError] > 0) do={ :set lastError ($lastError . " | " . $error) } else={ :set lastError $error }
    :put ("  WARN [dns-flush] FAILED: " . $error)
}

# --- Report the installed router to this ISP's current app --------------------
# Router registration is enabled when this script is generated for a saved router.

# --- Keep install noise out of the normal system log --------------------------
:do {
    /system logging set [find topics="warning"] topics=warning,!script
    /system logging set [find topics="script"] topics=script,!warning
    :put "Log script-warning suppression applied"
} on-error={ :put "Log suppression skipped (non-fatal)" }

:local proxyStatus "NOT_CONFIGURED"
:if ("" != "") do={
    :set proxyStatus "FAILED"
    :if ($backendRegistrationSucceeded) do={ :set proxyStatus "REGISTERED" }
}
:local apiLockdownStatus "FAILED"
:if ($apiLockdownActive) do={ :set apiLockdownStatus "ACTIVE" }
:local dnsSchedulerStatus "FAILED"
:if ($dnsSchedulerActive) do={ :set dnsSchedulerStatus "ACTIVE" }
:local syncStatus "FAILED"
:if ($syncUsersStatus = "OK" && $syncFullStatus = "OK") do={ :set syncStatus "OK" }
:put ("ROUTEROS_VERSION=" . $routerOsVersion)
:put ("HOTSPOT_STATUS=" . $hotspotStatus)
:put ("PPPOE_STATUS=" . $pppoeStatus)
:put ("USERS_STATUS=" . $usersStatus)
:put ("SYNC_STATUS=" . $syncStatus)
:put ("HEARTBEAT_STATUS=" . $heartbeatStatus)
:put ("VPN_STATUS=" . $vpnStatus)
:put ("VPN_IP=" . $vpnIp)
:put ("PROXY_STATUS=" . $proxyStatus)
:put ("API_LOCKDOWN=" . $apiLockdownStatus)
:put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
:put ("FAILED_COMPONENT=" . $failedComponent)
:put ("ERROR=" . $lastError)
:local installationStatus "FAILED"
:if ($failures = 0 && $optionalFailures > 0) do={ :set installationStatus "PARTIAL" }
:if ($failures = 0 && $optionalFailures = 0 && (("" = "" || $backendRegistrationSucceeded) && $vpnStatus != "FAILED" && $apiLockdownActive && $dnsSchedulerActive)) do={
    :set installationStatus "SUCCESS"
}
:if ($failures = 0 && $optionalFailures = 0) do={
    :if (("" = "" || $backendRegistrationSucceeded) && $vpnStatus != "FAILED" && $apiLockdownActive && $dnsSchedulerActive) do={
        :put "INSTALLATION_STATUS=SUCCESS"
        :put ("VPN_STATUS=" . $vpnStatus)
        :put ("VPN_IP=" . $vpnIp)
        :put ("PROXY_STATUS=" . $proxyStatus)
        :put ("API_LOCKDOWN=" . $apiLockdownStatus)
        :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
        :put ("FAILED_COMPONENT=" . $failedComponent)
        :put ("ERROR=" . $lastError)
        :put "Ochola SuperNet: SUCCESS - VPN connected; core configuration installed; API lockdown completed."
    } else={
        :put "INSTALLATION_STATUS=FAILED"
        :put ("VPN_STATUS=" . $vpnStatus)
        :put ("VPN_IP=" . $vpnIp)
        :put ("PROXY_STATUS=" . $proxyStatus)
        :put ("API_LOCKDOWN=" . $apiLockdownStatus)
        :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
        :put ("FAILED_COMPONENT=" . $failedComponent)
        :put ("ERROR=" . $lastError)
        :put "Ochola SuperNet: FAILED - one or more required verification gates did not complete; production readiness is blocked."
    }
} else={
    :if ($failures = 0) do={
        :put "INSTALLATION_STATUS=PARTIAL"
        :put ("VPN_STATUS=" . $vpnStatus)
        :put ("VPN_IP=" . $vpnIp)
        :put ("PROXY_STATUS=" . $proxyStatus)
        :put ("API_LOCKDOWN=" . $apiLockdownStatus)
        :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
        :put ("FAILED_COMPONENT=" . $failedComponent)
        :put ("ERROR=" . $lastError)
        :put ("Ochola SuperNet: PARTIAL - core configuration installed, but " . $optionalFailures . " optional component(s) were skipped.")
    } else={
    :put "INSTALLATION_STATUS=FAILED"
    :put ("VPN_STATUS=" . $vpnStatus)
    :put ("VPN_IP=" . $vpnIp)
    :put ("PROXY_STATUS=" . $proxyStatus)
    :put ("API_LOCKDOWN=" . $apiLockdownStatus)
    :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
    :put ("FAILED_COMPONENT=" . $failedComponent)
    :put ("ERROR=" . $lastError)
    :put ("Ochola SuperNet: FAILED - " . $failures . " required step(s) failed and " . $optionalFailures . " optional issue(s); production readiness is blocked.")
    }
}


# Final completion ping for the admin progress timeline.
:do {
    :global IPProgUrl
    :global IPRname
    :global ocholaFormEncode
    :if ([:typeof $IPProgUrl] = "str" && [:len $IPProgUrl] > 0) do={
        /tool fetch url=$IPProgUrl http-method=post http-data=("done=1&rname=" . [$ocholaFormEncode $IPRname] . "&installation_status=" . [$ocholaFormEncode $installationStatus] . "&routeros_version=" . [$ocholaFormEncode $routerOsVersion] . "&vpn_status=" . [$ocholaFormEncode $vpnStatus] . "&vpn_ip=" . [$ocholaFormEncode $vpnIp] . "&proxy_status=" . [$ocholaFormEncode $proxyStatus] . "&api_lockdown=" . [$ocholaFormEncode $apiLockdownStatus] . "&dns_scheduler=" . [$ocholaFormEncode $dnsSchedulerStatus] . "&hotspot_status=" . [$ocholaFormEncode $hotspotStatus] . "&pppoe_status=" . [$ocholaFormEncode $pppoeStatus] . "&users_status=" . [$ocholaFormEncode $usersStatus] . "&sync_status=" . [$ocholaFormEncode $syncStatus] . "&heartbeat_status=" . [$ocholaFormEncode $heartbeatStatus] . "&failed_component=" . [$ocholaFormEncode $failedComponent] . "&error=" . [$ocholaFormEncode $lastError]) keep-result=no mode=https check-certificate=yes
    }
} on-error={}

