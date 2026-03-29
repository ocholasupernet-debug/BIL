import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  ArrowRight, RefreshCw, CheckCircle2, AlertTriangle, Loader2,
  Server, Wifi, Users, Ticket, Settings2, UploadCloud, Eye, EyeOff,
  Database, Check, X, RotateCcw,
} from "lucide-react";

/* ══════════════════════════════ Types ══════════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null;
  ros_version: string | null; model: string | null;
  bridge_interface: string | null; hotspot_dns_name: string | null;
  bridge_ip: string | null;
}
interface DbPlan { id: number; name: string; type: string; speed_down: number; speed_up: number; validity: number; validity_unit: string; shared_users: number; }
interface DbCustomer { id: number; username: string | null; password: string | null; type: string | null; plan_id: number | null; pppoe_username: string | null; mac_address: string | null; ip_address: string | null; }
interface DbPlanMap { [id: number]: string; }

/* ══════════════════════════════ Helpers ══════════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-inner-card,rgba(255,255,255,0.04))",
  border: "1px solid var(--isp-border,rgba(255,255,255,0.1))",
  borderRadius: 8, padding: "0.5rem 0.75rem",
  color: "var(--isp-text,#e2e8f0)", fontSize: "0.8rem",
  fontFamily: "monospace", width: "100%", boxSizing: "border-box", outline: "none",
};
const selStyle: React.CSSProperties = { ...inp, fontFamily: "inherit", cursor: "pointer" };
function FLabel({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--isp-text-muted,#94a3b8)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "0.67rem", color: "var(--isp-text-muted,#94a3b8)", marginTop: "0.1rem" }}>{hint}</span>}
    </label>
  );
}

/* ── Panel card ── */
function Panel({ title, subtitle, icon, color = "#06b6d4", children }: {
  title: string; subtitle: string; icon: React.ReactNode; color?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--isp-section,#1e293b)", border: `1px solid ${color}25`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "0.875rem 1.25rem", background: `${color}08`, borderBottom: `1px solid ${color}18`, display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <div style={{ color }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--isp-text,#e2e8f0)" }}>{title}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted,#94a3b8)", marginTop: "0.1rem" }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ padding: "1.25rem" }}>{children}</div>
    </div>
  );
}

/* ── Log panel ── */
function LogPanel({ logs, ok, error, onClose }: { logs: string[]; ok: boolean | null; error?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  const col = ok === false ? "#f87171" : ok === true ? "#4ade80" : "#22d3ee";
  const bg  = ok === false ? "rgba(248,113,113,0.06)" : ok === true ? "rgba(74,222,128,0.06)" : "rgba(6,182,212,0.05)";
  const border = ok === false ? "rgba(248,113,113,0.3)" : ok === true ? "rgba(74,222,128,0.3)" : "rgba(6,182,212,0.25)";
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.125rem", background: bg }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {ok === null  && <Loader2 size={14} style={{ color: "#22d3ee", animation: "spin 1s linear infinite" }} />}
          {ok === true  && <CheckCircle2 size={14} style={{ color: "#4ade80" }} />}
          {ok === false && <AlertTriangle size={14} style={{ color: "#f87171" }} />}
          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: col }}>
            {ok === null ? "Replacing router…" : ok === true ? "Replacement complete" : "Replacement failed"}
          </span>
        </div>
        <button onClick={onClose} style={{ fontSize: "0.7rem", color: "var(--isp-text-muted,#94a3b8)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem", borderRadius: 5 }}>✕ close</button>
      </div>
      {error && <div style={{ padding: "0.5rem 1.125rem", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.15)", fontSize: "0.75rem", color: "#f87171", lineHeight: 1.5 }}>{error}</div>}
      <div style={{ padding: "0.75rem 1.125rem", background: "#080c10", maxHeight: 340, overflow: "auto", fontFamily: "monospace", fontSize: "0.72rem", lineHeight: 1.8 }}>
        {logs.map((line, i) => {
          const c = line.startsWith("✅") ? "#4ade80" : line.startsWith("❌") ? "#f87171" : line.startsWith("✓") ? "#a3e635" : line.startsWith("▶") ? "#22d3ee" : line.startsWith("★") ? "#f59e0b" : line.startsWith("  ") ? "#64748b" : "#94a3b8";
          return <div key={i} style={{ color: c }}>{line || " "}</div>;
        })}
        <div ref={ref} />
      </div>
    </div>
  );
}

/* ── Option checkbox row ── */
function OptionRow({ checked, onChange, label, sub, count, color = "#06b6d4", icon }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; sub: string; count?: number; color?: string; icon: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem", cursor: "pointer", padding: "0.75rem", borderRadius: 10, background: checked ? `${color}08` : "rgba(255,255,255,0.02)", border: `1px solid ${checked ? color + "30" : "rgba(255,255,255,0.07)"}`, transition: "all 0.15s" }}>
      <div style={{ width: 18, height: 18, borderRadius: 5, background: checked ? color : "transparent", border: `2px solid ${checked ? color : "rgba(255,255,255,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "0.1rem", transition: "all 0.15s" }}>
        {checked && <Check size={11} style={{ color: "white" }} />}
      </div>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color, flexShrink: 0 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text,#e2e8f0)" }}>{label}</span>
          {count !== undefined && (
            <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 20, background: `${color}15`, color, border: `1px solid ${color}30` }}>{count}</span>
          )}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted,#94a3b8)", marginTop: "0.2rem" }}>{sub}</div>
      </div>
    </label>
  );
}

/* ══════════════════════════════ Main page ══════════════════════════════ */
export default function ReplaceRouter() {
  const [, navigate] = useLocation();

  /* ── Router selector ── */
  const [oldRouterId, setOldRouterId] = useState<number | null>(null);

  /* ── New router form ── */
  const [newName,     setNewName]     = useState("");
  const [newHost,     setNewHost]     = useState("");
  const [newUser,     setNewUser]     = useState("admin");
  const [newPass,     setNewPass]     = useState("");
  const [newModel,    setNewModel]    = useState("");
  const [newRos,      setNewRos]      = useState("");
  const [showPass,    setShowPass]    = useState(false);

  /* ── Hotspot config fields (defaults from old router) ── */
  const [hsIp,        setHsIp]        = useState("192.168.1.1");
  const [hsDns,       setHsDns]       = useState("hotspot.myisp.com");
  const [hsBridge,    setHsBridge]    = useState("bridge1");
  const [hsPool,      setHsPool]      = useState("192.168.2.2");
  const [hsPoolEnd,   setHsPoolEnd]   = useState("192.168.2.254");
  const [hsProfile,   setHsProfile]   = useState("hsprof1");
  const [radiusIp,    setRadiusIp]    = useState("10.0.0.1");
  const [radiusSecret,setRadiusSecret]= useState("supersecret");

  /* ── Migration options ── */
  const [doHotspot,   setDoHotspot]   = useState(true);
  const [doPlans,     setDoPlans]     = useState(true);
  const [doCustomers, setDoCustomers] = useState(true);
  const [doVouchers,  setDoVouchers]  = useState(false);
  const [doUpdateDb,  setDoUpdateDb]  = useState(true);

  /* ── Execution state ── */
  const [running,     setRunning]     = useState(false);
  const [logs,        setLogs]        = useState<string[]>([]);
  const [done,        setDone]        = useState<boolean | null>(null);
  const [lastError,   setLastError]   = useState<string | undefined>(undefined);

  /* ── Admin info ── */
  const { data: adminInfo } = useQuery({
    queryKey: ["admin_info", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("name").eq("id", ADMIN_ID).single();
      return data as { name: string } | null;
    },
  });
  const companyName = adminInfo?.name ?? "ISP";

  /* ── Supabase data ── */
  const { data: routers = [] } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_rr"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbRouter[];
    },
  });
  const { data: plans = [] } = useQuery<DbPlan[]>({
    queryKey: ["isp_plans_rr"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_plans").select("id,name,type,speed_down,speed_up,validity,validity_unit,shared_users").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbPlan[];
    },
  });
  const { data: customers = [] } = useQuery<DbCustomer[]>({
    queryKey: ["isp_customers_rr"],
    queryFn: async () => {
      const { data } = await supabase.from("isp_customers").select("id,username,password,type,plan_id,pppoe_username,mac_address,ip_address").eq("admin_id", ADMIN_ID);
      return (data ?? []) as DbCustomer[];
    },
  });
  const { data: vouchers = [] } = useQuery<{ code: string; plan_name: string }[]>({
    queryKey: ["vouchers_rr"],
    queryFn: async () => {
      const { data } = await supabase.from("radcheck").select("username,value").eq("attribute", "Cleartext-Password").order("id", { ascending: false });
      return (data ?? []).map(r => ({ code: r.username, plan_name: "hotspot" }));
    },
  });

  const oldRouter = routers.find(r => r.id === oldRouterId) ?? null;
  const planMap: DbPlanMap = {};
  plans.forEach(p => { planMap[p.id] = p.name; });

  /* Auto-fill from old router when selected */
  useEffect(() => {
    if (!oldRouter) return;
    if (oldRouter.bridge_interface) setHsBridge(oldRouter.bridge_interface);
    if (oldRouter.hotspot_dns_name) setHsDns(oldRouter.hotspot_dns_name);
    if (oldRouter.bridge_ip) setHsIp(oldRouter.bridge_ip.split("/")[0]);
    setNewName(`${oldRouter.name} (new)`);
    setRadiusSecret(oldRouter.router_secret ?? "supersecret");
  }, [oldRouterId]);

  /* Pre-select from URL param ?router=id */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("router");
    if (id) setOldRouterId(Number(id));
  }, []);

  /* ══════════ Execute replacement ══════════ */
  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const handleReplace = async () => {
    if (!oldRouter || !newHost) return;
    setRunning(true); setLogs([]); setDone(null); setLastError(undefined);
    let anyFail = false;

    const postSync = async (endpoint: string, payload: Record<string, unknown>): Promise<{ ok: boolean; logs: string[]; error?: string }> => {
      try {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host: newHost, username: newUser, password: newPass, ...payload }) });
        return await res.json() as { ok: boolean; logs: string[]; error?: string };
      } catch (e) {
        return { ok: false, logs: [], error: String(e) };
      }
    };

    addLog(`★ Starting router replacement`);
    addLog(`  Old: ${oldRouter.name} (${oldRouter.host})`);
    addLog(`  New: ${newName || "new-router"} (${newHost})`);
    addLog(``);

    /* ── 1. Hotspot Config ── */
    if (doHotspot) {
      addLog(`▶ [1/${steps}] Pushing hotspot configuration…`);
      const r = await postSync("/api/admin/sync", {
        cfg: {
          routerName:      (newName || "new-router").replace(/\s+/g, "-").toLowerCase(),
          hotspotIp:       hsIp,
          dnsName:         hsDns,
          radiusIp,
          radiusSecret,
          bridgeInterface: hsBridge,
          poolStart:       hsPool,
          poolEnd:         hsPoolEnd,
          profileName:     hsProfile,
        },
      });
      r.logs.forEach(l => addLog(`  ${l}`));
      if (!r.ok) { addLog(`❌ Hotspot config failed: ${r.error}`); anyFail = true; }
      else addLog(`✅ Hotspot config applied`);
      addLog(``);
    }

    /* ── 2. Plan profiles ── */
    if (doPlans && plans.length > 0) {
      addLog(`▶ [${doHotspot ? 2 : 1}/${steps}] Pushing ${plans.length} service plan profiles…`);
      const r = await postSync("/api/admin/sync/plans", {
        plans: plans.map(p => ({ id: p.id, name: p.name, type: p.type, speed_down: p.speed_down, speed_up: p.speed_up, speed_down_unit: "Mbps", speed_up_unit: "Mbps", validity: p.validity, validity_unit: p.validity_unit, shared_users: p.shared_users })),
      });
      r.logs.forEach(l => addLog(`  ${l}`));
      if (!r.ok) { addLog(`❌ Plans sync failed: ${r.error}`); anyFail = true; }
      else addLog(`✅ Plan profiles applied`);
      addLog(``);
    }

    /* ── 3. Customer accounts ── */
    if (doCustomers && customers.length > 0) {
      addLog(`▶ [${[doHotspot, doPlans].filter(Boolean).length + 1}/${steps}] Pushing ${customers.length} customer accounts…`);
      const r = await postSync("/api/admin/sync/users", {
        users: customers.map(c => ({ username: c.username ?? "", password: "", type: c.type ?? "hotspot", plan_name: c.plan_id ? (planMap[c.plan_id] ?? "default") : "default", pppoe_username: c.pppoe_username ?? undefined, mac_address: c.mac_address ?? undefined, ip_address: c.ip_address ?? undefined, comment: `${companyName} customer #${c.id}` })),
      });
      r.logs.forEach(l => addLog(`  ${l}`));
      if (!r.ok) { addLog(`❌ Customer sync failed: ${r.error}`); anyFail = true; }
      else addLog(`✅ Customer accounts applied`);
      addLog(``);
    }

    /* ── 4. Vouchers ── */
    if (doVouchers && vouchers.length > 0) {
      addLog(`▶ [${[doHotspot, doPlans, doCustomers].filter(Boolean).length + 1}/${steps}] Pushing ${vouchers.length} voucher codes…`);
      const r = await postSync("/api/admin/sync/users", {
        users: vouchers.map(v => ({ username: v.code, password: v.code, type: "voucher", plan_name: v.plan_name, comment: `${companyName} voucher` })),
      });
      r.logs.forEach(l => addLog(`  ${l}`));
      if (!r.ok) { addLog(`❌ Voucher sync failed: ${r.error}`); anyFail = true; }
      else addLog(`✅ Vouchers applied`);
      addLog(``);
    }

    /* ── 5. Update DB record ── */
    if (doUpdateDb) {
      addLog(`▶ [${steps}/${steps}] Updating router record in database…`);
      try {
        const payload: Record<string, string> = {
          name:            newName || oldRouter.name,
          host:            newHost,
          router_username: newUser || "admin",
          updated_at:      new Date().toISOString(),
        };
        if (newPass)  payload.router_secret = newPass;
        if (newModel) payload.model         = newModel;
        if (newRos)   payload.ros_version   = newRos;
        const { error } = await supabase.from("isp_routers").update(payload).eq("id", oldRouter.id);
        if (error) throw error;
        addLog(`✓ Database record updated for '${newName || oldRouter.name}'`);
        addLog(`✅ Database updated`);
      } catch (e) {
        addLog(`❌ DB update failed: ${e instanceof Error ? e.message : String(e)}`);
        anyFail = true;
      }
      addLog(``);
    }

    addLog(anyFail ? `\n❌ Replacement finished with errors` : `\n✅ Router replacement complete!`);
    setDone(!anyFail);
    if (anyFail) setLastError("Some steps failed — check the log above for details.");
    setRunning(false);
  };

  /* Count steps */
  const steps = [doHotspot, doPlans && plans.length > 0, doCustomers && customers.length > 0, doVouchers && vouchers.length > 0, doUpdateDb].filter(Boolean).length;

  const canReplace = !running && !!oldRouter && !!newHost && steps > 0;

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Replace Router</h1>
          <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
            Migrate all configuration from an old/broken router to a new one — hotspot, plans, customers, vouchers, and database record.
          </p>
        </div>

        <NetworkTabs active="replace-router" />

        {/* ── Arrow diagram ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.875rem 1.25rem", background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.12)", borderRadius: 12 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.25rem" }}>Old / Broken Router</div>
            <div style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--isp-text)" }}>{oldRouter ? oldRouter.name : "—"}</div>
            {oldRouter && <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>{oldRouter.host}</div>}
          </div>
          <ArrowRight size={20} style={{ color: "#22d3ee", flexShrink: 0 }} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.25rem" }}>New Router</div>
            <div style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--isp-text)" }}>{newName || "—"}</div>
            {newHost && <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>{newHost}</div>}
          </div>
        </div>

        {/* ══ STEP 1 — Select old router ══ */}
        <Panel title="Step 1 — Select the Router to Replace" subtitle="Choose the old or broken router that will be swapped out." icon={<Server size={16} />} color="#f87171">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.875rem" }}>
            <FLabel label="Old Router">
              <select value={oldRouterId ?? ""} onChange={e => setOldRouterId(Number(e.target.value))} style={selStyle}>
                <option value="" disabled>Select router to replace…</option>
                {routers.map(r => (
                  <option key={r.id} value={r.id}>{r.name} — {r.host} {r.status === "online" ? "🟢" : "🔴"}</option>
                ))}
              </select>
            </FLabel>

            {oldRouter && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.625rem", padding: "0.875rem", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: 10 }}>
                  {[
                    ["Name",    oldRouter.name],
                    ["Host",    oldRouter.host],
                    ["Model",   oldRouter.model ?? "MikroTik"],
                    ["ROS",     oldRouter.ros_version ? `v${oldRouter.ros_version}` : "—"],
                    ["Status",  oldRouter.status],
                    ["API User",oldRouter.router_username || "admin"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</div>
                      <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: "var(--isp-text)", marginTop: "0.15rem" }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Reconfigure button */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 0.875rem", background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10 }}>
                  <RotateCcw size={14} style={{ color: "#fbbf24", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text)" }}>
                      Just want to re-run setup on this router?
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>
                      Use Reconfigure to re-apply the setup script without creating a new router record.
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(`/admin/network/self-install?reconfigure=${oldRouter.id}`)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.375rem",
                      padding: "0.45rem 1.125rem", borderRadius: 7,
                      background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)",
                      color: "#fbbf24", fontWeight: 700, fontSize: "0.8rem",
                      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}
                  >
                    <RotateCcw size={12} /> Reconfigure
                  </button>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* ══ STEP 2 — New router details ══ */}
        <Panel title="Step 2 — New Router Details" subtitle="Connection credentials for the replacement router. Must have API service enabled on port 8728." icon={<Wifi size={16} />} color="#4ade80">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0.875rem" }}>
            <FLabel label="Display Name"><input style={{ ...inp, fontFamily: "inherit" }} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Main Router (new)" /></FLabel>
            <FLabel label="IP Address / Hostname"><input style={inp} value={newHost} onChange={e => setNewHost(e.target.value)} placeholder="e.g. 192.168.1.1 or router.myisp.com" /></FLabel>
            <FLabel label="API Username"><input style={inp} value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="admin" /></FLabel>
            <FLabel label="API Password">
              <div style={{ position: "relative" }}>
                <input type={showPass ? "text" : "password"} style={{ ...inp, paddingRight: "2.5rem" }} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="router password" />
                <button onClick={() => setShowPass(s => !s)} style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: "0.15rem" }}>
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </FLabel>
            <FLabel label="Model (optional)"><input style={{ ...inp, fontFamily: "inherit" }} value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="e.g. RB750Gr3 / CCR1009" /></FLabel>
            <FLabel label="RouterOS Version (optional)"><input style={inp} value={newRos} onChange={e => setNewRos(e.target.value)} placeholder="e.g. 7.14.1" /></FLabel>
          </div>
        </Panel>

        {/* ══ STEP 3 — Hotspot config (shown if doHotspot) ══ */}
        <Panel title="Step 3 — Hotspot Configuration" subtitle="Settings to push to the new router. Auto-filled from the old router record where available." icon={<Settings2 size={16} />} color="#06b6d4">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.875rem" }}>
            <FLabel label="Hotspot IP"><input style={inp} value={hsIp} onChange={e => setHsIp(e.target.value)} placeholder="192.168.1.1" /></FLabel>
            <FLabel label="DNS Name"><input style={{ ...inp, fontFamily: "inherit" }} value={hsDns} onChange={e => setHsDns(e.target.value)} placeholder="hotspot.myisp.com" /></FLabel>
            <FLabel label="Bridge Interface"><input style={inp} value={hsBridge} onChange={e => setHsBridge(e.target.value)} placeholder="bridge1" /></FLabel>
            <FLabel label="IP Pool Start"><input style={inp} value={hsPool} onChange={e => setHsPool(e.target.value)} placeholder="192.168.2.2" /></FLabel>
            <FLabel label="IP Pool End"><input style={inp} value={hsPoolEnd} onChange={e => setHsPoolEnd(e.target.value)} placeholder="192.168.2.254" /></FLabel>
            <FLabel label="Hotspot Profile Name"><input style={inp} value={hsProfile} onChange={e => setHsProfile(e.target.value)} placeholder="hsprof1" /></FLabel>
            <FLabel label="RADIUS IP"><input style={inp} value={radiusIp} onChange={e => setRadiusIp(e.target.value)} placeholder="10.0.0.1" /></FLabel>
            <FLabel label="RADIUS Secret"><input style={inp} value={radiusSecret} onChange={e => setRadiusSecret(e.target.value)} placeholder="secret" /></FLabel>
          </div>
        </Panel>

        {/* ══ STEP 4 — Migration options ══ */}
        <Panel title="Step 4 — Migration Options" subtitle="Choose what to push to the new router. Unselected items are skipped." icon={<UploadCloud size={16} />} color="#8b5cf6">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            <OptionRow
              checked={doHotspot} onChange={setDoHotspot}
              label="Hotspot Configuration" sub="Push hotspot profile, IP pool, RADIUS client, NAT redirect, and DNS settings." icon={<Wifi size={14} />} color="#06b6d4"
            />
            <OptionRow
              checked={doPlans} onChange={setDoPlans}
              label="Service Plan Profiles" sub="Create hotspot user profiles and PPPoE profiles with rate-limits on the new router."
              count={plans.length} icon={<Settings2 size={14} />} color="#8b5cf6"
            />
            <OptionRow
              checked={doCustomers} onChange={setDoCustomers}
              label="Customer Accounts" sub="Push all hotspot users and PPPoE secrets to the router for local authentication."
              count={customers.length} icon={<Users size={14} />} color="#f59e0b"
            />
            <OptionRow
              checked={doVouchers} onChange={setDoVouchers}
              label="Voucher Codes" sub="Push unused voucher codes as hotspot users on the router (RADIUS fallback)."
              count={vouchers.length} icon={<Ticket size={14} />} color="#22d3ee"
            />
            <OptionRow
              checked={doUpdateDb} onChange={setDoUpdateDb}
              label="Update Database Record" sub={`Replace the stored host, credentials, model, and ROS version for "${oldRouter?.name ?? "selected router"}" in the platform database.`}
              icon={<Database size={14} />} color="#4ade80"
            />
          </div>

          {/* Step summary */}
          <div style={{ marginTop: "1rem", padding: "0.625rem 0.875rem", background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 8, fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
            <span style={{ fontWeight: 700, color: "#8b5cf6" }}>{steps} step{steps !== 1 ? "s" : ""}</span> selected
            {!canReplace && !running && (
              <span style={{ marginLeft: "0.5rem", color: "#f87171" }}>
                {!oldRouter ? "— select old router" : !newHost ? "— enter new router IP" : steps === 0 ? "— select at least one option" : ""}
              </span>
            )}
          </div>
        </Panel>

        {/* ══ Execute button ══ */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button
            onClick={handleReplace}
            disabled={!canReplace}
            style={{
              display: "flex", alignItems: "center", gap: "0.625rem",
              padding: "0.875rem 2rem", borderRadius: 12,
              background: canReplace ? "linear-gradient(135deg,#f87171,#dc2626)" : "rgba(248,113,113,0.1)",
              border: "none", color: canReplace ? "white" : "#94a3b8",
              fontWeight: 800, fontSize: "0.9375rem", cursor: canReplace ? "pointer" : "not-allowed",
              fontFamily: "inherit", boxShadow: canReplace ? "0 4px 20px rgba(248,113,113,0.3)" : "none", transition: "all 0.2s",
            }}
          >
            {running
              ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Replacing…</>
              : <><RefreshCw size={17} /> Start Replacement</>
            }
          </button>
          {done === true && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#4ade80", fontWeight: 700, fontSize: "0.875rem" }}>
              <CheckCircle2 size={16} /> Replacement successful
            </div>
          )}
          {done === false && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#f87171", fontWeight: 700, fontSize: "0.875rem" }}>
              <X size={16} /> Completed with errors
            </div>
          )}
        </div>

        {/* ══ Log panel ══ */}
        {(running || logs.length > 0) && (
          <LogPanel
            logs={running && logs.length === 0 ? ["▶ Connecting…"] : logs}
            ok={done}
            error={lastError}
            onClose={() => { setLogs([]); setDone(null); setLastError(undefined); }}
          />
        )}

      </div>
    </AdminLayout>
  );
}
