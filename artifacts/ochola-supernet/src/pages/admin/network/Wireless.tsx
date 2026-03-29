import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Wifi, Eye, EyeOff, Save, RefreshCw, CheckCircle2,
  AlertTriangle, Loader2, Radio, Lock, Signal,
} from "lucide-react";

/* ══════════════════════════ Types ══════════════════════════ */
interface DbRouter {
  id: number; name: string; host: string; bridge_ip: string | null;
  status: string; ros_version: string;
}

interface WirelessIface {
  id: string; name: string; ssid: string; disabled: boolean;
  band: string; channel: string; macAddress: string;
  securityProfile: string; mode: string;
}

interface SecurityProfile {
  id: string; name: string; wpa2PreSharedKey: string; authentication: string;
}

interface WirelessData {
  interfaces: WirelessIface[];
  profiles: SecurityProfile[];
}

/* ══════════════════════════ Helpers ══════════════════════════ */
const inp: React.CSSProperties = {
  background: "var(--isp-input-bg, #0f1923)",
  border: "1px solid var(--isp-input-border, rgba(255,255,255,0.1))",
  borderRadius: 8, padding: "0.55rem 0.875rem",
  color: "var(--isp-text)", fontSize: "0.875rem",
  fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box",
};

function bandLabel(band: string) {
  if (!band) return "—";
  if (band.includes("5ghz") || band.includes("5g")) return "5 GHz";
  if (band.includes("2ghz") || band.includes("2.4")) return "2.4 GHz";
  return band;
}

/* ══════════════════════════ Password field ══════════════════════════ */
function PasswordInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "Wi-Fi password"}
        style={{ ...inp, paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{
          position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", cursor: "pointer",
          color: "var(--isp-text-muted)", padding: 0, display: "flex",
        }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/* ══════════════════════════ Wireless card ══════════════════════════ */
function WirelessCard({
  iface, profiles, routerId, onSaved,
}: {
  iface: WirelessIface;
  profiles: SecurityProfile[];
  routerId: number;
  onSaved: () => void;
}) {
  const profile = useMemo(
    () => profiles.find(p => p.name === iface.securityProfile) ?? profiles[0] ?? null,
    [profiles, iface.securityProfile],
  );

  const [ssid, setSsid]         = useState(iface.ssid);
  const [password, setPassword] = useState(profile?.wpa2PreSharedKey ?? "");
  const [saving, setSaving]     = useState(false);
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null);

  const dirty = ssid !== iface.ssid || password !== (profile?.wpa2PreSharedKey ?? "");

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { interfaceId: iface.id };
      if (ssid !== iface.ssid) body.ssid = ssid;
      if (profile && password !== profile.wpa2PreSharedKey) {
        body.profileId = profile.id;
        body.password  = password;
      }
      const res = await fetch(`/api/router/${routerId}/wireless`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setResult({ ok: true, msg: "Saved successfully" });
        onSaved();
      } else {
        setResult({ ok: false, msg: json.error ?? "Save failed" });
      }
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSaving(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  const bandColor = iface.band?.includes("5") ? "#a78bfa" : "#22d3ee";

  return (
    <div style={{
      background: "var(--isp-section)",
      border: "1px solid var(--isp-border)",
      borderRadius: 14, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "0.875rem 1.25rem",
        background: iface.disabled ? "rgba(248,113,113,0.05)" : "rgba(6,182,212,0.04)",
        borderBottom: "1px solid var(--isp-border-subtle)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: iface.disabled ? "rgba(248,113,113,0.1)" : "rgba(6,182,212,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Radio size={16} style={{ color: iface.disabled ? "#f87171" : "#06b6d4" }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--isp-text)" }}>
                {iface.name}
              </span>
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, borderRadius: 4,
                padding: "0.1rem 0.45rem",
                background: bandColor + "18",
                border: `1px solid ${bandColor}40`,
                color: bandColor,
              }}>
                {bandLabel(iface.band)}
              </span>
              {iface.disabled && (
                <span style={{
                  fontSize: "0.65rem", fontWeight: 700, borderRadius: 4, padding: "0.1rem 0.45rem",
                  background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)",
                  color: "#f87171",
                }}>disabled</span>
              )}
            </div>
            <div style={{ fontSize: "0.71rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>
              {iface.macAddress || "—"} · ch {iface.channel || "auto"} · {iface.mode || "ap-bridge"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <Signal size={13} style={{ color: iface.disabled ? "#64748b" : "#4ade80" }} />
          <span style={{ fontSize: "0.72rem", color: iface.disabled ? "#64748b" : "#4ade80", fontWeight: 600 }}>
            {iface.disabled ? "Off" : "Broadcasting"}
          </span>
        </div>
      </div>

      {/* Edit fields */}
      <div style={{ padding: "1.125rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* SSID */}
        <div>
          <label style={{
            display: "flex", alignItems: "center", gap: "0.375rem",
            fontSize: "0.72rem", fontWeight: 700,
            color: "var(--isp-text-muted)", textTransform: "uppercase",
            letterSpacing: "0.06em", marginBottom: "0.4rem",
          }}>
            <Wifi size={11} /> Network Name (SSID)
          </label>
          <input
            type="text"
            value={ssid}
            onChange={e => setSsid(e.target.value)}
            placeholder="Enter SSID"
            style={inp}
          />
        </div>

        {/* Password */}
        {profile && (
          <div>
            <label style={{
              display: "flex", alignItems: "center", gap: "0.375rem",
              fontSize: "0.72rem", fontWeight: 700,
              color: "var(--isp-text-muted)", textTransform: "uppercase",
              letterSpacing: "0.06em", marginBottom: "0.4rem",
            }}>
              <Lock size={11} /> Password
              <span style={{ marginLeft: "auto", fontWeight: 500, fontSize: "0.68rem", textTransform: "none" }}>
                Profile: <span style={{ color: "#06b6d4" }}>{profile.name}</span>
              </span>
            </label>
            <PasswordInput value={password} onChange={setPassword} />
            {password.length > 0 && password.length < 8 && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.71rem", color: "#f87171" }}>
                Password must be at least 8 characters
              </p>
            )}
          </div>
        )}

        {/* Save row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", paddingTop: "0.25rem" }}>
          <button
            onClick={save}
            disabled={!dirty || saving || (password.length > 0 && password.length < 8)}
            style={{
              display: "flex", alignItems: "center", gap: "0.45rem",
              padding: "0.55rem 1.375rem", borderRadius: 8, border: "none",
              background: dirty && !saving ? "linear-gradient(135deg,#06b6d4,#0284c7)" : "rgba(255,255,255,0.06)",
              color: dirty && !saving ? "white" : "var(--isp-text-muted)",
              fontWeight: 700, fontSize: "0.84rem", cursor: dirty && !saving ? "pointer" : "not-allowed",
              fontFamily: "inherit", transition: "all 0.15s",
              boxShadow: dirty && !saving ? "0 4px 14px rgba(6,182,212,0.3)" : "none",
            }}
          >
            {saving
              ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
              : <><Save size={14} /> Save Changes</>
            }
          </button>

          {result && (
            <div style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              fontSize: "0.8rem", fontWeight: 600,
              color: result.ok ? "#4ade80" : "#f87171",
              animation: "fadeIn 0.2s ease",
            }}>
              {result.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
export default function Wireless() {
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ["isp_routers_wireless", ADMIN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("isp_routers").select("id,name,host,bridge_ip,status,ros_version").eq("admin_id", ADMIN_ID);
      if (error) throw error;
      return (data ?? []) as DbRouter[];
    },
  });

  useEffect(() => {
    if (routers.length > 0 && selectedRouterId === null) {
      setSelectedRouterId(routers[0].id);
    }
  }, [routers, selectedRouterId]);

  const router = useMemo(
    () => routers.find(r => r.id === selectedRouterId) ?? null,
    [routers, selectedRouterId],
  );

  const {
    data: wirelessData,
    isLoading: loadingWireless,
    isFetching,
    error: wirelessError,
    refetch,
  } = useQuery<WirelessData>({
    queryKey: ["wireless", selectedRouterId],
    queryFn: async () => {
      const res = await fetch(`/api/router/${selectedRouterId}/wireless`);
      if (!res.ok) {
        const json = await res.json() as { error?: string; detail?: string };
        throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<WirelessData>;
    },
    enabled: !!selectedRouterId,
    retry: 0,
  });

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>
          Wireless
        </h1>

        <NetworkTabs active="wireless" />

        {/* ── Router picker ── */}
        <div style={{
          maxWidth: 720,
          background: "var(--isp-section)",
          border: "1px solid var(--isp-border)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.875rem",
            padding: "0.875rem 1.25rem",
          }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
            }}>Router</span>
            <select
              value={selectedRouterId ?? ""}
              onChange={e => setSelectedRouterId(Number(e.target.value))}
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
                  {r.name} — {r.host || r.bridge_ip || "no IP"} {r.status === "online" ? "🟢" : "🔴"}
                </option>
              ))}
            </select>

            {router && (
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                style={{
                  display: "flex", alignItems: "center", gap: "0.35rem",
                  padding: "0.45rem 0.875rem", borderRadius: 7,
                  background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)",
                  color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.75rem",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <RefreshCw size={12} style={isFetching ? { animation: "spin 1s linear infinite" } : {}} />
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* ── States ── */}
        {!router && !loadingRouters && routers.length === 0 && (
          <div style={{
            maxWidth: 720, textAlign: "center", padding: "3rem 1rem",
            color: "var(--isp-text-muted)", fontSize: "0.875rem",
          }}>
            No routers found.{" "}
            <a href="/admin/network/add-router" style={{ color: "#06b6d4", fontWeight: 600 }}>
              Add a router first →
            </a>
          </div>
        )}

        {loadingWireless && (
          <div style={{
            maxWidth: 720, display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "2rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.875rem",
          }}>
            <Loader2 size={18} style={{ animation: "spin 1s linear infinite", color: "#06b6d4" }} />
            Reading wireless interfaces from {router?.name}…
          </div>
        )}

        {wirelessError && !loadingWireless && (
          <div style={{
            maxWidth: 720,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: 12, padding: "1.125rem 1.25rem",
            display: "flex", alignItems: "flex-start", gap: "0.75rem",
          }}>
            <AlertTriangle size={18} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: "#f87171", fontSize: "0.875rem" }}>
                Could not read wireless interfaces
              </p>
              <p style={{ margin: "0.25rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                {(wirelessError as Error).message}
              </p>
              <p style={{ margin: "0.5rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.78rem" }}>
                Make sure the router is online and the MikroTik API (port 8728) is reachable.
                Wireless package must be installed on the router.
              </p>
            </div>
          </div>
        )}

        {/* ── Wireless interface cards ── */}
        {wirelessData && !loadingWireless && (
          <>
            {wirelessData.interfaces.length === 0 ? (
              <div style={{
                maxWidth: 720, textAlign: "center", padding: "2.5rem 1rem",
                background: "var(--isp-section)", border: "1px solid var(--isp-border)",
                borderRadius: 14, color: "var(--isp-text-muted)", fontSize: "0.875rem",
              }}>
                <Wifi size={32} style={{ marginBottom: "0.75rem", opacity: 0.3 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No wireless interfaces found</p>
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem" }}>
                  This router may not have a wireless card or the wireless package is not installed.
                </p>
              </div>
            ) : (
              <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>
                  {wirelessData.interfaces.length} interface{wirelessData.interfaces.length !== 1 ? "s" : ""} found on <strong style={{ color: "var(--isp-text)" }}>{router?.name}</strong>
                </p>
                {wirelessData.interfaces.map(iface => (
                  <WirelessCard
                    key={iface.id}
                    iface={iface}
                    profiles={wirelessData.profiles}
                    routerId={selectedRouterId!}
                    onSaved={() => refetch()}
                  />
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </AdminLayout>
  );
}
