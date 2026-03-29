import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Server, RotateCcw, Network, Loader2, WifiOff,
  CheckCircle2, AlertCircle, Settings, Eye, EyeOff,
  Save, PlugZap, ChevronDown, ChevronUp, Check,
  Cpu, Clock, Wifi, Globe,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────── */
interface DbRouter {
  id: number;
  name: string;
  host: string;
  status: string;
  model: string | null;
  ros_version: string | null;
  last_seen: string | null;
  bridge_interface: string | null;
  router_username: string;
  router_secret: string | null;
  bridge_ip: string | null;
}

interface ProbeResult {
  ok: boolean;
  version?: string;
  model?: string;
  boardName?: string;
  serial?: string;
  firmware?: string;
  identity?: string;
  uptime?: string;
  cpuLoad?: number;
  freeMem?: number;
  totalMem?: number;
  ipAddresses?: Array<{ address: string; interface: string }>;
  interfaces?: Array<{ name: string; type: string; running: boolean }>;
  connectedVia?: string;
  logs?: string[];
  error?: string;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const STALE_MS = 12 * 60 * 1000;
function isFresh(r: DbRouter) {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < STALE_MS;
}
function isOnline(r: DbRouter) {
  return isFresh(r) && (r.status === "online" || r.status === "connected");
}
function timeSince(d: string | null) {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 7, padding: "0.45rem 0.75rem",
  color: "var(--isp-text)", fontSize: "0.82rem",
  fontFamily: "monospace", outline: "none",
  width: "100%", boxSizing: "border-box",
  transition: "border-color 0.15s",
};

/* ─── API Panel (expandable per router) ──────────────────────── */
function ApiPanel({ router, onSaved }: { router: DbRouter; onSaved: () => void }) {
  const [host,     setHost]     = useState(router.host || router.bridge_ip || "");
  const [user,     setUser]     = useState(router.router_username || "admin");
  const [pass,     setPass]     = useState(router.router_secret || "");
  const [showPass, setShowPass] = useState(false);

  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe,   setProbe]   = useState<ProbeResult | null>(null);

  /* Reset fields if router prop changes */
  useEffect(() => {
    setHost(router.host || router.bridge_ip || "");
    setUser(router.router_username || "admin");
    setPass(router.router_secret || "");
    setProbe(null);
  }, [router.id]);

  const dirty = host !== (router.host || "") || user !== (router.router_username || "admin") || pass !== (router.router_secret || "");

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from("isp_routers").update({
        host:             host.trim(),
        router_username:  user.trim() || "admin",
        router_secret:    pass,
        updated_at:       new Date().toISOString(),
      }).eq("id", router.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const testHost = host.trim() || router.host;
    if (!testHost) { setProbe({ ok: false, error: "Enter an IP address first." }); return; }
    setTesting(true); setProbe(null);
    try {
      const res = await fetch("/api/admin/router/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     testHost,
          username: user.trim() || "admin",
          password: pass,
          bridgeIp: router.bridge_ip ?? undefined,
        }),
      });
      const data = await res.json() as ProbeResult;
      setProbe(data);
      /* ── Auto-save model/version/host into DB after successful probe ── */
      if (data.ok) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (data.model)   patch.model       = data.model;
        if (data.version) patch.ros_version = data.version;
        if (!router.host && testHost) patch.host = testHost;
        await supabase.from("isp_routers").update(patch).eq("id", router.id);
        onSaved();
      }
    } catch (e) {
      setProbe({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      borderTop: "1px solid rgba(255,255,255,0.06)",
      padding: "1.125rem 1.25rem",
      background: "rgba(6,182,212,0.025)",
    }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.875rem" }}>
        API Connection Settings — port 8728
      </div>

      {/* Fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.875rem" }}>

        {/* Host */}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            IP / Hostname
          </span>
          <input
            style={inp}
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="192.168.88.1"
            onFocus={e => (e.target.style.borderColor = "#06b6d4")}
            onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
          />
        </label>

        {/* Username */}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            API Username
          </span>
          <input
            style={inp}
            value={user}
            onChange={e => setUser(e.target.value)}
            placeholder="admin"
            onFocus={e => (e.target.style.borderColor = "#06b6d4")}
            onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
          />
        </label>

        {/* Password */}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            API Password
          </span>
          <div style={{ position: "relative" }}>
            <input
              type={showPass ? "text" : "password"}
              style={{ ...inp, paddingRight: "2.25rem" }}
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="router password"
              onFocus={e => (e.target.style.borderColor = "#06b6d4")}
              onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
            />
            <button
              onClick={() => setShowPass(s => !s)}
              style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: "0.15rem", display: "flex" }}
            >
              {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </label>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>

        {/* Test Connection */}
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.375rem",
            padding: "0.45rem 1rem", borderRadius: 7,
            background: testing ? "rgba(255,255,255,0.06)" : "rgba(99,102,241,0.15)",
            border: `1px solid ${testing ? "rgba(255,255,255,0.1)" : "rgba(99,102,241,0.4)"}`,
            color: testing ? "var(--isp-text-muted)" : "#a5b4fc",
            fontWeight: 700, fontSize: "0.8rem",
            cursor: testing ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {testing
            ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Testing…</>
            : <><PlugZap size={13} /> Test Connection</>}
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.375rem",
            padding: "0.45rem 1rem", borderRadius: 7,
            background: saved ? "rgba(34,197,94,0.15)"
              : dirty ? "linear-gradient(135deg,#06b6d4,#0284c7)"
              : "rgba(255,255,255,0.05)",
            border: saved ? "1px solid rgba(34,197,94,0.4)" : "none",
            color: saved ? "#4ade80" : dirty ? "white" : "var(--isp-text-muted)",
            fontWeight: 700, fontSize: "0.8rem",
            cursor: saving || !dirty ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            boxShadow: dirty && !saved ? "0 3px 10px rgba(6,182,212,0.3)" : "none",
          }}
        >
          {saving   ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
          : saved   ? <><Check size={13} /> Saved!</>
          : <><Save size={13} /> Save Credentials</>}
        </button>

        {/* Dirty indicator */}
        {dirty && !saving && (
          <span style={{ fontSize: "0.7rem", color: "#fbbf24" }}>Unsaved changes</span>
        )}
      </div>

      {/* Probe result */}
      {probe && (
        <div style={{
          marginTop: "0.875rem",
          padding: "0.875rem 1rem",
          background: probe.ok ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.06)",
          border: `1px solid ${probe.ok ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.25)"}`,
          borderRadius: 9,
        }}>
          {probe.ok ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                <span style={{ fontWeight: 700, fontSize: "0.83rem", color: "#22c55e" }}>Connected successfully</span>
                {probe.connectedVia?.includes("VPN") && (
                  <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#a78bfa", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 4, padding: "0.1rem 0.45rem" }}>
                    via VPN
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem" }}>
                {[
                  [<Cpu size={11} />, "Model",    probe.model || probe.boardName || "—"],
                  [<Globe size={11} />, "RouterOS", probe.version ? `v${probe.version}` : "—"],
                  [<Server size={11} />, "Identity", probe.identity || "—"],
                  [<Clock size={11} />, "Uptime",   probe.uptime || "—"],
                  [<Wifi size={11} />, "CPU",      probe.cpuLoad !== undefined ? `${probe.cpuLoad}%` : "—"],
                  [<Wifi size={11} />, "RAM",      probe.freeMem !== undefined && probe.totalMem ? `${probe.freeMem}/${probe.totalMem} MB` : "—"],
                ].map(([icon, label, val], i) => (
                  <div key={i} style={{ fontSize: "0.72rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "var(--isp-text-muted)", marginBottom: "0.1rem" }}>
                      <span style={{ color: "#22c55e" }}>{icon as React.ReactNode}</span>{label as string}
                    </div>
                    <div style={{ fontFamily: "monospace", color: "var(--isp-text)", fontWeight: 600 }}>{val as string}</div>
                  </div>
                ))}
              </div>
              {probe.ipAddresses && probe.ipAddresses.length > 0 && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>
                  IPs: {probe.ipAddresses.map(a => `${a.address} (${a.interface})`).join(", ")}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.875rem" }}>
                <AlertCircle size={14} style={{ color: "#f87171", flexShrink: 0, marginTop: "0.1rem" }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.83rem", color: "#f87171", marginBottom: "0.3rem" }}>Connection failed</div>
                  <div style={{ fontSize: "0.77rem", color: "#fca5a5", lineHeight: 1.6 }}>{probe.error}</div>
                </div>
              </div>
              {/* ── RouterOS setup commands ── */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "0.75rem 0.875rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.6rem" }}>
                  Run these commands in your router terminal to enable API access:
                </div>
                {[
                  "/ip service set api enabled=yes",
                  `/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/24 action=accept comment="OcholaNet API" place-before=0`,
                  `/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=${router.bridge_ip ?? "192.168.88.0"}/24 action=accept comment="OcholaNet API" place-before=0`,
                ].map((cmd, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
                    <code style={{ flex: 1, fontFamily: "monospace", fontSize: "0.7rem", color: "#a3e635", background: "rgba(0,0,0,0.25)", padding: "0.25rem 0.5rem", borderRadius: 5, wordBreak: "break-all" }}>{cmd}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(cmd)}
                      style={{ flexShrink: 0, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "var(--isp-text-muted)", cursor: "pointer", fontSize: "0.65rem", padding: "0.2rem 0.5rem", fontFamily: "inherit" }}
                    >copy</button>
                  </div>
                ))}
                <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: "var(--isp-text-muted)", lineHeight: 1.6 }}>
                  Or re-run the install script — API rules are now added automatically in step 6.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Router Row ──────────────────────────────────────────────── */
function RouterRow({ router, index, onReconfigure, onPorts, onSaved }: {
  router: DbRouter;
  index: number;
  onReconfigure: (id: number) => void;
  onPorts: (id: number) => void;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const online = isOnline(router);

  return (
    <div style={{
      background: "var(--isp-card)",
      border: `1px solid ${expanded ? "rgba(6,182,212,0.25)" : online ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 11, overflow: "hidden",
      transition: "border-color 0.2s",
    }}>
      {/* ── Main row ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "2fr 1.5fr 1fr auto auto auto",
        gap: "0.75rem", alignItems: "center",
        padding: "0.875rem 1.125rem",
      }}>

        {/* Name + model */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: online ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${online ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Server size={16} style={{ color: online ? "#22c55e" : "#64748b" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--isp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {index + 1}. {router.name}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", marginTop: "0.1rem" }}>
              {router.model || "MikroTik"}
              {router.ros_version ? ` · ROS v${router.ros_version}` : ""}
            </div>
          </div>
        </div>

        {/* IP + last seen */}
        <div style={{ minWidth: 0 }}>
          <code style={{
            fontFamily: "monospace", fontSize: "0.78rem",
            color: router.host ? "var(--isp-text)" : "var(--isp-text-muted)",
            display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {router.host || "no IP set"}
          </code>
          <div style={{ fontSize: "0.66rem", color: "var(--isp-text-muted)", marginTop: "0.1rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <Clock size={9} /> {timeSince(router.last_seen)}
          </div>
        </div>

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          {online
            ? <><CheckCircle2 size={13} style={{ color: "#22c55e" }} /><span style={{ fontSize: "0.73rem", fontWeight: 700, color: "#22c55e" }}>Online</span></>
            : <><AlertCircle  size={13} style={{ color: "#64748b" }} /><span style={{ fontSize: "0.73rem", fontWeight: 700, color: "#64748b" }}>Offline</span></>
          }
        </div>

        {/* API settings toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          title="API connection settings"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.35rem",
            padding: "0.43rem 0.75rem", borderRadius: 7,
            background: expanded ? "rgba(6,182,212,0.15)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${expanded ? "rgba(6,182,212,0.4)" : "rgba(255,255,255,0.1)"}`,
            color: expanded ? "#06b6d4" : "var(--isp-text-muted)",
            fontWeight: 700, fontSize: "0.78rem",
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "all 0.15s",
          }}
        >
          <Settings size={12} />
          API
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {/* Reconfigure */}
        <button
          onClick={() => onReconfigure(router.id)}
          title="Re-run setup script"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.35rem",
            padding: "0.43rem 0.75rem", borderRadius: 7,
            background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
            color: "#fbbf24", fontWeight: 700, fontSize: "0.78rem",
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "background 0.15s",
          }}
          onMouseOver={e => (e.currentTarget.style.background = "rgba(251,191,36,0.18)")}
          onMouseOut={e  => (e.currentTarget.style.background = "rgba(251,191,36,0.1)")}
        >
          <RotateCcw size={12} /> Reconfigure
        </button>

        {/* Ports */}
        <button
          onClick={() => onPorts(router.id)}
          title="Bridge port assignment"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.35rem",
            padding: "0.43rem 0.75rem", borderRadius: 7,
            background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)",
            color: "#06b6d4", fontWeight: 700, fontSize: "0.78rem",
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            transition: "background 0.15s",
          }}
          onMouseOver={e => (e.currentTarget.style.background = "rgba(6,182,212,0.18)")}
          onMouseOut={e  => (e.currentTarget.style.background = "rgba(6,182,212,0.1)")}
        >
          <Network size={12} /> Ports
        </button>
      </div>

      {/* ── Expandable API panel ── */}
      {expanded && <ApiPanel router={router} onSaved={onSaved} />}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function ReplaceRouter() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: routers = [], isLoading } = useQuery<DbRouter[]>({
    queryKey: ["isp_routers_rr3", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_routers")
        .select("id,name,host,status,model,ros_version,last_seen,bridge_interface,router_username,router_secret,bridge_ip")
        .eq("admin_id", ADMIN_ID)
        .order("created_at", { ascending: true });
      return (data ?? []) as DbRouter[];
    },
    refetchInterval: 12_000,
  });

  const onlineCount = routers.filter(isOnline).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["isp_routers_rr3", ADMIN_ID] });

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem", maxWidth: 960 }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.2rem" }}>
            Routers
          </h1>
          <p style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", margin: 0 }}>
            {routers.length} router{routers.length !== 1 ? "s" : ""} · {onlineCount} online
            {" · "}Click <strong style={{ color: "#06b6d4" }}>API</strong> on any row to set credentials and test the connection.
          </p>
        </div>

        <NetworkTabs active="replace-router" />

        {/* Router rows */}
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "2rem", color: "var(--isp-text-muted)", fontSize: "0.85rem" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
            Loading routers…
          </div>
        ) : routers.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem",
            padding: "3rem 1.5rem", textAlign: "center",
            background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)", borderRadius: 12,
          }}>
            <WifiOff size={28} style={{ color: "#64748b" }} />
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--isp-text)" }}>No routers yet</div>
            <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>Use <strong>Self Install</strong> to add your first router.</div>
            <button
              onClick={() => navigate("/admin/network/self-install")}
              style={{ marginTop: "0.25rem", padding: "0.5rem 1.25rem", borderRadius: 7, background: "linear-gradient(135deg,#06b6d4,#0284c7)", border: "none", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
            >
              Go to Self Install
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {routers.map((r, i) => (
              <RouterRow
                key={r.id}
                router={r}
                index={i}
                onReconfigure={id => navigate(`/admin/network/self-install?reconfigure=${id}`)}
                onPorts={id => navigate(`/admin/network/bridge-ports?routerId=${id}`)}
                onSaved={refresh}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div style={{ background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.14)", borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.76rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
          <strong style={{ color: "#06b6d4" }}>API</strong> — set the router IP, API username and password, then click <em>Test Connection</em> to verify the MikroTik API is reachable on port 8728.{" "}
          <strong style={{ color: "#fbbf24" }}>Reconfigure</strong> — re-apply the setup script.{" "}
          <strong style={{ color: "#06b6d4" }}>Ports</strong> — assign bridge ports for the hotspot.
        </div>

      </div>
    </AdminLayout>
  );
}
