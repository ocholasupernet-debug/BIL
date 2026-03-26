import { useState } from "react";
import VpnLayout from "./VpnLayout";
import {
  Shield, Zap, Wifi, Smartphone, ChevronRight, Check,
  Send, User, Clock, Gauge, Server, Globe,
} from "lucide-react";
import { Link } from "wouter";

const PROTOCOLS = [
  {
    id: "wireguard", name: "WireGuard", badge: "Recommended",
    icon: Zap, color: "border-purple-400 bg-purple-50",
    badgeColor: "bg-purple-500",
    desc: "Fastest and most modern VPN protocol. Ideal for MikroTik routers and high-throughput connections.",
    pros: ["Fastest speeds", "Low latency", "Simple config", "MikroTik native"],
  },
  {
    id: "openvpn", name: "OpenVPN", badge: "Most Compatible",
    icon: Wifi, color: "border-orange-400 bg-orange-50",
    badgeColor: "bg-orange-500",
    desc: "Works through firewalls, compatible with all operating systems and devices.",
    pros: ["All platforms", "Firewall friendly", "Battle-tested", "OpenSource"],
  },
  {
    id: "ikev2", name: "IKEv2 / IPSec", badge: "Mobile Best",
    icon: Smartphone, color: "border-teal-400 bg-teal-50",
    badgeColor: "bg-teal-500",
    desc: "Best choice for smartphones. Auto-reconnects when switching between WiFi and mobile data.",
    pros: ["Auto-reconnect", "iOS/Android native", "Fast handoff", "Secure"],
  },
];

const BANDWIDTHS = ["5 Mbps", "10 Mbps", "20 Mbps", "50 Mbps", "100 Mbps", "Unlimited"];
const VALIDITIES = [
  { label: "1 Month",  value: "1m" },
  { label: "3 Months", value: "3m" },
  { label: "6 Months", value: "6m" },
  { label: "1 Year",   value: "1y" },
];
const SERVERS = [
  { label: "Nairobi (ke1.vpn.isplatty.org)",  value: "ke1" },
  { label: "Mombasa (ke2.vpn.isplatty.org)",  value: "ke2" },
  { label: "Kisumu (ksm.vpn.isplatty.org)",   value: "ksm" },
  { label: "Nakuru (nkr.vpn.isplatty.org)",   value: "nkr" },
];

export default function CreateVpn() {
  const [step, setStep] = useState(1);
  const [protocol, setProtocol]   = useState("wireguard");
  const [vpnName, setVpnName]     = useState("");
  const [owner, setOwner]         = useState("");
  const [bandwidth, setBandwidth] = useState("10 Mbps");
  const [validity, setValidity]   = useState("1m");
  const [server, setServer]       = useState("ke1");
  const [done, setDone]           = useState(false);

  function nextStep() { setStep(s => Math.min(s + 1, 3)); }
  function prevStep() { setStep(s => Math.max(s - 1, 1)); }

  function handleCreate() {
    setDone(true);
  }

  const selectedProto = PROTOCOLS.find(p => p.id === protocol)!;
  const selectedServer = SERVERS.find(s => s.value === server)!;

  if (done) {
    return (
      <VpnLayout breadcrumb="Create VPN">
        <div className="max-w-lg mx-auto mt-10 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <Check size={36} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">VPN Created!</h2>
          <p className="text-gray-500 mb-6">
            <span className="font-semibold text-gray-700">{vpnName || "New VPN"}</span> has been created using <span className="font-semibold text-gray-700">{selectedProto.name}</span>.<br />
            The configuration file is ready to download.
          </p>
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-left mb-6 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Protocol</span><span className="font-semibold">{selectedProto.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Server</span><span className="font-semibold font-mono text-xs">{selectedServer.label.split("(")[1].replace(")", "")}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Bandwidth</span><span className="font-semibold">{bandwidth}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Validity</span><span className="font-semibold">{VALIDITIES.find(v => v.value === validity)?.label}</span></div>
            {owner && <div className="flex justify-between"><span className="text-gray-400">Assigned to</span><span className="font-semibold">{owner}</span></div>}
          </div>
          <div className="flex gap-3 justify-center">
            <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors">
              Download Config
            </button>
            <Link href="/vpn/list" className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors">
              View All VPNs
            </Link>
          </div>
        </div>
      </VpnLayout>
    );
  }

  return (
    <VpnLayout breadcrumb="Create VPN">
      <div className="max-w-2xl mx-auto space-y-6">

        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Send size={20} className="text-amber-500" /> Create New VPN
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Set up a VPN account for remote access to your MikroTik infrastructure</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2">
          {["Protocol", "Details", "Review"].map((s, i) => {
            const n = i + 1;
            const active = step === n; const done_ = step > n;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? "bg-blue-600 text-white" : done_ ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {done_ ? <Check size={11} /> : <span>{n}</span>}
                  {s}
                </div>
                {i < 2 && <ChevronRight size={14} className="text-gray-300" />}
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Step 1 — Protocol */}
          {step === 1 && (
            <div className="p-6 space-y-4">
              <h2 className="font-bold text-gray-700 flex items-center gap-2"><Shield size={16} className="text-blue-500" /> Choose Protocol</h2>
              <div className="space-y-3">
                {PROTOCOLS.map(p => {
                  const Icon = p.icon;
                  const sel = protocol === p.id;
                  return (
                    <button key={p.id} onClick={() => setProtocol(p.id)}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${sel ? p.color : "border-gray-200 hover:border-gray-300"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <Icon size={18} className={sel ? "text-gray-700" : "text-gray-400"} />
                          <span className="font-bold text-gray-800">{p.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${p.badgeColor}`}>{p.badge}</span>
                        </div>
                        {sel && <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center"><Check size={11} className="text-white" /></div>}
                      </div>
                      <p className="text-xs text-gray-500 ml-8">{p.desc}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                        {p.pros.map(pr => (
                          <span key={pr} className="text-[10px] bg-white/80 border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">{pr}</span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 — Details */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              <h2 className="font-bold text-gray-700 flex items-center gap-2"><User size={16} className="text-blue-500" /> VPN Details</h2>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VPN Name <span className="text-red-400">*</span></label>
                  <input value={vpnName} onChange={e => setVpnName(e.target.value)}
                    placeholder="e.g. Kenya-VPN-03"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><User size={12} /> Assign to Customer <span className="text-gray-400 text-xs">(optional)</span></label>
                  <input value={owner} onChange={e => setOwner(e.target.value)}
                    placeholder="Customer name or leave blank for yourself"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Server size={12} /> VPN Server</label>
                    <select value={server} onChange={e => setServer(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {SERVERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Gauge size={12} /> Bandwidth</label>
                    <select value={bandwidth} onChange={e => setBandwidth(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {BANDWIDTHS.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={12} /> Validity Period</label>
                  <div className="grid grid-cols-4 gap-2">
                    {VALIDITIES.map(v => (
                      <button key={v.value} onClick={() => setValidity(v.value)}
                        className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${validity === v.value ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Review */}
          {step === 3 && (
            <div className="p-6 space-y-5">
              <h2 className="font-bold text-gray-700 flex items-center gap-2"><Check size={16} className="text-green-500" /> Review & Create</h2>
              <div className="bg-gray-50 rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
                {[
                  { label: "VPN Name",       value: vpnName || "(unnamed)", icon: Shield },
                  { label: "Protocol",        value: selectedProto.name,    icon: Wifi },
                  { label: "Server",          value: selectedServer.label,  icon: Globe },
                  { label: "Bandwidth",       value: bandwidth,             icon: Gauge },
                  { label: "Validity",        value: VALIDITIES.find(v => v.value === validity)?.label || "", icon: Clock },
                  ...(owner ? [{ label: "Assigned to", value: owner, icon: User }] : []),
                ].map(row => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 text-gray-500"><Icon size={14} /> {row.label}</div>
                      <span className="font-semibold text-gray-800">{row.value}</span>
                    </div>
                  );
                })}
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">
                <p className="font-semibold mb-1">What happens next?</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>A unique VPN key pair will be generated for this account</li>
                  <li>Configuration file (.conf / .ovpn) will be ready to download</li>
                  <li>The VPN will be active immediately on the selected server</li>
                  {owner && <li>An email with setup instructions will be sent to {owner}</li>}
                </ul>
              </div>
            </div>
          )}

          {/* Footer nav */}
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <button onClick={prevStep} disabled={step === 1}
              className="px-4 py-2 text-sm font-semibold border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Back
            </button>
            {step < 3
              ? <button onClick={nextStep} disabled={step === 2 && !vpnName}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 disabled:pointer-events-none transition-colors">
                  Next <ChevronRight size={14} />
                </button>
              : <button onClick={handleCreate}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">
                  <Send size={14} /> Create VPN
                </button>
            }
          </div>
        </div>
      </div>
    </VpnLayout>
  );
}
