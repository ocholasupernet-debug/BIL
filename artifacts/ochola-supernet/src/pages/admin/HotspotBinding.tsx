import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Wifi, Plus, Trash, RefreshCw, Search, X, ShieldCheck,
  Loader2, CheckCircle2, AlertTriangle, Monitor, Users,
  Link2, Clock, Activity, UploadCloud, DownloadCloud,
  Edit, Shield,
} from "lucide-react";

/* ══════════════════════════ Types ══════════════════════════ */
interface DbCustomer {
  id: number; name: string | null; username: string | null;
  mac_address: string | null; ip_address: string | null;
  type: string | null; status: string; expires_at: string | null;
}
interface RouterLite { id: number; name: string; host: string; status: string; }
interface RadCheck { id: number; username: string; attribute: string; op: string; value: string; }
interface RadAcct {
  radacctid: number; username: string; nasipaddress: string;
  callingstationid: string; framedipaddress: string;
  acctstarttime: string; acctstoptime: string | null;
  acctinputoctets: number; acctoutputoctets: number;
  acctsessiontime: number; acctterminatecause: string;
}

/* ──── Binding = a MAC address linked to a user or auto-accepted ──── */
interface Binding {
  id: string;           // synthetic key
  mac: string;
  type: "user-mac" | "bypass";
  username: string | null;
  ip: string | null;
  routerHost: string | null;
  status: "active" | "inactive";
  source: "isp_customers" | "radcheck";
  customerId?: number;
  radcheckIds?: number[];
}

/* ══════════════════════════ Helpers ══════════════════════════ */
function normalizeMac(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-F]/g, "").replace(/(.{2})(?=.)/g, "$1:").slice(0, 17);
}
function formatMac(m: string): string {
  if (!m) return "—";
  const clean = m.replace(/[^0-9A-Fa-f]/g, "");
  if (clean.length === 12) return clean.match(/.{2}/g)!.join(":").toUpperCase();
  return m.toUpperCase();
}
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDuration(secs: number): string {
  if (!secs) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

/* ══════════════════════════ DB helpers ══════════════════════════ */
async function fetchCustomersWithMac(): Promise<DbCustomer[]> {
  const { data, error } = await supabase
    .from("isp_customers")
    .select("id,name,username,mac_address,ip_address,type,status,expires_at")
    .eq("admin_id", ADMIN_ID)
    .not("mac_address", "is", null);
  if (error) throw error;
  return (data ?? []).filter(c => c.mac_address);
}
async function fetchBypassEntries(): Promise<RadCheck[]> {
  const { data, error } = await supabase
    .from("radcheck")
    .select("id,username,attribute,op,value")
    .eq("attribute", "Auth-Type")
    .eq("value", "Accept");
  if (error) throw error;
  return data ?? [];
}
async function fetchBypassIps(): Promise<RadCheck[]> {
  const { data, error } = await supabase
    .from("radcheck")
    .select("id,username,attribute,op,value")
    .eq("attribute", "Framed-IP-Address")
    .ilike("username", "bypass:%");
  if (error) throw error;
  return data ?? [];
}
async function fetchRouters(): Promise<RouterLite[]> {
  const { data, error } = await supabase.from("isp_routers").select("id,name,host,status").eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}
async function fetchSessions(active: boolean): Promise<RadAcct[]> {
  let q = supabase.from("radacct")
    .select("radacctid,username,nasipaddress,callingstationid,framedipaddress,acctstarttime,acctstoptime,acctinputoctets,acctoutputoctets,acctsessiontime,acctterminatecause")
    .order("acctstarttime", { ascending: false })
    .limit(100);
  if (active) q = q.is("acctstoptime", null);
  else q = q.not("acctstoptime", "is", null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function addUserMacBinding(customerId: number, mac: string): Promise<void> {
  // Update the customer record
  const { error: custErr } = await supabase
    .from("isp_customers")
    .update({ mac_address: mac, updated_at: new Date().toISOString() })
    .eq("id", customerId);
  if (custErr) throw custErr;

  // Fetch the customer username
  const { data: cust } = await supabase.from("isp_customers").select("username,pppoe_username,type").eq("id", customerId).single();
  if (!cust) return;
  const radUser = cust.type === "pppoe" ? (cust.pppoe_username || cust.username) : cust.username;
  if (!radUser) return;

  // Upsert Calling-Station-Id in radcheck
  const { data: existing } = await supabase.from("radcheck")
    .select("id").eq("username", radUser).eq("attribute", "Calling-Station-Id").single();
  if (existing) {
    await supabase.from("radcheck").update({ value: mac }).eq("id", existing.id);
  } else {
    await supabase.from("radcheck").insert({ username: radUser, attribute: "Calling-Station-Id", op: ":=", value: mac });
  }
}

async function addBypassBinding(mac: string, ip: string | null): Promise<void> {
  const key = `bypass:${mac.replace(/:/g, "-")}`;
  await supabase.from("radcheck").insert({ username: key, attribute: "Auth-Type", op: ":=", value: "Accept" });
  if (ip) {
    await supabase.from("radcheck").insert({ username: key, attribute: "Framed-IP-Address", op: ":=", value: ip });
  }
}

async function removeBinding(b: Binding): Promise<void> {
  if (b.source === "isp_customers" && b.customerId) {
    await supabase.from("isp_customers").update({ mac_address: null }).eq("id", b.customerId);
    // Remove Calling-Station-Id from radcheck for that user
    if (b.username) {
      await supabase.from("radcheck").delete().eq("username", b.username).eq("attribute", "Calling-Station-Id");
    }
  } else if (b.source === "radcheck" && b.radcheckIds?.length) {
    await supabase.from("radcheck").delete().in("id", b.radcheckIds);
  }
}

/* ══════════════════════════ Compose Bindings list ══════════════════════════ */
function composeBindings(customers: DbCustomer[], bypasses: RadCheck[], bypassIps: RadCheck[], routers: RouterLite[]): Binding[] {
  const out: Binding[] = [];

  // User-MAC bindings from isp_customers
  customers.forEach(c => {
    const mac = formatMac(c.mac_address ?? "");
    out.push({
      id: `cust-${c.id}`,
      mac,
      type: "user-mac",
      username: c.username ?? null,
      ip: c.ip_address ?? null,
      routerHost: null,
      status: c.status === "active" ? "active" : "inactive",
      source: "isp_customers",
      customerId: c.id,
    });
  });

  // MAC bypass from radcheck
  const bypassIpMap: Record<string, string> = {};
  bypassIps.forEach(r => { bypassIpMap[r.username] = r.value; });

  bypasses.forEach(r => {
    const rawMac = r.username.replace("bypass:", "").replace(/-/g, ":");
    out.push({
      id: `rad-${r.id}`,
      mac: formatMac(rawMac),
      type: "bypass",
      username: null,
      ip: bypassIpMap[r.username] ?? null,
      routerHost: null,
      status: "active",
      source: "radcheck",
      radcheckIds: [r.id, ...(bypassIps.filter(x => x.username === r.username).map(x => x.id))],
    });
  });

  return out;
}

/* ══════════════════════════ Form ══════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8,
  padding: "0.575rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem",
  fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const sel: React.CSSProperties = { ...inp };

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "#f87171", marginLeft: 2 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: "0.68rem", color: "var(--isp-text-sub)" }}>{hint}</span>}
    </label>
  );
}

function AddBindingModal({
  customers, onClose, onSave,
}: {
  customers: DbCustomer[];
  onClose: () => void;
  onSave: (type: "user-mac" | "bypass", customerId: number | null, mac: string, ip: string) => void;
}) {
  const [btype, setBtype]       = useState<"user-mac" | "bypass">("user-mac");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [mac, setMac]           = useState("");
  const [ip,  setIp]            = useState("");
  const [saving, setSaving]     = useState(false);

  // Filter to hotspot customers only
  const hotspotCustomers = customers.filter(c => c.type === "hotspot" || !c.type);

  const handleMac = (v: string) => {
    const clean = v.replace(/[^0-9A-Fa-f:]/g, "");
    setMac(clean.toUpperCase());
  };

  const valid = mac.replace(/:/g, "").length === 12 && (btype === "bypass" || customerId !== "");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 480, boxShadow: "0 32px 80px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--isp-border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Link2 size={17} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.95rem" }}>Add Binding</div>
              <div style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>Link a device to a user or whitelist a MAC</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.4rem", color: "var(--isp-text-muted)", cursor: "pointer", display: "flex" }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Binding type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.625rem" }}>
            {(["user-mac", "bypass"] as const).map(t => {
              const active = btype === t;
              const color = t === "user-mac" ? "var(--isp-accent)" : "var(--isp-accent)";
              return (
                <button key={t} onClick={() => setBtype(t)}
                  style={{ padding: "0.75rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", border: active ? `1.5px solid ${color}` : "1.5px solid var(--isp-border)", background: active ? `${color}18` : "rgba(255,255,255,0.02)", textAlign: "left", transition: "all 0.14s" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.8rem", color: active ? color : "var(--isp-text)", marginBottom: "0.2rem" }}>
                    {t === "user-mac" ? "User-MAC Lock" : "MAC Bypass"}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)" }}>
                    {t === "user-mac" ? "Bind an account to a device" : "Allow device without login"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* User-MAC: pick customer */}
          {btype === "user-mac" && (
            <Field label="Customer" required hint="Select the hotspot account to bind">
              <select style={sel} value={customerId} onChange={e => setCustomerId(Number(e.target.value))}>
                <option value="">— Select customer —</option>
                {hotspotCustomers.map(c => (
                  <option key={c.id} value={c.id}>{c.name ?? c.username} ({c.username})</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="MAC Address" required hint="Device hardware address, e.g. AA:BB:CC:DD:EE:FF">
            <input style={inp} value={mac} placeholder="AA:BB:CC:DD:EE:FF" maxLength={17}
              onChange={e => handleMac(e.target.value)} />
          </Field>

          {/* IP is optional for bypass, shown for both */}
          <Field label="IP Address (optional)" hint={btype === "bypass" ? "Assign a fixed IP to this device" : "Static IP for this binding"}>
            <input style={inp} value={ip} placeholder="e.g. 192.168.88.50"
              onChange={e => setIp(e.target.value)} />
          </Field>

          {/* Info box */}
          <div style={{ background: "rgba(37,99,235,0.06)", border: "1px solid var(--isp-accent-glow)", borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
            {btype === "user-mac"
              ? "This device's MAC will be locked to the selected account. The user can only log in from this device."
              : "This device will bypass the hotspot login page and connect automatically, regardless of any user account."}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.5rem", borderTop: "1px solid var(--isp-border-subtle)" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.65rem", borderRadius: 10, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={() => { setSaving(true); onSave(btype, btype === "user-mac" ? Number(customerId) : null, mac, ip); }} disabled={saving || !valid}
            style={{ flex: 2, padding: "0.65rem", borderRadius: 10, background: saving || !valid ? "var(--isp-accent-border)" : "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: saving || !valid ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Link2 size={14} />}
            Add Binding
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ Sessions Tab ══════════════════════════ */
function SessionsTab() {
  const [showActive, setShowActive] = useState(true);
  const [search, setSearch] = useState("");

  const { data: sessions = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["radacct", showActive],
    queryFn: () => fetchSessions(showActive),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    if (!search) return sessions;
    const t = search.toLowerCase();
    return sessions.filter(s =>
      s.username.toLowerCase().includes(t) ||
      s.callingstationid.toLowerCase().includes(t) ||
      s.framedipaddress.includes(t) ||
      s.nasipaddress.includes(t)
    );
  }, [sessions, search]);

  const totalIn  = sessions.reduce((a, s) => a + (s.acctinputoctets  ?? 0), 0);
  const totalOut = sessions.reduce((a, s) => a + (s.acctoutputoctets ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Session stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem" }}>
        {[
          { label: showActive ? "Active Sessions" : "Past Sessions", value: String(sessions.length), icon: <Activity size={18} />, color: "var(--isp-accent)" },
          { label: "Unique Users", value: String(new Set(sessions.map(s => s.username)).size), icon: <Users size={18} />, color: "var(--isp-accent)" },
          { label: "Data Upload", value: fmtBytes(totalIn), icon: <UploadCloud size={18} />, color: "#34d399" },
          { label: "Data Download", value: fmtBytes(totalOut), icon: <DownloadCloud size={18} />, color: "#f59e0b" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1rem 1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ color, opacity: 0.8 }}>{icon}</span>
              <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "var(--isp-text)", fontFamily: "monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search user, MAC, IP…"
            style={{ width: "100%", boxSizing: "border-box", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem 0.5rem 2rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, overflow: "hidden" }}>
          {[{ label: "Active", val: true }, { label: "History", val: false }].map(o => (
            <button key={String(o.val)} onClick={() => setShowActive(o.val)}
              style={{ padding: "0.5rem 1rem", fontFamily: "inherit", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", border: "none", background: showActive === o.val ? "var(--isp-accent-glow)" : "transparent", color: showActive === o.val ? "var(--isp-accent)" : "var(--isp-text-muted)", transition: "all 0.14s" }}>
              {o.label}
            </button>
          ))}
        </div>
        <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.875rem", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
          <RefreshCw size={13} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} /> Refresh
        </button>
      </div>

      {/* Sessions table */}
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                {["User", "Device MAC", "IP Address", "Router", "Duration", "↑ Upload", "↓ Download", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.1rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.67rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: "3rem", color: "var(--isp-text-muted)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading sessions…
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: "4rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(37,99,235,0.07)", border: "1.5px dashed rgba(37,99,235,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Activity size={22} style={{ color: "var(--isp-accent)", opacity: 0.5 }} />
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, color: "var(--isp-text)", marginBottom: "0.2rem" }}>
                        {showActive ? "No active sessions" : "No session history"}
                      </p>
                      <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                        {showActive ? "Sessions will appear here when users are connected." : "Past sessions will appear here once users disconnect."}
                      </p>
                    </div>
                  </div>
                </td></tr>
              ) : filtered.map(s => (
                <tr key={s.radacctid} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }} className="crow">
                  <td style={{ padding: "0.7rem 1.1rem", fontWeight: 600, color: "var(--isp-text)" }}>{s.username || "—"}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>{formatMac(s.callingstationid) || "—"}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-accent)" }}>{s.framedipaddress || "—"}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>{s.nasipaddress || "—"}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-text)" }}>{fmtDuration(s.acctsessiontime)}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#34d399" }}>{fmtBytes(s.acctinputoctets)}</td>
                  <td style={{ padding: "0.7rem 1.1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#f59e0b" }}>{fmtBytes(s.acctoutputoctets)}</td>
                  <td style={{ padding: "0.7rem 1.1rem" }}>
                    {s.acctstoptime == null
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,0.1)", padding: "0.2rem 0.6rem", borderRadius: 20 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} /> Online
                        </span>
                      : <span style={{ fontSize: "0.7rem", color: "var(--isp-text-sub)" }}>
                          {s.acctterminatecause || "Disconnected"}
                        </span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div style={{ padding: "0.5rem 1.1rem", borderTop: "1px solid var(--isp-border-subtle)", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
            {filtered.length} session{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
export default function HotspotBinding() {
  const [location] = useLocation();
  const initialTab = (typeof window !== "undefined" && window.location.search.includes("tab=sessions")) ? "sessions" : "bindings";
  const [tab, setTab] = useState<"bindings" | "sessions">(initialTab);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<Binding | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const qc = useQueryClient();

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: customers = [], isLoading: loadingCust }    = useQuery({ queryKey: ["isp_customers_mac"], queryFn: fetchCustomersWithMac, refetchInterval: 60_000 });
  const { data: allCustomers = [] }                          = useQuery({ queryKey: ["isp_customers_all"],  queryFn: async () => {
    const { data } = await supabase.from("isp_customers").select("id,name,username,mac_address,ip_address,type,status,expires_at").eq("admin_id", ADMIN_ID);
    return (data ?? []) as DbCustomer[];
  }});
  const { data: bypasses = [],   isLoading: loadingByp }    = useQuery({ queryKey: ["radcheck_bypass"],    queryFn: fetchBypassEntries, refetchInterval: 60_000 });
  const { data: bypassIps = [] }                             = useQuery({ queryKey: ["radcheck_bypass_ip"], queryFn: fetchBypassIps, refetchInterval: 60_000 });
  const { data: routers  = [] }                              = useQuery({ queryKey: ["isp_routers"],        queryFn: fetchRouters });

  const isLoading = loadingCust || loadingByp;
  const bindings  = useMemo(() => composeBindings(customers, bypasses, bypassIps, routers), [customers, bypasses, bypassIps, routers]);

  const filtered = useMemo(() => {
    return bindings.filter(b => {
      const term = search.toLowerCase();
      const match = !search ||
        (b.mac ?? "").toLowerCase().includes(term) ||
        (b.username ?? "").toLowerCase().includes(term) ||
        (b.ip ?? "").includes(term);
      const matchType = filterType === "all" || b.type === filterType;
      return match && matchType;
    });
  }, [bindings, search, filterType]);

  const totalBindings = bindings.length;
  const userMacCount  = bindings.filter(b => b.type === "user-mac").length;
  const bypassCount   = bindings.filter(b => b.type === "bypass").length;
  const activeCount   = bindings.filter(b => b.status === "active").length;

  const addMutation = useMutation({
    mutationFn: async ({ btype, customerId, mac, ip }: { btype: "user-mac" | "bypass"; customerId: number | null; mac: string; ip: string }) => {
      if (btype === "user-mac" && customerId) await addUserMacBinding(customerId, mac);
      else await addBypassBinding(mac, ip || null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_customers_mac"] });
      qc.invalidateQueries({ queryKey: ["radcheck_bypass"] });
      qc.invalidateQueries({ queryKey: ["radcheck_bypass_ip"] });
      setShowAdd(false);
      showToast("Binding added successfully");
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const deleteMutation = useMutation({
    mutationFn: removeBinding,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_customers_mac"] });
      qc.invalidateQueries({ queryKey: ["radcheck_bypass"] });
      qc.invalidateQueries({ queryKey: ["radcheck_bypass_ip"] });
      setDeleting(null);
      showToast("Binding removed");
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        .crow:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 24, zIndex: 2000, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderRadius: 10, background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${toast.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`, color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.875rem", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "slideIn 0.2s ease" }}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Add Binding Modal */}
      {showAdd && (
        <AddBindingModal
          customers={allCustomers}
          onClose={() => setShowAdd(false)}
          onSave={(btype, customerId, mac, ip) => addMutation.mutate({ btype, customerId, mac, ip })}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, width: "100%", maxWidth: 400, padding: "1.75rem", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <AlertTriangle size={17} style={{ color: "#f87171" }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: "var(--isp-text)" }}>Remove Binding</div>
                <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>This cannot be undone</div>
              </div>
            </div>
            <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
              Remove binding for MAC <strong style={{ color: "var(--isp-text)", fontFamily: "monospace" }}>{deleting.mac}</strong>?
              {deleting.type === "bypass" ? " This device will no longer auto-connect." : " The user will no longer be locked to this device."}
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setDeleting(null)} style={{ flex: 1, padding: "0.65rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleting)} disabled={deleteMutation.isPending}
                style={{ flex: 1, padding: "0.65rem", borderRadius: 8, background: deleteMutation.isPending ? "rgba(239,68,68,0.4)" : "rgba(239,68,68,0.9)", border: "none", color: "white", fontWeight: 700, cursor: deleteMutation.isPending ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem" }}>
                {deleteMutation.isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash size={13} />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* ─── Header ─── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.875rem" }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--isp-text)", margin: 0 }}>Hotspot Binding</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", marginTop: "0.2rem" }}>
              MAC-to-user locks and device bypass rules
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.625rem" }}>
            <button onClick={() => { qc.invalidateQueries({ queryKey: ["isp_customers_mac"] }); qc.invalidateQueries({ queryKey: ["radcheck_bypass"] }); }}
              style={{ padding: "0.5rem 0.75rem", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem", fontFamily: "inherit", fontWeight: 600, fontSize: "0.8rem" }}>
              <RefreshCw size={13} style={{ animation: isLoading ? "spin 1s linear infinite" : "none" }} />
            </button>
            <button onClick={() => setShowAdd(true)}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1.1rem", borderRadius: 10, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px var(--isp-accent-border)" }}>
              <Plus size={15} /> Add Binding
            </button>
          </div>
        </div>

        {/* ─── Tabs ─── */}
        <div style={{ display: "flex", gap: 0, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 10, padding: 4, alignSelf: "flex-start" }}>
          {([["bindings", <Link2 size={13} />, "Bindings"], ["sessions", <Activity size={13} />, "Sessions"]] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.45rem 1.1rem", borderRadius: 8, fontFamily: "inherit", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", border: "none", background: tab === t ? "var(--isp-accent-glow)" : "transparent", color: tab === t ? "var(--isp-accent)" : "var(--isp-text-muted)", transition: "all 0.14s" }}>
              {icon} {label}
            </button>
          ))}
        </div>

        {/* ══════════ BINDINGS TAB ══════════ */}
        {tab === "bindings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem" }}>
              {[
                { label: "Total Bindings", value: String(totalBindings), icon: <Link2 size={18} />,    color: "var(--isp-accent)" },
                { label: "User-MAC Locks", value: String(userMacCount),  icon: <Shield size={18} />,   color: "var(--isp-accent)" },
                { label: "MAC Bypass",     value: String(bypassCount),   icon: <Monitor size={18} />,  color: "#34d399" },
                { label: "Active",         value: String(activeCount),   icon: <Activity size={18} />, color: "#f59e0b" },
              ].map(({ label, value, icon, color }) => (
                <div key={label} style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "1rem 1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ color, opacity: 0.8 }}>{icon}</span>
                    <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                  </div>
                  <div style={{ fontSize: "1.65rem", fontWeight: 800, color: "var(--isp-text)", fontFamily: "monospace" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
                <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search MAC, username, IP…"
                  style={{ width: "100%", boxSizing: "border-box", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem 0.5rem 2rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }} />
              </div>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
                <option value="all">All Types</option>
                <option value="user-mac">User-MAC Lock</option>
                <option value="bypass">MAC Bypass</option>
              </select>
            </div>

            {/* Bindings table */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                      {["MAC Address", "Type", "Linked Account", "IP Address", "Status", "Actions"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.67rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={6} style={{ textAlign: "center", padding: "3.5rem", color: "var(--isp-text-muted)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading bindings…
                        </div>
                      </td></tr>
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: "center", padding: "4rem" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                          <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(37,99,235,0.07)", border: "1.5px dashed rgba(37,99,235,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Link2 size={22} style={{ color: "var(--isp-accent)", opacity: 0.5 }} />
                          </div>
                          <div>
                            <p style={{ fontWeight: 600, color: "var(--isp-text)", marginBottom: "0.2rem" }}>
                              {bindings.length === 0 ? "No bindings yet" : "No bindings match your search"}
                            </p>
                            <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                              {bindings.length === 0
                                ? "Add a User-MAC lock to restrict logins to a device, or a MAC Bypass to whitelist a device."
                                : "Try adjusting your filters."}
                            </p>
                          </div>
                          {bindings.length === 0 && (
                            <button onClick={() => setShowAdd(true)}
                              style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1.25rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                              <Plus size={13} /> Add First Binding
                            </button>
                          )}
                        </div>
                      </td></tr>
                    ) : filtered.map(b => (
                      <tr key={b.id} className="crow" style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                        {/* MAC */}
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: b.type === "bypass" ? "rgba(52,211,153,0.1)" : "var(--isp-accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {b.type === "bypass" ? <Monitor size={13} style={{ color: "#34d399" }} /> : <Shield size={13} style={{ color: "var(--isp-accent)" }} />}
                            </div>
                            <span style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text)", letterSpacing: "0.04em" }}>{b.mac}</span>
                          </div>
                        </td>
                        {/* Type */}
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 20,
                            background: b.type === "bypass" ? "rgba(52,211,153,0.1)" : "var(--isp-accent-glow)",
                            color: b.type === "bypass" ? "#34d399" : "var(--isp-accent)" }}>
                            {b.type === "bypass" ? <Monitor size={10} /> : <Shield size={10} />}
                            {b.type === "bypass" ? "MAC Bypass" : "User-MAC Lock"}
                          </span>
                        </td>
                        {/* Account */}
                        <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                          {b.username ? (
                            <span style={{ fontFamily: "monospace", color: "var(--isp-accent)" }}>{b.username}</span>
                          ) : (
                            <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>No account (bypass)</span>
                          )}
                        </td>
                        {/* IP */}
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          {b.ip ? <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--isp-accent)" }}>{b.ip}</span> : <span style={{ color: "var(--isp-text-sub)", fontSize: "0.75rem" }}>Dynamic</span>}
                        </td>
                        {/* Status */}
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <Badge variant={b.status === "active" ? "success" : "warning"}>{b.status}</Badge>
                        </td>
                        {/* Actions */}
                        <td style={{ padding: "0.75rem 1.25rem" }}>
                          <button onClick={() => setDeleting(b)}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--isp-text-muted)", cursor: "pointer" }}
                            title="Remove binding">
                            <Trash size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!isLoading && filtered.length > 0 && (
                <div style={{ padding: "0.5rem 1.25rem", borderTop: "1px solid var(--isp-border-subtle)", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                  {filtered.length} binding{filtered.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>

            {/* Info card */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
              {[
                { icon: <Shield size={16} />, color: "var(--isp-accent)", title: "User-MAC Lock", body: "Restricts a hotspot account to authenticate only from one specific device. Prevents credential sharing across multiple devices." },
                { icon: <Monitor size={16} />, color: "#34d399", title: "MAC Bypass", body: "Whitelists a device so it can access the internet without going through the hotspot login page. Useful for internal devices, printers, cameras, etc." },
              ].map(({ icon, color, title, body }) => (
                <div key={title} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid var(--isp-border-subtle)", borderRadius: 12, padding: "1rem 1.25rem", display: "flex", gap: "0.875rem" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color }}>{icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem", marginBottom: "0.35rem" }}>{title}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════ SESSIONS TAB ══════════ */}
        {tab === "sessions" && <SessionsTab />}

      </div>
    </AdminLayout>
  );
}
