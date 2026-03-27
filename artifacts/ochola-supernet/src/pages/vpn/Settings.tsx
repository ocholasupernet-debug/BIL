import { useState } from "react";
import VpnLayout from "./VpnLayout";
import {
  User, Lock, Shield, Key, Bell, Palette, Wifi,
  Eye, EyeOff, Copy, Check, Trash2, Plus, Upload,
  Smartphone, Mail, Globe, Clock, Monitor, Sun, Moon,
  ChevronRight, AlertTriangle, CheckCircle2, ToggleLeft,
  Terminal, RefreshCw, LogOut, Download, QrCode,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-blue-600" : "bg-gray-300"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-800">{title}</h3>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function SaveBtn({ label = "Save Changes" }: { label?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }}
      className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${saved ? "bg-green-600 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
    >
      {saved ? <><Check size={14} /> Saved!</> : label}
    </button>
  );
}

// ── Tab components ────────────────────────────────────────────────────────

function ProfileTab() {
  const [showPass, setShowPass] = useState(false);
  const [showNew, setShowNew] = useState(false);
  return (
    <div className="space-y-5">
      <Section title="Personal Information" desc="Your name and contact details shown on this portal">
        <div className="flex items-center gap-5 pb-2">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xl font-black shrink-0">CO</div>
          <div>
            <p className="font-semibold text-gray-800">Chrisphine Ochola</p>
            <p className="text-xs text-gray-400 mt-0.5">chrisphine@isplatty.org</p>
            <button className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
              <Upload size={12} /> Change Avatar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First Name">
            <input defaultValue="Chrisphine" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Last Name">
            <input defaultValue="Ochola" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Email Address">
            <input defaultValue="chrisphine@isplatty.org" type="email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Phone Number" hint="Used for SMS alerts and 2FA">
            <input defaultValue="+254 712 345 678" type="tel" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Organization / ISP Name">
            <input defaultValue="isplatty.org" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
          <Field label="Country">
            <select defaultValue="KE" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="KE">Kenya 🇰🇪</option>
              <option value="UG">Uganda 🇺🇬</option>
              <option value="TZ">Tanzania 🇹🇿</option>
              <option value="NG">Nigeria 🇳🇬</option>
              <option value="GH">Ghana 🇬🇭</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end pt-2">
          <SaveBtn />
        </div>
      </Section>

      <Section title="Change Password" desc="Use a strong password of at least 12 characters">
        <div className="space-y-3 max-w-md">
          <Field label="Current Password">
            <div className="relative">
              <input type={showPass ? "text" : "password"} placeholder="••••••••••••" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
          <Field label="New Password">
            <div className="relative">
              <input type={showNew ? "text" : "password"} placeholder="••••••••••••" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
          <Field label="Confirm New Password">
            <input type="password" placeholder="••••••••••••" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </Field>
        </div>
        <div className="flex justify-start pt-1">
          <SaveBtn label="Update Password" />
        </div>
      </Section>
    </div>
  );
}

function SecurityTab() {
  const [twoFa, setTwoFa] = useState(false);
  const [loginAlerts, setLoginAlerts] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const API_KEY = "sk_live_ochola_abc123def456ghi789jkl012mno";
  const SESSIONS = [
    { id: 1, device: "Chrome — Windows 11",    ip: "197.232.14.5",   location: "Nairobi, KE",  time: "Now",           current: true  },
    { id: 2, device: "Safari — iPhone 14 Pro", ip: "197.232.14.6",   location: "Nairobi, KE",  time: "2h ago",        current: false },
    { id: 3, device: "WireGuard App — Android",ip: "41.90.100.12",   location: "Mombasa, KE",  time: "Yesterday",     current: false },
  ];

  function copyKey() {
    navigator.clipboard.writeText(API_KEY);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="space-y-5">
      {/* 2FA */}
      <Section title="Two-Factor Authentication" desc="Add an extra layer of protection to your account">
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-semibold text-gray-700">Authenticator App (TOTP)</p>
            <p className="text-xs text-gray-400 mt-0.5">Use Google Authenticator, Authy, or any TOTP app</p>
          </div>
          <Toggle on={twoFa} onChange={setTwoFa} />
        </div>
        {twoFa && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-2">
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 bg-white border-2 border-blue-200 rounded-xl flex items-center justify-center shrink-0">
                <QrCode size={40} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800 mb-1">Scan this QR code</p>
                <p className="text-xs text-blue-700 mb-2">Open your authenticator app and scan the QR code to link it to your account.</p>
                <p className="text-[11px] text-blue-600 font-mono bg-white/70 rounded px-2 py-1">JBSWY3DPEHPK3PXP (manual entry)</p>
                <div className="mt-3 flex gap-2">
                  <input placeholder="Enter 6-digit code" className="border border-blue-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36" />
                  <button className="bg-blue-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-700">Verify</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between py-1 border-t pt-4">
          <div>
            <p className="text-sm font-semibold text-gray-700">SMS Verification</p>
            <p className="text-xs text-gray-400 mt-0.5">Receive a code via SMS to +254 712 345 678</p>
          </div>
          <Toggle on={false} onChange={() => {}} />
        </div>
      </Section>

      {/* Login alerts */}
      <Section title="Login & Security Alerts" desc="Get notified when your account is accessed">
        {[
          { label: "New device login alert",      desc: "Email me when a new device signs in",            val: loginAlerts, fn: setLoginAlerts },
          { label: "Failed login attempt alert",  desc: "Alert me on repeated failed login attempts",     val: true,        fn: () => {} },
          { label: "VPN key access notification", desc: "Notify me when a VPN config is downloaded",      val: false,       fn: () => {} },
        ].map((item, i) => (
          <div key={i} className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-semibold text-gray-700">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
      </Section>

      {/* Active sessions */}
      <Section title="Active Sessions" desc="Devices currently signed into your account — revoke any you don't recognise">
        <div className="space-y-3">
          {SESSIONS.map(s => (
            <div key={s.id} className={`flex items-center justify-between rounded-xl px-4 py-3 ${s.current ? "bg-blue-50 border border-blue-200" : "bg-gray-50 border border-gray-200"}`}>
              <div className="flex items-center gap-3">
                <Monitor size={18} className={s.current ? "text-blue-600" : "text-gray-400"} />
                <div>
                  <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    {s.device}
                    {s.current && <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">This device</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.ip} · {s.location} · {s.time}</p>
                </div>
              </div>
              {!s.current && (
                <button className="text-red-400 hover:text-red-600 text-xs font-semibold flex items-center gap-1 transition-colors">
                  <LogOut size={12} /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1.5 transition-colors">
          <LogOut size={13} /> Sign out all other sessions
        </button>
      </Section>

      {/* API Key */}
      <Section title="API Key" desc="Use this key to integrate with the isplatty.org API from your own applications">
        <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-4 py-3">
          <Key size={14} className="text-gray-400 shrink-0" />
          <span className="flex-1 font-mono text-xs text-gray-600 truncate">
            {showApiKey ? API_KEY : "sk_live_ochola_•••••••••••••••••••••••••••••"}
          </span>
          <button onClick={() => setShowApiKey(v => !v)} className="text-gray-400 hover:text-gray-600 p-1">
            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={copyKey} className="text-gray-400 hover:text-blue-600 p-1">
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="flex gap-3 pt-1">
          <button className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
            <RefreshCw size={12} /> Regenerate Key
          </button>
          <span className="text-gray-300">|</span>
          <button className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:underline">
            <Download size={12} /> Download SDK
          </button>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
          Regenerating your API key will immediately invalidate the current one. Any integrations using the old key will stop working.
        </div>
      </Section>
    </div>
  );
}

function VpnPreferencesTab() {
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [killSwitch, setKillSwitch]       = useState(false);
  const [splitTunnel, setSplitTunnel]     = useState(false);
  const [lanAccess, setLanAccess]         = useState(true);
  const [proto, setProto]                 = useState("wireguard");
  const [dns, setDns]                     = useState("cloudflare");
  const [customDns, setCustomDns]         = useState("");
  const [server, setServer]               = useState("ke1");

  return (
    <div className="space-y-5">
      <Section title="Default VPN Protocol" desc="Used when creating new VPN accounts">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { id: "wireguard", label: "WireGuard",   badge: "Fastest",       color: "border-purple-400 bg-purple-50" },
            { id: "openvpn",   label: "OpenVPN",     badge: "Compatible",    color: "border-orange-400 bg-orange-50" },
            { id: "ikev2",     label: "IKEv2/IPSec", badge: "Mobile Best",   color: "border-teal-400 bg-teal-50" },
          ].map(p => (
            <button key={p.id} onClick={() => setProto(p.id)}
              className={`relative border-2 rounded-xl p-4 text-left transition-all ${proto === p.id ? p.color : "border-gray-200 hover:border-gray-300"}`}>
              {proto === p.id && <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center"><Check size={11} className="text-white" /></div>}
              <p className="font-bold text-gray-800 text-sm">{p.label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{p.badge}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Default VPN Server" desc="Preferred server location for new VPN accounts">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { id: "ke1", label: "Nairobi — ke1.vpn.isplatty.org",  flag: "🇰🇪", ping: "12ms"  },
            { id: "ke2", label: "Mombasa — ke2.vpn.isplatty.org",  flag: "🇰🇪", ping: "22ms"  },
            { id: "ksm", label: "Kisumu  — ksm.vpn.isplatty.org",  flag: "🇰🇪", ping: "30ms"  },
            { id: "nkr", label: "Nakuru  — nkr.vpn.isplatty.org",  flag: "🇰🇪", ping: "28ms"  },
          ].map(s => (
            <button key={s.id} onClick={() => setServer(s.id)}
              className={`flex items-center justify-between border-2 rounded-xl px-4 py-3 text-sm transition-all ${server === s.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
              <span className="flex items-center gap-2 font-medium text-gray-700">{s.flag} {s.label}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${server === s.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500"}`}>{s.ping}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="DNS Settings" desc="DNS servers used when the VPN is active">
        <div className="space-y-2">
          {[
            { id: "cloudflare", label: "Cloudflare",  desc: "1.1.1.1 · 1.0.0.1 — Fast & private"         },
            { id: "google",     label: "Google",      desc: "8.8.8.8 · 8.8.4.4 — Reliable & global"       },
            { id: "custom",     label: "Custom DNS",  desc: "Use your own DNS server (e.g. your MikroTik)" },
          ].map(d => (
            <div key={d.id} onClick={() => setDns(d.id)}
              className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${dns === d.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${dns === d.id ? "border-blue-600 bg-blue-600" : "border-gray-300"}`}>
                {dns === d.id && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">{d.label}</p>
                <p className="text-xs text-gray-500">{d.desc}</p>
              </div>
            </div>
          ))}
          {dns === "custom" && (
            <input value={customDns} onChange={e => setCustomDns(e.target.value)}
              placeholder="e.g. 192.168.1.1 or 10.0.0.1"
              className="w-full mt-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
          )}
        </div>
      </Section>

      <Section title="Connection Behaviour" desc="How the VPN client behaves on your devices">
        {[
          { label: "Auto-Reconnect",      desc: "Automatically reconnect if the VPN drops",                       val: autoReconnect, fn: setAutoReconnect },
          { label: "Kill Switch",          desc: "Block all internet traffic if VPN disconnects unexpectedly",      val: killSwitch,    fn: setKillSwitch    },
          { label: "Split Tunneling",      desc: "Only route traffic to your ISP network through the VPN",          val: splitTunnel,   fn: setSplitTunnel   },
          { label: "Allow LAN Access",     desc: "Keep access to local network devices while VPN is connected",     val: lanAccess,     fn: setLanAccess     },
        ].map((item, i) => (
          <div key={i} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t" : ""}`}>
            <div>
              <p className="text-sm font-semibold text-gray-700">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <SaveBtn label="Save VPN Preferences" />
        </div>
      </Section>
    </div>
  );
}

function SshKeysTab() {
  const [keys, setKeys] = useState([
    { id: 1, name: "MacBook Pro (Work)", fingerprint: "SHA256:abc123xyz...def", added: "2026-01-15", last: "Mar 20, 2026" },
    { id: 2, name: "Ubuntu Server",     fingerprint: "SHA256:qrs456uvw...ghi", added: "2026-02-10", last: "Mar 18, 2026" },
  ]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey]   = useState("");

  function addKey() {
    if (!newName || !newKey) return;
    setKeys(k => [...k, { id: Date.now(), name: newName, fingerprint: "SHA256:new..." + Date.now(), added: new Date().toISOString().split("T")[0], last: "Never" }]);
    setNewName(""); setNewKey(""); setShowAdd(false);
  }

  return (
    <div className="space-y-5">
      <Section title="SSH Public Keys" desc="Public keys authorized for passwordless SSH access to your MikroTik routers">
        <div className="space-y-3">
          {keys.map(k => (
            <div key={k.id} className="flex items-start justify-between bg-gray-50 rounded-xl border border-gray-200 px-4 py-3 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
                  <Terminal size={15} className="text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">{k.name}</p>
                  <p className="text-xs font-mono text-gray-400 mt-0.5">{k.fingerprint}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Added {k.added} · Last used {k.last}</p>
                </div>
              </div>
              <button onClick={() => setKeys(ks => ks.filter(x => x.id !== k.id))}
                className="text-red-400 hover:text-red-600 transition-colors p-1 shrink-0">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {keys.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <Terminal size={32} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No SSH keys added yet.</p>
            </div>
          )}
        </div>

        {showAdd ? (
          <div className="border-2 border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3 mt-2">
            <p className="text-sm font-bold text-blue-800">Add New SSH Key</p>
            <Field label="Key Name" hint="e.g. MacBook Pro or Ubuntu Dev Server">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My Laptop"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </Field>
            <Field label="Public Key" hint="Paste your SSH public key — starts with ssh-rsa, ssh-ed25519, or ecdsa-sha2">
              <textarea value={newKey} onChange={e => setNewKey(e.target.value)} rows={3}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... user@hostname"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </Field>
            <div className="flex gap-2">
              <button onClick={addKey} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                <Check size={13} /> Add Key
              </button>
              <button onClick={() => setShowAdd(false)} className="text-gray-500 text-sm font-semibold px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 border-2 border-dashed border-gray-300 hover:border-blue-400 text-gray-500 hover:text-blue-600 rounded-xl px-4 py-3 text-sm font-semibold transition-colors w-full justify-center">
            <Plus size={15} /> Add SSH Key
          </button>
        )}

        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-xs text-gray-500">
          <p className="font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><Key size={12} /> How to generate an SSH key pair</p>
          <p className="font-mono bg-white border rounded px-2 py-1.5 mt-1 text-gray-600">ssh-keygen -t ed25519 -C "your@email.com"</p>
          <p className="mt-1.5">Then copy the contents of <span className="font-mono">~/.ssh/id_ed25519.pub</span> and paste above.</p>
        </div>
      </Section>
    </div>
  );
}

function NotificationsTab() {
  const [email, setEmail]     = useState(true);
  const [sms, setSms]         = useState(false);
  const [expiry, setExpiry]   = useState(true);
  const [maint, setMaint]     = useState(true);
  const [billing, setBilling] = useState(true);
  const [newVpn, setNewVpn]   = useState(false);
  const [digest, setDigest]   = useState("weekly");

  return (
    <div className="space-y-5">
      <Section title="Notification Channels" desc="How you want to receive notifications">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><Mail size={16} className="text-blue-600" /></div>
              <div>
                <p className="text-sm font-semibold text-gray-700">Email Notifications</p>
                <p className="text-xs text-gray-400">chrisphine@isplatty.org</p>
              </div>
            </div>
            <Toggle on={email} onChange={setEmail} />
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center"><Smartphone size={16} className="text-green-600" /></div>
              <div>
                <p className="text-sm font-semibold text-gray-700">SMS Notifications</p>
                <p className="text-xs text-gray-400">+254 712 345 678</p>
              </div>
            </div>
            <Toggle on={sms} onChange={setSms} />
          </div>
        </div>
      </Section>

      <Section title="Notification Types" desc="Choose which events you want to be notified about">
        {[
          { label: "VPN Expiry Reminders",     desc: "7 and 1 day before a VPN account expires",           val: expiry,  fn: setExpiry  },
          { label: "Maintenance Announcements",desc: "Scheduled downtime and server maintenance alerts",    val: maint,   fn: setMaint   },
          { label: "Billing & Subscription",   desc: "Payment receipts, plan upgrades, renewal reminders", val: billing, fn: setBilling },
          { label: "New VPN Account Created",  desc: "Notify me when a VPN is created under my ISP",       val: newVpn,  fn: setNewVpn  },
        ].map((item, i) => (
          <div key={i} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t" : ""}`}>
            <div>
              <p className="text-sm font-semibold text-gray-700">{item.label}</p>
              <p className="text-xs text-gray-400">{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
      </Section>

      <Section title="Activity Digest" desc="Receive a summary of your VPN and router activity">
        <div className="flex gap-3 flex-wrap">
          {["daily", "weekly", "monthly", "never"].map(d => (
            <button key={d} onClick={() => setDigest(d)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize border transition-colors ${digest === d ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-2">
          <SaveBtn label="Save Notification Settings" />
        </div>
      </Section>
    </div>
  );
}

function AppearanceTab() {
  const [theme, setTheme]   = useState("light");
  const [lang, setLang]     = useState("en");
  const [tz, setTz]         = useState("Africa/Nairobi");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");
  const [density, setDensity] = useState("comfortable");

  return (
    <div className="space-y-5">
      <Section title="Theme" desc="Choose how the portal looks">
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: "light",  label: "Light",  icon: Sun,     preview: "bg-white border-gray-300"  },
            { id: "dark",   label: "Dark",   icon: Moon,    preview: "bg-gray-900 border-gray-700"},
            { id: "system", label: "System", icon: Monitor, preview: "bg-gradient-to-r from-white to-gray-900 border-gray-400" },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTheme(t.id)}
                className={`border-2 rounded-xl p-4 text-center transition-all ${theme === t.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                <div className={`w-full h-10 rounded-lg mb-2 border ${t.preview}`} />
                <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-gray-700">
                  <Icon size={13} /> {t.label}
                </div>
                {theme === t.id && <div className="mt-1 text-[10px] font-bold text-blue-600 flex items-center justify-center gap-1"><Check size={10} /> Active</div>}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Language & Region" desc="Localisation settings">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Language">
            <select value={lang} onChange={e => setLang(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="en">English</option>
              <option value="sw">Swahili</option>
              <option value="fr">French</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select value={tz} onChange={e => setTz(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="Africa/Nairobi">Africa/Nairobi (EAT +3)</option>
              <option value="Africa/Lagos">Africa/Lagos (WAT +1)</option>
              <option value="UTC">UTC ±0</option>
              <option value="Europe/London">Europe/London (GMT)</option>
            </select>
          </Field>
          <Field label="Date Format">
            <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>DD/MM/YYYY</option>
              <option>MM/DD/YYYY</option>
              <option>YYYY-MM-DD</option>
            </select>
          </Field>
          <Field label="Time Format">
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>12-hour (2:30 PM)</option>
              <option>24-hour (14:30)</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Display Density" desc="Control spacing and information density across the portal">
        <div className="flex gap-3">
          {[
            { id: "compact",      label: "Compact",      desc: "More info, less space"   },
            { id: "comfortable",  label: "Comfortable",  desc: "Balanced — default"      },
            { id: "spacious",     label: "Spacious",     desc: "Easier to read"          },
          ].map(d => (
            <button key={d.id} onClick={() => setDensity(d.id)}
              className={`flex-1 border-2 rounded-xl p-3 text-center transition-all ${density === d.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
              <p className="text-sm font-bold text-gray-800">{d.label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{d.desc}</p>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-2">
          <SaveBtn label="Save Appearance" />
        </div>
      </Section>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────

const TABS = [
  { id: "profile",      label: "Profile",          icon: User,     badge: null },
  { id: "security",     label: "Security",         icon: Shield,   badge: null },
  { id: "vpn",          label: "VPN Preferences",  icon: Wifi,     badge: null },
  { id: "ssh",          label: "SSH Keys",         icon: Terminal, badge: "2"  },
  { id: "notifications",label: "Notifications",    icon: Bell,     badge: null },
  { id: "appearance",   label: "Appearance",       icon: Palette,  badge: null },
];

export default function VpnSettings() {
  const [tab, setTab] = useState("profile");
  const current = TABS.find(t => t.id === tab)!;

  return (
    <VpnLayout breadcrumb="Settings">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Lock size={20} className="text-gray-500" /> Settings
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your account, security, VPN preferences, and appearance</p>
        </div>

        <div className="flex gap-6 items-start">
          {/* Sidebar */}
          <aside className="w-52 shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden sticky top-28">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left transition-colors border-l-2 ${active ? "border-blue-600 bg-blue-50 text-blue-700 font-semibold" : "border-transparent text-gray-600 hover:bg-gray-50"}`}>
                  <Icon size={15} className={active ? "text-blue-600" : "text-gray-400"} />
                  <span className="flex-1">{t.label}</span>
                  {t.badge && <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{t.badge}</span>}
                </button>
              );
            })}
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {tab === "profile"       && <ProfileTab />}
            {tab === "security"      && <SecurityTab />}
            {tab === "vpn"           && <VpnPreferencesTab />}
            {tab === "ssh"           && <SshKeysTab />}
            {tab === "notifications" && <NotificationsTab />}
            {tab === "appearance"    && <AppearanceTab />}
          </div>
        </div>
      </div>
    </VpnLayout>
  );
}
