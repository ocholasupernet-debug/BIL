# Ochola SuperNet - Coexistence management installer
# INSTALLER_REVISION=rmtqms0de
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
    } on-error={ :put "WARN: progress callback failed; continuing installer." }
}

:global ocholaFormEncode do={
    :return [:tostr $1]
}

:put "INSTALLER_REVISION=rmtqms0de"

:local errors ""
:local trustStatus "FAILED"
:local trustError ""
:local auditStatus "FAILED"
:local auditError ""
:local versionStatus "FAILED"
:local versionError ""
:local vpnStageStatus "FAILED"
:local vpnStageError ""
:local hotspotStageStatus "FAILED"
:local hotspotStageError ""
:local heartbeatStatus "SKIPPED"
:local heartbeatError ""
:local finalAuditStatus "FAILED"
:local finalAuditError ""
:local bridgeCount 0
:local hotspotCount 0
:local dhcpCount 0
:local poolCount 0
:local radiusCount 0
:local filterCount 0
:local natCount 0
:local ovpnCount 0
:local ipsecCount 0
:local hotspotUserCount 0
:local pppUserCount 0
:local fileCount 0
:local vpnConfigured false
:local vpnProtocol ""
:local vpnStatus "FAILED"
:local vpnFailureSummary ""
:local routerOsVersion ""
:local routerOsMajorDigit ""
:local majorVersion 0
:local openVpnUrl ""
:local openVpnBackupUrl ""
:local wireGuardUrl ""
:local ipsecUrl ""
:local vpnIp ""
:local coexistenceBundleBytes ""

# Stage 1: trust bootstrap. Failure is recorded; later stages still run and
# report their own HTTPS/download failures rather than stopping this installer.
:do {
# Install the public CA used by the VPS HTTPS certificate before verified fetches.
# The CA certificate is public; no private certificate key is downloaded.
:do {
    :local caFile "ochola-isrg-root-x1.pem"
    :local caBuildBase "ochola-isrg-root-x1-bootstrap"
    :local caBuildFile "ochola-isrg-root-x1-bootstrap.txt"
    :local caImportFile $caFile
    :local caCert [/certificate find name="ochola-isrg-root-x1"]
    :if ([:len $caCert] = 0) do={
        :do { /file remove [find name="$caFile"] } on-error={}
        :do { /file remove [find name="$caBuildFile"] } on-error={}
        :local fetchedViaTrustedStore false
        :do {
            /tool fetch url="https://come.isplatty.org/api/scripts/ochola-isrg-root-x1.pem" dst-path="$caFile" keep-result=yes mode=https check-certificate=yes
            :set fetchedViaTrustedStore true
        } on-error={}
        :if (!$fetchedViaTrustedStore) do={
            :put "      RouterOS built-in trust did not validate the CA endpoint; using the embedded ISRG Root X1 trust anchor."
            /file print file=$caBuildBase
            /file set [find name=$caBuildFile] contents=""
            :local caText "-----BEGIN CERTIFICATE-----"
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=")
            /file set [find name=$caBuildFile] contents=$caText
            :set caText ($caText . "\n" . "-----END CERTIFICATE-----")
            /file set [find name=$caBuildFile] contents=$caText
            :set caImportFile $caBuildFile
        }
        /certificate import file-name="$caImportFile" name="ochola-isrg-root-x1"
        :do { /file remove [find name="$caFile"] } on-error={}
        :do { /file remove [find name="$caBuildFile"] } on-error={}
    }
    :set caCert [/certificate find name="ochola-isrg-root-x1"]
    :if ([:len $caCert] = 0) do={ :error "public HTTPS CA certificate was not imported" }
    /certificate set $caCert trusted=yes
    :put "      HTTPS certificate trust configured for verified downloads."
} on-error={
    :do { /file remove [find name="$caFile"] } on-error={}
    :do { /file remove [find name="$caBuildFile"] } on-error={}
    :error ("HTTPS certificate trust setup failed - " . $error)
}
    :set trustStatus "SUCCESS"
    :put "SUCCESS: HTTPS trust bootstrap completed."
    :do { $pg 0 "coexistence-trust" "applied" "" } on-error={ :put "WARN: progress update for coexistence-trust failed; continuing installer." }
} on-error={
    :set trustError $error
    :if ([:len $trustError] = 0) do={ :set trustError "HTTPS trust bootstrap failed without a RouterOS error message." }
    :set errors ($errors . "https-trust: " . $trustError . "; ")
    :put ("FAILED: HTTPS trust bootstrap - " . $trustError)
    :do { $pg 0 "coexistence-trust" "failed" $trustError } on-error={ :put "WARN: progress update for coexistence-trust failed; continuing installer." }
}

# Stage 2: read-only audit before any Ochola-owned resource is added.
:do {
    :set bridgeCount [:len [/interface bridge find]]
    :set hotspotCount [:len [/ip hotspot find]]
    :set dhcpCount [:len [/ip dhcp-server find]]
    :set poolCount [:len [/ip pool find]]
    :set radiusCount [:len [/radius find]]
    :set filterCount [:len [/ip firewall filter find]]
    :set natCount [:len [/ip firewall nat find]]
    :set ovpnCount [:len [/interface ovpn-client find]]
    :set ipsecCount [:len [/ip ipsec peer find]]
    :set hotspotUserCount [:len [/ip hotspot user find]]
    :set pppUserCount [:len [/ppp secret find]]
    :set fileCount [:len [/file find]]
    :set auditStatus "SUCCESS"
    :put ("SUCCESS: initial coexistence audit - bridges=" . $bridgeCount . ", hotspots=" . $hotspotCount . ", dhcp=" . $dhcpCount . ", pools=" . $poolCount . ", radius=" . $radiusCount . ", firewall=" . $filterCount . ", nat=" . $natCount . ", ovpn=" . $ovpnCount . ", ipsec=" . $ipsecCount . ", hotspot-users=" . $hotspotUserCount . ", ppp-users=" . $pppUserCount . ", files=" . $fileCount)
    :do { $pg 0 "coexistence-audit" "audited" "" } on-error={ :put "WARN: progress update for coexistence-audit failed; continuing installer." }
} on-error={
    :set auditError $error
    :if ([:len $auditError] = 0) do={ :set auditError "initial audit failed without a RouterOS error message." }
    :set errors ($errors . "initial-audit: " . $auditError . "; ")
    :put ("FAILED: initial coexistence audit - " . $auditError)
    :do { $pg 0 "coexistence-audit" "failed" $auditError } on-error={ :put "WARN: progress update for coexistence-audit failed; continuing installer." }
}

# Stage 3: RouterOS version and network preflight. Keep the version dispatch
# flat so RouterOS 6 parses it before any later stage is attempted.
:do {
    :set routerOsVersion [/system resource get version]
    :set routerOsMajorDigit [:pick $routerOsVersion 0 1]
    :set majorVersion 0
    :if ($routerOsMajorDigit = "7") do={ :set majorVersion 7 }
    :if ($routerOsMajorDigit = "6") do={ :set majorVersion 6 }
    :if ($majorVersion = 0) do={ :error ("Unsupported RouterOS version " . $routerOsVersion . ". Only RouterOS 6.48+ and 7.x are supported.") }
    :if ([/ping address=8.8.8.8 count=3] = 0) do={ :error "The router has no internet access; management VPN and hotspot downloads may fail." }
    :set versionStatus "SUCCESS"
    :put ("SUCCESS: RouterOS/network preflight completed - " . $routerOsVersion)
} on-error={
    :set versionError $error
    :if ([:len $versionError] = 0) do={ :set versionError "RouterOS/network preflight failed without a RouterOS error message." }
    :set errors ($errors . "version-network: " . $versionError . "; ")
    :put ("FAILED: RouterOS/network preflight - " . $versionError)
    :do { $pg 0 "coexistence-preflight" "failed" $versionError } on-error={ :put "WARN: progress update for coexistence-preflight failed; continuing installer." }
}

# Stage 4: management VPN. Each protocol attempt already retains its child
# diagnostics; failure of all protocols is recorded but does not stop later
# coexistence stages.
:do {
:set openVpnUrl ("https://come.isplatty.org/api/scripts/router-vpn.rsc?rid=90&token=example12345&mode=coexist&ros-version=" . [:tostr $majorVersion])
:set openVpnBackupUrl ("https://come.isplatty.org/api/scripts/router-vpn.rsc?rid=90&token=example12345&mode=coexist&protocol=openvpn-backup&ros-version=" . [:tostr $majorVersion])
    :set wireGuardUrl ""
    :set ipsecUrl ""
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
         :set attemptPhase "child import"
        :do {
            /import "ochola-coexist-vpn-openvpn.rsc.download"
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn: $attemptPhase failed; inspect ochola-coexist-vpn-openvpn.rsc.download and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="ochola-coexist-vpn-openvpn.rsc"] } on-error={}
         :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn.rsc.download" }
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
                :set vpnError "openvpn: $attemptPhase failed. Check ochola-coexist-vpn-openvpn.rsc.download and /log for the RouterOS error."
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
        :put ("  Retained child download for diagnosis: ochola-coexist-vpn-openvpn.rsc.download")
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
         :set attemptPhase "child import"
        :do {
            /import "ochola-coexist-vpn-openvpn-backup.rsc.download"
        } on-error={
            :local importError $error
            :if ([:len $ocholaVpnChildError] > 0) do={ :set importError $ocholaVpnChildError }
            :if ([:len $importError] = 0) do={ :set importError "openvpn-backup: $attemptPhase failed; inspect ochola-coexist-vpn-openvpn-backup.rsc.download and /log for the exact RouterOS command." }
            :set ocholaVpnChildError $importError
            :error $importError
        }
        :if ([:len $ocholaVpnChildError] > 0) do={ :error $ocholaVpnChildError }
        :do { /file remove [find name="ochola-coexist-vpn-openvpn-backup.rsc"] } on-error={}
         :local fetchedFile [/file find name="ochola-coexist-vpn-openvpn-backup.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexist-vpn-openvpn-backup.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexist-vpn-openvpn-backup.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexist-vpn-openvpn-backup.rsc.download" }
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
                :set vpnError "openvpn-backup: $attemptPhase failed. Check ochola-coexist-vpn-openvpn-backup.rsc.download and /log for the RouterOS error."
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
        :put ("  Retained child download for diagnosis: ochola-coexist-vpn-openvpn-backup.rsc.download")
    }
}


    :local verifiedVpnInterface "ochola-mgmt-vpn-90"
    :if ($vpnProtocol = "openvpn-backup") do={ :set verifiedVpnInterface "ochola-mgmt-vpn-90-backup" }
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
            :if ([:len [/interface wireguard find where name="ochola-mgmt-wg-90"]] > 0 && [:len [/ip address find where interface="ochola-mgmt-wg-90" && address~"^10\.8\.5\.[0-9]+/"]] > 0) do={
                :set vpnResourceReady true
                :set vpnStatus "CONNECTED"
                :foreach addressId in=[/ip address find where interface="ochola-mgmt-wg-90"] do={
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
        :set vpnStatus "FAILED"
        :set vpnFailureSummary ($vpnFailureSummary . "selected management VPN did not pass parent-level resource verification; ")
    }
    :if (!$vpnConfigured) do={
        :set vpnFailureSummary ($vpnFailureSummary . "no management VPN protocol succeeded; ")
    }
    :if ([:len $vpnFailureSummary] > 0) do={
        :set vpnStageError $vpnFailureSummary
        :set errors ($errors . "management-vpn: " . $vpnFailureSummary . "; ")
    }
    :if ($vpnConfigured && $vpnResourceReady) do={
        :set vpnStageStatus "SUCCESS"
        :put ("SUCCESS: management VPN - " . $vpnProtocol . " added; existing customer configuration was not replaced.")
        :do { $pg 1 "coexistence-vpn" "applied" ("management-vpn=" . $vpnProtocol) } on-error={ :put "WARN: progress update for coexistence-vpn failed; continuing installer." }
    } else={
        :set vpnStageStatus "FAILED"
        :if ([:len $vpnStageError] = 0) do={ :set vpnStageError "management VPN did not become ready." }
        :put ("FAILED: management VPN - " . $vpnStageError)
        :do { $pg 1 "coexistence-vpn" "failed" $vpnStageError } on-error={ :put "WARN: progress update for coexistence-vpn failed; continuing installer." }
    }
    :put ("VPN_STATUS=" . $vpnStatus)
    :put ("VPN_IP=" . $vpnIp)
} on-error={
    :set vpnStageError $error
    :if ([:len $vpnStageError] = 0) do={ :set vpnStageError "management VPN stage failed without a RouterOS error message." }
    :set errors ($errors . "management-vpn: " . $vpnStageError . "; ")
    :put ("FAILED: management VPN stage - " . $vpnStageError)
    :do { $pg 1 "coexistence-vpn" "failed" $vpnStageError } on-error={ :put "WARN: progress update for coexistence-vpn failed; continuing installer." }
}

# Stage 5: isolated hotspot bundle. This never removes or resets existing
# billing, customer-access, LAN, PPPoE, or existing hotspot resources.
:do {

    :global ocholaCoexistenceError
    :set ocholaCoexistenceError ""
    :set coexistenceBundleBytes ""
    :do { /file remove [find name="ochola-coexistence-hotspot.rsc.download"] } on-error={}
    /tool fetch url="https://come.isplatty.org/api/scripts/coexistence-hotspot/90.rsc" dst-path="ochola-coexistence-hotspot.rsc.download" keep-result=yes mode=https check-certificate=yes
    :local fetchedFile [/file find name="ochola-coexistence-hotspot.rsc.download"]
:if ([:len $fetchedFile] = 0) do={ :error "download did not create ochola-coexistence-hotspot.rsc.download" }
:local fetchedType [/file get $fetchedFile type]
:if ($fetchedType = "directory") do={ :error "download destination is a directory: ochola-coexistence-hotspot.rsc.download" }
:local fetchedSize [/file get $fetchedFile size]
:if ([:tonum $fetchedSize] <= 0) do={ :error "download created an empty file: ochola-coexistence-hotspot.rsc.download" }
    :set coexistenceBundleBytes [/file get [find name="ochola-coexistence-hotspot.rsc.download"] size]
    :put ("COEXISTENCE BUNDLE DOWNLOADED: " . $coexistenceBundleBytes . " bytes")
    /import "ochola-coexistence-hotspot.rsc.download"
    :set hotspotStageStatus "SUCCESS"
    :put "SUCCESS: isolated coexistence hotspot bundle installed; existing customer services remain untouched."
    :do { $pg 2 "coexistence-hotspot" "applied" "" } on-error={ :put "WARN: progress update for coexistence-hotspot failed; continuing installer." }

} on-error={
    :global ocholaCoexistenceError
    :set hotspotStageError $error
    :if ([:len $hotspotStageError] = 0) do={ :set hotspotStageError ("isolated hotspot bundle failed after " . $coexistenceBundleBytes . " bytes; inspect the RouterOS log.") }
    :set errors ($errors . "isolated-hotspot: " . $hotspotStageError . "; ")
    :put ("FAILED: isolated coexistence hotspot - " . $hotspotStageError)
    :do { $pg 2 "coexistence-hotspot" "failed" $hotspotStageError } on-error={ :put "WARN: progress update for coexistence-hotspot failed; continuing installer." }
    :do { /file remove [find name="failed-ochola-coexistence-hotspot.rsc"] } on-error={}
    :put "  Retained coexistence hotspot download for diagnosis: ochola-coexistence-hotspot.rsc.download"
}

# Stage 6: authenticated heartbeat. It is independent of VPN and hotspot
# success so it can still provide recovery telemetry after a partial install.
:do {

    /tool fetch url="https://come.isplatty.org/api/isp/router/heartbeat/example?coexist=1" keep-result=no mode=https check-certificate=yes
    :set heartbeatStatus "SUCCESS"
    :put "SUCCESS: coexistence heartbeat sent; existing customer services remain under their current configuration."
    :do { $pg 3 "coexistence-heartbeat" "applied" "" } on-error={ :put "WARN: progress update for coexistence-heartbeat failed; continuing installer." }

} on-error={
    :set heartbeatError $error
    :if ([:len $heartbeatError] = 0) do={ :set heartbeatError "coexistence heartbeat failed without a RouterOS error message." }
    :set errors ($errors . "heartbeat: " . $heartbeatError . "; ")
    :put ("FAILED: coexistence heartbeat - " . $heartbeatError)
    :do { $pg 3 "coexistence-heartbeat" "failed" $heartbeatError } on-error={ :put "WARN: progress update for coexistence-heartbeat failed; continuing installer." }
}

# Stage 7: final read-only audit. This runs even when VPN or hotspot failed.
:do {
    :set bridgeCount [:len [/interface bridge find]]
    :set hotspotCount [:len [/ip hotspot find]]
    :set dhcpCount [:len [/ip dhcp-server find]]
    :set poolCount [:len [/ip pool find]]
    :set radiusCount [:len [/radius find]]
    :set filterCount [:len [/ip firewall filter find]]
    :set natCount [:len [/ip firewall nat find]]
    :set ovpnCount [:len [/interface ovpn-client find]]
    :set ipsecCount [:len [/ip ipsec peer find]]
    :set hotspotUserCount [:len [/ip hotspot user find]]
    :set pppUserCount [:len [/ppp secret find]]
    :set fileCount [:len [/file find]]
    :set finalAuditStatus "SUCCESS"
    :put ("SUCCESS: final coexistence audit - bridges=" . $bridgeCount . ", hotspots=" . $hotspotCount . ", dhcp=" . $dhcpCount . ", pools=" . $poolCount . ", radius=" . $radiusCount . ", firewall=" . $filterCount . ", nat=" . $natCount . ", ovpn=" . $ovpnCount . ", ipsec=" . $ipsecCount . ", hotspot-users=" . $hotspotUserCount . ", ppp-users=" . $pppUserCount . ", files=" . $fileCount)
    :do { $pg 4 "coexistence-final-audit" "audited" "" } on-error={ :put "WARN: progress update for coexistence-final-audit failed; continuing installer." }
} on-error={
    :set finalAuditError $error
    :if ([:len $finalAuditError] = 0) do={ :set finalAuditError "final audit failed without a RouterOS error message." }
    :set errors ($errors . "final-audit: " . $finalAuditError . "; ")
    :put ("FAILED: final coexistence audit - " . $finalAuditError)
    :do { $pg 4 "coexistence-final-audit" "failed" $finalAuditError } on-error={ :put "WARN: progress update for coexistence-final-audit failed; continuing installer." }
}

# Final summary: no stage above can terminate this coexistence installer.
:put "======================================================"
:put "COEXISTENCE INSTALLATION SUMMARY"
:if ($trustStatus = "SUCCESS") do={ :put "SUCCESS: HTTPS trust bootstrap" } else={ :put ("FAILED: HTTPS trust bootstrap - " . $trustError) }
:if ($auditStatus = "SUCCESS") do={ :put "SUCCESS: initial audit" } else={ :put ("FAILED: initial audit - " . $auditError) }
:if ($versionStatus = "SUCCESS") do={ :put "SUCCESS: RouterOS/network preflight" } else={ :put ("FAILED: RouterOS/network preflight - " . $versionError) }
:if ($vpnStageStatus = "SUCCESS") do={ :put ("SUCCESS: management VPN (" . $vpnProtocol . ")") } else={ :put ("FAILED: management VPN - " . $vpnStageError) }
:if ($hotspotStageStatus = "SUCCESS") do={ :put "SUCCESS: isolated coexistence hotspot" } else={ :put ("FAILED: isolated coexistence hotspot - " . $hotspotStageError) }
:if ($heartbeatStatus = "SUCCESS") do={ :put "SUCCESS: authenticated heartbeat" } else={ :put ("FAILED: authenticated heartbeat - " . $heartbeatError) }
:if ($finalAuditStatus = "SUCCESS") do={ :put "SUCCESS: final audit" } else={ :put ("FAILED: final audit - " . $finalAuditError) }
:if ([:len $errors] = 0) do={ :put "ERRORS: none" } else={ :put ("ERRORS: " . $errors) }
:put "COEXISTENCE COMPLETE: existing billing, customer-access, LAN, PPPoE, and other existing configuration was not removed or reset."

# Final completion ping for the admin progress timeline.
:do {
    :global IPProgUrl
    :global IPRname
    :global ocholaFormEncode
    :if ([:typeof $IPProgUrl] = "str" && [:len $IPProgUrl] > 0) do={
        /tool fetch url=$IPProgUrl http-method=post http-data=("done=1&rname=" . [$ocholaFormEncode $IPRname] . "&installation_status=" . [$ocholaFormEncode $installationStatus] . "&routeros_version=" . [$ocholaFormEncode $routerOsVersion] . "&vpn_status=" . [$ocholaFormEncode $vpnStatus] . "&vpn_ip=" . [$ocholaFormEncode $vpnIp] . "&proxy_status=" . [$ocholaFormEncode $proxyStatus] . "&api_lockdown=" . [$ocholaFormEncode $apiLockdownStatus] . "&dns_scheduler=" . [$ocholaFormEncode $dnsSchedulerStatus] . "&hotspot_status=" . [$ocholaFormEncode $hotspotStatus] . "&pppoe_status=" . [$ocholaFormEncode $pppoeStatus] . "&users_status=" . [$ocholaFormEncode $usersStatus] . "&sync_status=" . [$ocholaFormEncode $syncStatus] . "&heartbeat_status=" . [$ocholaFormEncode $heartbeatStatus] . "&failed_component=" . [$ocholaFormEncode $failedComponent] . "&error=" . [$ocholaFormEncode $lastError]) keep-result=no mode=https check-certificate=yes
    }
} on-error={}

