# OcholaSuperNet / ISPlatty MikroTik installer verification
# RouterOS 6/7 compatible, read-only.
#
# Upload this file to the router and run:
#   /import mikrotik-installer-verify.rsc
#
# This script does not download, import, remove, enable, disable, or modify
# any RouterOS resource. It only checks retained installer files and the
# resources that prove the core child scripts were imported.

:put "======================================================"
:put " OcholaSuperNet installer verification"
:put " READ-ONLY — no router configuration will be changed"
:put "======================================================"
:put ("RouterOS version: " . [/system resource get version])
:put ""

:local filePassed 0
:local fileFailed 0
:local resourcePassed 0
:local resourceFailed 0

:local checkFile do={
    :local fileName $1
    :local fileIds [/file find where name=$fileName]
    :if ([:len $fileIds] = 0) do={
        :put ("FAIL FILE     " . $fileName . " — not found")
        :return false
    }
    :local fileId [:pick $fileIds 0]
    :local fileSize 0
    :do { :set fileSize [/file get $fileId size] } on-error={}
    :if ([:tonum $fileSize] <= 0) do={
        :put ("FAIL FILE     " . $fileName . " — empty")
        :return false
    }
    :put ("PASS FILE     " . $fileName . " (" . $fileSize . " bytes)")
    :return true
}

:local checkResource do={
    :local resourceName $1
    :local found $2
    :if ($found) do={
        :put ("PASS RESOURCE " . $resourceName)
        :return true
    }
    :put ("FAIL RESOURCE " . $resourceName)
    :return false
}

:local checkOptionalFile do={
    :local fileName $1
    :local fileIds [/file find where name=$fileName]
    :if ([:len $fileIds] = 0) do={
        :put ("INFO FILE     " . $fileName . " — not present; this fallback may not have been selected")
        :return false
    }
    :local fileId [:pick $fileIds 0]
    :local fileSize 0
    :do { :set fileSize [/file get $fileId size] } on-error={}
    :if ([:tonum $fileSize] <= 0) do={
        :put ("WARN FILE     " . $fileName . " — present but empty")
        :return false
    }
    :put ("PASS FILE     " . $fileName . " (" . $fileSize . " bytes, optional fallback)")
    :return true
}

:put "--- Retained installer files ---"
:foreach fileName in={
    "mainhotspot.rsc";
    "hotspotsetup.rsc";
    "pppoesetup.rsc";
    "users.rsc";
    "syncusers.rsc";
    "heartbeat.rsc";
    "syncfull.rsc"
} do={
    :if ([$checkFile $fileName]) do={
        :set filePassed ($filePassed + 1)
    } else={
        :set fileFailed ($fileFailed + 1)
    }
}

:put ""
:put "--- Optional VPN fallback files ---"
:foreach fileName in={
    "vpn-openvpn.rsc";
    "vpn-openvpn-backup.rsc";
    "vpn-wireguard.rsc";
    "vpn-ipsec.rsc"
} do={
    [$checkOptionalFile $fileName]
}

:put ""
:put "--- HTTPS trust ---"
:local trustFound ([:len [/certificate find where name="ochola-isrg-root-x1"]] > 0)
:if ([$checkResource "ochola-isrg-root-x1 trusted certificate" $trustFound]) do={
    :set resourcePassed ($resourcePassed + 1)
} else={
    :set resourceFailed ($resourceFailed + 1)
}

:put ""
:put "--- Hotspot import resources ---"
:local hotspotBridgeFound ([:len [/interface bridge find where name="hotspot-bridge"]] > 0)
:if ([$checkResource "hotspot-bridge" $hotspotBridgeFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local hotspotPoolFound ([:len [/ip pool find where name="hspool"]] > 0)
:if ([$checkResource "hspool" $hotspotPoolFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local hotspotProfileFound ([:len [/ip hotspot profile find where name="default-hs"]] > 0)
:if ([$checkResource "default-hs hotspot profile" $hotspotProfileFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local hotspotServerFound ([:len [/ip hotspot find where name="hotspot1"]] > 0)
:if ([$checkResource "hotspot1 service" $hotspotServerFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }

:put ""
:put "--- PPPoE import resources ---"
:local pppoePoolFound ([:len [/ip pool find where name="pppoe-pool"]] > 0)
:if ([$checkResource "pppoe-pool" $pppoePoolFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local pppoeProfileFound ([:len [/ppp profile find where name="isp-profile"]] > 0)
:if ([$checkResource "isp-profile PPP profile" $pppoeProfileFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local pppoeServerFound ([:len [/interface pppoe-server server find where service-name="isp-pppoe" && disabled=no]] > 0)
:if ([$checkResource "isp-pppoe enabled server" $pppoeServerFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }

:put ""
:put "--- User and synchronization resources ---"
:local userProfileFound ([:len [/ip hotspot user profile find where name="default"]] > 0)
:if ([$checkResource "default hotspot user profile" $userProfileFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local syncFirewallFound ([:len [/ip firewall filter find where comment="SafeNet - allow API sync" && action=accept && chain=input]] > 0)
:if ([$checkResource "SafeNet API sync firewall rule" $syncFirewallFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }

:put ""
:put "--- Heartbeat and sync-full resources ---"
:local heartbeatScriptFound ([:len [/system script find where name="ochola-heartbeat-script"]] > 0)
:if ([$checkResource "ochola-heartbeat-script" $heartbeatScriptFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local heartbeatSchedulerFound ([:len [/system scheduler find where name="ochola-heartbeat"]] > 0)
:if ([$checkResource "ochola-heartbeat scheduler" $heartbeatSchedulerFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }
:local syncFullSchedulerFound ([:len [/system scheduler find where name="ochola-autoupdate"]] > 0)
:if ([$checkResource "ochola-autoupdate scheduler" $syncFullSchedulerFound]) do={ :set resourcePassed ($resourcePassed + 1) } else={ :set resourceFailed ($resourceFailed + 1) }

:put ""
:put "--- Management VPN resources ---"
:local openVpnFound ([:len [/interface ovpn-client find where name~"ochola" && running=yes]] > 0)
:local wireGuardFound ([:len [/interface wireguard find where name~"ochola"]] > 0)
:local ipsecFound ([:len [/ip ipsec policy find where comment~"IPsec management policy"]] > 0)
:if ($openVpnFound) do={
    :put "PASS VPN      running Ochola OpenVPN client found"
    :set resourcePassed ($resourcePassed + 1)
} else={
    :if ($wireGuardFound) do={
        :put "PASS VPN      Ochola WireGuard interface found"
        :set resourcePassed ($resourcePassed + 1)
    } else={
        :if ($ipsecFound) do={
            :put "PASS VPN      Ochola IPsec management policy found"
            :set resourcePassed ($resourcePassed + 1)
        } else={
            :put "FAIL VPN      no running/created Ochola management VPN found"
            :set resourceFailed ($resourceFailed + 1)
        }
    }
}

:put ""
:put "======================================================"
:put ("FILE_RESULT=" . $filePassed . " passed, " . $fileFailed . " failed")
:put ("RESOURCE_RESULT=" . $resourcePassed . " passed, " . $resourceFailed . " failed")
:if ($fileFailed = 0 && $resourceFailed = 0) do={
    :put "INSTALLER_VERIFY=SUCCESS"
    :put "All retained files and required imported resources passed."
} else={
    :put "INSTALLER_VERIFY=FAILED"
    :put "One or more files/resources are missing. Review each FAIL line above."
}
:put "======================================================"