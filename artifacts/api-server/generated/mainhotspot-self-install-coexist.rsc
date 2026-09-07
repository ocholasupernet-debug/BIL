# Ochola SuperNet - Coexistence management installer
# INSTALLER_REVISION=rmtqlj151
# This path never replaces billing, customer-access, or LAN configuration.
# It audits existing resources, then adds only Ochola management resources.

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
            /file add name=$caFile contents="-----BEGIN CERTIFICATE-----\r\nMIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\r\nTzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\r\ncmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\r\nWhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\r\nZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\r\nMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\r\nh77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\r\n0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\r\nA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\r\nT8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH\r\nB5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC\r\nB5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv\r\nKBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn\r\nOlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn\r\njh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw\r\nqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI\r\nrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\r\nHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\r\nhkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL\r\nubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ\r\n3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK\r\nNFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5\r\nORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur\r\nTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC\r\njNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc\r\noyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq\r\n4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\r\nmRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d\r\nemyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\r\n-----END CERTIFICATE-----\r\n"
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

:put "INSTALLER_REVISION=rmtqlj151"

:local bridgeCount [:len [/interface bridge find]]
:local hotspotCount [:len [/ip hotspot find]]
:local dhcpCount [:len [/ip dhcp-server find]]
:local poolCount [:len [/ip pool find]]
:local radiusCount [:len [/radius find]]
:local filterCount [:len [/ip firewall filter find]]
:local natCount [:len [/ip firewall nat find]]
:local ovpnCount [:len [/interface ovpn-client find]]
:local ipsecCount [:len [/ip ipsec peer find]]
:local hotspotUserCount [:len [/ip hotspot user find]]
:local pppUserCount [:len [/ppp secret find]]
:local fileCount [:len [/file find]]
:put ("COEXISTENCE AUDIT - bridges=" . $bridgeCount . ", hotspots=" . $hotspotCount . ", dhcp=" . $dhcpCount . ", pools=" . $poolCount . ", radius=" . $radiusCount . ", firewall=" . $filterCount . ", nat=" . $natCount . ", ovpn=" . $ovpnCount . ", ipsec=" . $ipsecCount . ", hotspot-users=" . $hotspotUserCount . ", ppp-users=" . $pppUserCount . ", files=" . $fileCount)
$pg 0 "coexistence-audit" "audited" ("bridges=" . $bridgeCount . ";hotspots=" . $hotspotCount . ";dhcp=" . $dhcpCount . ";pools=" . $poolCount . ";radius=" . $radiusCount . ";firewall=" . $filterCount . ";nat=" . $natCount . ";ovpn=" . $ovpnCount . ";ipsec=" . $ipsecCount . ";hotspot-users=" . $hotspotUserCount . ";ppp-users=" . $pppUserCount . ";files=" . $fileCount)

:local vpnConfigured false
:local vpnProtocol ""
:local vpnFailureSummary ""
:local routerOsVersion [/system resource get version]
:local routerOsMajorDigit [:pick $routerOsVersion 0 1]
:local majorVersion 0
:if ($routerOsMajorDigit = "7") do={
    :set majorVersion 7
} else={
    :if ($routerOsMajorDigit = "6") do={
        :set majorVersion 6
    } else={
        :error ("Unsupported RouterOS version " . $routerOsVersion . ". Only RouterOS 6.48+ and 7.x are supported.")
    }
}
:if ([/ping 8.8.8.8 count=3] = 0) do={ :error "The router has no internet access; coexistence stopped before any configuration was added." }
:local openVpnUrl ""
 :local openVpnBackupUrl ""
    :local wireGuardUrl ""
    :local ipsecUrl ""
:if ($majorVersion >= 7) do={ :set openVpnUrl "https://come.isplatty.org/api/scripts/vpn7.rsc" } else={ :set openVpnUrl "https://come.isplatty.org/api/scripts/vpn6.rsc" }
:set openVpnBackupUrl ""
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
        :do { /file remove [find name="ochola-coexist-vpn-openvpn.rsc.download"] } on-error={}
         :set attemptPhase "download"
        /tool fetch url=$openVpnUrl dst-path="ochola-coexist-vpn-openvpn.rsc.download" keep-result=yes mode=https check-certificate=yes
         :set attemptPhase "download verification"
        :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn.rsc.download" }
 :global ocholaVpnChildError
 :local fetchedContents ""
 :do { :set fetchedContents [/file get $fetchedFile contents] } on-error={
     :set ocholaVpnChildError "downloaded ochola-coexist-vpn-openvpn.rsc.download could not be inspected before import"
     :error $ocholaVpnChildError
 }
 :if ([:len $fetchedContents] >= [:len "# OCHOLA_ROUTER_VPN_ERROR"] && [:pick $fetchedContents 0 [:len "# OCHOLA_ROUTER_VPN_ERROR"]] = "# OCHOLA_ROUTER_VPN_ERROR") do={
     :set ocholaVpnChildError ("server rejected ochola-coexist-vpn-openvpn.rsc.download: " . $fetchedContents)
     :error $ocholaVpnChildError
 }
        :delay 2s
         :if ($majorVersion >= 7) do={
             :local preflightError ""
              :set attemptPhase "RouterOS 7 dry-run"
             :do {
                 /import "ochola-coexist-vpn-openvpn.rsc.download" verbose=yes dry-run
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
            /import "ochola-coexist-vpn-openvpn.rsc.download" verbose=yes
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn: $attemptPhase failed; inspect failed-ochola-coexist-vpn-openvpn.rsc and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="ochola-coexist-vpn-openvpn.rsc"] } on-error={}
        /file set [find name="ochola-coexist-vpn-openvpn.rsc.download"] name="ochola-coexist-vpn-openvpn.rsc"
         :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn.rsc" }
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
                :set vpnError "openvpn: $attemptPhase failed. Check failed-ochola-coexist-vpn-openvpn.rsc and /log for the RouterOS error."
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
        :do { /file remove [find name="failed-ochola-coexist-vpn-openvpn.rsc"] } on-error={}
        :do { /file set [find name="ochola-coexist-vpn-openvpn.rsc.download"] name="failed-ochola-coexist-vpn-openvpn.rsc" } on-error={}
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
        :do { /file remove [find name="ochola-coexist-vpn-openvpn-backup.rsc.download"] } on-error={}
         :set attemptPhase "download"
        /tool fetch url=$openVpnBackupUrl dst-path="ochola-coexist-vpn-openvpn-backup.rsc.download" keep-result=yes mode=https check-certificate=yes
         :set attemptPhase "download verification"
        :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn-backup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn-backup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn-backup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn-backup.rsc.download" }
 :global ocholaVpnChildError
 :local fetchedContents ""
 :do { :set fetchedContents [/file get $fetchedFile contents] } on-error={
     :set ocholaVpnChildError "downloaded ochola-coexist-vpn-openvpn-backup.rsc.download could not be inspected before import"
     :error $ocholaVpnChildError
 }
 :if ([:len $fetchedContents] >= [:len "# OCHOLA_ROUTER_VPN_ERROR"] && [:pick $fetchedContents 0 [:len "# OCHOLA_ROUTER_VPN_ERROR"]] = "# OCHOLA_ROUTER_VPN_ERROR") do={
     :set ocholaVpnChildError ("server rejected ochola-coexist-vpn-openvpn-backup.rsc.download: " . $fetchedContents)
     :error $ocholaVpnChildError
 }
        :delay 2s
         :if ($majorVersion >= 7) do={
             :local preflightError ""
              :set attemptPhase "RouterOS 7 dry-run"
             :do {
                 /import "ochola-coexist-vpn-openvpn-backup.rsc.download" verbose=yes dry-run
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
            /import "ochola-coexist-vpn-openvpn-backup.rsc.download" verbose=yes
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn-backup: $attemptPhase failed; inspect failed-ochola-coexist-vpn-openvpn-backup.rsc and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="ochola-coexist-vpn-openvpn-backup.rsc"] } on-error={}
        /file set [find name="ochola-coexist-vpn-openvpn-backup.rsc.download"] name="ochola-coexist-vpn-openvpn-backup.rsc"
         :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn-backup.rsc"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn-backup.rsc" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn-backup.rsc" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn-backup.rsc" }
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
                :set vpnError "openvpn-backup: $attemptPhase failed. Check failed-ochola-coexist-vpn-openvpn-backup.rsc and /log for the RouterOS error."
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
        :do { /file remove [find name="failed-ochola-coexist-vpn-openvpn-backup.rsc"] } on-error={}
        :do { /file set [find name="ochola-coexist-vpn-openvpn-backup.rsc.download"] name="failed-ochola-coexist-vpn-openvpn-backup.rsc" } on-error={}
    }
}


:if (!$vpnConfigured) do={
    :put ("COEXISTENCE STOPPED - no management VPN was installed. " . $vpnFailureSummary)
    $pg 1 "coexistence" "failed" $vpnFailureSummary
    :error ("Coexistence stopped without changing existing billing resources: " . $vpnFailureSummary)
}
:put ("COEXISTENCE VPN READY - " . $vpnProtocol . " added; existing customer configuration was not replaced.")
$pg 1 "coexistence-vpn" "applied" ("management-vpn=" . $vpnProtocol)

# Install Ochola's isolated hotspot service only after the management VPN is ready.
:local coexistenceBundleBytes ""
:local coexistencePreflightError ""
:do {
    :global ocholaCoexistenceError
    :set ocholaCoexistenceError ""
    :do { /file remove [find name="ochola-coexistence-hotspot.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/coexistence-hotspot.rsc" dst-path="ochola-coexistence-hotspot.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="ochola-coexistence-hotspot.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexistence-hotspot.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexistence-hotspot.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexistence-hotspot.rsc.download" }
    :set coexistenceBundleBytes [/file get [find name="ochola-coexistence-hotspot.rsc.download"] size]
    :put ("COEXISTENCE BUNDLE DOWNLOADED: " . $coexistenceBundleBytes . " bytes")
    # RouterOS 7 can report the exact source line and column for import-time
    # syntax/property failures without changing configuration. RouterOS 6
    # does not have this import option, so the normal import remains the
    # compatibility path there.
    :if ($majorVersion >= 7) do={
        :do {
            /import "ochola-coexistence-hotspot.rsc.download" verbose=yes dry-run
        } on-error={
            :set coexistencePreflightError $error
        }
        :if ([:len $coexistencePreflightError] > 0) do={
            :error ("coexistence hotspot dry-run failed: " . $coexistencePreflightError)
        }
    }
    /import "ochola-coexistence-hotspot.rsc.download"
    :do { /file set [find name="ochola-coexistence-hotspot.rsc.download"] name="ochola-coexistence-hotspot.rsc" } on-error={}
    $pg 1 "coexistence-hotspot" "applied" ""
} on-error={
    :global ocholaCoexistenceError
    :local hotspotError $ocholaCoexistenceError
    :if ([:len $hotspotError] = 0) do={
        :set hotspotError ("isolated hotspot bundle import failed after " . $coexistenceBundleBytes . " bytes; inspect failed-ochola-coexistence-hotspot.rsc and the RouterOS log for the failing stage.")
    }
    :put ("COEXISTENCE STOPPED - isolated hotspot service was not installed: " . $hotspotError)
    $pg 1 "coexistence-hotspot" "failed" $hotspotError
    :do { /file remove [find name="failed-ochola-coexistence-hotspot.rsc"] } on-error={}
    :do { /file set [find name="ochola-coexistence-hotspot.rsc.download"] name="failed-ochola-coexistence-hotspot.rsc" } on-error={}
    :error ("Coexistence stopped without changing existing billing resources; isolated hotspot failed: " . $hotspotError)
}


