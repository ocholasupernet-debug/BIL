import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2, Power, RotateCw, Wifi } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminApiFetch, parseJsonResponse } from "@/lib/api-client";

type AccessConfig = {
  active: boolean;
  speedDownMbps: number;
  speedUpMbps: number;
  dataLimitMb: number;
};

const defaults: AccessConfig = { active: false, speedDownMbps: 2, speedUpMbps: 1, dataLimitMb: 500 };

export default function FreeHotspotAccess() {
  const [config, setConfig] = useState(defaults);
  const [routerCount, setRouterCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await adminApiFetch("/api/customers/free-hotspot-access", { cache: "no-store" });
      const data = await parseJsonResponse<{ error?: string; config?: AccessConfig; routerCount?: number }>(response);
      if (!response.ok || !data.config) throw new Error(data.error || "Free Access settings could not be loaded.");
      setConfig({ ...defaults, ...data.config });
      setRouterCount(Number(data.routerCount) || 0);
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Free Access settings could not be loaded." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const apply = async (action: "activate" | "deactivate") => {
    if (action === "activate" && !window.confirm(
      "Activate Free Access on this ISP's Hotspot routers? Each device will receive the limits shown. Existing free-device allowances will reset; paid Hotspot and PPPoE accounts are not changed.",
    )) return;
    if (action === "deactivate" && !window.confirm(
      "Turn off Free Access and disconnect free-access sessions on this ISP's Hotspot routers? Paid Hotspot and PPPoE accounts are not changed.",
    )) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await adminApiFetch("/api/customers/free-hotspot-access", {
        method: "PUT",
        body: JSON.stringify({ ...config, action }),
      });
      const data = await parseJsonResponse<{ error?: string; config?: AccessConfig; routerCount?: number }>(response);
      if (!response.ok) throw new Error(data.error || "Free Access could not be applied.");
      if (data.config) setConfig({ ...defaults, ...data.config });
      setRouterCount(Number(data.routerCount) || routerCount);
      setNotice({ error: false, text: action === "activate"
        ? "Free Access is active. Device allowances were reset."
        : "Free Access is off. Free sessions were disconnected." });
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Free Access could not be applied." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-300"><Wifi size={17} /> Hotspot access</div>
            <h1 className="text-2xl font-bold tracking-tight">Free Hotspot Access</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Let connected devices request a capped, no-payment Hotspot session. PPPoE and paid Hotspot accounts keep their existing limits.</p>
          </div>
          <Link href="/admin/free-access/device-grant" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Grant one device
          </Link>
        </header>

        {notice && <div role={notice.error ? "alert" : "status"} className={`mb-5 flex items-start gap-2 rounded-xl border p-3 text-sm ${notice.error ? "border-red-400/30 bg-red-950/40 text-red-200" : "border-emerald-400/30 bg-emerald-950/30 text-emerald-200"}`}>
          {notice.error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.text}</span>
        </div>}

        <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-xl sm:p-7">
          {loading ? <div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" size={18} /> Loading settings…</div> : <>
            <div className={`mb-6 flex items-center justify-between rounded-xl border p-4 ${config.active ? "border-emerald-400/30 bg-emerald-950/30" : "border-slate-700 bg-slate-950/50"}`}>
              <div><div className="font-semibold">{config.active ? "Free Access is active" : "Free Access is off"}</div>
                <p className="mt-1 text-xs text-slate-400">Applies to direct Hotspot routers assigned to this ISP ({routerCount} found).</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${config.active ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>{config.active ? "ACTIVE" : "OFF"}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-sm text-slate-300">Download speed (Mbps)
                <input type="number" min="0.1" max="1000" step="0.1" value={config.speedDownMbps} onChange={e => setConfig({ ...config, speedDownMbps: Number(e.target.value) })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" />
              </label>
              <label className="text-sm text-slate-300">Upload speed (Mbps)
                <input type="number" min="0.1" max="1000" step="0.1" value={config.speedUpMbps} onChange={e => setConfig({ ...config, speedUpMbps: Number(e.target.value) })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" />
              </label>
              <label className="text-sm text-slate-300">Data per device (MB)
                <input type="number" min="1" max="102400" step="1" value={config.dataLimitMb} onChange={e => setConfig({ ...config, dataLimitMb: Number(e.target.value) })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white" />
              </label>
            </div>
            <p className="mt-4 rounded-lg bg-slate-950/70 p-3 text-xs leading-5 text-slate-400">Activating starts a fresh allowance for free devices. Turning Free Access off disconnects only accounts tagged by this feature. No payment or paid customer plan is changed.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button disabled={busy} onClick={() => void apply("activate")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <RotateCw size={16} />} Activate and reset
              </button>
              <button disabled={busy} onClick={() => void apply("deactivate")} className="inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-950/50 disabled:opacity-50">
                <Power size={16} /> Turn off / retry disconnect
              </button>
            </div>
          </>}
        </section>
      </main>
    </AdminLayout>
  );
}
