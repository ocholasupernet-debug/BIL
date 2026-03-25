import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import {
  Copy, Check, Download, ArrowRight, Terminal, Trash2,
  MonitorSmartphone, ChevronRight, PackageOpen, FileCode2,
  Globe, ShieldCheck, Layers, ExternalLink
} from "lucide-react";
import { Link } from "wouter";

/* ══════════════════════════════════════════════════════════════════
   CONFIG TYPE
══════════════════════════════════════════════════════════════════ */
interface Cfg {
  routerTarget: string;
  hotspotIp: string;
  dnsName: string;
  radiusIp: string;
  radiusSecret: string;
  bridgeInterface: string;
  poolStart: string;
  poolEnd: string;
  profileName: string;
  hotspotSsid: string;
  portalTitle: string;
  /* VPN */
  vpnType: "wireguard" | "openvpn" | "both";
  vpnServer: string;
  wgPort: string;
  wgRouterPrivKey: string;
  wgServerPubKey: string;
  wgRouterIp: string;
  ovpnPort: string;
  ovpnUser: string;
  ovpnPassword: string;
  /* Remote Access */
  adminUser: string;
  adminPassword: string;
  sshPort: string;
  winboxAllowedIp: string;
  apiEnabled: boolean;
}

/* ══════════════════════════════════════════════════════════════════
   ─── ROUTEROS SCRIPTS ───────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeScript1 = (c: Cfg) => `# ═══════════════════════════════════════════════════
# SCRIPT 1 — Initial Hotspot Configuration
# Run directly in MikroTik Terminal (Winbox / WebFig)
# Target: ${c.routerTarget}
# ═══════════════════════════════════════════════════

/system identity set name="OcholaNet-${c.routerTarget}"

/ip dns set servers=8.8.8.8,8.8.4.4 allow-remote-requests=yes

/ip hotspot profile
add name=${c.profileName} \\
    hotspot-address=${c.hotspotIp} \\
    dns-name=${c.dnsName} \\
    login-by=http-chap,http-pap \\
    use-radius=yes \\
    html-directory=flash/hotspot

/ip pool add name=hspool ranges=${c.poolStart}-${c.poolEnd}

/ip hotspot
add name=hotspot1 interface=${c.bridgeInterface} \\
    profile=${c.profileName} address-pool=hspool idle-timeout=none

/ip hotspot user profile
add name=default shared-users=1 keepalive-timeout=2m idle-timeout=none

/log info message="OcholaNet: Script 1 complete on ${c.routerTarget}"`.trim();

const makeScript2 = (c: Cfg) => `# ═══════════════════════════════════════════════════
# SCRIPT 2 — RADIUS & Firewall (Import Script)
# Save as: ochola-${c.routerTarget}-radius.rsc
# Run:  /import file-name=ochola-${c.routerTarget}-radius.rsc
# ═══════════════════════════════════════════════════

/radius
add service=hotspot address=${c.radiusIp} \\
    secret=${c.radiusSecret} \\
    authentication-port=1812 accounting-port=1813 timeout=3000ms

/ip firewall nat
add chain=dstnat protocol=tcp dst-port=80 \\
    action=redirect to-ports=64872 hotspot=!auth \\
    comment="OcholaNet - Hotspot redirect"

/ip firewall filter
add chain=input protocol=udp dst-port=1812,1813 action=accept \\
    comment="OcholaNet - RADIUS auth + accounting"
add chain=input protocol=tcp dst-port=8728,8729 action=accept \\
    comment="OcholaNet - Winbox API"

/ip firewall filter move [find comment~"OcholaNet"] destination=0

/log info message="OcholaNet: Script 2 (RADIUS) complete on ${c.routerTarget}"`.trim();

const makeCleanupScript = (c: Cfg) => `# ═══════════════════════════════════════════════════
# CLEANUP — Remove Router from Advanced Settings
# Run BEFORE clicking Next
# Target: ${c.routerTarget}
# ═══════════════════════════════════════════════════

/ip route remove [find routing-mark!="" comment!="OcholaNet"]
/ip rule remove [find table!=main comment!="OcholaNet"]
/ip firewall mangle remove [find comment!~"OcholaNet"]
/ip proxy set enabled=no
/ip upnp set enabled=no

/log info message="OcholaNet: Advanced settings cleaned on ${c.routerTarget}"`.trim();

const makeAllInOne = (c: Cfg) => [makeScript1(c), "\n\n", makeScript2(c), "\n\n", makeCleanupScript(c)].join("");

const makePppoeVlanScript = (c: Cfg) => `# ═══════════════════════════════════════════════════
# PPPoE VLAN Configuration Script
# Save as: pppoe/vlanpppoe.rsc on the router
# Run:  /import file-name=pppoe/vlanpppoe.rsc
# Target: ${c.routerTarget}
# ═══════════════════════════════════════════════════

/interface vlan add name=vlan10-pppoe vlan-id=10 interface=${c.bridgeInterface}

/ip pool add name=pppoe-pool ranges=10.10.10.2-10.10.10.254

/ppp profile
add name=pppoe-profile \\
    local-address=${c.hotspotIp} \\
    remote-address=pppoe-pool \\
    dns-server=8.8.8.8,8.8.4.4 \\
    use-radius=yes \\
    rate-limit=""

/interface pppoe-server server
add service-name=pppoe-server \\
    interface=vlan10-pppoe \\
    default-profile=pppoe-profile \\
    authentication=chap,mschap1,mschap2 \\
    one-session-per-host=yes

/radius
add service=ppp address=${c.radiusIp} \\
    secret=${c.radiusSecret} \\
    authentication-port=1812 accounting-port=1813

/ip firewall nat
add chain=srcnat out-interface=vlan10-pppoe action=masquerade \\
    comment="OcholaNet - PPPoE masquerade"

/log info message="OcholaNet: PPPoE VLAN script complete on ${c.routerTarget}"`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── VPN SCRIPTS ────────────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeWgRouterScript = (c: Cfg) => `# ═══════════════════════════════════════════════════
# WireGuard VPN — RouterOS Setup Script  ★ RECOMMENDED
# Paste in MikroTik Terminal or: /import file-name=ochola-${c.routerTarget}-wg.rsc
# Target: ${c.routerTarget}
# ═══════════════════════════════════════════════════

# 1. Create WireGuard interface
/interface wireguard
add name=wg-ochola \\
    listen-port=${c.wgPort} \\
    private-key="${c.wgRouterPrivKey}" \\
    comment="OcholaNet WireGuard — ${c.routerTarget}"

# 2. Add tunnel IP
/ip address
add address=${c.wgRouterIp} interface=wg-ochola comment="OcholaNet WG tunnel"

# 3. Add peer (VPN server)
/interface wireguard peers
add interface=wg-ochola \\
    public-key="${c.wgServerPubKey}" \\
    endpoint-address=${c.vpnServer} \\
    endpoint-port=${c.wgPort} \\
    allowed-address=0.0.0.0/0 \\
    persistent-keepalive=25 \\
    comment="OcholaNet VPN Server"

# 4. Route VPN management traffic
/ip route
add dst-address=${c.radiusIp}/32 gateway=wg-ochola \\
    comment="OcholaNet — RADIUS via WG"

# 5. Allow WireGuard in firewall
/ip firewall filter
add chain=input protocol=udp dst-port=${c.wgPort} action=accept \\
    comment="OcholaNet — WireGuard"

/log info message="OcholaNet: WireGuard VPN configured on ${c.routerTarget}"
:put "Done: WireGuard wg-ochola → ${c.vpnServer}:${c.wgPort}"`.trim();

const makeWgClientConf = (c: Cfg) => `# WireGuard Peer Config — ${c.routerTarget}
# Generated by OcholaSupernet Self-Install
# Use this on the VPN server to add ${c.routerTarget} as a peer.

[Interface]
# This router's WireGuard tunnel address
Address = ${c.wgRouterIp}
ListenPort = ${c.wgPort}
PrivateKey = ${c.wgRouterPrivKey}
DNS = 8.8.8.8, 8.8.4.4

[Peer]
# OcholaNet VPN Server
PublicKey = ${c.wgServerPubKey}
Endpoint = ${c.vpnServer}:${c.wgPort}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`.trim();

const makeOvpnRouterScript = (c: Cfg) => `# ═══════════════════════════════════════════════════
# OpenVPN — RouterOS Client Setup Script
# Paste in MikroTik Terminal or: /import file-name=ochola-${c.routerTarget}-ovpn.rsc
# Target: ${c.routerTarget}
# Requires: CA certificate already imported as "vpn-ca"
# ═══════════════════════════════════════════════════

# 1. Import CA cert (upload ca.crt to router first, then run):
# /certificate import file-name=ca.crt passphrase=""

# 2. Create OpenVPN client interface
/interface ovpn-client
add name=ovpn-ochola \\
    connect-to=${c.vpnServer} \\
    port=${c.ovpnPort} \\
    mode=ip \\
    user="${c.ovpnUser}" \\
    password="${c.ovpnPassword}" \\
    certificate=vpn-ca \\
    auth=sha1 \\
    cipher=aes256 \\
    add-default-route=no \\
    comment="OcholaNet OpenVPN — ${c.routerTarget}"

# 3. Route RADIUS traffic over VPN
/ip route
add dst-address=${c.radiusIp}/32 gateway=ovpn-ochola \\
    comment="OcholaNet — RADIUS via OVPN"

# 4. Firewall: allow OpenVPN port
/ip firewall filter
add chain=input protocol=tcp dst-port=${c.ovpnPort} action=accept \\
    comment="OcholaNet — OpenVPN"

/log info message="OcholaNet: OpenVPN configured on ${c.routerTarget}"
:put "Done: ovpn-ochola → ${c.vpnServer}:${c.ovpnPort}"`.trim();

const makeOvpnClientConfig = (c: Cfg) => `# OpenVPN Client Config — ${c.routerTarget}
# Save as: ${c.routerTarget}.ovpn
# Generated by OcholaSupernet Self-Install

client
dev tun
proto tcp
remote ${c.vpnServer} ${c.ovpnPort}
resolv-retry infinite
nobind
persist-key
persist-tun

# Place your CA certificate here
<ca>
-----BEGIN CERTIFICATE-----
# Paste your VPN server CA certificate here
-----END CERTIFICATE-----
</ca>

auth-user-pass
# Username: ${c.ovpnUser}

cipher AES-256-CBC
auth SHA256
comp-lzo adaptive
verb 3
keepalive 10 60

# Route only RADIUS traffic over VPN
route ${c.radiusIp} 255.255.255.255 vpn_gateway

# Comment the line below to route ALL traffic through VPN
pull-filter ignore "redirect-gateway"`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── REMOTE ACCESS SCRIPT ───────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeRemoteAccessScript = (c: Cfg) => `# Remote Admin Access — ${c.routerTarget}
# Generated by OcholaSupernet Self-Install
# ─────────────────────────────────────────────────────────────────
# This script:
#   1. Creates/updates the admin user with a secure password
#   2. Enables SSH on a custom port
#   3. Locks Winbox & WebFig to the VPN tunnel IP only
#   4. Optionally enables the RouterOS API
#   5. Adds firewall rules to allow remote access
# Upload to router then run:  /import file-name=ochola-${c.routerTarget}-remote.rsc
# ─────────────────────────────────────────────────────────────────

# 1. Admin user
/user
:if ([find name="${c.adminUser}"] = "") do={
  add name="${c.adminUser}" password="${c.adminPassword}" group=full \\
      comment="OcholaNet admin — ${c.routerTarget}"
} else={
  set [find name="${c.adminUser}"] password="${c.adminPassword}" group=full
}
/log info message="OcholaNet: admin user '${c.adminUser}' ready"

# 2. SSH — custom port ${c.sshPort}, strong crypto only
/ip ssh
set strong-crypto=yes forwarding-enabled=remote port=${c.sshPort}
/log info message="OcholaNet: SSH enabled on port ${c.sshPort}"

# 3. Services — restrict Winbox & WebFig to VPN tunnel address
/ip service
# Winbox (TCP 8291) — allowed from VPN tunnel only
set winbox disabled=no port=8291 address=${c.winboxAllowedIp}
# WebFig (TCP 80/443) — same restriction
set www    disabled=no port=80   address=${c.winboxAllowedIp}
set www-ssl disabled=no port=443 address=${c.winboxAllowedIp}
# SSH — allowed from VPN tunnel
set ssh    disabled=no port=${c.sshPort} address=${c.winboxAllowedIp}
# Telnet / FTP / API-SSL — disabled for security
set telnet disabled=yes
set ftp    disabled=yes
${c.apiEnabled ? `# API (TCP 8728) — allowed from VPN tunnel
set api     disabled=no  port=8728  address=${c.winboxAllowedIp}
set api-ssl disabled=no  port=8729  address=${c.winboxAllowedIp}` : `# API disabled (enable in Step 0 if needed)
set api     disabled=yes
set api-ssl disabled=yes`}

# 4. Firewall rules — allow remote access only from VPN tunnel
/ip firewall filter
# Allow SSH from allowed IP range
add chain=input protocol=tcp dst-port=${c.sshPort} src-address=${c.winboxAllowedIp} \\
    action=accept comment="OcholaNet — SSH remote admin"
# Allow Winbox from allowed IP range
add chain=input protocol=tcp dst-port=8291 src-address=${c.winboxAllowedIp} \\
    action=accept comment="OcholaNet — Winbox remote admin"
# Allow WebFig from allowed IP range
add chain=input protocol=tcp dst-port=80,443 src-address=${c.winboxAllowedIp} \\
    action=accept comment="OcholaNet — WebFig remote admin"
${c.apiEnabled ? `# Allow API from VPN tunnel
add chain=input protocol=tcp dst-port=8728,8729 src-address=${c.winboxAllowedIp} \\
    action=accept comment="OcholaNet — RouterOS API"` : ""}

# 5. Drop other management attempts on WAN (protect against brute force)
add chain=input in-interface-list=WAN protocol=tcp dst-port=${c.sshPort},8291,80,443,8728,8729 \\
    action=drop comment="OcholaNet — block management from WAN"

/log info message="OcholaNet: Remote access configured on ${c.routerTarget}"
:put "Done: admin='${c.adminUser}' SSH=${c.sshPort} Winbox+WebFig restricted to ${c.winboxAllowedIp}"`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── HOTSPOT HTML PAGES ─────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeLoginHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/login.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
  <script src="/hotspot/md5.js"></script>
</head>
<body class="hs-body">
  <div class="hs-card">
    <div class="hs-logo">
      <div class="hs-logo-icon">🌐</div>
      <h1>${c.portalTitle.toUpperCase()}</h1>
      <p>Internet Access Portal</p>
    </div>
    <div class="hs-ssid-badge">📶 ${c.hotspotSsid}</div>
    \$(if error)<div class="hs-error">\$(error)</div>\$(endif)
    <form name="sendin" action="/login" method="post">
      <input type="hidden" name="dst" value="\$(dst)"/>
      <input type="hidden" name="popup" value="true"/>
      \$(if chap-id)
      <input type="hidden" name="chap-id" value="\$(chap-id)"/>
      <input type="hidden" name="chap-challenge" value="\$(chap-challenge)"/>
      \$(endif)
      <div class="hs-field">
        <label>
          <img src="/hotspot/img/user.svg" alt="user"/>
          Username / Voucher
        </label>
        <input type="text" name="username" value="\$(username)" placeholder="Enter username" autocomplete="username"/>
      </div>
      <div class="hs-field">
        <label>
          <img src="/hotspot/img/password.svg" alt="pass"/>
          Password
        </label>
        <input type="password" name="password" id="password" placeholder="Enter password" autocomplete="current-password"/>
      </div>
      <button type="submit" class="hs-btn">Connect to Internet</button>
    </form>
    <div class="hs-footer">
      Powered by <a href="https://${c.dnsName}">${c.portalTitle}</a>
    </div>
  </div>
  <script>
    var form = document.sendin;
    form.onsubmit = function() {
      \$(if chap-id)
      var pwd = document.getElementById('password');
      pwd.value = '\$(chap-id)' + md5(pwd.value + '\$(chap-challenge)'.replace(/\\//g,''));
      \$(endif)
      return true;
    };
  </script>
</body>
</html>`.trim();

const makeStatusHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/status.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="refresh" content="120"/>
  <title>Connected — ${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card">
    <div class="hs-logo">
      <div class="hs-logo-icon">✅</div>
      <h1>You're Connected!</h1>
      <p>Welcome, <strong>\$(username)</strong></p>
    </div>
    <div class="hs-stat"><span>IP Address</span><span>\$(ip)</span></div>
    <div class="hs-stat"><span>MAC Address</span><span>\$(mac)</span></div>
    <div class="hs-stat"><span>Time Online</span><span>\$(uptime)</span></div>
    <div class="hs-stat"><span>Session Limit</span><span>\$(session-time-left)</span></div>
    <div class="hs-stat"><span>Data Down</span><span>\$(bytes-in-nice)</span></div>
    <div class="hs-stat"><span>Data Up</span><span>\$(bytes-out-nice)</span></div>
    <form action="/logout" method="post">
      <button class="hs-btn hs-btn-danger" type="submit">Disconnect</button>
    </form>
  </div>
</body>
</html>`.trim();

const makeAloginHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/alogin.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card" style="text-align:center">
    \$(if logged-in)
    <div class="hs-logo-icon" style="margin:0 auto 1rem">✅</div>
    <h2 style="color:#4ade80;margin-bottom:.5rem">Already Connected</h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      You are logged in as <strong>\$(username)</strong>
    </p>
    <a href="\$(link-status)" class="hs-btn" style="text-decoration:none;display:inline-block">
      View Status
    </a>
    \$(else)
    <div class="hs-logo-icon" style="margin:0 auto 1rem">⚠️</div>
    <h2 style="color:#f87171;margin-bottom:.5rem">\$(error)</h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      Please check your credentials and try again.
    </p>
    <a href="\$(link-login)" class="hs-btn" style="text-decoration:none;display:inline-block">
      Try Again
    </a>
    \$(endif)
  </div>
</body>
</html>`.trim();

const makeLogoutHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/logout.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Logged Out — ${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card" style="text-align:center">
    \$(if logged-in)
    <div class="hs-logo-icon" style="margin:0 auto 1rem">👋</div>
    <h2 style="color:#fff;margin-bottom:.5rem">Logging Out...</h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      Goodbye, <strong style="color:#06b6d4">\$(username)</strong>.<br/>
      You have been disconnected from ${c.hotspotSsid}.
    </p>
    <a href="\$(link-login-only)" class="hs-btn" style="text-decoration:none;display:inline-block">
      Log In Again
    </a>
    \$(else)
    <div class="hs-logo-icon" style="margin:0 auto 1rem">🔒</div>
    <h2 style="color:#94a3b8;margin-bottom:.5rem">Not Logged In</h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      You are not currently connected.
    </p>
    <a href="\$(link-login-only)" class="hs-btn" style="text-decoration:none;display:inline-block">
      Log In
    </a>
    \$(endif)
  </div>
</body>
</html>`.trim();

const makeRadvertHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/radvert.html on ${c.routerTarget} -->
<!-- Shown after authentication as an interstitial / advertisement page -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="refresh" content="3; url=\$(link-orig-esc)"/>
  <title>${c.portalTitle} — Welcome</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card" style="text-align:center">
    <div class="hs-logo-icon" style="margin:0 auto 1rem">🚀</div>
    <h2 style="color:#fff;margin-bottom:.5rem">
      Welcome, <span style="color:#06b6d4">\$(username)</span>!
    </h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      You are connected to ${c.hotspotSsid}.<br/>
      Redirecting to your destination in 3 seconds...
    </p>
    <div style="background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);border-radius:8px;padding:.75rem 1rem;font-size:.8rem;color:#64748b;">
      Redirecting to: <a href="\$(link-orig-esc)" style="color:#06b6d4">\$(link-orig)</a>
    </div>
  </div>
</body>
</html>`.trim();

const makeRedirectHtml = () => `<!DOCTYPE html>
<!-- Upload to: /flash/hotspot/redirect.html on router -->
<!-- Instant redirect page — minimal -->
<html>
<head>
  <meta http-equiv="refresh" content="0; url=\$(link-orig-esc)"/>
  <title>Redirecting...</title>
</head>
<body>
  Redirecting to <a href="\$(link-orig-esc)">\$(link-orig)</a>...
</body>
</html>`.trim();

const makeErrorHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /error.html (root, not in /hotspot/) on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Error — ${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card" style="text-align:center">
    <div class="hs-logo-icon" style="margin:0 auto 1rem">⛔</div>
    <h2 style="color:#f87171;margin-bottom:.5rem">\$(error)</h2>
    <p style="color:#64748b;font-size:.85rem;margin-bottom:1.5rem">
      An error occurred. Please try again or contact support.
    </p>
    <a href="\$(link-login)" class="hs-btn" style="text-decoration:none;display:inline-block">
      Back to Login
    </a>
  </div>
</body>
</html>`.trim();

const makeErrorsText = () => `# MikroTik Hotspot Error Messages
# File: /flash/hotspot/errors.txt

error-0=Unknown error
error-1=Invalid username or password
error-2=No more sessions are allowed
error-3=This user is already logged in — logout from the other location?
error-4=User is not allowed to log in from this location
error-5=Roaming user — please log in from the correct hotspot
error-6=Internal error, please contact the system administrator
error-7=Requested service is not allowed for this user
error-8=User authentication failed — check your credentials
error-9=Credit limit exceeded — please top up your account
error-10=Access granted
error-11=User is already online
error-12=Your session has expired — please log in again
error-13=You have reached your data limit
error-14=Service temporarily unavailable — try again later`.trim();

const makePppoeLoginHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- Upload to: /flash/pppoe/login.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>PPPoE Login — ${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card">
    <div class="hs-logo">
      <div class="hs-logo-icon">🔗</div>
      <h1>PPPoE Login</h1>
      <p>${c.portalTitle}</p>
    </div>
    \$(if error)<div class="hs-error">\$(error)</div>\$(endif)
    <form action="/login" method="post">
      <input type="hidden" name="dst" value="\$(dst)"/>
      <div class="hs-field">
        <label>PPPoE Username</label>
        <input type="text" name="username" value="\$(username)" placeholder="username@domain"/>
      </div>
      <div class="hs-field">
        <label>Password</label>
        <input type="password" name="password" placeholder="Password"/>
      </div>
      <button type="submit" class="hs-btn">Connect</button>
    </form>
    <div class="hs-footer">Powered by ${c.portalTitle}</div>
  </div>
</body>
</html>`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── HOTSPOT CSS ────────────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeCssStyle = (c: Cfg) => `/* OcholaNet Hotspot Stylesheet — hotspot/css/style.css
   Upload to: /flash/hotspot/css/style.css on ${c.routerTarget} */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --hs-primary:   #06b6d4;
  --hs-primary2:  #0891b2;
  --hs-bg:        #0d1117;
  --hs-card:      #131929;
  --hs-border:    rgba(6,182,212,0.2);
  --hs-text:      #f1f5f9;
  --hs-muted:     #64748b;
  --hs-error:     #f87171;
  --hs-success:   #4ade80;
}

body.hs-body {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--hs-bg) 0%, var(--hs-card) 50%, #0a1628 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  padding: 1rem; color: var(--hs-text);
}

.hs-card {
  background: var(--hs-card);
  border: 1px solid var(--hs-border);
  border-radius: 16px; padding: 2.5rem 2rem;
  width: 100%; max-width: 400px;
  box-shadow: 0 25px 60px rgba(0,0,0,0.5);
}

.hs-logo { text-align: center; margin-bottom: 1.75rem; }
.hs-logo-icon {
  width: 54px; height: 54px;
  background: linear-gradient(135deg, var(--hs-primary), var(--hs-primary2));
  border-radius: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 1.5rem; margin-bottom: .875rem;
}
.hs-logo h1 {
  font-size: 1.25rem; font-weight: 800;
  color: var(--hs-text); letter-spacing: .05em;
}
.hs-logo p { font-size: .75rem; color: var(--hs-primary); font-weight: 600; margin-top: .2rem; }

.hs-ssid-badge {
  display: flex; align-items: center; justify-content: center; gap: .375rem;
  background: rgba(6,182,212,.08); border: 1px solid rgba(6,182,212,.2);
  border-radius: 8px; padding: .45rem .875rem; margin-bottom: 1.75rem;
  font-size: .75rem; color: var(--hs-primary); font-weight: 600;
}

.hs-error {
  background: rgba(248,113,113,.1); border: 1px solid rgba(248,113,113,.25);
  border-radius: 8px; padding: .625rem .875rem; font-size: .8rem;
  color: var(--hs-error); margin-bottom: 1rem; text-align: center;
}

.hs-field { margin-bottom: 1rem; }
.hs-field label {
  display: flex; align-items: center; gap: .375rem;
  font-size: .7rem; font-weight: 700; color: var(--hs-muted);
  text-transform: uppercase; letter-spacing: .06em; margin-bottom: .375rem;
}
.hs-field label img { width: 14px; height: 14px; opacity: .6; }
.hs-field input[type="text"],
.hs-field input[type="password"] {
  width: 100%; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.1); border-radius: 9px;
  padding: .75rem 1rem; color: var(--hs-text); font-size: .9rem;
  outline: none; transition: border-color .2s; font-family: inherit;
}
.hs-field input:focus { border-color: var(--hs-primary); }

.hs-btn {
  width: 100%; padding: .875rem;
  background: linear-gradient(135deg, var(--hs-primary), var(--hs-primary2));
  border: none; border-radius: 9px; color: #fff;
  font-size: .9rem; font-weight: 700; cursor: pointer;
  letter-spacing: .02em; transition: opacity .2s; font-family: inherit;
  margin-top: .5rem;
}
.hs-btn:hover { opacity: .9; }
.hs-btn-danger {
  background: rgba(248,113,113,.1) !important;
  border: 1px solid rgba(248,113,113,.25) !important;
  color: var(--hs-error) !important;
}

.hs-stat {
  display: flex; justify-content: space-between; align-items: center;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
  border-radius: 10px; padding: .75rem 1rem; margin-bottom: .625rem;
  font-size: .8rem;
}
.hs-stat span:first-child { color: var(--hs-muted); }
.hs-stat span:last-child { color: var(--hs-text); font-weight: 600; font-family: monospace; }

.hs-footer { text-align: center; margin-top: 1.75rem; font-size: .7rem; color: #475569; }
.hs-footer a { color: var(--hs-primary); text-decoration: none; }`.trim();

const makeCssRloginHtml = (c: Cfg) => `<!DOCTYPE html>
<!-- hotspot/css/rlogin.html — Roaming/Redirect login variant
     Upload to: /flash/hotspot/css/rlogin.html on ${c.routerTarget} -->
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Roaming Login — ${c.portalTitle}</title>
  <link rel="stylesheet" href="/hotspot/css/style.css"/>
</head>
<body class="hs-body">
  <div class="hs-card">
    <div class="hs-logo">
      <div class="hs-logo-icon">🔄</div>
      <h1>Roaming Login</h1>
      <p>${c.portalTitle}</p>
    </div>
    \$(if error)<div class="hs-error">\$(error)</div>\$(endif)
    <form action="\$(link-login)" method="post">
      <input type="hidden" name="dst" value="\$(dst)"/>
      <div class="hs-field">
        <label>Username</label>
        <input type="text" name="username" value="\$(username)" placeholder="Roaming username"/>
      </div>
      <div class="hs-field">
        <label>Password</label>
        <input type="password" name="password" placeholder="Password"/>
      </div>
      <button type="submit" class="hs-btn">Login (Roaming)</button>
    </form>
    <div class="hs-footer">
      Home network: <a href="https://${c.dnsName}">${c.portalTitle}</a>
    </div>
  </div>
</body>
</html>`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── SVG ICONS ──────────────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeUserSvg = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/img/user.svg — Upload to /flash/hotspot/img/user.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
  <circle cx="12" cy="7" r="4"/>
</svg>`.trim();

const makePasswordSvg = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/img/password.svg — Upload to /flash/hotspot/img/password.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  <circle cx="12" cy="16" r="1" fill="#06b6d4"/>
</svg>`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── HOTSPOT API JSON ────────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeApiJson = (c: Cfg) => JSON.stringify({
  "portal": c.portalTitle,
  "router": c.routerTarget,
  "hotspot-ip": c.hotspotIp,
  "dns-name": c.dnsName,
  "ssid": c.hotspotSsid,
  "username": "$(username)",
  "password": "$(password)",
  "ip": "$(ip)",
  "mac": "$(mac)",
  "uptime": "$(uptime)",
  "bytes-in": "$(bytes-in)",
  "bytes-out": "$(bytes-out)",
  "session-time-left": "$(session-time-left)",
  "link-login": "$(link-login)",
  "link-orig": "$(link-orig)",
  "error": "$(error)",
  "chap-id": "$(chap-id)",
  "chap-challenge": "$(chap-challenge)",
  "popup": "$(popup)"
}, null, 2);

/* ══════════════════════════════════════════════════════════════════
   ─── MD5.JS ─────────────────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeMd5Js = () => `/*
 * MD5 implementation for MikroTik Hotspot HTTP-CHAP authentication
 * Based on RSA Data Security MD5 — Version 2.2
 * Copyright (C) Paul Johnston 1999-2009 — BSD License
 * Upload to: /flash/hotspot/md5.js on router
 */
function md5cycle(x,k){var a=x[0],b=x[1],c=x[2],d=x[3];a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3])}
function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b)}
function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
function md51(s){var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;for(i=64;i<=s.length;i+=64){md5cycle(state,md5blk(s.substring(i-64,i)))}s=s.substring(i-64);var tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0}tail[14]=n*8;md5cycle(state,tail);return state}
function md5blk(s){var md5blks=[],i;for(i=0;i<64;i+=4){md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24)}return md5blks}
var hex_chr='0123456789abcdef'.split('');
function rhex(n){var s='',j=0;for(;j<4;j++)s+=hex_chr[(n>>(j*8+4))&0x0F]+hex_chr[(n>>(j*8))&0x0F];return s}
function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('')}
function md5(s){return hex(md51(s))}
function add32(a,b){return(a+b)&0xFFFFFFFF}`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── XML / WISPr FILES ──────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeXmlLoginHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/login.html — WISPr Authentication Reply
     Upload to: /flash/hotspot/xml/login.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <AuthenticationReply>
    <MessageType>120</MessageType>
    <ResponseCode>\$(if error)100\$(else)50\$(endif)</ResponseCode>
    <ReplyMessage>\$(if error)\$(error)\$(else)Login succeeded.\$(endif)</ReplyMessage>
    \$(if chap-id)<ChapPollReply>\$(chap-id)</ChapPollReply>\$(endif)
    \$(if redirect-url)<RedirectURL>\$(redirect-url)</RedirectURL>\$(endif)
  </AuthenticationReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlLogoutHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/logout.html — WISPr Logoff Reply
     Upload to: /flash/hotspot/xml/logout.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <LogoffReply>
    <MessageType>140</MessageType>
    <ResponseCode>150</ResponseCode>
  </LogoffReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlAloginHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/alogin.html — WISPr Authentication Poll Reply
     Upload to: /flash/hotspot/xml/alogin.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <AuthenticationPollReply>
    <MessageType>140</MessageType>
    <ResponseCode>\$(if error)\$(if chap-id)100\$(else)150\$(endif)\$(else)50\$(endif)</ResponseCode>
    <ReplyMessage>\$(error)</ReplyMessage>
    \$(if chap-id)<ChapPollReply>\$(chap-id):\$(chap-challenge)</ChapPollReply>\$(endif)
    \$(if redirect-url)<RedirectURL>\$(redirect-url)</RedirectURL>\$(endif)
  </AuthenticationPollReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlRloginHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/rlogin.html — WISPr Roaming Login Reply
     Upload to: /flash/hotspot/xml/rlogin.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <AuthenticationReply>
    <MessageType>120</MessageType>
    <ResponseCode>\$(if error)100\$(else)50\$(endif)</ResponseCode>
    <ReplyMessage>\$(if error)\$(error)\$(else)Roaming login succeeded.\$(endif)</ReplyMessage>
    \$(if redirect-url)<RedirectURL>\$(redirect-url)</RedirectURL>\$(endif)
  </AuthenticationReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlErrorHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/error.html — WISPr Error Reply
     Upload to: /flash/hotspot/xml/error.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <AuthenticationReply>
    <MessageType>120</MessageType>
    <ResponseCode>100</ResponseCode>
    <ReplyMessage>\$(error)</ReplyMessage>
  </AuthenticationReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlFlogoutHtml = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/flogout.html — WISPr Floating Logout Reply
     Upload to: /flash/hotspot/xml/flogout.html -->
<WISPAccessGatewayParam
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="WISPAccessGateway.xsd">
  <LogoffReply>
    <MessageType>140</MessageType>
    <ResponseCode>150</ResponseCode>
  </LogoffReply>
</WISPAccessGatewayParam>`.trim();

const makeXmlWispSchema = () => `<?xml version="1.0" encoding="UTF-8"?>
<!-- hotspot/xml/WISPAccessGateway.xsd — WISPr XML Schema
     Upload to: /flash/hotspot/xml/WISPAccessGateway.xsd -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="WISPAccessGatewayParam">
    <xs:complexType>
      <xs:choice>
        <xs:element ref="Redirect"/>
        <xs:element ref="AuthenticationReply"/>
        <xs:element ref="AuthenticationPollReply"/>
        <xs:element ref="LogoffReply"/>
        <xs:element ref="AbortLoginReply"/>
      </xs:choice>
    </xs:complexType>
  </xs:element>
  <xs:element name="Redirect">
    <xs:complexType>
      <xs:all>
        <xs:element name="MessageType" type="xs:integer"/>
        <xs:element name="ResponseCode" type="xs:integer"/>
        <xs:element name="AccessProcedure" type="xs:string" minOccurs="0"/>
        <xs:element name="AccessLocation" type="xs:string" minOccurs="0"/>
        <xs:element name="LocationName" type="xs:string" minOccurs="0"/>
        <xs:element name="LoginURL" type="xs:anyURI" minOccurs="0"/>
        <xs:element name="AbortLoginURL" type="xs:anyURI" minOccurs="0"/>
        <xs:element name="ReplyMessage" type="xs:string" minOccurs="0"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
  <xs:element name="AuthenticationReply">
    <xs:complexType>
      <xs:all>
        <xs:element name="MessageType" type="xs:integer"/>
        <xs:element name="ResponseCode" type="xs:integer"/>
        <xs:element name="ReplyMessage" type="xs:string" minOccurs="0"/>
        <xs:element name="ChapPollReply" type="xs:string" minOccurs="0"/>
        <xs:element name="RedirectURL" type="xs:anyURI" minOccurs="0"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
  <xs:element name="AuthenticationPollReply">
    <xs:complexType>
      <xs:all>
        <xs:element name="MessageType" type="xs:integer"/>
        <xs:element name="ResponseCode" type="xs:integer"/>
        <xs:element name="ReplyMessage" type="xs:string" minOccurs="0"/>
        <xs:element name="ChapPollReply" type="xs:string" minOccurs="0"/>
        <xs:element name="RedirectURL" type="xs:anyURI" minOccurs="0"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
  <xs:element name="LogoffReply">
    <xs:complexType>
      <xs:all>
        <xs:element name="MessageType" type="xs:integer"/>
        <xs:element name="ResponseCode" type="xs:integer"/>
        <xs:element name="ReplyMessage" type="xs:string" minOccurs="0"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
  <xs:element name="AbortLoginReply">
    <xs:complexType>
      <xs:all>
        <xs:element name="MessageType" type="xs:integer"/>
        <xs:element name="ResponseCode" type="xs:integer"/>
      </xs:all>
    </xs:complexType>
  </xs:element>
</xs:schema>`.trim();

/* ══════════════════════════════════════════════════════════════════
   ─── RADIUS CLIENT CONF ─────────────────────────────────────────
══════════════════════════════════════════════════════════════════ */
const makeRadiusClientConf = (c: Cfg) => `# ═══════════════════════════════════════════════════
# FreeRADIUS clients.conf entry for ${c.routerTarget}
# Add to:  /etc/freeradius/3.0/clients.conf
# Restart: sudo systemctl restart freeradius
# ═══════════════════════════════════════════════════

client ${c.routerTarget} {
    ipaddr          = ${c.hotspotIp}
    secret          = ${c.radiusSecret}
    nas_type        = other
    shortname       = OcholaNet-${c.routerTarget}
    virtual_server  = default
}`.trim();

/* ══════════════════════════════════════════════════════════════════
   DOWNLOAD HELPER
══════════════════════════════════════════════════════════════════ */
function dl(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════════════════════
   FILE GROUPS
══════════════════════════════════════════════════════════════════ */
interface FileEntry {
  icon: string; label: string; desc: string;
  color: string; ext: string;
  get?: (c: Cfg) => string; filename: string;
  external?: string;
  visible?: (c: Cfg) => boolean;
}

/* ══════════════════════════════════════════════════════════════════
   ─── ROUTEROS STRING ESCAPE ─────────────────────────────────────
   Produces a safe double-quoted RouterOS string literal.
   \\ → \  |  \" → "  |  \$ → $ (literal, not variable)
   \n → newline in file  |  \t → tab
══════════════════════════════════════════════════════════════════ */
function escapeRos(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g,  '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

/* ══════════════════════════════════════════════════════════════════
   ─── CREATE-ALL-FILES RouterOS SCRIPT ───────────────────────────
   A single .rsc file that when imported, creates every hotspot
   HTML/CSS/SVG/JSON/XML file directly on the router filesystem.
   No FTP, no Winbox Files panel needed.
══════════════════════════════════════════════════════════════════ */
function makeCreateAllFilesScript(cfg: Cfg): string {
  const files: { path: string; content: string }[] = [
    // ── HTML pages ───────────────────────────────────────────────
    { path: "flash/hotspot/login.html",               content: makeLoginHtml(cfg)        },
    { path: "flash/hotspot/status.html",              content: makeStatusHtml(cfg)       },
    { path: "flash/hotspot/alogin.html",              content: makeAloginHtml(cfg)       },
    { path: "flash/hotspot/logout.html",              content: makeLogoutHtml(cfg)       },
    { path: "flash/hotspot/radvert.html",             content: makeRadvertHtml(cfg)      },
    { path: "flash/hotspot/redirect.html",            content: makeRedirectHtml()        },
    { path: "flash/hotspot/css/rlogin.html",          content: makeCssRloginHtml(cfg)    },
    { path: "flash/error.html",                       content: makeErrorHtml(cfg)        },
    { path: "flash/pppoe/login.html",                 content: makePppoeLoginHtml(cfg)   },
    // ── CSS + assets ─────────────────────────────────────────────
    { path: "flash/hotspot/css/style.css",            content: makeCssStyle(cfg)         },
    { path: "flash/hotspot/img/user.svg",             content: makeUserSvg()             },
    { path: "flash/hotspot/img/password.svg",         content: makePasswordSvg()         },
    { path: "flash/hotspot/api.json",                 content: makeApiJson(cfg)          },
    { path: "flash/hotspot/errors.txt",               content: makeErrorsText()          },
    { path: "flash/hotspot/md5.js",                   content: makeMd5Js()               },
    // ── WISPr XML ────────────────────────────────────────────────
    { path: "flash/hotspot/xml/WISPAccessGateway.xsd", content: makeXmlWispSchema()     },
    { path: "flash/hotspot/xml/login.html",           content: makeXmlLoginHtml()        },
    { path: "flash/hotspot/xml/logout.html",          content: makeXmlLogoutHtml()       },
    { path: "flash/hotspot/xml/alogin.html",          content: makeXmlAloginHtml()       },
    { path: "flash/hotspot/xml/rlogin.html",          content: makeXmlRloginHtml()       },
    { path: "flash/hotspot/xml/error.html",           content: makeXmlErrorHtml()        },
    { path: "flash/hotspot/xml/flogout.html",         content: makeXmlFlogoutHtml()      },
  ];

  const L: string[] = [];
  L.push(`# ═══════════════════════════════════════════════════════`);
  L.push(`# OcholaNet — Create All Hotspot Files`);
  L.push(`# Target router : ${cfg.routerTarget}`);
  L.push(`# Usage:`);
  L.push(`#   1. Download this file`);
  L.push(`#   2. Upload to router via Winbox > Files > Upload`);
  L.push(`#   3. In Winbox Terminal run:`);
  L.push(`#        /import file-name=create-hotspot-files-${cfg.routerTarget}.rsc`);
  L.push(`#`);
  L.push(`# Creates ${files.length} files inside flash/hotspot/ automatically.`);
  L.push(`# No FTP or manual file upload required for HTML/CSS/JS/XML.`);
  L.push(`# ═══════════════════════════════════════════════════════`);
  L.push(``);
  L.push(`:log info message="OcholaNet: Creating ${files.length} hotspot files on ${cfg.routerTarget}..."`);
  L.push(`:local f ""`);   // reused variable for file content
  L.push(``);

  for (const file of files) {
    const escaped = escapeRos(file.content);
    L.push(`# ── ${file.path}`);
    L.push(`:set f ""`);
    for (let i = 0; i < escaped.length; i += TERM_CHUNK) {
      L.push(`:set f ($f . "${escaped.slice(i, i + TERM_CHUNK)}")`);
    }
    L.push(`:do { /file remove [find name="${file.path}"] } on-error={}`);
    L.push(`/file add name="${file.path}" contents=$f`);
    L.push(``);
  }

  L.push(`:log info message="OcholaNet: Done — ${files.length} files created on ${cfg.routerTarget}"`);
  return L.join("\n");
}

const FILE_GROUPS: { title: string; color: string; files: FileEntry[] }[] = [
  {
    title: "★ Create All Files (RouterOS Script)", color: "#f97316",
    files: [
      {
        icon: "🚀",
        label: "create-hotspot-files-{r}.rsc",
        desc: "Single script that creates all 22 hotspot HTML/CSS/JS/XML files on the router. Upload to router then /import — no FTP needed.",
        color: "#f97316", ext: ".rsc",
        get: (c) => makeCreateAllFilesScript(c),
        filename: "create-hotspot-files-{r}.rsc",
      },
    ],
  },
  {
    title: "RouterOS Scripts (.rsc)", color: "#06b6d4",
    files: [
      { icon:"📄", label:"ochola-{r}-setup.rsc",   desc:"Script 1 — Initial hotspot config. Run in Terminal",   color:"#06b6d4", ext:".rsc", get:(c)=>makeScript1(c),        filename:"ochola-{r}-setup.rsc"   },
      { icon:"📄", label:"ochola-{r}-radius.rsc",  desc:"Script 2 — RADIUS + firewall. /import file-name=…",   color:"#8b5cf6", ext:".rsc", get:(c)=>makeScript2(c),        filename:"ochola-{r}-radius.rsc"  },
      { icon:"📄", label:"ochola-{r}-cleanup.rsc", desc:"Cleanup — removes advanced settings before Next",      color:"#f87171", ext:".rsc", get:(c)=>makeCleanupScript(c),  filename:"ochola-{r}-cleanup.rsc" },
      { icon:"📄", label:"ochola-{r}-all.rsc",     desc:"All-in-one — Scripts 1 + 2 + Cleanup combined",       color:"#fbbf24", ext:".rsc", get:(c)=>makeAllInOne(c),       filename:"ochola-{r}-all.rsc"     },
      { icon:"📄", label:"pppoe/vlanpppoe.rsc",    desc:"PPPoE VLAN script — /import file-name=pppoe/vlanpppoe.rsc", color:"#22d3ee", ext:".rsc", get:(c)=>makePppoeVlanScript(c), filename:"vlanpppoe.rsc" },
    ],
  },
  {
    title: "Hotspot HTML Pages", color: "#22c55e",
    files: [
      { icon:"🌐", label:"hotspot/login.html",   desc:"Main login page — HTTP-CHAP with MD5 hashing",      color:"#22c55e", ext:".html", get:(c)=>makeLoginHtml(c),   filename:"login.html"   },
      { icon:"🌐", label:"hotspot/status.html",  desc:"Connected status — uptime, data, disconnect button", color:"#22c55e", ext:".html", get:(c)=>makeStatusHtml(c),  filename:"status.html"  },
      { icon:"🌐", label:"hotspot/alogin.html",  desc:"Already-logged-in / error page",                    color:"#22c55e", ext:".html", get:(c)=>makeAloginHtml(c),  filename:"alogin.html"  },
      { icon:"🌐", label:"hotspot/logout.html",  desc:"Logout confirmation page",                          color:"#22c55e", ext:".html", get:(c)=>makeLogoutHtml(c),  filename:"logout.html"  },
      { icon:"🌐", label:"hotspot/radvert.html", desc:"RADIUS advertisement / welcome interstitial",       color:"#22c55e", ext:".html", get:(c)=>makeRadvertHtml(c), filename:"radvert.html" },
      { icon:"🌐", label:"hotspot/redirect.html",desc:"Instant redirect page (no UI)",                     color:"#22c55e", ext:".html", get:()=>makeRedirectHtml(),  filename:"redirect.html"},
      { icon:"🌐", label:"error.html",           desc:"Root-level error page (not in /hotspot/)",          color:"#f87171", ext:".html", get:(c)=>makeErrorHtml(c),   filename:"error.html"   },
      { icon:"🌐", label:"hotspot/css/rlogin.html", desc:"CSS/roaming login variant",                     color:"#22c55e", ext:".html", get:(c)=>makeCssRloginHtml(c),filename:"rlogin.html" },
      { icon:"🌐", label:"pppoe/login.html",     desc:"PPPoE login page",                                  color:"#22d3ee", ext:".html", get:(c)=>makePppoeLoginHtml(c), filename:"pppoe-login.html" },
    ],
  },
  {
    title: "Hotspot XML / WISPr API", color: "#a78bfa",
    files: [
      { icon:"🗂️", label:"hotspot/xml/login.html",    desc:"WISPr AuthenticationReply response",          color:"#a78bfa", ext:".xml", get:()=>makeXmlLoginHtml(),   filename:"xml-login.html"    },
      { icon:"🗂️", label:"hotspot/xml/logout.html",   desc:"WISPr LogoffReply response",                  color:"#a78bfa", ext:".xml", get:()=>makeXmlLogoutHtml(),  filename:"xml-logout.html"   },
      { icon:"🗂️", label:"hotspot/xml/alogin.html",   desc:"WISPr AuthenticationPollReply response",      color:"#a78bfa", ext:".xml", get:()=>makeXmlAloginHtml(),  filename:"xml-alogin.html"   },
      { icon:"🗂️", label:"hotspot/xml/rlogin.html",   desc:"WISPr Roaming Login reply",                   color:"#a78bfa", ext:".xml", get:()=>makeXmlRloginHtml(),  filename:"xml-rlogin.html"   },
      { icon:"🗂️", label:"hotspot/xml/error.html",    desc:"WISPr error response",                        color:"#a78bfa", ext:".xml", get:()=>makeXmlErrorHtml(),   filename:"xml-error.html"    },
      { icon:"🗂️", label:"hotspot/xml/flogout.html",  desc:"WISPr floating logout reply",                 color:"#a78bfa", ext:".xml", get:()=>makeXmlFlogoutHtml(), filename:"xml-flogout.html"  },
      { icon:"🗂️", label:"hotspot/xml/WISPAccessGateway.xsd", desc:"WISPr XML schema definition",         color:"#a78bfa", ext:".xsd", get:()=>makeXmlWispSchema(),  filename:"WISPAccessGateway.xsd" },
    ],
  },
  {
    title: "Hotspot CSS & Assets", color: "#fbbf24",
    files: [
      { icon:"🎨", label:"hotspot/css/style.css",       desc:"Main hotspot stylesheet — branded OcholaNet theme",  color:"#fbbf24", ext:".css", get:(c)=>makeCssStyle(c),  filename:"style.css"      },
      { icon:"🖼️", label:"hotspot/img/user.svg",        desc:"User icon for login form",                           color:"#fbbf24", ext:".svg", get:()=>makeUserSvg(),      filename:"user.svg"       },
      { icon:"🖼️", label:"hotspot/img/password.svg",    desc:"Password / lock icon for login form",                color:"#fbbf24", ext:".svg", get:()=>makePasswordSvg(),  filename:"password.svg"   },
      { icon:"📋", label:"hotspot/api.json",             desc:"Hotspot API variable map ($(username), $(ip)…)",     color:"#fbbf24", ext:".json",get:(c)=>makeApiJson(c),   filename:"api.json"       },
      { icon:"⚠️",  label:"hotspot/errors.txt",          desc:"Error message strings displayed in the portal",      color:"#fbbf24", ext:".txt", get:()=>makeErrorsText(),   filename:"errors.txt"     },
      { icon:"🔐", label:"hotspot/md5.js",               desc:"MD5 library for HTTP-CHAP password hashing",         color:"#fbbf24", ext:".js",  get:()=>makeMd5Js(),        filename:"md5.js"         },
      { icon:"📦", label:"hotspot/tailwind.js",          desc:"Tailwind CSS CDN — download separately",             color:"#94a3b8", ext:".js",  external:"https://cdn.tailwindcss.com/3.4.17/tailwind.min.js", filename:"tailwind.js" },
      { icon:"📦", label:"hotspot/sweetalert2js.js",     desc:"SweetAlert2 library — download separately",          color:"#94a3b8", ext:".js",  external:"https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js", filename:"sweetalert2.min.js" },
    ],
  },
  {
    title: "VPS / Server Side", color: "#94a3b8",
    files: [
      { icon:"⚙️", label:"radius-clients.conf", desc:"Add to /etc/freeradius/3.0/clients.conf on VPS", color:"#94a3b8", ext:".conf", get:(c)=>makeRadiusClientConf(c), filename:"radius-clients.conf" },
    ],
  },
  {
    title: "VPN Tunnel — WireGuard ★ Recommended", color: "#818cf8",
    files: [
      {
        icon:"🛡️", label:"ochola-{r}-wg.rsc",
        desc:"RouterOS script — creates wg-ochola interface, peer, IP address and firewall rules",
        color:"#818cf8", ext:".rsc",
        get:(c)=>makeWgRouterScript(c),
        filename:"ochola-{r}-wg.rsc",
        visible:(c)=>c.vpnType==="wireguard"||c.vpnType==="both",
      },
      {
        icon:"📄", label:"ochola-{r}-wg.conf",
        desc:"WireGuard peer config — add this router as a peer on the VPN server",
        color:"#818cf8", ext:".conf",
        get:(c)=>makeWgClientConf(c),
        filename:"ochola-{r}-wg.conf",
        visible:(c)=>c.vpnType==="wireguard"||c.vpnType==="both",
      },
    ],
  },
  {
    title: "VPN Tunnel — OpenVPN", color: "#c084fc",
    files: [
      {
        icon:"🔒", label:"ochola-{r}-ovpn.rsc",
        desc:"RouterOS script — creates ovpn-ochola client interface and RADIUS route",
        color:"#c084fc", ext:".rsc",
        get:(c)=>makeOvpnRouterScript(c),
        filename:"ochola-{r}-ovpn.rsc",
        visible:(c)=>c.vpnType==="openvpn"||c.vpnType==="both",
      },
      {
        icon:"📄", label:"ochola-{r}.ovpn",
        desc:"OpenVPN client config — import into OpenVPN app or router",
        color:"#c084fc", ext:".ovpn",
        get:(c)=>makeOvpnClientConfig(c),
        filename:"ochola-{r}.ovpn",
        visible:(c)=>c.vpnType==="openvpn"||c.vpnType==="both",
      },
    ],
  },
  {
    title: "Remote Admin Access", color: "#fb923c",
    files: [
      {
        icon:"🔑", label:"ochola-{r}-remote.rsc",
        desc:"RouterOS script — admin user, SSH port, Winbox/WebFig restricted to VPN, firewall rules",
        color:"#fb923c", ext:".rsc",
        get:(c)=>makeRemoteAccessScript(c),
        filename:"ochola-{r}-remote.rsc",
      },
    ],
  },
];

function resolveFile(entry: FileEntry, cfg: Cfg) {
  return entry.get ? entry.get(cfg) : "";
}
function resolveFilename(entry: FileEntry, cfg: Cfg) {
  return entry.filename.replace("{r}", cfg.routerTarget);
}

/* ══════════════════════════════════════════════════════════════════
   TERMINAL SCRIPT GENERATOR
   Wraps any file content into a RouterOS terminal-pasteable script.
   Chunks the content into 1400-char pieces so even large files (CSS,
   JS, HTML) can be pasted in a single copy-paste into Winbox terminal.
   For .rsc files, the raw content is already terminal-ready.
══════════════════════════════════════════════════════════════════ */
const TERM_CHUNK = 1400;

function makeTerminalScript(flashPath: string, content: string): string {
  const escaped = escapeRos(content);
  const L: string[] = [];
  L.push(`# ════════════════════════════════════════════════════`);
  L.push(`# Terminal Script — paste directly into MikroTik Terminal`);
  L.push(`# Creates: ${flashPath}`);
  L.push(`# ════════════════════════════════════════════════════`);
  L.push(``);
  L.push(`:local f ""`);
  for (let i = 0; i < escaped.length; i += TERM_CHUNK) {
    L.push(`:set f ($f . "${escaped.slice(i, i + TERM_CHUNK)}")`);
  }
  L.push(`# Remove existing file (ignore error if not found)`);
  L.push(`:do { /file remove [find name="${flashPath}"] } on-error={}`);
  L.push(`/file add name="${flashPath}" contents=$f`);
  L.push(`:log info message="OcholaNet: Created ${flashPath}"`);
  L.push(`:put "Done: ${flashPath}"`);
  return L.join("\n");
}

function resolveTerminalScript(entry: FileEntry, cfg: Cfg): string {
  const content = resolveFile(entry, cfg);
  if (entry.ext === ".rsc") return content;   // .rsc files paste directly as-is
  const label = entry.label.replace("{r}", cfg.routerTarget);
  const flashPath = `flash/${label}`;
  return makeTerminalScript(flashPath, content);
}

/* ── Small reusable copy button that tracks its own feedback state ── */
function CopyScriptBtn({ text, label = "Copy Script", color = "#f97316" }: { text: string; label?: string; color?: string }) {
  const [ok, setOk] = useState(false);
  const go = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 2000); });
  };
  return (
    <button
      onClick={go}
      style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.3rem 0.625rem", borderRadius: 6, background: ok ? `${color}18` : "rgba(249,115,22,0.08)", border: `1px solid ${ok ? color + "55" : "rgba(249,115,22,0.25)"}`, color: ok ? color : "#fb923c", fontWeight: 700, fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.2s" }}
    >
      {ok ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
      {ok ? "Copied!" : label}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FILES MANIFEST COMPONENT
══════════════════════════════════════════════════════════════════ */
function FilesManifest({ cfg, onSelect, selected }: { cfg: Cfg; onSelect: (f: FileEntry) => void; selected?: FileEntry }) {
  const visibleFiles      = FILE_GROUPS.flatMap(g => g.files).filter(f => !f.visible || f.visible(cfg));
  const totalDownloadable = visibleFiles.filter(f => f.get).length;
  const totalExternal     = visibleFiles.filter(f => f.external).length;
  const combinedScript    = makeCreateAllFilesScript(cfg);
  const combinedFilename  = `create-hotspot-files-${cfg.routerTarget}.rsc`;

  const handleDownloadAll = () => {
    let delay = 0;
    FILE_GROUPS.forEach(g => g.files.forEach(f => {
      if (f.get) { setTimeout(() => dl(resolveFile(f, cfg), resolveFilename(f, cfg)), delay); delay += 100; }
    }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* ── Combined Script Card ─────────────────────────────── */}
      <div style={{ borderRadius: 12, background: "linear-gradient(135deg, rgba(249,115,22,0.08) 0%, rgba(249,115,22,0.04) 100%)", border: "1px solid rgba(249,115,22,0.3)", overflow: "hidden" }}>
        {/* Card header */}
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid rgba(249,115,22,0.2)", display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <span style={{ fontSize: "1.1rem" }}>🚀</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "#fb923c" }}>Combined Import Script</div>
            <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginTop: "0.15rem" }}>
              One script that creates all 22 hotspot files on the router — upload to router and <code style={{ background: "rgba(249,115,22,0.15)", padding: "0 4px", borderRadius: 3, color: "#fb923c" }}>/import</code> it, or paste in terminal.
            </div>
          </div>
          <span style={{ fontSize: "0.65rem", background: "rgba(249,115,22,0.15)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.3)", borderRadius: 4, padding: "0.15rem 0.5rem", fontWeight: 700, whiteSpace: "nowrap" }}>22 FILES</span>
        </div>
        {/* Action row */}
        <div style={{ padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <code style={{ flex: 1, fontSize: "0.75rem", color: "#fb923c", fontFamily: "monospace", background: "rgba(0,0,0,0.2)", padding: "0.35rem 0.75rem", borderRadius: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            /import file-name={combinedFilename}
          </code>
          <CopyScriptBtn text={combinedScript} label="📋 Copy Script" color="#f97316" />
          <button
            onClick={() => dl(combinedScript, combinedFilename)}
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.35rem 0.875rem", borderRadius: 7, background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.25)", color: "#fb923c", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            <Download style={{ width: 13, height: 13 }} /> Download .rsc
          </button>
        </div>
      </div>

      {/* ── Per-file manifest table ──────────────────────────── */}
      <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
        <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <PackageOpen style={{ width: 14, height: 14, color: "#06b6d4" }} />
            <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>Individual Files</span>
            <span style={{ fontSize: "0.65rem", background: "rgba(6,182,212,0.12)", color: "#06b6d4", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 4, padding: "0.1rem 0.45rem", fontWeight: 700 }}>
              {totalDownloadable} GENERATED · {totalExternal} EXTERNAL
            </span>
          </div>
          <button
            onClick={handleDownloadAll}
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.35rem 0.75rem", borderRadius: 7, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "#06b6d4", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Download style={{ width: 12, height: 12 }} /> Download All
          </button>
        </div>

        {FILE_GROUPS.map((group) => {
          const visibleGroupFiles = group.files.filter(f => !f.visible || f.visible(cfg));
          if (visibleGroupFiles.length === 0) return null;
          return (
          <div key={group.title}>
            <div style={{ padding: "0.4rem 1.25rem", background: "rgba(0,0,0,0.15)", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: group.color, textTransform: "uppercase", letterSpacing: "0.07em" }}>{group.title}</span>
              <button
                onClick={() => { let d = 0; visibleGroupFiles.filter(f => f.get).forEach(f => { setTimeout(() => dl(resolveFile(f, cfg), resolveFilename(f, cfg)), d); d += 100; }); }}
                style={{ fontSize: "0.63rem", color: group.color, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, opacity: 0.7 }}
              >
                ↓ group
              </button>
            </div>
            {visibleGroupFiles.map((f) => {
              const isSelected = selected === f;
              const isExternal = !!f.external;
              const termScript = !isExternal ? resolveTerminalScript(f, cfg) : "";
              return (
                <div
                  key={f.label}
                  onClick={() => !isExternal && onSelect(f)}
                  style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.45rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", cursor: isExternal ? "default" : "pointer", background: isSelected ? `${f.color}08` : "transparent", transition: "background 0.15s" }}
                >
                  <span style={{ fontSize: "0.875rem", flexShrink: 0 }}>{f.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: isExternal ? "var(--isp-text-sub)" : f.color, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.label.replace("{r}", cfg.routerTarget)}
                    </div>
                    <div style={{ fontSize: "0.675rem", color: "var(--isp-text-muted)", marginTop: "0.1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.desc}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0, alignItems: "center" }}>
                    {isExternal ? (
                      <a href={f.external} target="_blank" rel="noreferrer"
                        style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.5rem", borderRadius: 6, background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)", color: "#94a3b8", fontWeight: 600, fontSize: "0.68rem", textDecoration: "none", whiteSpace: "nowrap" }}>
                        <ExternalLink style={{ width: 10, height: 10 }} /> CDN
                      </a>
                    ) : (
                      <>
                        <CopyScriptBtn text={termScript} label="📋 Copy" color={f.color} />
                        <button
                          onClick={e => { e.stopPropagation(); dl(resolveFile(f, cfg), resolveFilename(f, cfg)); }}
                          style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.25rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                        >
                          <Download style={{ width: 10, height: 10 }} /> {f.ext}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FILE VIEWER — with File Content / Terminal Script toggle
══════════════════════════════════════════════════════════════════ */
function FileViewer({ entry, cfg }: { entry: FileEntry; cfg: Cfg }) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"file" | "terminal">("terminal");

  const rawContent      = resolveFile(entry, cfg);
  const terminalContent = resolveTerminalScript(entry, cfg);
  const filename        = resolveFilename(entry, cfg);

  const isRsc     = entry.ext === ".rsc";
  const displayed = mode === "file" ? rawContent : terminalContent;
  const dlName    = mode === "terminal" && !isRsc
    ? `terminal-${filename}.rsc`
    : filename;

  const fileColor  = entry.color;
  const termColor  = "#f97316";
  const activeColor = mode === "file" ? fileColor : termColor;

  const textColor = mode === "terminal"
    ? "#4ade80"
    : entry.color === "#f87171" ? "#fca5a5"
    : entry.ext === ".css"  ? "#93c5fd"
    : entry.ext === ".svg"  ? "#86efac"
    : entry.ext === ".json" ? "#fde68a"
    : "#4ade80";

  const copy = () => {
    navigator.clipboard.writeText(displayed).then(() => setCopied(true));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${activeColor}33`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.625rem 1rem", background: `${activeColor}0d`, borderBottom: `1px solid ${activeColor}22`, flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#f87171", display: "inline-block" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fbbf24", display: "inline-block" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
          </div>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: activeColor, fontFamily: "monospace" }}>
            {mode === "terminal" && !isRsc ? `terminal-${filename}.rsc` : entry.label.replace("{r}", cfg.routerTarget)}
          </span>
          <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.45rem", borderRadius: 4, background: `${activeColor}20`, color: activeColor, fontWeight: 700 }}>
            {mode === "terminal" ? "TERMINAL" : entry.ext.toUpperCase().replace(".", "")}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden", fontSize: "0.68rem", fontWeight: 700 }}>
            <button
              onClick={() => setMode("terminal")}
              style={{ padding: "0.2rem 0.625rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.68rem", border: "none", background: mode === "terminal" ? termColor : "rgba(255,255,255,0.04)", color: mode === "terminal" ? "#fff" : "#64748b", transition: "all 0.15s" }}
            >
              📋 Terminal
            </button>
            <button
              onClick={() => setMode("file")}
              style={{ padding: "0.2rem 0.625rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.68rem", border: "none", borderLeft: "1px solid rgba(255,255,255,0.1)", background: mode === "file" ? fileColor : "rgba(255,255,255,0.04)", color: mode === "file" ? "#fff" : "#64748b", transition: "all 0.15s" }}
            >
              📄 File
            </button>
          </div>
          <button
            onClick={() => dl(displayed, dlName)}
            style={{ display: "flex", alignItems: "center", gap: "0.25rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "0.2rem 0.625rem", fontSize: "0.68rem", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            <Download style={{ width: 10, height: 10 }} /> Download
          </button>
          <button
            onClick={copy}
            style={{ display: "flex", alignItems: "center", gap: "0.25rem", background: copied ? `${activeColor}20` : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? activeColor + "55" : "rgba(255,255,255,0.1)"}`, borderRadius: 6, padding: "0.2rem 0.625rem", fontSize: "0.68rem", color: copied ? activeColor : "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, transition: "all 0.2s" }}
          >
            {copied ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Mode hint bar */}
      {mode === "terminal" && !isRsc && (
        <div style={{ padding: "0.45rem 1.25rem", background: "rgba(249,115,22,0.07)", borderBottom: "1px solid rgba(249,115,22,0.15)", fontSize: "0.7rem", color: "#fb923c" }}>
          <strong>Paste this entire block</strong> into the MikroTik Winbox Terminal. It builds the file using string chunks — no upload required.
        </div>
      )}
      {mode === "terminal" && isRsc && (
        <div style={{ padding: "0.45rem 1.25rem", background: "rgba(6,182,212,0.06)", borderBottom: "1px solid rgba(6,182,212,0.12)", fontSize: "0.7rem", color: "#67e8f9" }}>
          RouterOS script — <strong>copy and paste directly</strong> into Winbox Terminal, or save and run <code>/import file-name=…</code>
        </div>
      )}

      {/* Content */}
      <pre style={{ margin: 0, padding: "1rem 1.25rem", fontFamily: "monospace", fontSize: "0.72rem", color: textColor, lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#080c10", maxHeight: 400, overflow: "auto" }}>
        {displayed}
      </pre>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FORM FIELD
══════════════════════════════════════════════════════════════════ */
function Field({ label, value, onChange, mono = true }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <label style={{ fontSize: "0.675rem", fontWeight: 700, color: "var(--isp-text-sub)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 7, padding: "0.45rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8rem", fontFamily: mono ? "monospace" : "inherit", outline: "none", width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   STEP BAR
══════════════════════════════════════════════════════════════════ */
const STEPS = ["Configure", "Generate Files", "Clean Up", "Done"];
function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, background: i < current ? "#22c55e" : i === current ? "#06b6d4" : "var(--isp-section)", border: i === current ? "2px solid #06b6d4" : "2px solid transparent", color: i <= current ? "white" : "var(--isp-text-sub)", transition: "all 0.3s" }}>
              {i < current ? <Check style={{ width: 12, height: 12 }} /> : i + 1}
            </div>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, color: i === current ? "#06b6d4" : "var(--isp-text-sub)", whiteSpace: "nowrap" }}>{s}</span>
          </div>
          {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < current ? "#22c55e" : "var(--isp-border)", margin: "0 0.25rem", marginBottom: "1.1rem", transition: "background 0.3s" }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════ */
export default function SelfInstall() {
  const [step, setStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<FileEntry | undefined>(undefined);
  const [bridgePorts, setBridgePorts] = useState<string[]>(["ether2", "ether3", "ether4", "ether5"]);
  const [cfg, setCfg] = useState<Cfg>({
    routerTarget: "latty1", hotspotIp: "192.168.1.1",
    dnsName: "hotspot.isplatty.org", radiusIp: "10.0.0.1",
    radiusSecret: "supersecret", bridgeInterface: "bridge1",
    poolStart: "192.168.2.2", poolEnd: "192.168.2.254",
    profileName: "hsprof1", hotspotSsid: "OcholaNet-WiFi",
    portalTitle: "OcholaSupernet",
    vpnType: "wireguard", vpnServer: "vpn.isplatty.org",
    wgPort: "13231", wgRouterPrivKey: "PASTE_ROUTER_PRIVATE_KEY",
    wgServerPubKey: "PASTE_SERVER_PUBLIC_KEY", wgRouterIp: "10.100.0.2/24",
    ovpnPort: "1194", ovpnUser: "latty1", ovpnPassword: "changeme",
    adminUser: "ocholaadmin", adminPassword: "Ch@ngeMe2025!", sshPort: "2222",
    winboxAllowedIp: "10.100.0.0/24", apiEnabled: false,
  });
  const upd = (k: keyof Cfg) => (v: string) => setCfg(c => ({ ...c, [k]: v }));

  const totalFiles = FILE_GROUPS.flatMap(g => g.files).filter(f => !f.visible || f.visible(cfg)).length;

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Self Install</h1>
          <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 8, padding: "0.5rem 1rem", color: "#a78bfa", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
            <MonitorSmartphone style={{ width: 15, height: 15 }} /> New Device Setup
          </button>
        </div>

        <NetworkTabs active="self-install" />

        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1.25rem 1.5rem" }}>
          <StepBar current={step} />
        </div>

        {/* ── STEP 0: Configure ── */}
        {step === 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", alignItems: "start" }}>

            {/* Left card: Router + Network */}
            <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.875rem" }}>🖥️</span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>Router & Network</span>
              </div>
              <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <label style={{ fontSize: "0.675rem", fontWeight: 700, color: "var(--isp-text-sub)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Target Router</label>
                  <select value={cfg.routerTarget} onChange={e => upd("routerTarget")(e.target.value)} style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 7, padding: "0.45rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8rem", fontFamily: "monospace", outline: "none", cursor: "pointer", width: "100%" }}>
                    <option value="latty1">latty1 — L009UiGS-2HaxD</option>
                    <option value="latty2">latty2 — hAP lite</option>
                    <option value="latty3">latty3 — RB750Gr3</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <Field label="Hotspot IP Address"  value={cfg.hotspotIp}       onChange={upd("hotspotIp")} />
                  <Field label="Bridge Interface"    value={cfg.bridgeInterface} onChange={upd("bridgeInterface")} />
                  <Field label="IP Pool Start"       value={cfg.poolStart}       onChange={upd("poolStart")} />
                  <Field label="IP Pool End"         value={cfg.poolEnd}         onChange={upd("poolEnd")} />
                </div>
                <Field label="DNS / Portal Name"   value={cfg.dnsName}  onChange={upd("dnsName")} />
                <Field label="Profile Name"        value={cfg.profileName} onChange={upd("profileName")} />
              </div>
            </div>

            {/* Right card: RADIUS + Portal + Generate */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.875rem" }}>🔐</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>RADIUS & Authentication</span>
                </div>
                <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Field label="RADIUS IP"     value={cfg.radiusIp}     onChange={upd("radiusIp")} />
                    <Field label="RADIUS Secret" value={cfg.radiusSecret} onChange={upd("radiusSecret")} />
                  </div>
                </div>
              </div>

              <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.875rem" }}>🌐</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>Hotspot Portal</span>
                </div>
                <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Field label="Hotspot SSID"  value={cfg.hotspotSsid} onChange={upd("hotspotSsid")} mono={false} />
                    <Field label="Portal Title"  value={cfg.portalTitle} onChange={upd("portalTitle")} mono={false} />
                  </div>
                </div>
              </div>

              {/* VPN Tunnel card */}
              <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.875rem" }}>🛡️</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>VPN Tunnel</span>
                </div>
                <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  {/* Type selector */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    <label style={{ fontSize: "0.675rem", fontWeight: 700, color: "var(--isp-text-sub)", textTransform: "uppercase", letterSpacing: "0.07em" }}>VPN Type</label>
                    <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                      {([
                        { val: "wireguard", label: "WireGuard", badge: "★ Recommended", color: "#818cf8" },
                        { val: "openvpn",   label: "OpenVPN",   badge: "",               color: "#c084fc" },
                        { val: "both",      label: "Both",      badge: "",               color: "#06b6d4" },
                      ] as const).map((opt, i) => (
                        <button
                          key={opt.val}
                          onClick={() => setCfg(c => ({ ...c, vpnType: opt.val }))}
                          style={{ flex: 1, padding: "0.5rem 0.25rem", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.7rem", border: "none", borderLeft: i > 0 ? "1px solid var(--isp-border)" : "none", background: cfg.vpnType === opt.val ? `${opt.color}22` : "transparent", color: cfg.vpnType === opt.val ? opt.color : "var(--isp-text-sub)", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}
                        >
                          {opt.label}
                          {opt.badge && <span style={{ fontSize: "0.58rem", color: opt.color, opacity: 0.85 }}>{opt.badge}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Shared: VPN Server */}
                  <Field label="VPN Server Address" value={cfg.vpnServer} onChange={upd("vpnServer")} />
                  {/* WireGuard fields */}
                  {(cfg.vpnType === "wireguard" || cfg.vpnType === "both") && (<>
                    <div style={{ padding: "0.3rem 0.625rem", borderRadius: 6, background: "rgba(129,140,248,0.07)", border: "1px solid rgba(129,140,248,0.2)", fontSize: "0.68rem", color: "#818cf8", fontWeight: 600 }}>
                      🛡️ WireGuard fields
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <Field label="WG Listen Port"   value={cfg.wgPort}      onChange={upd("wgPort")} />
                      <Field label="Tunnel IP (CIDR)" value={cfg.wgRouterIp}  onChange={upd("wgRouterIp")} />
                    </div>
                    <Field label="Router Private Key" value={cfg.wgRouterPrivKey} onChange={upd("wgRouterPrivKey")} />
                    <Field label="Server Public Key"  value={cfg.wgServerPubKey} onChange={upd("wgServerPubKey")} />
                  </>)}
                  {/* OpenVPN fields */}
                  {(cfg.vpnType === "openvpn" || cfg.vpnType === "both") && (<>
                    <div style={{ padding: "0.3rem 0.625rem", borderRadius: 6, background: "rgba(192,132,252,0.07)", border: "1px solid rgba(192,132,252,0.2)", fontSize: "0.68rem", color: "#c084fc", fontWeight: 600 }}>
                      🔒 OpenVPN fields
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                      <Field label="OVPN Port"    value={cfg.ovpnPort}     onChange={upd("ovpnPort")} />
                      <Field label="Username"     value={cfg.ovpnUser}     onChange={upd("ovpnUser")} mono={false} />
                      <Field label="Password"     value={cfg.ovpnPassword} onChange={upd("ovpnPassword")} />
                    </div>
                  </>)}
                </div>
              </div>

              {/* Remote Access card */}
              <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.875rem" }}>🔑</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>Remote Admin Access</span>
                  <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: "#fb923c", background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 4, padding: "0.1rem 0.4rem", fontWeight: 600 }}>SSH · Winbox · WebFig</span>
                </div>
                <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Field label="Admin Username" value={cfg.adminUser}     onChange={upd("adminUser")} mono={false} />
                    <Field label="Admin Password" value={cfg.adminPassword} onChange={upd("adminPassword")} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Field label="SSH Port"           value={cfg.sshPort}          onChange={upd("sshPort")} />
                    <Field label="Allowed IP / CIDR"  value={cfg.winboxAllowedIp}  onChange={upd("winboxAllowedIp")} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: 8, background: "rgba(251,146,60,0.05)", border: "1px solid rgba(251,146,60,0.12)", cursor: "pointer" }}
                    onClick={() => setCfg(c => ({ ...c, apiEnabled: !c.apiEnabled }))}>
                    <div style={{ width: 34, height: 18, borderRadius: 9, background: cfg.apiEnabled ? "#fb923c" : "rgba(255,255,255,0.1)", transition: "background 0.2s", flexShrink: 0, position: "relative" }}>
                      <div style={{ position: "absolute", top: 2, left: cfg.apiEnabled ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text)" }}>Enable RouterOS API (port 8728/8729)</div>
                      <div style={{ fontSize: "0.65rem", color: "var(--isp-text-muted)" }}>Needed for billing integrations — also locked to Allowed IP/CIDR</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "var(--isp-text-muted)", background: "rgba(251,146,60,0.04)", borderRadius: 6, padding: "0.5rem 0.75rem", border: "1px solid rgba(251,146,60,0.1)", lineHeight: 1.6 }}>
                    🔒 All services are restricted to <strong style={{ color: "#fb923c" }}>{cfg.winboxAllowedIp}</strong> (your VPN tunnel range). Direct WAN access is blocked by firewall rules in the generated script.
                  </div>
                </div>
              </div>

              {/* Summary + Generate button */}
              <div style={{ borderRadius: 10, background: "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(6,182,212,0.04))", border: "1px solid rgba(6,182,212,0.25)", padding: "1.25rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", marginBottom: "1rem", lineHeight: 1.7 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem 1rem", marginBottom: "0.75rem" }}>
                    {[
                      ["5", "RouterOS scripts (.rsc)"],
                      ["9", "Hotspot HTML pages"],
                      ["7", "WISPr XML files"],
                      ["8", "CSS / JS / SVG / JSON"],
                      ["1", "FreeRADIUS config"],
                      ["1", "Create-all import script"],
                      ...(cfg.vpnType === "wireguard" ? [["2","WireGuard VPN files"]] :
                          cfg.vpnType === "openvpn"   ? [["2","OpenVPN files"]] :
                          [["4","WireGuard + OpenVPN"]]),
                      ["1", "Remote admin access script"],
                    ].map(([n, label]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontWeight: 800, color: "#06b6d4", fontFamily: "monospace", fontSize: "0.8rem" }}>{n}</span>
                        <span style={{ fontSize: "0.7rem" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: "1px solid rgba(6,182,212,0.15)", paddingTop: "0.625rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, color: "#06b6d4" }}>Total: {totalFiles} files</span>
                    <span style={{ fontSize: "0.68rem", color: "var(--isp-text-sub)" }}>for <code style={{ color: "#06b6d4" }}>{cfg.routerTarget}</code></span>
                  </div>
                </div>
                <button
                  onClick={() => setStep(1)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", background: "linear-gradient(135deg, #06b6d4, #0891b2)", border: "none", borderRadius: 9, color: "white", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 18px rgba(6,182,212,0.35)" }}
                >
                  <Terminal style={{ width: 16, height: 16 }} />
                  Generate All {totalFiles} Files
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 1: All files ── */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Top banner */}
            <div style={{ borderRadius: 8, background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", padding: "0.65rem 1.125rem", display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <Check style={{ width: 15, height: 15, color: "#22c55e", flexShrink: 0 }} />
              <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
                <strong style={{ color: "#06b6d4" }}>{totalFiles} files</strong> generated for <strong style={{ color: "#06b6d4" }}>{cfg.routerTarget}</strong> — click a file row to view it on the right, or use the copy / download buttons.
              </span>
              <button onClick={() => { setStep(0); setSelectedFile(undefined); }} style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>← Edit config</button>
            </div>

            {/* Side-by-side: manifest left, viewer right */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 420px) 1fr", gap: "1.25rem", alignItems: "start" }}>

              {/* Left: manifest */}
              <FilesManifest cfg={cfg} onSelect={setSelectedFile} selected={selectedFile} />

              {/* Right: viewer (sticky) */}
              <div style={{ position: "sticky", top: "1rem" }}>
                {selectedFile && !selectedFile.external ? (
                  <FileViewer entry={selectedFile} cfg={cfg} />
                ) : (
                  <div style={{ borderRadius: 10, background: "#080c10", border: "1px solid rgba(6,182,212,0.1)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.3)" }}>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        {["#1f2937","#1f2937","#1f2937"].map((c,i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />)}
                      </div>
                      <span style={{ fontSize: "0.7rem", color: "#374151", fontFamily: "monospace" }}>Select a file to preview…</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, gap: "0.875rem", opacity: 0.4 }}>
                      <PackageOpen style={{ width: 38, height: 38, color: "#4b5563" }} />
                      <p style={{ fontSize: "0.78rem", color: "#4b5563", margin: 0, fontFamily: "monospace", textAlign: "center", lineHeight: 1.7 }}>
                        Click any file row on the left<br/>to preview its content here
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: cleanup + next */}
            <div style={{ borderRadius: 10, background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.18)", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <Trash2 style={{ width: 15, height: 15, color: "#f87171", flexShrink: 0 }} />
                <span style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
                  Run <strong style={{ color: "#f87171" }}>ochola-{cfg.routerTarget}-cleanup.rsc</strong> on the router before importing the new files.
                </span>
              </div>
              <button onClick={() => setStep(2)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 1.375rem", background: "linear-gradient(135deg, #22c55e, #16a34a)", border: "none", borderRadius: 9, color: "white", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(34,197,94,0.3)", whiteSpace: "nowrap" }}>
                Next — Verify <ArrowRight style={{ width: 15, height: 15 }} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Bridge Port Selection ── */}
        {step === 2 && (() => {
          const ALL_PORTS = ["ether1","ether2","ether3","ether4","ether5","ether6","ether7","ether8"];
          const togglePort = (p: string) => setBridgePorts(prev =>
            prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
          );

          // Generate RouterOS script for selected bridge ports
          const bridgeScript = [
            `# Bridge Port Assignment — ${cfg.routerTarget}`,
            `# Generated by OcholaSupernet Self-Install`,
            ``,
            `# Remove existing hotspot bridge ports (ignore errors)`,
            ...ALL_PORTS.filter(p => p !== "ether1").map(p =>
              `:do { /interface bridge port remove [find interface=${p}] } on-error={}`
            ),
            ``,
            `# Add selected ports to ${cfg.bridgeInterface}`,
            ...bridgePorts.map(p =>
              `/interface bridge port add bridge=${cfg.bridgeInterface} interface=${p} comment="hotspot"`
            ),
            ``,
            `:log info message="OcholaNet: Bridge ports configured on ${cfg.routerTarget}"`,
            `:put "Done: ${bridgePorts.length} port(s) added to ${cfg.bridgeInterface}"`,
          ].join("\n");

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 720, margin: "0 auto", width: "100%" }}>

              {/* Card header */}
              <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
                <div style={{ padding: "0.875rem 1.375rem", borderBottom: "1px solid var(--isp-border-subtle)", background: "linear-gradient(90deg, rgba(6,182,212,0.08), transparent)" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--isp-text)" }}>
                    Configure Router — Profile: <code style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4", padding: "0.1rem 0.45rem", borderRadius: 4, fontSize: "0.8rem" }}>{cfg.routerTarget}</code>
                  </span>
                </div>

                {/* Connected IP banner */}
                <div style={{ margin: "1rem 1.375rem 0", borderRadius: 8, background: "linear-gradient(90deg, #06b6d4, #0e7490)", padding: "0.75rem 1.125rem", display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", opacity: 0.9, flexShrink: 0 }} />
                  <span style={{ fontSize: "0.8125rem", color: "white", fontWeight: 600 }}>
                    Connected router IP:&nbsp;
                    <span style={{ background: "rgba(255,80,80,0.85)", color: "white", padding: "0.1rem 0.5rem", borderRadius: 4, fontFamily: "monospace", fontWeight: 800, fontSize: "0.82rem" }}>{cfg.hotspotIp}</span>
                  </span>
                </div>

                {/* Instruction banner */}
                <div style={{ margin: "0.75rem 1.375rem", borderRadius: 8, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", padding: "0.75rem 1rem", display: "flex", gap: "0.625rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#06b6d4", flexShrink: 0, marginTop: "0.3rem" }} />
                  <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0, lineHeight: 1.7 }}>
                    Select ports to assign to <strong style={{ color: "#06b6d4" }}>{cfg.bridgeInterface}</strong>. WAN (<strong>ether1</strong>) is excluded.
                    After you click Finish, to re-add your customers follow this order:&nbsp;
                    <strong style={{ color: "var(--isp-text)" }}>Step 1.</strong> Network › Pools and sync by router&nbsp;&nbsp;
                    <strong style={{ color: "var(--isp-text)" }}>Step 2.</strong> Packages › Hotspot &amp; PPPoE and sync by router&nbsp;&nbsp;
                    <strong style={{ color: "var(--isp-text)" }}>Step 3.</strong> Activation › Prepaid users and sync by router
                  </p>
                </div>

                {/* Port list */}
                <div style={{ padding: "0.5rem 1.375rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {ALL_PORTS.map(port => {
                    const isWan    = port === "ether1";
                    const checked  = !isWan && bridgePorts.includes(port);
                    const disabled = isWan;
                    return (
                      <label
                        key={port}
                        style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.65rem 1rem", borderRadius: 8, background: checked ? "rgba(6,182,212,0.07)" : "rgba(255,255,255,0.02)", border: `1px solid ${checked ? "rgba(6,182,212,0.25)" : "var(--isp-border-subtle)"}`, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, transition: "all 0.15s" }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => !disabled && togglePort(port)}
                          style={{ accentColor: "#06b6d4", width: 16, height: 16, flexShrink: 0, cursor: disabled ? "not-allowed" : "pointer" }}
                        />
                        <span style={{ flex: 1, fontFamily: "monospace", fontSize: "0.85rem", fontWeight: 700, color: checked ? "#06b6d4" : "var(--isp-text)" }}>
                          {port}
                        </span>
                        <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                          {isWan ? "WAN — excluded" : "— *1B"}
                        </span>
                        {checked && (
                          <span style={{ fontSize: "0.65rem", background: "rgba(6,182,212,0.15)", color: "#06b6d4", padding: "0.1rem 0.45rem", borderRadius: 4, fontWeight: 700 }}>BRIDGE</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Bridge script preview + copy */}
                <div style={{ margin: "0 1.375rem 1.25rem", borderRadius: 8, background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)", overflow: "hidden" }}>
                  <div style={{ padding: "0.5rem 1rem", borderBottom: "1px solid rgba(249,115,22,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#fb923c" }}>📋 Bridge Port Script — paste in Winbox Terminal</span>
                    <CopyScriptBtn text={bridgeScript} label="Copy Script" color="#f97316" />
                  </div>
                  <pre style={{ margin: 0, padding: "0.75rem 1rem", fontFamily: "monospace", fontSize: "0.7rem", color: "#4ade80", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#080c10", maxHeight: 180, overflow: "auto" }}>
                    {bridgeScript}
                  </pre>
                </div>

                {/* Action buttons */}
                <div style={{ padding: "0 1.375rem 1.375rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    onClick={() => setStep(3)}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.7rem 2rem", background: "linear-gradient(135deg, #22c55e, #16a34a)", border: "none", borderRadius: 9, color: "white", fontWeight: 800, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 14px rgba(34,197,94,0.35)" }}
                  >
                    <Check style={{ width: 16, height: 16 }} /> Finish
                  </button>
                  <button
                    onClick={() => setStep(1)}
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.7rem 1.25rem", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 9, color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setBridgePorts(["ether2","ether3","ether4","ether5"])}
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.7rem 1.125rem", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 9, color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ↺ Reset
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── STEP 3: Done ── */}
        {step === 3 && (
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid rgba(6,182,212,0.2)", padding: "3rem", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--isp-text)", margin: "0 0 0.5rem" }}>Installation Complete!</h2>
            <p style={{ fontSize: "0.8375rem", color: "var(--isp-text-muted)", margin: "0 0 1.75rem" }}>
              <strong style={{ color: "#06b6d4" }}>{cfg.routerTarget}</strong> is fully configured as an OcholaNet hotspot node.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button onClick={() => { setStep(0); setSelectedFile(undefined); }} style={{ padding: "0.6rem 1.25rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>Configure Another Router</button>
              <Link href="/admin/network/routers">
                <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 1.25rem", borderRadius: 8, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)", color: "#06b6d4", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                  View Routers <ChevronRight style={{ width: 14, height: 14 }} />
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
