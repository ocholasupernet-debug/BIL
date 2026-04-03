import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Shield, Wifi, ChevronRight, Check,
  Send, User, Clock, Server,
  Key, Eye, EyeOff, Download, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Link } from "wouter";

const API = import.meta.env.VITE_API_BASE ?? "";

function getAdminId() {
  return localStorage.getItem("ochola_admin_id") ?? "1";
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function expiresAt(validity: string): string | null {
  const d = new Date();
  if (validity === "1m")  { d.setMonth(d.getMonth() + 1); return d.toISOString(); }
  if (validity === "3m")  { d.setMonth(d.getMonth() + 3); return d.toISOString(); }
  if (validity === "6m")  { d.setMonth(d.getMonth() + 6); return d.toISOString(); }
  if (validity === "1y")  { d.setFullYear(d.getFullYear() + 1); return d.toISOString(); }
  return null;
}

const VALIDITIES = [
  { label: "1 Month",  value: "1m" },
  { label: "3 Months", value: "3m" },
  { label: "6 Months", value: "6m" },
  { label: "1 Year",   value: "1y" },
  { label: "No expiry",value: "never" },
];

const SERVER_HOST =
  typeof import.meta !== "undefined" && (import.meta.env.VITE_VPN_HOST || import.meta.env.VITE_API_BASE?.replace(/^https?:\/\//, "").split(":")[0])
  || "proxyvpn.isplatty.org";

export default function CreateVpn() {
  const qc = useQueryClient();
  const adminId = getAdminId();

  const [step,     setStep]     = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("ocholasupernet");
  const [notes,    setNotes]    = useState("");
  const [validity, setValidity] = useState("never");
  const [showPass, setShowPass] = useState(false);

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [created,  setCreated]  = useState<{ id: number; username: string } | null>(null);

  function nextStep() { setStep(s => Math.min(s + 1, 2)); }
  function prevStep() { setStep(s => Math.max(s - 1, 1)); }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/vpn/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminId,
          username: slugify(username),
          password,
          notes:    notes.trim() || null,
          expiresAt: expiresAt(validity),
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt);
      }
      const user = await r.json();
      setCreated({ id: user.id, username: user.username });
      qc.invalidateQueries({ queryKey: ["vpn-users"] });
      qc.invalidateQueries({ queryKey: ["vpn-users-list"] });
    } catch (e: any) {
      setError(e.message ?? "Failed to create VPN user");
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <AdminLayout>
        <div className="max-w-lg mx-auto mt-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <Check size={36} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">VPN User Created!</h2>
          <p className="text-gray-500 mb-6">
            <span className="font-semibold text-gray-700 font-mono">{created.username}</span> has been created.
            Download the configuration file and import it into your OpenVPN client.
          </p>
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-left mb-6 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Username</span><span className="font-mono font-semibold">{created.username}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Password</span><span className="font-mono font-semibold">{password}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Protocol</span><span className="font-semibold">OpenVPN / TCP</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Server</span><span className="font-mono font-semibold text-xs">{SERVER_HOST}:1194</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Expires</span><span className="font-semibold">{VALIDITIES.find(v => v.value === validity)?.label}</span></div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 text-left mb-6">
            <p className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={13} /> After downloading</p>
            <ul className="space-y-1 list-disc list-inside leading-relaxed">
              <li>Import the <span className="font-mono">.ovpn</span> into OpenVPN Connect, Tunnelblick, or similar client</li>
              <li>On MikroTik: <span className="font-mono">PPP → Interface → Import → select the .ovpn</span></li>
              <li>Enter username <span className="font-mono font-bold">{created.username}</span> and your password when prompted</li>
            </ul>
          </div>

          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href={`${API}/api/vpn/users/${created.id}/ovpn`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              <Download size={14} /> Download .ovpn
            </a>
            <button
              onClick={() => { setCreated(null); setStep(1); setUsername(""); setPassword("ocholasupernet"); setNotes(""); setValidity("never"); }}
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              Create Another
            </button>
            <Link href="/admin/vpn/list" className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors">
              View All VPN Users
            </Link>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto space-y-6">

        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Send size={20} className="text-amber-500" /> Create VPN User
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Generate OpenVPN credentials for a router or device. The .ovpn config file is generated automatically.
          </p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2">
          {["Credentials", "Review"].map((s, i) => {
            const n = i + 1;
            const isActive = step === n;
            const isDone = step > n;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${isActive ? "bg-blue-600 text-white" : isDone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {isDone ? <Check size={11} /> : <span>{n}</span>}
                  {s}
                </div>
                {i < 1 && <ChevronRight size={14} className="text-gray-300" />}
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Step 1 — Credentials */}
          {step === 1 && (
            <div className="p-6 space-y-4">
              <h2 className="font-bold text-gray-700 flex items-center gap-2"><User size={16} className="text-blue-500" /> VPN Credentials</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username <span className="text-red-400">*</span></label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-400">
                    <User size={14} className="text-gray-400" />
                    <input
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="e.g. router-nairobi or come1"
                      className="flex-1 text-sm font-mono outline-none"
                    />
                  </div>
                  {username && (
                    <p className="text-[11px] text-gray-400 mt-1">Will be saved as: <span className="font-mono font-semibold text-gray-600">{slugify(username)}</span></p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-400">*</span></label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-400">
                    <Key size={14} className="text-gray-400" />
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="flex-1 text-sm font-mono outline-none"
                    />
                    <button onClick={() => setShowPass(v => !v)} className="text-gray-400 hover:text-gray-600">
                      {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Server size={12} /> Notes <span className="text-gray-400 text-xs">(optional)</span></label>
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Nairobi office router, customer Jane"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={12} /> Validity Period</label>
                  <div className="grid grid-cols-5 gap-2">
                    {VALIDITIES.map(v => (
                      <button key={v.value} onClick={() => setValidity(v.value)}
                        className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${validity === v.value ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700">
                <p className="font-semibold mb-1 flex items-center gap-1.5"><Wifi size={12} /> OpenVPN Server</p>
                <p>Connects to <span className="font-mono font-bold">{SERVER_HOST}:1194</span> (TCP). The .ovpn config file will be generated automatically with these credentials.</p>
              </div>
            </div>
          )}

          {/* Step 2 — Review */}
          {step === 2 && (
            <div className="p-6 space-y-5">
              <h2 className="font-bold text-gray-700 flex items-center gap-2"><Check size={16} className="text-green-500" /> Review & Create</h2>
              <div className="bg-gray-50 rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
                {[
                  { label: "Username",   value: slugify(username),                                    icon: User   },
                  { label: "Password",   value: "•".repeat(Math.min(password.length, 16)),            icon: Key    },
                  { label: "Protocol",   value: "OpenVPN / TCP port 1194",                            icon: Wifi   },
                  { label: "Server",     value: `${SERVER_HOST}:1194`,                                icon: Server },
                  { label: "Validity",   value: VALIDITIES.find(v => v.value === validity)?.label ?? "", icon: Clock },
                  ...(notes ? [{ label: "Notes", value: notes, icon: User }] : []),
                ].map(row => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 text-gray-500"><Icon size={14} /> {row.label}</div>
                      <span className="font-semibold text-gray-800 font-mono text-xs">{row.value}</span>
                    </div>
                  );
                })}
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-xs text-green-700">
                <p className="font-semibold mb-1">What happens when you click Create?</p>
                <ul className="space-y-0.5 list-disc list-inside leading-relaxed">
                  <li>Credentials are stored securely in the database</li>
                  <li>Synced to <span className="font-mono">/etc/openvpn/users.db</span> on the VPN server</li>
                  <li>A <span className="font-mono">.ovpn</span> configuration file is generated for download</li>
                </ul>
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Error creating user</p>
                    <p className="mt-0.5">{error}</p>
                    <p className="mt-1 text-red-500">Make sure the <span className="font-mono">isp_vpn_users</span> table exists in Supabase. See VPN Settings → Setup Guide for the SQL.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer nav */}
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <button onClick={prevStep} disabled={step === 1}
              className="px-4 py-2 text-sm font-semibold border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Back
            </button>
            {step < 2
              ? <button onClick={nextStep} disabled={!username || !password}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 disabled:pointer-events-none transition-colors">
                  Review <ChevronRight size={14} />
                </button>
              : <button onClick={handleCreate} disabled={loading}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-60">
                  {loading ? <><RefreshCw size={14} className="animate-spin" /> Creating…</> : <><Send size={14} /> Create VPN User</>}
                </button>
            }
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
