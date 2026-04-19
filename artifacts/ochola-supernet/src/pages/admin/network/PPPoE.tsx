import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import { Copy, Check, Loader2, RefreshCw, HelpCircle, Info } from "lucide-react";

const BASE_DOMAIN = "isplatty.org";

interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null; ros_version: string;
  ports: string | null; pppoe_mode: string | null;
  wan_interface: string | null; bridge_interface: string | null;
  bridge_ip: string | null; hotspot_dns_name: string | null;
  pppoe_configured_at: string | null; token: string;
}

type Mode = "pppoe_only" | "pppoe_vlan";
type RosVer = "6" | "7";

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function detectMajor(ver: string | null | undefined): RosVer {
  const m = (ver ?? "").match(/^(\d+)/);
  return m && parseInt(m[1]) >= 7 ? "7" : "6";
}

/* ── Copy button ── */
function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2200);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.3rem",
        padding: "0.3rem 0.75rem", borderRadius: 5,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.08)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.15)"}`,
        color: copied ? "#4ade80" : "#c7d2fe",
        fontSize: "0.73rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

/* ── Step command panel (orange style from reference) ── */
function StepPanel({ step, title, cmd, filePath }: {
  step: number; title: string; cmd: string; filePath?: string;
}) {
  return (
    <div style={{
      background: "rgba(234,88,12,0.06)",
      border: "1px solid rgba(234,88,12,0.25)",
      borderRadius: 10, overflow: "hidden",
    }}>
      <div style={{
        background: "rgba(234,88,12,0.12)",
        borderBottom: "1px solid rgba(234,88,12,0.2)",
        padding: "0.55rem 1rem",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span style={{
          width: 20, height: 20, borderRadius: "50%",
          background: "linear-gradient(135deg,#f97316,#ea580c)",
          color: "white", fontSize: "0.65rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{step}</span>
        <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#fb923c" }}>{title}</span>
      </div>
      <div style={{ padding: "0.75rem 1rem" }}>
        <div style={{
          background: "#060b12",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 7, padding: "0.65rem 0.875rem",
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: "0.75rem",
        }}>
          <code style={{
            fontFamily: "monospace", fontSize: "0.78rem", color: "#c7d2fe",
            wordBreak: "break-all", lineHeight: 1.7, flex: 1,
          }}>{cmd}</code>
          <CopyBtn text={cmd} />
        </div>
        {filePath && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "#fb923c", fontFamily: "monospace" }}>
            Target file path: {filePath}
          </p>
        )}
      </div>
    </div>
  );
}

export default function PPPoE() {
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("pppoe_only");
  const [rosVer, setRosVer] = useState<RosVer>("6");
  const [vlanId, setVlanId] = useState("200");
  const [vlanSubnet, setVlanSubnet] = useState("192.168.178.1");
  const [baseBridge, setBaseBridge] = useState("hotspot-bridge");
  const [loadingIfaces, setLoadingIfaces] = useState(false);
  const [ifaceMsg, setIfaceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [regen, setRegen] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: adminInfo } = useQuery({
    queryKey: ["admin_info_pppoe", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase
        .from("isp_admins").select("name,subdomain").eq("id", ADMIN_ID).single();
      return data as { name: string; subdomain: string | null } | null;
    },
  });

  const adminSubdomain = adminInfo?.subdomain ?? null;
  const scriptHost = adminSubdomain
    ? `https://${adminSubdomain}.${BASE_DOMAIN}`
    : window.location.origin;

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["isp_routers_pppoe", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase.from("isp_routers").select("*").eq("admin_id", ADMIN_ID);
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  useEffect(() => {
    if (routers.length > 0 && selectedRouterId === null) {
      const first = routers[0];
      setSelectedRouterId(first.id);
      setRosVer(detectMajor(first.ros_version));
    }
  }, [routers, selectedRouterId]);

  /* Pre-populate VLAN fields from stored pppoe_mode when router changes */
  const selectedRouter = useMemo(
    () => routers.find(r => r.id === selectedRouterId) ?? null,
    [routers, selectedRouterId],
  );
  useEffect(() => {
    if (!selectedRouter) return;
    const pm = selectedRouter.pppoe_mode ?? "";
    if (pm.startsWith("pppoe_vlan")) {
      const parts = pm.split(":");
      setMode("pppoe_vlan");
      setVlanId(parts[1] && parts[1] !== "" ? parts[1] : "200");
      setVlanSubnet(parts[2] && parts[2] !== "" ? parts[2] : "192.168.178.1");
      setBaseBridge(parts[3] && parts[3] !== "" ? parts[3] : "hotspot-bridge");
    } else if (pm === "pppoe_only") {
      setMode("pppoe_only");
      setVlanId("200");
      setVlanSubnet("192.168.178.1");
      setBaseBridge("hotspot-bridge");
    } else {
      setVlanId("200");
      setVlanSubnet("192.168.178.1");
      setBaseBridge("hotspot-bridge");
    }
    setSaveMsg(null);
  }, [selectedRouter?.id]);

  /* Save per-router VLAN config to pppoe_mode column */
  async function handleSaveVlanConfig() {
    if (!selectedRouter) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const vid = vlanId.trim() || "200";
      const sub = vlanSubnet.trim() || "192.168.178.1";
      const bb  = baseBridge.trim() || "hotspot-bridge";
      const modeStr = mode === "pppoe_vlan"
        ? `pppoe_vlan:${vid}:${sub}:${bb}`
        : mode;
      const { error } = await supabase
        .from("isp_routers")
        .update({ pppoe_mode: modeStr })
        .eq("id", selectedRouter.id);
      if (error) throw error;
      setSaveMsg({ ok: true, text: "VLAN settings saved to router." });
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  const router = useMemo(
    () => routers.find(r => r.id === selectedRouterId) ?? null,
    [routers, selectedRouterId],
  );

  /* Derived commands */
  const slug = router ? slugify(router.name) : "router";

  const fetchCmd = useMemo(() => {
    if (!router) return "";
    if (mode === "pppoe_only") {
      const file = `pppoe/pppoeonly-${slug}.rsc`;
      return `/tool fetch url="${scriptHost}/api/pppoe-script/${router.id}/pppoe_only/${rosVer}" mode=https dst-path=${file} check-certificate=no`;
    } else {
      /* Use the router-scoped path-param URL — RouterOS /tool fetch drops `?` query
         strings, so we use /api/scripts/vlanpppoe/:routerId.rsc (no query string).
         The endpoint reads all saved VLAN settings (ID, gateway, bridge) from pppoe_mode
         automatically, so the generated script always matches exactly what was saved. */
      const file = `pppoe/vlanpppoe-${slug}.rsc`;
      return `/tool fetch url="${scriptHost}/api/scripts/vlanpppoe/${router.id}.rsc" mode=https dst-path=${file} check-certificate=no`;
    }
  }, [router, mode, rosVer, vlanId, baseBridge, scriptHost, slug, regen]);

  const { importCmd, targetFile } = useMemo(() => {
    if (mode === "pppoe_only") {
      const f = `pppoe/pppoeonly-${slug}.rsc`;
      return { importCmd: `/import file-name=${f}`, targetFile: f };
    } else {
      const f = `pppoe/vlanpppoe-${slug}.rsc`;
      return { importCmd: `/import file-name=${f}`, targetFile: f };
    }
  }, [mode, slug, regen]);

  const downloadUrl = router
    ? mode === "pppoe_only"
      ? `/api/pppoe-script/${router.id}/pppoe_only/${rosVer}`
      : `/api/scripts/vlanpppoe/${router.id}.rsc`
    : "#";

  /* Load Interfaces — pings the router's API to confirm bridge state */
  async function handleLoadInterfaces() {
    if (!router) return;
    setLoadingIfaces(true);
    setIfaceMsg(null);
    try {
      const res = await fetch(`/api/bridge-ports/${router.id}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const ports: string[] = Array.isArray(data?.ports) ? data.ports : [];
        const bridgeOk = mode === "pppoe_only"
          ? data?.bridge === "bridge-pppoe" || ports.length > 0
          : data?.bridge === baseBridge.trim() || ports.length > 0;
        setIfaceMsg({
          ok: bridgeOk,
          text: bridgeOk
            ? `Interfaces loaded — ${ports.length} port(s) found`
            : "Bridge not yet configured on router",
        });
      } else {
        setIfaceMsg({ ok: false, text: "Could not reach router API — check firewall / VPN" });
      }
    } catch {
      setIfaceMsg({ ok: false, text: "Router unreachable — run the fetch+import commands first" });
    } finally {
      setLoadingIfaces(false);
    }
  }

  return (
    <AdminLayout>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .ppoe-radio:hover{background:rgba(255,255,255,0.05)!important}
        .ppoe-btn-load:hover{background:rgba(37,99,235,0.18)!important}
        .ppoe-btn-regen:hover{filter:brightness(1.1)}
        .ppoe-btn-help:hover{background:rgba(255,255,255,0.15)!important}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
          PPPoE Setup Wizard
        </h1>

        <NetworkTabs active="pppoe" />

        {/* ── Header banner ── */}
        <div style={{
          background: "linear-gradient(135deg,rgba(37,99,235,0.18),rgba(2,132,199,0.22))",
          border: "1px solid var(--isp-accent-border)",
          borderRadius: 12, padding: "0.875rem 1.25rem",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
        }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#67e8f9" }}>
              PPPoE Sign In — Show Expiry Page When PPPoE Account Expires
            </p>
          </div>
          <a
            href="https://isplatty.org/docs/pppoe"
            target="_blank"
            rel="noreferrer"
            className="ppoe-btn-help"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem",
              padding: "0.35rem 0.875rem", borderRadius: 7,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white", fontWeight: 700, fontSize: "0.75rem",
              textDecoration: "none", whiteSpace: "nowrap", transition: "all 0.15s",
              flexShrink: 0,
            }}
          >
            <HelpCircle size={13} /> Need Help?
          </a>
        </div>

        {/* ── Info box ── */}
        <div style={{
          background: "rgba(234,179,8,0.06)",
          border: "1px solid rgba(234,179,8,0.22)",
          borderRadius: 10, padding: "0.875rem 1.1rem",
          display: "flex", gap: "0.75rem",
        }}>
          <Info size={16} style={{ color: "#facc15", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: "0.78rem", color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
            <strong style={{ color: "var(--isp-text)" }}>How it works:</strong>{" "}
            Pick a router, click <span style={{ color: "#facc15", fontWeight: 700 }}>"Load Interfaces"</span> to create
            pppoe_bridge (if needed) and list ports. Choose{" "}
            <span style={{ color: "#facc15", fontWeight: 700 }}>Mode A</span>{" "}
            (you will assign a new bridge just to deal with PPPoE) or{" "}
            <span style={{ color: "#facc15", fontWeight: 700 }}>Mode B</span>{" "}
            (use Hotspot and PPPoE on the same port via VLAN).
            Choose Mode B even if your router doesn't have the VLAN option — it will still work.
            <br />
            <span style={{ color: "#a3e635" }}>• Mode A</span>{" — "}
            <strong style={{ color: "var(--isp-text)" }}>pppoe_bridge</strong>{" "}
            (Dedicated ports for PPPoE only — don't want to mix hotspot and PPPoE)
            <br />
            <span style={{ color: "#a3e635" }}>• Mode B</span>{" — "}
            <strong style={{ color: "var(--isp-text)" }}>Share hotspot and PPPoE on the same port</strong>{" "}
            (The port for PPPoE and hotspot is always named hotspot-bridge in our system)
            <br />
            <span style={{ color: "#a3e635" }}>• PPPoE Packages</span>{" — "}
            Go to <strong style={{ color: "#67e8f9" }}>Packages › PPPoE Plans</strong>{" "}
            (click edit and under expired pool choose the new pool named{" "}
            <code style={{ color: "#fb923c", fontSize: "0.73rem" }}>expired_pppoe_pool</code>{" "}
            to finalise the settings)
          </div>
        </div>

        {/* ── Main card ── */}
        <div style={{
          maxWidth: 780,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          borderRadius: 14, overflow: "hidden",
        }}>

          {/* Router row */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, color: "#facc15",
              textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
            }}>Router</span>
            <select
              value={selectedRouterId ?? ""}
              onChange={e => {
                const id = Number(e.target.value);
                setSelectedRouterId(id);
                setIfaceMsg(null);
                const r = routers.find(x => x.id === id);
                if (r) setRosVer(detectMajor(r.ros_version));
              }}
              disabled={loadingRouters}
              style={{
                flex: 1, background: "var(--isp-inner-card)",
                border: "1px solid var(--isp-border)", borderRadius: 8,
                padding: "0.4rem 0.75rem", color: "var(--isp-text)",
                fontSize: "0.8125rem", fontFamily: "inherit", outline: "none", cursor: "pointer",
              }}
            >
              {loadingRouters && <option>Loading…</option>}
              {routers.length === 0 && !loadingRouters && <option>No routers found</option>}
              {routers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.host || "no IP"} {r.status === "online" ? "🟢" : "🔴"}
                </option>
              ))}
            </select>

            <button
              onClick={handleLoadInterfaces}
              disabled={!router || loadingIfaces}
              className="ppoe-btn-load"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.35rem",
                padding: "0.4rem 0.875rem", borderRadius: 7,
                background: "rgba(37,99,235,0.1)",
                border: "1px solid var(--isp-accent-border)",
                color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.75rem",
                cursor: router ? "pointer" : "not-allowed",
                fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap",
                opacity: !router ? 0.5 : 1,
              }}
            >
              {loadingIfaces
                ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Loading…</>
                : "Load Interfaces"
              }
            </button>

            <span style={{
              fontSize: "0.7rem", fontWeight: 700, color: "#facc15",
              textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
            }}>Setup Mode</span>
          </div>

          {/* Interface load result */}
          {ifaceMsg && (
            <div style={{
              padding: "0.5rem 1.25rem",
              borderBottom: "1px solid var(--isp-border-subtle)",
              background: ifaceMsg.ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
              fontSize: "0.75rem", fontWeight: 600,
              color: ifaceMsg.ok ? "#4ade80" : "#f87171",
            }}>
              {ifaceMsg.ok ? "✓" : "✗"} {ifaceMsg.text}
            </div>
          )}

          {/* Mode A / B radios */}
          <div style={{
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              {[
                { id: "pppoe_only" as Mode, label: "A) Normal bridge (pppoe_bridge)" },
                { id: "pppoe_vlan"  as Mode, label: "B) VLAN under hotspot-bridge" },
              ].map(opt => {
                const active = mode === opt.id;
                return (
                  <label
                    key={opt.id}
                    className="ppoe-radio"
                    style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.45rem 0.875rem", borderRadius: 8, cursor: "pointer",
                      background: active ? "rgba(37,99,235,0.1)" : "transparent",
                      border: `1px solid ${active ? "var(--isp-accent-border)" : "transparent"}`,
                      transition: "all 0.14s",
                    }}
                  >
                    <input
                      type="radio"
                      name="pppoe_mode"
                      value={opt.id}
                      checked={active}
                      onChange={() => { setMode(opt.id); setIfaceMsg(null); }}
                      style={{ accentColor: "var(--isp-accent)", width: 14, height: 14, cursor: "pointer" }}
                    />
                    <span style={{
                      fontSize: "0.82rem", fontWeight: active ? 700 : 500,
                      color: active ? "var(--isp-accent)" : "var(--isp-text)",
                    }}>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* VLAN Details — only for Mode B */}
          {mode === "pppoe_vlan" && (
            <div style={{
              padding: "0.875rem 1.25rem",
              borderBottom: "1px solid var(--isp-border-subtle)",
              background: "var(--isp-accent-glow)",
              animation: "fadeIn 0.18s ease",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem", gap: "0.75rem", flexWrap: "wrap" }}>
                <p style={{
                  margin: 0, fontSize: "0.7rem", fontWeight: 700,
                  color: "#facc15", textTransform: "uppercase", letterSpacing: "0.06em",
                }}>VLAN Details</p>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {saveMsg && (
                    <span style={{ fontSize: "0.72rem", fontWeight: 600, color: saveMsg.ok ? "#4ade80" : "#f87171" }}>
                      {saveMsg.ok ? "✓" : "✗"} {saveMsg.text}
                    </span>
                  )}
                  <button
                    onClick={() => void handleSaveVlanConfig()}
                    disabled={!router || saving}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "0.3rem 0.75rem", borderRadius: 6,
                      background: saving ? "rgba(37,99,235,0.08)" : "rgba(37,99,235,0.15)",
                      border: "1px solid rgba(37,99,235,0.4)",
                      color: "var(--isp-accent)", fontWeight: 700, fontSize: "0.72rem",
                      cursor: !router || saving ? "not-allowed" : "pointer",
                      fontFamily: "inherit", opacity: !router ? 0.5 : 1, transition: "all 0.14s",
                    }}
                  >
                    {saving ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : null}
                    {saving ? "Saving…" : "Save VLAN Settings"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 110px" }}>
                  <label style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", display: "block", marginBottom: 4 }}>
                    VLAN ID
                  </label>
                  <input
                    type="number"
                    value={vlanId}
                    min={1} max={4094}
                    onChange={e => setVlanId(e.target.value)}
                    style={{
                      width: "100%", background: "var(--isp-inner-card)",
                      border: "1px solid var(--isp-border)", borderRadius: 7,
                      padding: "0.4rem 0.625rem", color: "var(--isp-text)",
                      fontSize: "0.85rem", fontFamily: "monospace", outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: "0 0 170px" }}>
                  <label style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", display: "block", marginBottom: 4 }}>
                    VLAN Gateway IP
                  </label>
                  <input
                    type="text"
                    value={vlanSubnet}
                    onChange={e => setVlanSubnet(e.target.value)}
                    placeholder="192.168.178.1"
                    style={{
                      width: "100%", background: "var(--isp-inner-card)",
                      border: "1px solid var(--isp-border)", borderRadius: 7,
                      padding: "0.4rem 0.625rem", color: "var(--isp-text)",
                      fontSize: "0.85rem", fontFamily: "monospace", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", display: "block", marginBottom: 4 }}>
                    Hotspot Bridge
                  </label>
                  <input
                    type="text"
                    value={baseBridge}
                    onChange={e => setBaseBridge(e.target.value)}
                    placeholder="hotspot-bridge"
                    style={{
                      width: "100%", background: "var(--isp-inner-card)",
                      border: "1px solid var(--isp-border)", borderRadius: 7,
                      padding: "0.4rem 0.625rem", color: "var(--isp-text)",
                      fontSize: "0.85rem", fontFamily: "monospace", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.73rem", color: "var(--isp-text-muted)" }}>
                VLAN <span style={{ color: "#facc15", fontWeight: 600 }}>{vlanId || "200"}</span> on{" "}
                <span style={{ color: "var(--isp-accent)", fontWeight: 600 }}>
                  {baseBridge.trim() || "hotspot-bridge"}
                </span>
                {" "}— gateway <span style={{ color: "#fb923c", fontWeight: 600, fontFamily: "monospace" }}>
                  {vlanSubnet.trim() || "192.168.178.1"}/24
                </span>.
                {" "}Save to persist settings; the router-specific script URL will use these values.
              </p>
            </div>
          )}

          {/* ROS version row */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.65rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
              ROS Version
            </span>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              {(["6", "7"] as RosVer[]).map(v => {
                const active = rosVer === v;
                return (
                  <button
                    key={v}
                    onClick={() => setRosVer(v)}
                    style={{
                      padding: "0.25rem 0.75rem", borderRadius: 6, fontFamily: "inherit",
                      fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", transition: "all 0.14s",
                      background: active ? "var(--isp-accent-glow)" : "var(--isp-inner-card)",
                      border: `1px solid ${active ? "rgba(37,99,235,0.5)" : "var(--isp-border)"}`,
                      color: active ? "var(--isp-accent)" : "var(--isp-text-muted)",
                    }}
                  >
                    ROS {v}
                  </button>
                );
              })}
            </div>
            {router && (
              <span style={{ fontSize: "0.71rem", color: "var(--isp-text-muted)", marginLeft: "auto", fontFamily: "monospace" }}>
                Router reports: {router.ros_version || "—"}
              </span>
            )}
          </div>

          {/* Steps */}
          <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            {router ? (
              <>
                <StepPanel
                  step={1}
                  title="Download configuration script"
                  cmd={fetchCmd}
                />
                <StepPanel
                  step={2}
                  title="Import configuration"
                  cmd={importCmd}
                  filePath={targetFile}
                />

                {/* Download link + Regenerate */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", paddingTop: "0.25rem" }}>
                  <button
                    onClick={() => setRegen(r => r + 1)}
                    className="ppoe-btn-regen"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.4rem",
                      padding: "0.5rem 1.1rem", borderRadius: 8,
                      background: "linear-gradient(135deg,#f97316,#ea580c)",
                      border: "none", color: "white",
                      fontWeight: 700, fontSize: "0.8rem",
                      cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                    }}
                  >
                    <RefreshCw size={13} /> Regenerate RSC Files
                  </button>

                  <a
                    href={downloadUrl}
                    download
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.35rem",
                      padding: "0.45rem 0.875rem", borderRadius: 7,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "var(--isp-text-muted)",
                      fontWeight: 600, fontSize: "0.75rem", textDecoration: "none",
                    }}
                  >
                    Download .rsc
                  </a>
                </div>

                {/* Verify commands */}
                <div style={{
                  background: "rgba(74,222,128,0.04)",
                  border: "1px solid rgba(74,222,128,0.13)",
                  borderRadius: 9, padding: "0.75rem 0.875rem",
                }}>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.73rem", fontWeight: 700, color: "#4ade80" }}>
                    Step 3 — Verify (run in Winbox Terminal)
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    {[
                      "/interface pppoe-server server print",
                      "/ppp profile print",
                      mode === "pppoe_vlan" ? "/interface vlan print" : "/ip pool print",
                    ].map(cmd => (
                      <div key={cmd} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        background: "#060b12", borderRadius: 6, padding: "0.45rem 0.75rem", gap: "0.75rem",
                      }}>
                        <code style={{ fontFamily: "monospace", fontSize: "0.76rem", color: "#86efac", flex: 1 }}>
                          {cmd}
                        </code>
                        <CopyBtn text={cmd} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: "1.5rem 0", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
                  {loadingRouters ? "Loading routers…" : "Select a router above to generate commands"}
                </p>
                {!loadingRouters && routers.length === 0 && (
                  <a href="/admin/network/add-router" style={{ color: "var(--isp-accent)", fontWeight: 600, fontSize: "0.8rem" }}>
                    Add a router first →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </AdminLayout>
  );
}
