import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, isSuperAdmin } from "@/lib/supabase";
import {
  Settings, Shield, CheckCircle2, XCircle, Loader2, Eye, EyeOff,
  Plus, Edit2, Save, Wifi, WifiOff, Clock, AlertTriangle, X,
  Terminal, Server, RefreshCw, Lock, User, Hash, Globe, Zap,
  ChevronDown, ChevronUp,
} from "lucide-react";

/* ══════════════════════ Types ══════════════════════════════════ */
interface DbRouter {
  id: number;
  admin_id: number;
  name: string;
  host: string;
  ip_address: string | null;
  bridge_ip: string | null;
  bridge_interface: string | null;
  router_secret: string | null;
  router_username: string;
  description: string | null;
  model: string | null;
  ros_version: string | null;
  status: string;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  routerIdentity?: string;
  rosVersion?: string;
  warnings?: string[];
  error?: string;
  usedVpnFallback?: boolean;
  bridgeInterfaces?: string[];
  detectedBridgeInterface?: string;
}

/* ══════════════════════ Styles ══════════════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-input-bg,#0f1923)",
  border: "1px solid var(--isp-input-border,rgba(255,255,255,0.1))",
  borderRadius: 8, padding: "0.55rem 0.875rem",
  color: "var(--isp-text)", fontSize: "0.875rem",
  fontFamily: "inherit", outline: "none",
  width: "100%", boxSizing: "border-box",
};

/* ══════════════════════ Helpers ══════════════════════════════════ */
function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)  return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function PwInput({ value, onChange, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "•••••••"}
        disabled={disabled}
        style={{ ...inp, paddingRight: "2.5rem", opacity: disabled ? 0.5 : 1 }}
      />
      <button type="button" onClick={() => setShow(s => !s)} disabled={disabled}
        style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: disabled ? "default" : "pointer", color: "var(--isp-text-muted)", padding: 0, display: "flex" }}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/* ══════════════════════ Status Badge ═══════════════════════════ */
function StatusBadge({ status, lastSeen }: { status: string; lastSeen: string | null }) {
  const isOnline = status === "online" || status === "connected";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: isOnline ? "#4ade80" : "#f87171",
        boxShadow: isOnline ? "0 0 6px rgba(74,222,128,0.6)" : "none",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: isOnline ? "#4ade80" : "#f87171" }}>
        {isOnline ? "Connected" : "Not Connected"}
      </span>
      {lastSeen && (
        <span style={{ fontSize: 11, color: "var(--isp-text-muted)" }}>
          · Last seen {timeAgo(lastSeen)}
        </span>
      )}
    </div>
  );
}

/* ══════════════════════ Read-only status card (regular admin) ══ */
function RouterStatusCard({ router, onTest }: { router: DbRouter; onTest: (id: number) => void }) {
  return (
    <div style={{
      background: "var(--isp-section)", border: "1px solid var(--isp-border)",
      borderRadius: 12, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(6,182,212,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Server size={16} style={{ color: "#06b6d4" }} />
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>{router.name}</p>
            <p style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
              {router.host || router.bridge_ip || "No IP configured"}
            </p>
          </div>
        </div>
        <button
          onClick={() => onTest(router.id)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "#06b6d4", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          <RefreshCw size={11} /> Test
        </button>
      </div>

      <StatusBadge status={router.status} lastSeen={router.last_seen} />

      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--isp-text-muted)" }}>
        {router.model && <span>Model: <strong style={{ color: "var(--isp-text)" }}>{router.model}</strong></span>}
        {router.ros_version && <span>ROS: <strong style={{ color: "var(--isp-text)" }}>{router.ros_version}</strong></span>}
        <span>Port: <strong style={{ color: "var(--isp-text)" }}>8728</strong></span>
        <span>User: <strong style={{ color: "var(--isp-text)" }}>{router.router_username || "admin"}</strong></span>
      </div>
    </div>
  );
}

/* ══════════════════════ Router Form (superadmin) ════════════════ */
interface RouterForm {
  name: string;
  host: string;
  bridge_ip: string;
  bridge_interface: string;
  router_username: string;
  router_secret: string;
  api_port: number;
  description: string;
}

const EMPTY_FORM: RouterForm = {
  name: "", host: "", bridge_ip: "", bridge_interface: "",
  router_username: "admin", router_secret: "", api_port: 8728, description: "",
};

function RouterForm({
  initial, routerId, onSaved, onCancel,
}: {
  initial?: RouterForm;
  routerId?: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RouterForm>(initial ?? EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function set(k: keyof RouterForm, v: string | number) {
    setForm(f => ({ ...f, [k]: v }));
    setTestResult(null);
  }

  async function handleTest() {
    if (!form.host && !form.bridge_ip) {
      setTestResult({ ok: false, error: "Enter a MikroTik IP address first." });
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/router/test-raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:      form.host || form.bridge_ip,
          port:      form.api_port || 8728,
          username:  form.router_username || "admin",
          password:  form.router_secret,
          bridgeIp:  form.bridge_ip || undefined,
        }),
      });
      const j = await r.json() as TestResult;
      setTestResult(j);

      /* Auto-fill bridge_interface from detection if field is blank or still default */
      if (j.ok && j.detectedBridgeInterface) {
        setForm(f => ({
          ...f,
          bridge_interface: f.bridge_interface && f.bridge_interface !== "hotspot-bridge"
            ? f.bridge_interface
            : j.detectedBridgeInterface!,
        }));
      }

      /* If test succeeded and editing an existing router, update status in DB */
      if (j.ok && routerId) {
        await supabase
          .from("isp_routers")
          .update({
            status:      "online",
            last_seen:   new Date().toISOString(),
            ros_version: j.rosVersion || undefined,
          })
          .eq("id", routerId);
      }
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Test failed" });
    } finally { setTesting(false); }
  }

  async function handleSave() {
    if (!form.name.trim()) { setSaveErr("Router name is required."); return; }
    if (!form.host.trim() && !form.bridge_ip.trim()) { setSaveErr("Enter at least one IP address (public or VPN)."); return; }
    if (!form.router_username.trim()) { setSaveErr("API username is required."); return; }
    setSaving(true); setSaveErr("");
    try {
      const now = new Date();
      const fmtDate = now.toLocaleString("en-KE", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      });

      const userDesc = form.description.trim();
      const autoDesc = `Manually installed on ${fmtDate}`;

      const payload = {
        admin_id:         ADMIN_ID,
        name:             form.name.trim(),
        host:             form.host.trim(),
        bridge_ip:        form.bridge_ip.trim()        || null,
        bridge_interface: form.bridge_interface.trim() || "hotspot-bridge",
        router_username:  form.router_username.trim(),
        router_secret:    form.router_secret,
        description:      userDesc || null,
        updated_at:       now.toISOString(),
      };

      let err;
      if (routerId) {
        ({ error: err } = await supabase.from("isp_routers").update(payload).eq("id", routerId));
      } else {
        ({ error: err } = await supabase.from("isp_routers").insert({
          ...payload,
          description: userDesc || autoDesc,
          status:      "unknown",
          created_at:  now.toISOString(),
        }));
      }
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 };
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };
  const field: React.CSSProperties = { marginBottom: 16 };

  return (
    <div style={{ background: "var(--isp-section)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 12, padding: "22px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Settings size={15} style={{ color: "#06b6d4" }} />
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--isp-text)" }}>
            {routerId ? "Edit Router API Credentials" : "Add New Router"}
          </span>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4 }}><X size={16} /></button>
      </div>

      <div style={field}>
        <label style={lbl}><Server size={11} /> Router Name</label>
        <input value={form.name} onChange={e => set("name", e.target.value)} style={inp} placeholder="e.g. Main Router - Nairobi" />
      </div>

      <div style={{ ...grid2, marginBottom: 16 }}>
        <div>
          <label style={lbl}><Globe size={11} /> MikroTik Public IP / Host</label>
          <input value={form.host} onChange={e => set("host", e.target.value)} style={inp} placeholder="e.g. 102.212.246.158" />
          <p style={{ fontSize: 10, color: "var(--isp-text-muted)", margin: "4px 0 0" }}>Public IP or hostname reachable from VPS</p>
        </div>
        <div>
          <label style={lbl}><Wifi size={11} /> VPN Tunnel IP (bridge_ip)</label>
          <input value={form.bridge_ip} onChange={e => set("bridge_ip", e.target.value)} style={inp} placeholder="e.g. 10.8.0.6" />
          <p style={{ fontSize: 10, color: "var(--isp-text-muted)", margin: "4px 0 0" }}>OpenVPN client IP assigned to this router</p>
        </div>
      </div>

      <div style={{ ...grid2, marginBottom: 16 }}>
        <div>
          <label style={lbl}><User size={11} /> API Username</label>
          <input value={form.router_username} onChange={e => set("router_username", e.target.value)} style={inp} placeholder="admin" />
        </div>
        <div>
          <label style={lbl}><Hash size={11} /> API Port</label>
          <input
            type="number" value={form.api_port}
            onChange={e => set("api_port", parseInt(e.target.value) || 8728)}
            style={inp} min={1} max={65535}
          />
          <p style={{ fontSize: 10, color: "var(--isp-text-muted)", margin: "4px 0 0" }}>8728 = plain API · 8729 = SSL</p>
        </div>
      </div>

      <div style={field}>
        <label style={lbl}><Lock size={11} /> API Password <span style={{ fontWeight: 400, marginLeft: 4 }}>(stored securely in Supabase)</span></label>
        <PwInput value={form.router_secret} onChange={v => set("router_secret", v)} placeholder="RouterOS API password" />
      </div>

      <div style={field}>
        <label style={lbl}><Wifi size={11} /> Hotspot Bridge Interface</label>
        <div style={{ position: "relative" }}>
          <input
            value={form.bridge_interface}
            onChange={e => set("bridge_interface", e.target.value)}
            style={inp}
            placeholder="Auto-detected after Test Connection…"
          />
          {form.bridge_interface && (
            <span style={{
              position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)",
              fontSize: 10, fontWeight: 700, color: "#4ade80", fontFamily: "monospace",
              background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)",
              padding: "0.15rem 0.4rem", borderRadius: 4,
            }}>✓ set</span>
          )}
        </div>
        <p style={{ fontSize: 10, color: "var(--isp-text-muted)", margin: "4px 0 0" }}>
          MikroTik bridge interface used for hotspot. Detected automatically when you "Test Connection" — or type manually (e.g. <code style={{ fontFamily: "monospace" }}>hotspot-bridge</code>).
        </p>
      </div>

      <div style={{ ...field, marginBottom: 0 }}>
        <label style={lbl}>Description (optional)</label>
        <input value={form.description} onChange={e => set("description", e.target.value)} style={inp} placeholder="e.g. Main office router, handles PPPoE clients" />
      </div>

      {/* ── Firewall advisory ── */}
      <div style={{ margin: "18px 0", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <AlertTriangle size={13} style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.6 }}>
            <strong>Firewall note:</strong> The VPS ({window.location.hostname || "your VPS"}) must be able to reach the MikroTik API port (8728/8729).
            On the router, allow: <code style={{ fontFamily: "monospace" }}>/ip firewall filter add chain=input src-address=VPS_IP protocol=tcp dst-port=8728 action=accept</code>.
            If using OpenVPN, ensure the VPN tunnel is up and use the bridge IP (10.8.0.x).
          </div>
        </div>
      </div>

      {/* ── Test result ── */}
      {testResult && (
        <div style={{
          borderRadius: 8, padding: "12px 14px", marginBottom: 16,
          background: testResult.ok ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)",
          border: `1px solid ${testResult.ok ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: testResult.ok ? 6 : 0 }}>
            {testResult.ok
              ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
              : <XCircle size={14} style={{ color: "#f87171" }} />}
            <span style={{ fontWeight: 700, fontSize: 13, color: testResult.ok ? "#4ade80" : "#f87171" }}>
              {testResult.ok ? `Connection Successful ✅` : `Connection Failed ❌`}
            </span>
            {testResult.ok && testResult.latencyMs != null && (
              <span style={{ fontSize: 11, color: "var(--isp-text-muted)" }}>{testResult.latencyMs}ms</span>
            )}
          </div>
          {testResult.ok && (
            <div style={{ fontSize: 11, color: "var(--isp-text-muted)", paddingLeft: 21, lineHeight: 1.7 }}>
              {testResult.routerIdentity && <p style={{ margin: 0 }}>Identity: <strong style={{ color: "var(--isp-text)" }}>{testResult.routerIdentity}</strong></p>}
              {testResult.rosVersion && <p style={{ margin: 0 }}>RouterOS: <strong style={{ color: "var(--isp-text)" }}>{testResult.rosVersion}</strong></p>}
              {testResult.usedVpnFallback && <p style={{ margin: 0, color: "#fbbf24" }}>⚠ Connected via VPN fallback IP</p>}
              {testResult.detectedBridgeInterface && (
                <p style={{ margin: "2px 0 0" }}>
                  Bridge interface detected: <strong style={{ color: "#4ade80", fontFamily: "monospace" }}>{testResult.detectedBridgeInterface}</strong>
                  <span style={{ marginLeft: 6, fontSize: 10, color: "#4ade80" }}>← auto-filled</span>
                </p>
              )}
              {testResult.bridgeInterfaces && testResult.bridgeInterfaces.length > 1 && (
                <p style={{ margin: "1px 0 0" }}>
                  All bridges: {testResult.bridgeInterfaces.map(b => (
                    <code key={b} style={{ marginLeft: 4, fontFamily: "monospace", fontSize: 10, background: "rgba(255,255,255,0.06)", padding: "0 4px", borderRadius: 3 }}>{b}</code>
                  ))}
                </p>
              )}
              {testResult.ok && !testResult.detectedBridgeInterface && (
                <p style={{ margin: "2px 0 0", color: "#fbbf24" }}>⚠ No bridge interfaces found on this router — enter the interface name manually.</p>
              )}
            </div>
          )}
          {!testResult.ok && testResult.error && (
            <p style={{ margin: "4px 0 0 21px", fontSize: 11, color: "#f87171" }}>{testResult.error}</p>
          )}
          {testResult.warnings && testResult.warnings.length > 0 && (
            <ul style={{ margin: "6px 0 0 21px", padding: 0, listStyle: "disc inside", fontSize: 11, color: "#fbbf24", lineHeight: 1.7 }}>
              {testResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {saveErr && (
        <div style={{ color: "#f87171", fontSize: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={12} /> {saveErr}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button onClick={onCancel}
          style={{ padding: "9px 18px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", fontSize: 13, cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={handleTest} disabled={testing}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          {testing ? "Testing…" : "Test Connection"}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════ Superadmin router card ═══════════════════ */
function AdminRouterCard({
  router, onEdit, onTestDirect,
}: { router: DbRouter; onEdit: (r: DbRouter) => void; onTestDirect: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isOnline = router.status === "online" || router.status === "connected";

  return (
    <div style={{
      background: "var(--isp-section)", border: `1px solid ${isOnline ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        {/* Status dot */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: isOnline ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isOnline ? <Wifi size={18} style={{ color: "#4ade80" }} /> : <WifiOff size={18} style={{ color: "#f87171" }} />}
          </div>
          <span style={{ position: "absolute", bottom: -2, right: -2, width: 10, height: 10, borderRadius: "50%", background: isOnline ? "#4ade80" : "#f87171", border: "2px solid var(--isp-section)", boxShadow: isOnline ? "0 0 5px rgba(74,222,128,0.5)" : "none" }} />
        </div>

        {/* Name + host */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>{router.name}</p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
            {router.host || "—"}{router.bridge_ip ? ` · VPN: ${router.bridge_ip}` : ""}
          </p>
        </div>

        {/* Status label */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: isOnline ? "#4ade80" : "#f87171" }}>
            {isOnline ? "Connected" : "Not Connected"}
          </p>
          {router.last_seen && (
            <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end", marginTop: 2 }}>
              <Clock size={10} style={{ color: "var(--isp-text-muted)" }} />
              <span style={{ fontSize: 10, color: "var(--isp-text-muted)" }}>{timeAgo(router.last_seen)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => onTestDirect(router.id)}
            title="Run connection test"
            style={{ padding: "6px 10px", borderRadius: 7, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}>
            <Zap size={11} /> Test
          </button>
          <button onClick={() => onEdit(router)}
            title="Edit credentials"
            style={{ padding: "6px 10px", borderRadius: 7, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}>
            <Edit2 size={11} /> Edit
          </button>
          <button onClick={() => setExpanded(e => !e)}
            style={{ padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--isp-text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
          {[
            ["API Host",     router.host || "—"],
            ["VPN IP",       router.bridge_ip || "—"],
            ["API User",     router.router_username || "admin"],
            ["API Port",     "8728"],
            ["Password",     "••••••••"],
            ["Model",        router.model || "—"],
            ["ROS Version",  router.ros_version || "—"],
            ["Description",  router.description || "—"],
          ].map(([label, val]) => (
            <div key={label}>
              <p style={{ margin: 0, fontSize: 10, color: "var(--isp-text-muted)", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>{label}</p>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--isp-text)", fontFamily: label === "API Host" || label === "VPN IP" || label === "API User" ? "monospace" : "inherit" }}>{val}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ Main Page ═══════════════════════════════ */
export default function RouterAPIConfig() {
  const qc = useQueryClient();
  const superAdmin = isSuperAdmin();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingRouter, setEditingRouter] = useState<DbRouter | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});

  /* ── Load routers from Supabase ── */
  const { data: routers = [], isLoading } = useQuery<DbRouter[]>({
    queryKey: ["routers_api_config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,admin_id,name,host,ip_address,bridge_ip,router_secret,router_username,description,model,ros_version,status,last_seen,created_at,updated_at")
        .eq("admin_id", ADMIN_ID)
        .order("name");
      return (data ?? []) as DbRouter[];
    },
  });

  async function handleTestDirect(id: number) {
    setTestingId(id);
    try {
      const r = await fetch(`/api/router/${id}/test`);
      const j = await r.json() as TestResult & { warnings?: string[] };
      setTestResults(prev => ({ ...prev, [id]: j }));

      /* Update status in Supabase based on test result */
      await supabase.from("isp_routers").update({
        status:    j.ok ? "online" : "offline",
        last_seen: new Date().toISOString(),
        ...(j.rosVersion ? { ros_version: j.rosVersion } : {}),
      }).eq("id", id);

      qc.invalidateQueries({ queryKey: ["routers_api_config"] });
    } catch {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, error: "Request failed" } }));
    } finally { setTestingId(null); }
  }

  function afterSave() {
    qc.invalidateQueries({ queryKey: ["routers_api_config"] });
    setShowAddForm(false);
    setEditingRouter(null);
  }

  const editForm: RouterForm | undefined = editingRouter ? {
    name:             editingRouter.name,
    host:             editingRouter.host ?? "",
    bridge_ip:        editingRouter.bridge_ip ?? "",
    bridge_interface: editingRouter.bridge_interface ?? "",
    router_username:  editingRouter.router_username ?? "admin",
    router_secret:    editingRouter.router_secret ?? "",
    api_port:         8728,
    description:      editingRouter.description ?? "",
  } : undefined;

  /* ════ Read-only view for non-superadmins ════ */
  if (!superAdmin) {
    return (
      <AdminLayout>
        <div style={{ padding: "1.75rem 2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div>
            <h1 style={{ margin: 0, fontWeight: 800, fontSize: "1.4rem", color: "var(--isp-text)" }}>Router API Status</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--isp-text-muted)" }}>Connection status for all configured routers</p>
          </div>
          <NetworkTabs active="router-api-config" />

          {/* Access notice */}
          <div style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
            <Shield size={14} style={{ color: "#a78bfa", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 12, color: "#a78bfa" }}>
              <strong>Read-only view.</strong> Only SuperAdmins can edit router API credentials. Contact your platform administrator to update connection settings.
            </p>
          </div>

          {isLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--isp-text-muted)" }}>
              <Loader2 size={22} className="animate-spin" style={{ display: "block", margin: "0 auto 8px" }} />
              Loading routers…
            </div>
          ) : routers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--isp-text-muted)", fontSize: 14 }}>
              No routers configured yet. Ask your SuperAdmin to add one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {routers.map(r => (
                <RouterStatusCard
                  key={r.id} router={r}
                  onTest={handleTestDirect}
                />
              ))}
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }

  /* ════ Full superadmin view ════ */
  return (
    <AdminLayout>
      <div style={{ padding: "1.75rem 2rem", display: "flex", flexDirection: "column", gap: "1.5rem", minHeight: "100%" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontWeight: 800, fontSize: "1.4rem", color: "var(--isp-text)" }}>Router API Configuration</h1>
              <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>
                SuperAdmin
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--isp-text-muted)" }}>
              Manage MikroTik API credentials, test connections, and configure router access
            </p>
          </div>
          {!showAddForm && !editingRouter && (
            <button onClick={() => setShowAddForm(true)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 9, background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              <Plus size={14} /> Add Router
            </button>
          )}
        </div>

        {/* Network tabs */}
        <NetworkTabs active="router-api-config" />

        {/* Security notice */}
        <div style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Lock size={13} style={{ color: "#06b6d4", flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 11, color: "#06b6d4", lineHeight: 1.7 }}>
              <strong>Security best practice:</strong> Create a dedicated MikroTik API user with PPP + Hotspot permissions only (not full admin).
              On RouterOS: <code style={{ fontFamily: "monospace", background: "rgba(6,182,212,0.1)", padding: "1px 4px", borderRadius: 3 }}>
                /user add name=api-user group=read password=StrongPass
              </code> — then grant only the permissions this system needs.
              Passwords are stored encrypted in your Supabase project and never exposed on the frontend.
            </div>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && !editingRouter && (
          <RouterForm onSaved={afterSave} onCancel={() => setShowAddForm(false)} />
        )}

        {/* Edit form */}
        {editingRouter && (
          <RouterForm
            initial={editForm} routerId={editingRouter.id}
            onSaved={afterSave} onCancel={() => setEditingRouter(null)}
          />
        )}

        {/* Router list */}
        {!showAddForm && !editingRouter && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--isp-text)" }}>
                {routers.length} Router{routers.length !== 1 ? "s" : ""} Configured
              </h2>
              <button
                onClick={() => routers.forEach(r => handleTestDirect(r.id))}
                disabled={testingId !== null}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", fontSize: 12, cursor: "pointer" }}
              >
                {testingId !== null ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Test All
              </button>
            </div>

            {isLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--isp-text-muted)" }}>
                <Loader2 size={22} className="animate-spin" style={{ display: "block", margin: "0 auto 8px" }} />
                Loading…
              </div>
            ) : routers.length === 0 ? (
              <div style={{
                background: "var(--isp-section)", border: "1px dashed rgba(255,255,255,0.1)",
                borderRadius: 12, padding: "60px 20px", textAlign: "center",
              }}>
                <Server size={32} style={{ color: "var(--isp-text-muted)", margin: "0 auto 12px", display: "block" }} />
                <p style={{ fontWeight: 700, fontSize: 15, color: "var(--isp-text)", margin: "0 0 6px" }}>No routers configured</p>
                <p style={{ fontSize: 13, color: "var(--isp-text-muted)", margin: "0 0 18px" }}>
                  Add your first MikroTik router to enable automatic PPPoE and Hotspot account management.
                </p>
                <button onClick={() => setShowAddForm(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 9, background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.35)", color: "#06b6d4", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  <Plus size={14} /> Add First Router
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {routers.map(r => (
                  <div key={r.id}>
                    <AdminRouterCard
                      router={r}
                      onEdit={setEditingRouter}
                      onTestDirect={id => handleTestDirect(id)}
                    />
                    {/* Inline test result */}
                    {testResults[r.id] && (
                      <div style={{
                        marginTop: 6, borderRadius: 8, padding: "10px 14px",
                        background: testResults[r.id].ok ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
                        border: `1px solid ${testResults[r.id].ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                        display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                      }}>
                        {testResults[r.id].ok
                          ? <CheckCircle2 size={13} style={{ color: "#4ade80" }} />
                          : <XCircle size={13} style={{ color: "#f87171" }} />}
                        <span style={{ color: testResults[r.id].ok ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                          {testResults[r.id].ok
                            ? `✅ Connected — ${testResults[r.id].routerIdentity ?? "OK"} · ${testResults[r.id].latencyMs}ms`
                            : `❌ Failed — ${testResults[r.id].error ?? "Connection refused"}`}
                        </span>
                        {testResults[r.id].ok && testResults[r.id].usedVpnFallback && (
                          <span style={{ color: "#fbbf24", fontSize: 11 }}>⚠ Via VPN</span>
                        )}
                        <button onClick={() => setTestResults(p => { const c = { ...p }; delete c[r.id]; return c; })}
                          style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: 0 }}>
                          <X size={11} />
                        </button>
                      </div>
                    )}
                    {testingId === r.id && !testResults[r.id] && (
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--isp-text-muted)", paddingLeft: 4 }}>
                        <Loader2 size={11} className="animate-spin" /> Testing connection…
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* How automatic ops work */}
        <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Terminal size={14} style={{ color: "#a78bfa" }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--isp-text)" }}>How Automatic Operations Work</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
            {[
              { icon: "💳", title: "Customer Payment", desc: "When a payment is confirmed for a PPPoE or Hotspot plan" },
              { icon: "⚡", title: "API Call Triggered", desc: "Backend connects to the assigned router via the saved credentials" },
              { icon: "👤", title: "Account Created", desc: "PPP secret or Hotspot user is created automatically on the router" },
              { icon: "🔁", title: "Renewal", desc: "Expired accounts are re-enabled or updated when payment is received" },
            ].map(s => (
              <div key={s.title} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 8, padding: "12px 14px" }}>
                <p style={{ margin: "0 0 4px", fontSize: 18 }}>{s.icon}</p>
                <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 12, color: "var(--isp-text)" }}>{s.title}</p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)", lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
