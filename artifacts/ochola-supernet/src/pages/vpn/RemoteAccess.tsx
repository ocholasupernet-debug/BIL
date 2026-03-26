import { useState } from "react";
import VpnLayout from "./VpnLayout";
import {
  Router, Wifi, Terminal, Globe, Key, Eye, EyeOff, Copy, Check,
  RefreshCw, Circle, AlertTriangle, CheckCircle2, Clock, ExternalLink,
  ChevronDown, ChevronUp, ShieldCheck, Cpu, MemoryStick, Signal,
} from "lucide-react";

const ROUTERS = [
  {
    id: 1, name: "Nairobi-HQ-RB4011", ip: "196.201.214.10", localIp: "192.168.1.1",
    model: "RB4011iGS+", os: "RouterOS 7.14", status: "online",
    cpu: 12, ram: 34, uptime: "42d 7h 18m",
    winboxPort: 8291, webfigPort: 443, sshPort: 22, apiPort: 8728,
    user: "admin", pass: "Ochola@2024#",
    webfigUrl: "https://196.201.214.10",
  },
  {
    id: 2, name: "Kisumu-POP-hAP", ip: "196.201.220.55", localIp: "10.10.1.1",
    model: "hAP ac³", os: "RouterOS 7.12", status: "online",
    cpu: 5, ram: 22, uptime: "18d 3h 42m",
    winboxPort: 8291, webfigPort: 80, sshPort: 2222, apiPort: 8728,
    user: "admin", pass: "Kisumu@Pop#22",
    webfigUrl: "http://196.201.220.55",
  },
  {
    id: 3, name: "Nakuru-BTS-CCR", ip: "196.201.230.12", localIp: "10.20.1.1",
    model: "CCR2004-1G-12S+2XS", os: "RouterOS 7.14", status: "offline",
    cpu: 0, ram: 0, uptime: "—",
    winboxPort: 8291, webfigPort: 443, sshPort: 22, apiPort: 8728,
    user: "admin", pass: "Nakuru@CCR#23",
    webfigUrl: "https://196.201.230.12",
  },
];

type Router_ = typeof ROUTERS[number];

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
      <Circle size={6} className={status === "online" ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500"} />
      {status === "online" ? "Online" : "Offline"}
    </span>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); });
  }
  return (
    <button onClick={copy} title={`Copy ${label}`} className="text-gray-400 hover:text-blue-600 transition-colors">
      {done ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  );
}

function RouterCard({ r }: { r: Router_ }) {
  const [showPass, setShowPass] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const online = r.status === "online";

  return (
    <div className={`bg-white rounded-xl shadow-sm border ${online ? "border-gray-200" : "border-red-200"} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${online ? "bg-blue-50" : "bg-red-50"}`}>
            <Router size={20} className={online ? "text-blue-600" : "text-red-400"} />
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">{r.name}</p>
            <p className="text-xs text-gray-400 font-mono">{r.ip}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot status={r.status} />
          <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Quick stats */}
      {online && (
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 text-center">
          <div className="py-3 px-2">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1"><Cpu size={11} /><span className="text-[10px] uppercase tracking-wide">CPU</span></div>
            <p className="font-bold text-gray-700 text-sm">{r.cpu}%</p>
          </div>
          <div className="py-3 px-2">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1"><MemoryStick size={11} /><span className="text-[10px] uppercase tracking-wide">RAM</span></div>
            <p className="font-bold text-gray-700 text-sm">{r.ram}%</p>
          </div>
          <div className="py-3 px-2">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1"><Clock size={11} /><span className="text-[10px] uppercase tracking-wide">Uptime</span></div>
            <p className="font-bold text-gray-700 text-xs">{r.uptime}</p>
          </div>
        </div>
      )}

      {/* Connect buttons */}
      <div className="px-5 py-4 flex flex-wrap gap-2">
        <a
          href={`winbox://${r.ip}:${r.winboxPort}`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none"}`}
        >
          <Router size={12} /> Winbox
        </a>
        <a
          href={online ? r.webfigUrl : "#"}
          target="_blank" rel="noopener noreferrer"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-green-500 hover:bg-green-600 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none"}`}
        >
          <Globe size={12} /> WebFig <ExternalLink size={10} />
        </a>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-gray-700 hover:bg-gray-800 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
          disabled={!online}
          onClick={() => alert(`SSH: ssh ${r.user}@${r.ip} -p ${r.sshPort}`)}
        >
          <Terminal size={12} /> SSH
        </button>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${online ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
          disabled={!online}
        >
          <Signal size={12} /> API
        </button>
      </div>

      {/* Expanded credentials */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Key size={11} /> Credentials</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Username</label>
              <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
                <span className="flex-1 font-mono text-xs text-gray-700">{r.user}</span>
                <CopyBtn text={r.user} label="username" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1">Password</label>
              <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
                <span className="flex-1 font-mono text-xs text-gray-700">{showPass ? r.pass : "•".repeat(r.pass.length)}</span>
                <button onClick={() => setShowPass(v => !v)} className="text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <CopyBtn text={r.pass} label="password" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 text-xs text-gray-500">
            <div><span className="font-medium text-gray-400">Model:</span><br />{r.model}</div>
            <div><span className="font-medium text-gray-400">RouterOS:</span><br />{r.os}</div>
            <div><span className="font-medium text-gray-400">SSH Port:</span><br />{r.sshPort}</div>
            <div><span className="font-medium text-gray-400">API Port:</span><br />{r.apiPort}</div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 mt-2">
            <p className="font-semibold mb-1 flex items-center gap-1"><ShieldCheck size={12} /> VPN Tunnel Required</p>
            <p>Winbox and WebFig are only accessible through the VPN tunnel (vpn.isplatty.org). Make sure your VPN is connected before clicking connect.</p>
            <p className="mt-1 font-mono bg-white/70 rounded px-2 py-1 text-[11px]">ssh {r.user}@{r.ip} -p {r.sshPort}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RemoteAccess() {
  const online = ROUTERS.filter(r => r.status === "online").length;
  const total = ROUTERS.length;

  return (
    <VpnLayout breadcrumb="Remote Access">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Page title + summary */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Wifi size={20} className="text-green-500" /> Remote Access
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage and connect to your MikroTik routers remotely via VPN tunnel</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center bg-white rounded-xl px-4 py-2 shadow-sm border border-gray-200">
              <p className="text-xs text-gray-400 font-medium">Online</p>
              <p className="font-bold text-green-600 text-lg">{online}/{total}</p>
            </div>
            <button className="flex items-center gap-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-lg transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {/* VPN warning banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">VPN Connection Required</p>
            <p className="text-amber-700 text-xs mt-0.5">
              All router management interfaces (Winbox, WebFig, SSH) are protected behind the VPN tunnel.
              Connect to <span className="font-mono font-bold">vpn.isplatty.org</span> before attempting remote access.
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
              <CheckCircle2 size={11} /> VPN Active
            </span>
          </div>
        </div>

        {/* Router cards */}
        <div className="space-y-4">
          {ROUTERS.map(r => <RouterCard key={r.id} r={r} />)}
        </div>

        {/* Info box */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="font-semibold text-gray-700 mb-3 flex items-center gap-2"><Terminal size={15} className="text-gray-500" /> Connection Methods</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded bg-orange-100 flex items-center justify-center shrink-0 mt-0.5"><Router size={12} className="text-orange-500" /></div>
                <div><p className="font-semibold text-gray-700">Winbox</p><p className="text-xs text-gray-500">Native MikroTik Windows/Linux app. Best for full router management.</p></div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded bg-green-100 flex items-center justify-center shrink-0 mt-0.5"><Globe size={12} className="text-green-500" /></div>
                <div><p className="font-semibold text-gray-700">WebFig</p><p className="text-xs text-gray-500">Browser-based management interface, no software install required.</p></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center shrink-0 mt-0.5"><Terminal size={12} className="text-gray-600" /></div>
                <div><p className="font-semibold text-gray-700">SSH</p><p className="text-xs text-gray-500">Command-line access via terminal. Great for scripting and automation.</p></div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center shrink-0 mt-0.5"><Signal size={12} className="text-blue-500" /></div>
                <div><p className="font-semibold text-gray-700">RouterOS API</p><p className="text-xs text-gray-500">Programmatic access for integrations and hotspot management.</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </VpnLayout>
  );
}
