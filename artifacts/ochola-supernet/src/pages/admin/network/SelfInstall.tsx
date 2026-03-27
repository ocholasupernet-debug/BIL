import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Copy, Check, Download, FileCode2, ChevronDown, ChevronUp,
  RefreshCw, CheckCircle2, AlertTriangle, Loader2, Wifi,
} from "lucide-react";

/* ══════════════════════════ Types ══════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
  ros_version: string;
}

interface Cfg {
  routerName: string; hotspotIp: string; dnsName: string;
  radiusIp: string; radiusSecret: string; bridgeInterface: string;
  poolStart: string; poolEnd: string; profileName: string;
  portalTitle: string; hotspotSsid: string;
}

const DEFAULTS: Cfg = {
  routerName: "router1", hotspotIp: "192.168.1.1", dnsName: "hotspot.myisp.com",
  radiusIp: "10.0.0.1", radiusSecret: "supersecret", bridgeInterface: "bridge1",
  poolStart: "192.168.2.2", poolEnd: "192.168.2.254",
  profileName: "hsprof1", portalTitle: "OcholaSupernet", hotspotSsid: "OcholaNet-WiFi",
};

/* ══════════════════════════ Script generators ══════════════════════════ */
const makeScript1 = (c: Cfg) => `# ═══════════════════════════════════════════════════
# SCRIPT 1 — Initial Hotspot Configuration
# Run directly in MikroTik Terminal (Winbox / WebFig)
# Target: ${c.routerName}
# ═══════════════════════════════════════════════════

/system identity set name="OcholaNet-${c.routerName}"
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

/log info message="OcholaNet: Script 1 complete on ${c.routerName}"`.trim();

const makeScript2 = (c: Cfg) => `# ═══════════════════════════════════════════════════
# SCRIPT 2 — RADIUS & Firewall
# Save as: ochola-${c.routerName}-radius.rsc
# Run:  /import file-name=ochola-${c.routerName}-radius.rsc
# Target: ${c.routerName}
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

/log info message="OcholaNet: Script 2 (RADIUS) complete on ${c.routerName}"`.trim();

const makeAllInOne = (c: Cfg) => [makeScript1(c), "\n\n", makeScript2(c)].join("");

/* ══ HTML/CSS/Asset generators (used by Create-All-Files script) ══ */
const makeLoginHtml = (c: Cfg) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${c.portalTitle}</title>
<link rel="stylesheet" href="/hotspot/css/style.css"/>
<script src="/hotspot/md5.js"></script>
</head>
<body class="hs-body">
  <div class="hs-card">
    <div class="hs-logo"><div class="hs-logo-icon">🌐</div><h1>${c.portalTitle.toUpperCase()}</h1><p>Internet Access Portal</p></div>
    <div class="hs-ssid-badge">📶 ${c.hotspotSsid}</div>
    \$(if error)<div class="hs-error">\$(error)</div>\$(endif)
    <form name="sendin" action="/login" method="post">
      <input type="hidden" name="dst" value="\$(dst)"/>
      <input type="hidden" name="popup" value="true"/>
      \$(if chap-id)
      <input type="hidden" name="chap-id" value="\$(chap-id)"/>
      <input type="hidden" name="chap-challenge" value="\$(chap-challenge)"/>
      \$(endif)
      <div class="hs-field"><label>Username / Voucher</label><input type="text" name="username" value="\$(username)" placeholder="Enter username"/></div>
      <div class="hs-field"><label>Password</label><input type="password" name="password" id="password" placeholder="Enter password"/></div>
      <button type="submit" class="hs-btn">Connect to Internet</button>
    </form>
    <div class="hs-footer">Powered by <a href="https://${c.dnsName}">${c.portalTitle}</a></div>
  </div>
  <script>
    document.sendin.onsubmit=function(){
      \$(if chap-id)
      var p=document.getElementById('password');
      p.value='\$(chap-id)'+md5(p.value+'\$(chap-challenge)'.replace(/\\//g,''));
      \$(endif)
      return true;
    };
  </script>
</body></html>`.trim();

const makeStatusHtml = (c: Cfg) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="120"/><title>Connected — ${c.portalTitle}</title><link rel="stylesheet" href="/hotspot/css/style.css"/></head>
<body class="hs-body"><div class="hs-card">
  <div class="hs-logo"><div class="hs-logo-icon">✅</div><h1>Connected!</h1><p>Welcome, <strong>\$(username)</strong></p></div>
  <div class="hs-stat"><span>IP</span><span>\$(ip)</span></div>
  <div class="hs-stat"><span>Online</span><span>\$(uptime)</span></div>
  <div class="hs-stat"><span>Time left</span><span>\$(session-time-left)</span></div>
  <div class="hs-stat"><span>Down</span><span>\$(bytes-in-nice)</span></div>
  <div class="hs-stat"><span>Up</span><span>\$(bytes-out-nice)</span></div>
  <form action="/logout" method="post"><button class="hs-btn hs-btn-danger" type="submit">Disconnect</button></form>
</div></body></html>`.trim();

const makeAloginHtml = () => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head><body class="hs-body"><div class="hs-card" style="text-align:center">
\$(if logged-in)<h2 style="color:#4ade80">Already Connected</h2><a href="\$(link-status)" class="hs-btn" style="text-decoration:none">View Status</a>
\$(else)<h2 style="color:#f87171">\$(error)</h2><a href="\$(link-login)" class="hs-btn" style="text-decoration:none">Try Again</a>
\$(endif)</div></body></html>`.trim();

const makeLogoutHtml = (c: Cfg) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head><body class="hs-body"><div class="hs-card" style="text-align:center">
\$(if logged-in)<h2>Logging Out...</h2><p>Goodbye, <strong>\$(username)</strong>. Disconnected from ${c.hotspotSsid}.</p>
<a href="\$(link-login-only)" class="hs-btn" style="text-decoration:none">Log In Again</a>
\$(else)<h2>Not Logged In</h2><a href="\$(link-login-only)" class="hs-btn" style="text-decoration:none">Log In</a>
\$(endif)</div></body></html>`.trim();

const makeRadvertHtml = (c: Cfg) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="3; url=\$(link-orig-esc)"/></head>
<body class="hs-body"><div class="hs-card" style="text-align:center"><h2>Welcome, <span style="color:#06b6d4">\$(username)</span>!</h2>
<p>Connected to ${c.hotspotSsid}. Redirecting...</p></div></body></html>`.trim();

const makeCssStyle = (c: Cfg) => `:root{--bg:#0f172a;--card:#1e293b;--accent:#06b6d4;--text:#e2e8f0;--sub:#94a3b8}
*{box-sizing:border-box;margin:0;padding:0}body.hs-body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text)}
.hs-card{background:var(--card);border-radius:16px;padding:2rem;width:min(420px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.4)}
.hs-logo{text-align:center;margin-bottom:1.5rem}.hs-logo-icon{font-size:2.5rem;margin-bottom:.5rem}.hs-logo h1{font-size:1.4rem;font-weight:800;color:var(--accent)}.hs-logo p{font-size:.825rem;color:var(--sub)}
.hs-ssid-badge{text-align:center;font-size:.75rem;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);border-radius:20px;padding:.3rem .875rem;color:var(--accent);margin-bottom:1.25rem}
.hs-error{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:.625rem .875rem;color:#f87171;font-size:.8rem;margin-bottom:1rem}
.hs-field{display:flex;flex-direction:column;gap:.35rem;margin-bottom:1rem}.hs-field label{font-size:.72rem;font-weight:600;color:var(--sub);text-transform:uppercase;letter-spacing:.05em}
.hs-field input{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:.625rem .875rem;color:var(--text);font-size:.9rem;outline:none}
.hs-field input:focus{border-color:var(--accent)}
.hs-btn{display:block;width:100%;padding:.75rem;background:var(--accent);color:#fff;border:none;border-radius:9px;font-size:.9rem;font-weight:700;cursor:pointer;text-align:center;margin-top:.5rem;text-decoration:none}
.hs-btn:hover{opacity:.85}.hs-btn-danger{background:#ef4444}
.hs-stat{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:.825rem}.hs-stat span:last-child{font-weight:600;color:var(--accent)}
.hs-footer{text-align:center;margin-top:1.5rem;font-size:.72rem;color:var(--sub)}.hs-footer a{color:var(--accent);text-decoration:none}
/* portal: ${c.portalTitle} */`.trim();

const makeUserSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#94a3b8" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`;
const makePasswordSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#94a3b8" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
const makeMd5Js = () => `/* md5.js */var MD5=function(d){var r=M(V(Y(X(d),8*d.length)));return r};function M(d){for(var _,m="0123456789ABCDEF",f="",r=0;r<d.length;r++)_=d.charCodeAt(r),f+=m.charAt(_>>>4&15)+m.charAt(15&_);return f}function X(d){for(var _=Array(d.length>>2),m=0;m<_.length;m++)_[m]=0;for(m=0;m<8*d.length;m+=8)_[m>>5]|=(255&d.charCodeAt(m/8))<<m%32;return _}function V(d){for(var _="",m=0;m<32*d.length;m+=8)_+=String.fromCharCode(d[m>>5]>>>m%32&255);return _}function Y(d,_){d[_>>5]|=128<<_%32,d[14+(_+64>>>9<<4)]=_;var m=1732584193,f=-271733879,r=-1732584194,i=271733878;for(var n=0;n<d.length;n+=16){var h=m,t=f,g=r,e=i;f=md5ii(f=md5ii(f=md5ii(f=md5ii(f=md5hh(f=md5hh(f=md5hh(f=md5hh(f=md5gg(f=md5gg(f=md5gg(f=md5gg(f=md5ff(f=md5ff(f=md5ff(f=md5ff(f,r=md5ff(r,i=md5ff(i,m=md5ff(m,f,r,i,d[n+0],7,-680876936),f,r,d[n+1],12,-389564586),m,f,d[n+2],17,606105819),i,m,d[n+3],22,-1044525330),r=md5ff(r,i=md5ff(i,m=md5ff(m,f,r,i,d[n+4],7,-176418897),f,r,d[n+5],12,1200080426),m,f,d[n+6],17,-1473231341),i,m,d[n+7],22,-45705983),r=md5ff(r,i=md5ff(i,m=md5ff(m,f,r,i,d[n+8],7,1770035416),f,r,d[n+9],12,-1958414417),m,f,d[n+10],17,-42063),i,m,d[n+11],22,-1990404162),r=md5ff(r,i=md5ff(i,m=md5ff(m,f,r,i,d[n+12],7,1804603682),f,r,d[n+13],12,-40341101),m,f,d[n+14],17,-1502002290),i,m,d[n+15],22,1236535329),r=md5gg(r,i=md5gg(i,m=md5gg(m,f,r,i,d[n+1],5,-165796510),f,r,d[n+6],9,-1069501632),m,f,d[n+11],14,643717713),i,m,d[n+0],20,-373897302),r=md5gg(r,i=md5gg(i,m=md5gg(m,f,r,i,d[n+5],5,-701558691),f,r,d[n+10],9,38016083),m,f,d[n+15],14,-660478335),i,m,d[n+4],20,-405537848),r=md5gg(r,i=md5gg(i,m=md5gg(m,f,r,i,d[n+9],5,568446438),f,r,d[n+14],9,-1019803690),m,f,d[n+3],14,-187363961),i,m,d[n+8],20,1163531501),r=md5gg(r,i=md5gg(i,m=md5gg(m,f,r,i,d[n+13],5,-1444681467),f,r,d[n+2],9,-51403784),m,f,d[n+7],14,1735328473),i,m,d[n+12],20,-1926607734),r=md5hh(r,i=md5hh(i,m=md5hh(m,f,r,i,d[n+5],4,-378558),f,r,d[n+8],11,-2022574463),m,f,d[n+11],16,1839030562),i,m,d[n+14],23,-35309556),r=md5hh(r,i=md5hh(i,m=md5hh(m,f,r,i,d[n+1],4,-1530992060),f,r,d[n+4],11,1272893353),m,f,d[n+7],16,-155497632),i,m,d[n+10],23,-1094730640),r=md5hh(r,i=md5hh(i,m=md5hh(m,f,r,i,d[n+13],4,681279174),f,r,d[n+0],11,-358537222),m,f,d[n+3],16,-722521979),i,m,d[n+6],23,76029189),r=md5hh(r,i=md5hh(i,m=md5hh(m,f,r,i,d[n+9],4,-640364487),f,r,d[n+12],11,-421815835),m,f,d[n+15],16,530742520),i,m,d[n+2],23,-995338651),r=md5ii(r,i=md5ii(i,m=md5ii(m,f,r,i,d[n+0],6,-198630844),f,r,d[n+7],10,1126891415),m,f,d[n+14],15,-1416354905),i,m,d[n+5],21,-57434055),r=md5ii(r,i=md5ii(i,m=md5ii(m,f,r,i,d[n+12],6,1700485571),f,r,d[n+3],10,-1894986606),m,f,d[n+10],15,-1051523),i,m,d[n+1],21,-2054922799),r=md5ii(r,i=md5ii(i,m=md5ii(m,f,r,i,d[n+8],6,1873313359),f,r,d[n+15],10,-30611744),m,f,d[n+6],15,-1560198380),i,m,d[n+13],21,1309151649),r=md5ii(r,i=md5ii(i,m=md5ii(m,f,r,i,d[n+4],6,-145523070),f,r,d[n+11],10,-1120210379),m,f,d[n+2],15,718787259),i,m,d[n+9],21,-343485551),m=safeadd(m,h),f=safeadd(f,t),r=safeadd(r,g),i=safeadd(i,e)}return[m,f,r,i]}function md5cmn(d,_,m,f,r,i){return safeadd(bitrol(safeadd(safeadd(_,d),safeadd(f,i)),r),m)}function md5ff(d,_,m,f,r,i,n){return md5cmn(_&m|~_&f,d,_,r,i,n)}function md5gg(d,_,m,f,r,i,n){return md5cmn(_&f|m&~f,d,_,r,i,n)}function md5hh(d,_,m,f,r,i,n){return md5cmn(_^m^f,d,_,r,i,n)}function md5ii(d,_,m,f,r,i,n){return md5cmn(m^(_|~f),d,_,r,i,n)}function safeadd(d,_){var m=(65535&d)+(65535&_);return(d>>16)+(_>>16)+(m>>16)<<16|65535&m}function bitrol(d,_){return d<<_|d>>>32-_}window.md5=MD5;`;
const makeApiJson = (c: Cfg) => JSON.stringify({ server: c.hotspotIp, dns_name: c.dnsName, profile: c.profileName }, null, 2);
const makeErrorsText = () => `1=Wrong credentials.\n2=Already logged in.\n3=Access denied.\n6=Account expired.\n7=Session limit reached.`;

function escapeRos(s: string): string {
  return s.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\$/g,"\\$").replace(/\r\n/g,"\\n").replace(/\n/g,"\\n").replace(/\t/g,"\\t");
}
const TERM_CHUNK = 1400;

function makeCreateAllFilesScript(c: Cfg): string {
  const files = [
    { path: "flash/hotspot/login.html",   content: makeLoginHtml(c)   },
    { path: "flash/hotspot/status.html",  content: makeStatusHtml(c)  },
    { path: "flash/hotspot/alogin.html",  content: makeAloginHtml()   },
    { path: "flash/hotspot/logout.html",  content: makeLogoutHtml(c)  },
    { path: "flash/hotspot/radvert.html", content: makeRadvertHtml(c) },
    { path: "flash/hotspot/css/style.css",content: makeCssStyle(c)    },
    { path: "flash/hotspot/img/user.svg", content: makeUserSvg()      },
    { path: "flash/hotspot/img/password.svg", content: makePasswordSvg() },
    { path: "flash/hotspot/api.json",     content: makeApiJson(c)     },
    { path: "flash/hotspot/errors.txt",   content: makeErrorsText()   },
    { path: "flash/hotspot/md5.js",       content: makeMd5Js()        },
  ];
  const L: string[] = [
    `# ═══════════════════════════════════════════════════════`,
    `# OcholaNet — Create All Hotspot Files (${files.length} files)`,
    `# Router: ${c.routerName}`,
    `# Upload to router via Winbox Files, then run:`,
    `#   /import file-name=create-hotspot-files-${c.routerName}.rsc`,
    `# ═══════════════════════════════════════════════════════`,
    ``,
    `:log info message="OcholaNet: Creating ${files.length} hotspot files on ${c.routerName}..."`,
    `:local f ""`,
    ``,
  ];
  for (const file of files) {
    const esc = escapeRos(file.content);
    L.push(`# ── ${file.path}`);
    L.push(`:set f ""`);
    for (let i = 0; i < esc.length; i += TERM_CHUNK) {
      L.push(`:set f ($f . "${esc.slice(i, i + TERM_CHUNK)}")`);
    }
    L.push(`:do { /file remove [find name="${file.path}"] } on-error={}`);
    L.push(`/file add name="${file.path}" contents=$f`);
    L.push(``);
  }
  L.push(`:log info message="OcholaNet: Done — ${files.length} files on ${c.routerName}"`);
  return L.join("\n");
}

/* ══════════════════════════ Helpers ══════════════════════════ */
function dl(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const inp: React.CSSProperties = {
  background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8,
  padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8rem",
  fontFamily: "monospace", width: "100%", boxSizing: "border-box", outline: "none",
};
const selStyle: React.CSSProperties = { ...inp, fontFamily: "inherit", cursor: "pointer" };

function FLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
    </label>
  );
}

/* ── Script card ── */
function ScriptCard({ title, subtitle, color, code, filename }: {
  title: string; subtitle: string; color: string; code: string; filename: string;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };

  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.875rem 1.125rem", background: `${color}08` }}>
        <FileCode2 size={16} style={{ color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "0.8625rem", color: "var(--isp-text)" }}>{title}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", marginTop: "0.15rem" }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0, alignItems: "center" }}>
          <button onClick={copy} style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0.625rem", borderRadius: 7, background: copied ? `${color}18` : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? color + "55" : "rgba(255,255,255,0.12)"}`, color: copied ? color : "var(--isp-text-muted)", fontWeight: 700, fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={() => dl(code, filename)} style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0.625rem", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--isp-text-muted)", fontWeight: 700, fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit" }}>
            <Download size={11} /> .rsc
          </button>
          <button onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", padding: "0.3rem 0.45rem", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>
      {open && (
        <pre style={{ margin: 0, padding: "0.875rem 1.125rem", background: "#080c10", fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.7, color: "#94a3b8", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflow: "auto" }}>
          {code.split("\n").map((line, i) => {
            let c2 = "#94a3b8";
            if (line.trim().startsWith("#")) c2 = "#475569";
            else if (line.trim().startsWith("/")) c2 = "#22d3ee";
            else if (line.includes("=")) c2 = "#a78bfa";
            return <span key={i} style={{ display: "block", color: c2 }}>{line}</span>;
          })}
        </pre>
      )}
    </div>
  );
}

/* ══════════════════════════ Sync Log Panel ══════════════════════════ */
function SyncPanel({ logs, ok, error, onClose }: { logs: string[]; ok: boolean | null; error?: string; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  return (
    <div style={{ border: `1px solid ${ok === false ? "rgba(248,113,113,0.3)" : ok === true ? "rgba(74,222,128,0.3)" : "rgba(6,182,212,0.25)"}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.125rem", background: ok === false ? "rgba(248,113,113,0.06)" : ok === true ? "rgba(74,222,128,0.06)" : "rgba(6,182,212,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {ok === null && <Loader2 size={14} style={{ color: "#22d3ee", animation: "spin 1s linear infinite" }} />}
          {ok === true && <CheckCircle2 size={14} style={{ color: "#4ade80" }} />}
          {ok === false && <AlertTriangle size={14} style={{ color: "#f87171" }} />}
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: ok === false ? "#f87171" : ok === true ? "#4ade80" : "#22d3ee" }}>
            {ok === null ? "Syncing…" : ok === true ? "Sync Complete" : "Sync Failed"}
          </span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0.25rem 0.5rem", borderRadius: 5 }}>✕ close</button>
      </div>
      {error && (
        <div style={{ padding: "0.625rem 1.125rem", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.15)", fontSize: "0.75rem", color: "#f87171", lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      <div style={{ padding: "0.75rem 1.125rem", background: "#080c10", maxHeight: 260, overflow: "auto", fontFamily: "monospace", fontSize: "0.73rem", lineHeight: 1.75 }}>
        {logs.map((line, i) => {
          const c2 = line.startsWith("✅") ? "#4ade80"
            : line.startsWith("❌") ? "#f87171"
            : line.startsWith("✓") ? "#a3e635"
            : line.startsWith("▶") ? "#22d3ee"
            : line.startsWith("  ") ? "#64748b"
            : "#94a3b8";
          return <div key={i} style={{ color: c2 }}>{line || " "}</div>;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ══════════════════════════ Main page ══════════════════════════ */
export default function SelfInstall() {
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ logs: string[]; ok: boolean; error?: string } | null>(null);
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const upd = (k: keyof Cfg) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCfg(c => ({ ...c, [k]: e.target.value }));

  /* ── Load routers from Supabase ── */
  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_si"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouter[];
    },
  });

  /* Auto-populate cfg from selected router */
  const selectedRouter = routers.find(r => r.id === selectedRouterId) ?? null;
  const handleRouterChange = (id: number) => {
    setSelectedRouterId(id);
    setSyncResult(null);
    const r = routers.find(x => x.id === id);
    if (r) {
      setCfg(c => ({
        ...c,
        routerName: r.name.replace(/\s+/g, "-").toLowerCase(),
        radiusSecret: r.router_secret ?? c.radiusSecret,
      }));
    }
  };

  /* ── Sync handler ── */
  const handleSync = async () => {
    if (!selectedRouter) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     selectedRouter.host,
          username: selectedRouter.router_username || "admin",
          password: selectedRouter.router_secret  || "",
          cfg: {
            routerName:     cfg.routerName,
            hotspotIp:      cfg.hotspotIp,
            dnsName:        cfg.dnsName,
            radiusIp:       cfg.radiusIp,
            radiusSecret:   cfg.radiusSecret,
            bridgeInterface:cfg.bridgeInterface,
            poolStart:      cfg.poolStart,
            poolEnd:        cfg.poolEnd,
            profileName:    cfg.profileName,
          },
        }),
      });
      const data = await res.json() as { ok: boolean; logs: string[]; error?: string };
      setSyncResult(data);
    } catch (err) {
      setSyncResult({ ok: false, logs: [], error: String(err) });
    } finally {
      setSyncing(false);
    }
  };

  const scripts = [
    { title: "Script 1 — Hotspot Setup",      subtitle: "Creates hotspot profile, pool and server. Paste in MikroTik Terminal.",     color: "#06b6d4", code: makeScript1(cfg),             filename: `ochola-${cfg.routerName}-setup.rsc`  },
    { title: "Script 2 — RADIUS & Firewall",  subtitle: "Adds RADIUS client, NAT redirect, and firewall rules. Upload then /import.", color: "#8b5cf6", code: makeScript2(cfg),             filename: `ochola-${cfg.routerName}-radius.rsc` },
    { title: "All-in-One Script",             subtitle: "Script 1 + Script 2 combined. Run once to configure everything.",            color: "#f59e0b", code: makeAllInOne(cfg),            filename: `ochola-${cfg.routerName}-all.rsc`    },
    { title: "Create All Hotspot Files",      subtitle: "Creates 11 portal files (HTML, CSS, JS, SVG, JSON) on the router. Upload then /import.", color: "#f97316", code: makeCreateAllFilesScript(cfg), filename: `create-hotspot-files-${cfg.routerName}.rsc` },
  ];

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Self Install</h1>
        <NetworkTabs active="self-install" />

        {/* ─── Sync bar ─── */}
        <div style={{ background: "linear-gradient(135deg,rgba(6,182,212,0.08),rgba(6,182,212,0.03))", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 14, padding: "1rem 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <Wifi size={18} style={{ color: "#22d3ee", flexShrink: 0 }} />
            <div style={{ flex: "1 1 220px" }}>
              <div style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--isp-text)", marginBottom: "0.15rem" }}>Sync to Router</div>
              <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Select a router and push the hotspot configuration directly via the MikroTik API — no terminal copy-paste needed.</div>
            </div>
            <select
              value={selectedRouterId ?? ""}
              onChange={e => handleRouterChange(Number(e.target.value))}
              style={{ ...selStyle, flex: "1 1 200px", maxWidth: 280 }}
            >
              <option value="" disabled>Select router…</option>
              {routers.map(r => (
                <option key={r.id} value={r.id}>{r.name} — {r.host} {r.status === "online" ? "🟢" : "🔴"}</option>
              ))}
            </select>
            <button
              onClick={handleSync}
              disabled={syncing || !selectedRouter}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1.375rem", borderRadius: 10, background: syncing || !selectedRouter ? "rgba(6,182,212,0.1)" : "linear-gradient(135deg,#06b6d4,#0284c7)", border: "none", color: syncing || !selectedRouter ? "#94a3b8" : "white", fontWeight: 800, fontSize: "0.875rem", cursor: syncing || !selectedRouter ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: syncing || !selectedRouter ? "none" : "0 4px 12px rgba(6,182,212,0.3)", transition: "all 0.2s", whiteSpace: "nowrap" }}
            >
              {syncing
                ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Syncing…</>
                : <><RefreshCw size={15} /> Sync Now</>
              }
            </button>
          </div>
          {selectedRouter && (
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(6,182,212,0.12)", display: "flex", gap: "1.5rem", fontSize: "0.73rem", color: "var(--isp-text-muted)", flexWrap: "wrap" }}>
              {[["Host", selectedRouter.host], ["API User", selectedRouter.router_username || "admin"], ["Secret", selectedRouter.router_secret ? "••••••••" : "—"], ["ROS", selectedRouter.ros_version], ["Port", "8728"]].map(([k, v]) => (
                <span key={k}><span style={{ fontWeight: 700, color: "#22d3ee" }}>{k}:</span> <span style={{ fontFamily: "monospace" }}>{v}</span></span>
              ))}
            </div>
          )}
        </div>

        {/* ─── Sync result ─── */}
        {(syncing || syncResult) && (
          <SyncPanel
            logs={syncResult?.logs ?? (syncing ? ["▶ Connecting…"] : [])}
            ok={syncResult ? syncResult.ok : null}
            error={syncResult?.error}
            onClose={() => setSyncResult(null)}
          />
        )}

        {/* ─── Config form ─── */}
        <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", fontSize: "0.7rem", fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Router Configuration — scripts update live as you type
          </div>
          <div style={{ padding: "1.25rem", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.875rem" }}>
            <FLabel label="Router Name"><input style={inp} value={cfg.routerName} onChange={upd("routerName")} placeholder="router1" /></FLabel>
            <FLabel label="Hotspot IP Address"><input style={inp} value={cfg.hotspotIp} onChange={upd("hotspotIp")} placeholder="192.168.1.1" /></FLabel>
            <FLabel label="Bridge Interface"><input style={inp} value={cfg.bridgeInterface} onChange={upd("bridgeInterface")} placeholder="bridge1" /></FLabel>
            <FLabel label="IP Pool Start"><input style={inp} value={cfg.poolStart} onChange={upd("poolStart")} placeholder="192.168.2.2" /></FLabel>
            <FLabel label="IP Pool End"><input style={inp} value={cfg.poolEnd} onChange={upd("poolEnd")} placeholder="192.168.2.254" /></FLabel>
            <FLabel label="DNS / Portal Name"><input style={inp} value={cfg.dnsName} onChange={upd("dnsName")} placeholder="hotspot.myisp.com" /></FLabel>
            <FLabel label="RADIUS IP"><input style={inp} value={cfg.radiusIp} onChange={upd("radiusIp")} placeholder="10.0.0.1" /></FLabel>
            <FLabel label="RADIUS Secret"><input style={inp} value={cfg.radiusSecret} onChange={upd("radiusSecret")} placeholder="supersecret" /></FLabel>
            <FLabel label="Profile Name"><input style={inp} value={cfg.profileName} onChange={upd("profileName")} placeholder="hsprof1" /></FLabel>
            <FLabel label="Portal Title"><input style={{ ...inp, fontFamily: "inherit" }} value={cfg.portalTitle} onChange={upd("portalTitle")} placeholder="OcholaSupernet" /></FLabel>
            <FLabel label="Hotspot SSID"><input style={{ ...inp, fontFamily: "inherit" }} value={cfg.hotspotSsid} onChange={upd("hotspotSsid")} placeholder="OcholaNet-WiFi" /></FLabel>
          </div>
        </div>

        {/* ─── Script cards ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {scripts.map(s => <ScriptCard key={s.title} {...s} />)}
        </div>

        {/* ─── How to apply ─── */}
        <div style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)", borderRadius: 12, padding: "1rem 1.25rem" }}>
          <div style={{ fontWeight: 700, color: "#22d3ee", fontSize: "0.8rem", marginBottom: "0.5rem" }}>How to apply scripts to your MikroTik</div>
          <ol style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {[
              "Use Sync Now (above) for automatic push via MikroTik API — requires port 8728 to be open",
              "Or: fill the config fields → Copy a script → open Winbox Terminal → paste directly",
              "For larger scripts: Download .rsc → Winbox Files → Upload → /import file-name=filename.rsc",
              "Order: Script 1 first, then Script 2. All-in-One does both at once",
              "Create All Hotspot Files deploys the branded login portal (run last)",
            ].map((s, i) => (
              <li key={i} style={{ fontSize: "0.77rem", color: "var(--isp-text-muted)" }}>{s}</li>
            ))}
          </ol>
        </div>
      </div>
    </AdminLayout>
  );
}
