# Come account — Router 88 isolated coexistence bridge test
# RouterOS 6/7 compatible.
#
# This script creates only Come's isolated test service:
#   Bridge : co-hotspot-bridge
#   Network: 10.254.88.0/24
#
# It does NOT add physical ports to the bridge and does NOT replace an
# existing billing bridge, hotspot, PPPoE server, RADIUS, or customer users.
#
# Upload to MikroTik Files, then run:
#   /import come-router-88-isolated-bridge.rsc
#
# This is a bridge/service test only. It does not create the signed Come
# account VPN credentials or register router 88 in the billing API.

:global comeBridgeTestError
:set comeBridgeTestError ""
:local comeBridgeTestStep "start"

:do {
    :put "======================================================"
    :put " Come account — Router 88 isolated bridge test"
    :put " No physical ports will be added"
    :put "======================================================"

    :local bridgeName "co-hotspot-bridge"
    :local bridgeComment "Come account router 88 isolated coexistence bridge"
    :local gateway "10.254.88.1"
    :local subnet "10.254.88.0/24"
    :local poolName "ochola-hs-pool-88"
    :local poolRange "10.254.88.2-10.254.88.254"
    :local dhcpName "ochola-hs-dhcp-88"
    :local profileName "ochola-hs-profile-88"
    :local hotspotName "ochola-hs-server-88"
    :local portalDirectory "ochola-hotspot-88"
    :local natComment "Come account router 88 isolated hotspot NAT"
    :local dnsUdpComment "Come account router 88 isolated hotspot DNS UDP"
    :local dnsTcpComment "Come account router 88 isolated hotspot DNS TCP"

    :set comeBridgeTestStep "bridge"
    :local bridgeIds [/interface bridge find where name=$bridgeName]
    :if ([:len $bridgeIds] = 0) do={
        /interface bridge add name=$bridgeName protocol-mode=none fast-forward=no comment=$bridgeComment
        :put "PASS bridge created: co-hotspot-bridge"
    } else={
        :local bridgeId [:pick $bridgeIds 0]
        :local existingComment [/interface bridge get $bridgeId comment]
        :if ([:find $existingComment "Come account router 88"] = nil) do={
            :error "co-hotspot-bridge already exists without the Come router 88 ownership comment"
        }
        :put "PASS bridge already belongs to Come router 88"
    }

    :set comeBridgeTestStep "address"
    :local ownedAddress [/ip address find where interface=$bridgeName && address="10.254.88.1/24"]
    :if ([:len $ownedAddress] = 0) do={
        :if ([:len [/ip address find where interface=$bridgeName]] > 0) do={
            :error "co-hotspot-bridge has an address other than 10.254.88.1/24"
        }
        /ip address add address="10.254.88.1/24" interface=$bridgeName comment=$bridgeComment
    }
    :put "PASS address: 10.254.88.1/24"

    :set comeBridgeTestStep "pool"
    :local poolIds [/ip pool find where name=$poolName]
    :if ([:len $poolIds] = 0) do={
        /ip pool add name=$poolName ranges=$poolRange comment=$bridgeComment
    } else={
        :local poolId [:pick $poolIds 0]
        :if ([:tostr [/ip pool get $poolId ranges]] != $poolRange) do={
            :error "ochola-hs-pool-88 already exists with a different range"
        }
    }
    :put "PASS pool: 10.254.88.2-10.254.88.254"

    :set comeBridgeTestStep "dhcp"
    :local dhcpIds [/ip dhcp-server find where name=$dhcpName]
    :if ([:len $dhcpIds] = 0) do={
        /ip dhcp-server add name=$dhcpName interface=$bridgeName address-pool=$poolName disabled=no comment=$bridgeComment
    } else={
        :local dhcpId [:pick $dhcpIds 0]
        :if ([/ip dhcp-server get $dhcpId interface] != $bridgeName) do={
            :error "ochola-hs-dhcp-88 already belongs to another interface"
        }
        /ip dhcp-server enable $dhcpId
    }
    :local networkIds [/ip dhcp-server network find where address=$subnet]
    :if ([:len $networkIds] = 0) do={
        /ip dhcp-server network add address=$subnet gateway=$gateway dns-server=$gateway comment=$bridgeComment
    }
    :put "PASS DHCP: ochola-hs-dhcp-88"

    :set comeBridgeTestStep "hotspot"
    :local profileIds [/ip hotspot profile find where name=$profileName]
    :if ([:len $profileIds] = 0) do={
        /ip hotspot profile add name=$profileName hotspot-address=$gateway dns-name="wifi-88.local" login-by=http-chap,http-pap html-directory=$portalDirectory
    } else={
        :local profileId [:pick $profileIds 0]
        :if ([/ip hotspot profile get $profileId hotspot-address] != $gateway) do={
            :error "ochola-hs-profile-88 already uses another hotspot address"
        }
    }
    :local hotspotIds [/ip hotspot find where name=$hotspotName]
    :if ([:len $hotspotIds] = 0) do={
        /ip hotspot add name=$hotspotName interface=$bridgeName profile=$profileName address-pool=$poolName idle-timeout=none disabled=no
    } else={
        :local hotspotId [:pick $hotspotIds 0]
        :if ([/ip hotspot get $hotspotId interface] != $bridgeName) do={
            :error "ochola-hs-server-88 already belongs to another interface"
        }
        /ip hotspot enable $hotspotId
    }
    :put "PASS hotspot: ochola-hs-server-88"

    :set comeBridgeTestStep "dns-and-nat"
    :do { /ip dns set allow-remote-requests=yes } on-error={
        :put "WARN router DNS could not be enabled; DHCP/hotspot resources remain installed"
    }
    :if ([:len [/ip firewall nat find where comment=$natComment]] = 0) do={
        /ip firewall nat add chain=srcnat src-address=$subnet action=masquerade comment=$natComment
    }
    :if ([:len [/ip firewall filter find where comment=$dnsUdpComment]] = 0) do={
        /ip firewall filter add chain=input protocol=udp dst-port=53 src-address=$subnet action=accept comment=$dnsUdpComment
    }
    :if ([:len [/ip firewall filter find where comment=$dnsTcpComment]] = 0) do={
        /ip firewall filter add chain=input protocol=tcp dst-port=53 src-address=$subnet action=accept comment=$dnsTcpComment
    }

    :set comeBridgeTestStep "portal-directory"
    :do { /file add name=$portalDirectory type=directory } on-error={}
    :do { /file make-dir $portalDirectory } on-error={}

    :put ""
    :put "BRIDGE_TEST=SUCCESS"
    :put "COME_ROUTER=88"
    :put "BRIDGE=co-hotspot-bridge"
    :put "SUBNET=10.254.88.0/24"
    :put "PHYSICAL_PORTS=0 (assign manually only after review)"
    :put "VPN=not configured by this bridge-only test"
    :put "ACCOUNT_REGISTRATION=not configured by this bridge-only test"
} on-error={
    :set comeBridgeTestError $error
    :put ("BRIDGE_TEST=FAILED at " . $comeBridgeTestStep . ": " . $comeBridgeTestError)
    :error $comeBridgeTestError
}