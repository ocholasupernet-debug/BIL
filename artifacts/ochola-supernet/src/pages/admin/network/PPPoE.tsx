import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Shield, Wifi, Copy, Check, Loader2,
  Zap, Terminal, Download,
} from "lucide-react";

const BASE_DOMAIN = "isplatty.org";

/* ══════════════════════════ Types ══════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; status: string;
  router_username: string; router_secret: string | null; ros_version: string;
  ports: string | null; pppoe_mode: string | null;
  wan_interface: string | null; bridge_interface: string | null;
  bridge_ip: string | null; hotspot_dns_name: string | null;
  pppoe_configured_at: string | null; token: string;
}

type Mode = "pppoe_only" | "pppoe_over_hotspot";

/* ══════════════════════════ Helpers ══════════════════════════ */
function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* ══════════════════════════ Copy button ══════════════════════════ */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2200);
      })}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.35rem 0.875rem", borderRadius: 6,
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(99,102,241,0.18)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : "rgba(99,102,241,0.4)"}`,
        color: copied ? "#4ade80" : "#a5b4fc",
        fontSize: "0.74rem", fontWeight: 700, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0,
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ══════════════════════════ Command block ══════════════════════════ */
function CmdBlock({ step, title, cmd, note }: { step: number; title: string; cmd: string; note?: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "linear-gradient(135deg,#06b6d4,#0284c7)",
          color: "white", fontSize: "0.68rem", fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>{step}</span>
        <span style={{ fontWeight: 700, fontSize: "0.84rem", color: "var(--isp-text)" }}>{title}</span>
      </div>
      {note && (
        <p style={{ margin: "0 0 0.5rem 1.875rem", fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.6 }}>
          {note}
        </p>
      )}
      <div style={{
        background: "#060b12",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8, padding: "0.875rem 1rem",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem",
      }}>
        <code style={{
          fontFamily: "monospace", fontSize: "0.8rem", color: "#c7d2fe",
          wordBreak: "break-all", lineHeight: 1.7, flex: 1,
        }}>
          {cmd}
        </code>
        <CopyBtn text={cmd} />
      </div>
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
type RosVer = "6" | "7";

function detectMajor(ver: string | null | undefined): RosVer {
  const m = (ver ?? "").match(/^(\d+)/);
  return m && parseInt(m[1]) >= 7 ? "7" : "6";
}

export default function PPPoE() {
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("pppoe_only");
  const [generated, setGenerated] = useState(false);
  const [rosVer, setRosVer] = useState<RosVer>("6");

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

  const router = useMemo(
    () => routers.find(r => r.id === selectedRouterId) ?? null,
    [routers, selectedRouterId],
  );

  /* Derived filenames & commands */
  const slug         = router ? slugify(router.name) : "router";
  const configFile   = mode === "pppoe_only" ? `pppoe-only-${slug}.rsc` : `pppoe-hotspot-${slug}.rsc`;
  const fetchCmd     = router
    ? `/tool fetch url="${scriptHost}/api/pppoe-script/${router.id}/${mode}/${rosVer}" dst-path=${configFile} mode=https check-certificate=no`
    : "";
  const importCmd    = `/import ${configFile}`;
  const downloadUrl  = router
    ? `/api/pppoe-script/${router.id}/${mode}/${rosVer}`
    : "#";

  const MODES: { id: Mode; label: string; sub: string; icon: React.ReactNode; color: string; border: string }[] = [
    {
      id: "pppoe_only",
      label: "PPPoE Only",
      sub: "Pure PPPoE dial-up. Clients authenticate via username & password. Best for fiber/cable subscribers.",
      icon: <Shield size={22} style={{ color: "#06b6d4" }} />,
      color: "rgba(6,182,212,0.08)", border: "rgba(6,182,212,0.35)",
    },
    {
      id: "pppoe_over_hotspot",
      label: "PPPoE over Hotspot",
      sub: "Combines a hotspot captive portal with a PPPoE server on the same bridge. Supports both auth methods simultaneously.",
      icon: <Wifi size={22} style={{ color: "#a78bfa" }} />,
      color: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.35)",
    },
  ];

  return (
    <AdminLayout>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
          PPPoE Configuration
        </h1>

        <NetworkTabs active="pppoe" />

        {/* ── Compact selector card ── */}
        <div style={{
          maxWidth: 720,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          borderRadius: 14, overflow: "hidden",
        }}>

          {/* Router picker */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.875rem",
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
            }}>Router</span>
            <select
              value={selectedRouterId ?? ""}
              onChange={e => {
                const id = Number(e.target.value);
                setSelectedRouterId(id);
                setGenerated(false);
                const r = routers.find(x => x.id === id);
                if (r) setRosVer(detectMajor(r.ros_version));
              }}
              disabled={loadingRouters}
              style={{
                flex: 1, background: "var(--isp-inner-card)",
                border: "1px solid var(--isp-border)", borderRadius: 8,
                padding: "0.45rem 0.75rem", color: "var(--isp-text)",
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
            {router && (
              <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                ROS {router.ros_version || "—"}
              </span>
            )}
          </div>

          {/* ROS version selector */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.875rem",
            padding: "0.75rem 1.25rem",
            borderBottom: "1px solid var(--isp-border-subtle)",
          }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
            }}>ROS Version</span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {(["6", "7"] as RosVer[]).map(v => {
                const active = rosVer === v;
                return (
                  <button
                    key={v}
                    onClick={() => { setRosVer(v); setGenerated(false); }}
                    style={{
                      padding: "0.3rem 0.875rem", borderRadius: 7, fontFamily: "inherit",
                      fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", transition: "all 0.14s",
                      background: active ? "rgba(6,182,212,0.15)" : "var(--isp-inner-card)",
                      border: `1px solid ${active ? "rgba(6,182,212,0.5)" : "var(--isp-border)"}`,
                      color: active ? "#06b6d4" : "var(--isp-text-muted)",
                    }}
                  >
                    ROS {v}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", marginLeft: "auto" }}>
              {rosVer === "7"
                ? "Includes use-radius, mac-auth-mode"
                : "Compatible with RouterOS 6.x"}
            </span>
          </div>

          {/* Mode selection + generate */}
          <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>Select type</span>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {MODES.map(m => {
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setMode(m.id); setGenerated(false); }}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start",
                      gap: "0.5rem", padding: "1rem 1.125rem",
                      background: active ? m.color : "var(--isp-inner-card)",
                      border: `${active ? "2px" : "1px"} solid ${active ? m.border : "var(--isp-border)"}`,
                      borderRadius: 10, cursor: "pointer", textAlign: "left",
                      fontFamily: "inherit", transition: "all 0.15s",
                      boxShadow: active ? `0 0 0 3px ${m.color}` : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", width: "100%" }}>
                      {m.icon}
                      <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--isp-text)" }}>
                        {m.label}
                      </span>
                      {active && (
                        <span style={{
                          marginLeft: "auto", fontSize: "0.65rem", fontWeight: 700,
                          color: mode === "pppoe_only" ? "#06b6d4" : "#a78bfa",
                          background: mode === "pppoe_only" ? "rgba(6,182,212,0.12)" : "rgba(139,92,246,0.12)",
                          border: `1px solid ${mode === "pppoe_only" ? "rgba(6,182,212,0.3)" : "rgba(139,92,246,0.3)"}`,
                          borderRadius: 4, padding: "0.1rem 0.45rem",
                        }}>Selected</span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--isp-text-muted)", lineHeight: 1.55 }}>
                      {m.sub}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Generate button */}
            <button
              onClick={() => router && setGenerated(true)}
              disabled={!router}
              style={{
                marginTop: "0.25rem",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                padding: "0.7rem 1.5rem", borderRadius: 9,
                background: router
                  ? "linear-gradient(135deg,#06b6d4,#0284c7)"
                  : "rgba(255,255,255,0.06)",
                border: "none",
                color: router ? "white" : "var(--isp-text-muted)",
                fontWeight: 700, fontSize: "0.9rem", cursor: router ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                boxShadow: router ? "0 4px 18px rgba(6,182,212,0.35)" : "none",
                transition: "all 0.2s",
              }}
            >
              {router
                ? <><Zap size={15} /> Generate Commands</>
                : <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Select a router first</>
              }
            </button>

            {!router && !loadingRouters && routers.length === 0 && (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#f87171", textAlign: "center" }}>
                No routers found.{" "}
                <a href="/admin/network/add-router" style={{ color: "#06b6d4", fontWeight: 600 }}>
                  Add a router first →
                </a>
              </p>
            )}
          </div>
        </div>

        {/* ── Command steps (shown after generate) ── */}
        {generated && router && (
          <div style={{
            maxWidth: 720,
            background: "var(--isp-card)",
            border: "1px solid var(--isp-border-subtle)",
            borderRadius: 14, overflow: "hidden",
            animation: "fadeIn 0.2s ease",
          }}>

            {/* Header */}
            <div style={{
              padding: "0.875rem 1.375rem",
              background: "rgba(6,182,212,0.05)",
              borderBottom: "1px solid rgba(6,182,212,0.12)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <Terminal size={16} style={{ color: "#06b6d4" }} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--isp-text)" }}>
                  MikroTik Terminal Commands
                </span>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, color: "#06b6d4",
                  background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.28)",
                  borderRadius: 5, padding: "0.1rem 0.45rem",
                }}>
                  {router.name}
                </span>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, color: "#a78bfa",
                  background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.28)",
                  borderRadius: 5, padding: "0.1rem 0.45rem",
                }}>
                  ROS {rosVer}
                </span>
              </div>
              {/* Download config file directly */}
              <a
                href={downloadUrl}
                download={configFile}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.35rem",
                  padding: "0.35rem 0.875rem", borderRadius: 7,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "var(--isp-text-muted)",
                  fontWeight: 600, fontSize: "0.74rem",
                  textDecoration: "none", transition: "all 0.15s",
                }}
              >
                <Download size={12} /> Download .rsc
              </a>
            </div>

            {/* Steps */}
            <div style={{ padding: "1.25rem 1.375rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <CmdBlock
                step={1}
                title="Fetch the configuration script onto the router"
                note="Open the MikroTik terminal (Winbox → New Terminal) and paste this command. The router will download the config file from the server."
                cmd={fetchCmd}
              />
              <CmdBlock
                step={2}
                title="Import and apply the configuration"
                note="After the file is downloaded, run this to apply it. You will see 'Script file loaded and executed successfully' when done."
                cmd={importCmd}
              />

              {/* Verify section */}
              <div style={{
                background: "rgba(74,222,128,0.05)",
                border: "1px solid rgba(74,222,128,0.15)",
                borderRadius: 10, padding: "0.875rem 1rem",
              }}>
                <p style={{ margin: "0 0 0.625rem", fontSize: "0.78rem", fontWeight: 700, color: "#4ade80" }}>
                  Step 3 — Verify
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {[
                    "/interface pppoe-server server print",
                    "/ppp profile print",
                    mode === "pppoe_over_hotspot" ? "/ip hotspot print" : "/ip pool print",
                  ].map(cmd => (
                    <div key={cmd} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: "#060b12", borderRadius: 7, padding: "0.5rem 0.875rem", gap: "0.75rem",
                    }}>
                      <code style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#86efac", flex: 1 }}>
                        {cmd}
                      </code>
                      <CopyBtn text={cmd} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
