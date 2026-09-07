# OcholaSuperNet Main ISP Configuration Script (mainhotspot.rsc)
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
:put ("ROUTEROS_VERSION=" . $version)
:local internetReachable false
:foreach internetTarget in={"1.1.1.1";"8.8.8.8";"9.9.9.9"} do={
    :if (!$internetReachable) do={
        :do {
            :if ([/ping address=$internetTarget count=2] > 0) do={ :set internetReachable true }
        } on-error={}
    }
}
:if (!$internetReachable) do={
    :error "No usable internet connection was found after testing multiple destinations."
}
:local failures 0
:local optionalFailures 0
:local hotspotStatus "FAILED"
:local pppoeStatus "FAILED"
:local usersStatus "FAILED"
:local syncUsersStatus "FAILED"
:local syncFullStatus "FAILED"
:local heartbeatStatus "FAILED"
:local failedComponent ""
:local safeError ""
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
        # RouterOS 6/7 parses a find expression more reliably than a local
        # result variable in the item position of /file set.
        /file set [find name=$temp] name=($dst)
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
            /tool fetch url="https://come.isplatty.org/scripts/ochola-isrg-root-x1.pem" dst-path=$caFile keep-result=yes mode=https check-certificate=yes
            :set fetchedViaTrustedStore true
        } on-error={}
        :if (!$fetchedViaTrustedStore) do={
            :put "RouterOS built-in trust did not validate the CA endpoint; using the embedded ISRG Root X1 trust anchor."
            /file add name=$caFile contents="-----BEGIN CERTIFICATE-----\r\nMIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\r\nTzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\r\ncmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\r\nWhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\r\nZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\r\nMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\r\nh77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\r\n0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\r\nA5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\r\nT8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH\r\nB5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC\r\nB5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv\r\nKBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn\r\nOlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn\r\njh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw\r\nqHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI\r\nrU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\r\nHRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\r\nhkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL\r\nubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ\r\n3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK\r\nNFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5\r\nORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur\r\nTkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC\r\njNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc\r\noyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq\r\n4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\r\nmRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d\r\nemyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\r\n-----END CERTIFICATE-----\r\n"
        }
        :if ([:tonum [/file get [/file find name=$caFile] size]] <= 0) do={ :error "public CA source was empty" }
        /certificate import file-name=$caFile name=$caName
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
        :set vpnUrl "https://come.isplatty.org/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890/7.rsc"
    } else={
        :if ($majorVersion = 6) do={
            :set vpnUrl "https://come.isplatty.org/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890/6.rsc"
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
            :foreach vpnClient in=[/interface ovpn-client find where name="ochola-mgmt-vpn-90"] do={
                :if ([/interface ovpn-client get $vpnClient running] = true) do={
                    :foreach addressId in=[/ip address find where interface="ochola-mgmt-vpn-90"] do={
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
        :set failedComponent "management-vpn"
        :set safeError "Required management VPN did not reach running=yes with a valid 10.8.5.x address."
        :error "Required management VPN client ochola-mgmt-vpn-90 did not reach running=yes with a valid 10.8.5.x address."
    }
    :put ("VPN_STATUS=CONNECTED")
    :put ("VPN_IP=" . $vpnIp)
    :do { $ocholaFetchImportMain "hotspot configuration" "https://come.isplatty.org/scripts/hotspotsetup.rsc" "hotspotsetup.rsc"; :set hotspotStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "hotspot"
        :set safeError $error
        :put ("  REQUIRED hotspot step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "PPPoE configuration" "https://come.isplatty.org/scripts/pppoesetup.rsc" "pppoesetup.rsc"; :set pppoeStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "pppoe"
        :set safeError $error
        :put ("  REQUIRED PPPoE step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "users configuration" "https://come.isplatty.org/scripts/users.rsc" "users.rsc"; :set usersStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "users"
        :set safeError $error
        :put ("  REQUIRED users step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "sync-users firewalls" "https://come.isplatty.org/scripts/syncusers.rsc" "syncusers.rsc"; :set syncUsersStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "sync-users"
        :set safeError $error
        :put ("  REQUIRED sync-users step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "heartbeat firewalls" "https://come.isplatty.org/scripts/heartbeat.rsc" "heartbeat.rsc"; :set heartbeatStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "heartbeat"
        :set safeError $error
        :put ("  REQUIRED heartbeat step failed: " . $error)
    }
    :do { $ocholaFetchImportMain "sync-full script" "https://come.isplatty.org/scripts/syncfull.rsc" "syncfull.rsc"; :set syncFullStatus "OK" } on-error={
        :set failures ($failures + 1)
        :set failedComponent "sync-full"
        :set safeError $error
        :put ("  REQUIRED sync-full step failed: " . $error)
    }
    :do {
      $ocholaFetchImportMain "log-push script" "https://come.isplatty.org/scripts/logpush.rsc" "logpush.rsc"
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
      $ocholaFetchImportMain "API lockdown" "https://come.isplatty.org/scripts/seclogpush.rsc" "seclogpush.rsc"
       :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - management API allow" && action=accept && chain=input]] = 0) do={ :error "API lockdown allow rule was not installed" }
       :if ([:len [/ip firewall filter find where comment="OcholaSuperNet - public management port drop" && action=drop && chain=input]] < 3) do={ :error "API lockdown drop rules were not installed" }
       :set apiLockdownActive true
    } on-error={
        :set failedComponent "api-lockdown"
        :set safeError $error
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
             :foreach a in=[/ip address find where interface="ochola-mgmt-vpn-90"] do={
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
              http-data=("action=register&sub=come&name=come1&ip=" . $reportedIp) \
              url=$proxyReportUrl \
              output=user
             :set proxyRegistrationSucceeded true
            :put ("Reported VPN IP " . $reportedIp . " to proxy")
        } on-error={
            :put "Primary proxyserver report failed; trying proxyvpn backup..."
            :do {
                /tool fetch mode=https http-method=post \
                  http-data=("action=register&sub=come&name=come1&ip=" . $reportedIp) \
                  url="https://proxyvpn.isplatty.org/ipp.php" \
                  output=user
                 :set proxyRegistrationSucceeded true
                :put ("Reported VPN IP " . $reportedIp . " through proxyvpn backup")
            } on-error={
                  :set failedComponent "proxy-registration"
                  :set safeError $error
                 :set failures ($failures + 1)
                 :put "FAILED: Proxy report and proxyvpn backup failed; heartbeat will retry, but production readiness is blocked."
            }
        }
    } else={
        :set failedComponent "proxy-registration"
        :set safeError "Management VPN interface has no valid 10.8.5.x IP; proxy registration was not attempted."
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
      :local syncStatus "FAILED"
      :if ($syncUsersStatus = "OK" && $syncFullStatus = "OK") do={ :set syncStatus "OK" }
      :put ("ROUTEROS_VERSION=" . $version)
      :put ("HOTSPOT_STATUS=" . $hotspotStatus)
      :put ("PPPOE_STATUS=" . $pppoeStatus)
      :put ("USERS_STATUS=" . $usersStatus)
      :put ("SYNC_STATUS=" . $syncStatus)
      :put ("HEARTBEAT_STATUS=" . $heartbeatStatus)
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
           :put ("FAILED_COMPONENT=" . $failedComponent)
           :put ("ERROR=" . $safeError)
             :put ("PARTIAL: core configuration installed, but " . $optionalFailures . " optional component(s) need attention.")
        } else={
               :put "INSTALLATION_STATUS=FAILED"
               :put ("VPN_STATUS=" . $vpnStatus)
               :put ("VPN_IP=" . $vpnIp)
               :put ("PROXY_STATUS=" . $proxyStatus)
               :put ("API_LOCKDOWN=" . $apiLockdownStatus)
               :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
               :put ("FAILED_COMPONENT=" . $failedComponent)
               :put ("ERROR=" . $safeError)
             :put ("FAILED: " . $failures . " required failure(s) and " . $optionalFailures . " optional issue(s); production readiness is blocked.")
        }
    }
} on-error={
    :set failures ($failures + 1)
    :put ("REQUIRED_UNHANDLED_FAILURE=" . $error)
    :put "INSTALLATION_STATUS=FAILED"
     :put ("ROUTEROS_VERSION=" . $version)
    :put ("VPN_STATUS=" . $vpnStatus)
    :put ("VPN_IP=" . $vpnIp)
    :local proxyStatus "FAILED"
    :local apiLockdownStatus "FAILED"
    :local dnsSchedulerStatus "FAILED"
     :local syncStatus "FAILED"
    :if ($proxyRegistrationSucceeded) do={ :set proxyStatus "REGISTERED" }
    :if ($apiLockdownActive) do={ :set apiLockdownStatus "ACTIVE" }
    :if ($dnsSchedulerActive) do={ :set dnsSchedulerStatus "ACTIVE" }
     :put ("HOTSPOT_STATUS=" . $hotspotStatus)
     :put ("PPPOE_STATUS=" . $pppoeStatus)
     :put ("USERS_STATUS=" . $usersStatus)
     :put ("SYNC_STATUS=" . $syncStatus)
     :put ("HEARTBEAT_STATUS=" . $heartbeatStatus)
    :put ("PROXY_STATUS=" . $proxyStatus)
    :put ("API_LOCKDOWN=" . $apiLockdownStatus)
    :put ("DNS_SCHEDULER=" . $dnsSchedulerStatus)
     :put ("FAILED_COMPONENT=" . $failedComponent)
     :put ("ERROR=" . $error)
}
