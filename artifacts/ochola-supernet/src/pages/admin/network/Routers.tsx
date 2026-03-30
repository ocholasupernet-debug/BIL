import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Loader2, RefreshCw, Search, Plus, Clock, RotateCcw,
  Edit2, Trash2, History, ExternalLink, X, CheckCircle,
  AlertCircle, ChevronLeft, ChevronRight, Radio,
} from "lucide-react";
import { useLocation } from "wouter";

const PAGE_SIZE = 10;

/* ── helpers ── */
async function fetchRouters(): Promise<DbRouter[]> {
  const { data, error } = await supabase
    .from("isp_routers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .order("id", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

function timeSince(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isOnline(r: DbRouter) {
  if (!r.last_seen) return false;
  const ms = Date.now() - new Date(r.last_seen).getTime();
  return ms < 10 * 60 * 1000 && (r.status === "online" || r.status === "connected");
}

function isCurrentlyOnline(r: DbRouter) {
  if (!r.last_seen) return false;
  return Date.now() - new Date(r.last_seen).getTime() < 5 * 60 * 1000;
}

/* ── small badge ── */
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "0.18rem 0.55rem", borderRadius: 4,
      fontSize: "0.7rem", fontWeight: 700, color, background: bg, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

/* ── simple modal ── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }} onClick={onClose}>
      <div style={{
        background: "var(--isp-section)", border: "1px solid var(--isp-border)",
        borderRadius: 12, padding: "1.5rem", minWidth: 340, maxWidth: 500, width: "100%",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--isp-text)" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)", padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main page
══════════════════════════════════════════════════════════════ */
export default function Routers() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [search, setSearch]           = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage]               = useState(1);

  /* per-router UI state */
  const [rebootState, setRebootState]   = useState<Record<number, "idle" | "rebooting" | "ok" | "error">>({});
  const [rebootMsg, setRebootMsg]       = useState<Record<number, string>>({});
  const [deleteState, setDeleteState]   = useState<Record<number, "idle" | "confirm" | "deleting">>({});
  const [historyModal, setHistoryModal] = useState<DbRouter | null>(null);
  const [autoRebootModal, setAutoRebootModal] = useState<DbRouter | null>(null);

  /* ping state */
  const [pingState,  setPingState]  = useState<Record<number, "idle" | "pinging" | "online" | "offline">>({});
  const [pingResult, setPingResult] = useState<Record<number, { identity?: string; uptime?: string; error?: string }>>({});
  const [pingingAll, setPingingAll] = useState(false);

  /* ping a single router */
  const pingOneRouter = async (r: DbRouter) => {
    setPingState(p => ({ ...p, [r.id]: "pinging" }));
    setPingResult(p => ({ ...p, [r.id]: {} }));
    try {
      const res = await fetch(`/api/routers/${r.id}/ping`, { method: "POST" });
      const data = await res.json() as { ok: boolean; identity?: string; uptime?: string; error?: string };
      setPingState(p => ({ ...p, [r.id]: data.ok ? "online" : "offline" }));
      setPingResult(p => ({ ...p, [r.id]: { identity: data.identity, uptime: data.uptime, error: data.error } }));
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
    } catch (e) {
      setPingState(p => ({ ...p, [r.id]: "offline" }));
      setPingResult(p => ({ ...p, [r.id]: { error: (e as Error).message } }));
    }
  };

  /* ping all routers */
  const pingAll = async () => {
    setPingingAll(true);
    try {
      await fetch(`/api/routers/ping-all?adminId=${ADMIN_ID}`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
    } finally {
      setPingingAll(false);
    }
  };

  const { data: routers = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["isp_routers"],
    queryFn: fetchRouters,
    refetchInterval: 30_000,
  });

  /* filtered list */
  const filtered = useMemo(() => {
    if (!search.trim()) return routers;
    const q = search.toLowerCase();
    return routers.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.host || "").toLowerCase().includes(q) ||
      (r.model || "").toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      (r.bridge_ip || "").toLowerCase().includes(q)
    );
  }, [routers, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /* ── reboot a router ── */
  const rebootRouter = async (r: DbRouter) => {
    setRebootState(prev => ({ ...prev, [r.id]: "rebooting" }));
    setRebootMsg(prev => ({ ...prev, [r.id]: "" }));
    try {
      const res = await fetch("/api/admin/router/reboot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host:     r.host,
          username: r.router_username || "admin",
          password: r.router_secret   || "",
          bridgeIp: r.bridge_ip       || undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; message?: string; error?: string };
      if (json.ok) {
        setRebootState(prev => ({ ...prev, [r.id]: "ok" }));
        setRebootMsg(prev => ({ ...prev, [r.id]: json.message || "Reboot command sent" }));
        setTimeout(() => setRebootState(prev => ({ ...prev, [r.id]: "idle" })), 8000);
      } else {
        setRebootState(prev => ({ ...prev, [r.id]: "error" }));
        setRebootMsg(prev => ({ ...prev, [r.id]: json.error || "Reboot failed" }));
        setTimeout(() => setRebootState(prev => ({ ...prev, [r.id]: "idle" })), 6000);
      }
    } catch (e) {
      setRebootState(prev => ({ ...prev, [r.id]: "error" }));
      setRebootMsg(prev => ({ ...prev, [r.id]: e instanceof Error ? e.message : "Reboot failed" }));
      setTimeout(() => setRebootState(prev => ({ ...prev, [r.id]: "idle" })), 6000);
    }
  };

  /* ── delete a router ── */
  const deleteRouter = async (r: DbRouter) => {
    setDeleteState(prev => ({ ...prev, [r.id]: "deleting" }));
    try {
      await supabase.from("isp_routers").delete().eq("id", r.id);
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
    } catch {
      setDeleteState(prev => ({ ...prev, [r.id]: "idle" }));
    }
  };

  /* ── table header cell ── */
  const Th = ({ label }: { label: string }) => (
    <th style={{
      textAlign: "left", padding: "0.65rem 0.75rem",
      color: "#64748b", fontWeight: 700, fontSize: "0.62rem",
      textTransform: "uppercase", letterSpacing: "0.07em",
      borderBottom: "1px solid var(--isp-border)", whiteSpace: "nowrap",
    }}>
      {label}
    </th>
  );

  /* ── button helper ── */
  const Btn = ({
    label, onClick, color, bg, border, icon, disabled, title,
  }: {
    label?: string; onClick?: () => void; color: string; bg: string;
    border: string; icon?: React.ReactNode; disabled?: boolean; title?: string;
  }) => (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.2rem",
        padding: label ? "0.22rem 0.6rem" : "0.22rem 0.45rem",
        borderRadius: 4, fontSize: "0.68rem", fontWeight: 700,
        fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer",
        color, background: bg, border: `1px solid ${border}`,
        whiteSpace: "nowrap", opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}{label}
    </button>
  );

  return (
    <AdminLayout>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* ── top bar ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          {/* search */}
          <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
            <Search size={13} style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)", pointerEvents: "none" }} />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
              placeholder="Search by Name..."
              style={{
                width: "100%", background: "var(--isp-input-bg)", border: "1px solid var(--isp-input-border)",
                borderRadius: 7, padding: "0.45rem 0.75rem 0.45rem 2rem",
                color: "var(--isp-text)", fontSize: "0.8rem", fontFamily: "inherit",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={() => { setSearch(searchInput); setPage(1); }}
            style={{
              padding: "0.45rem 1.25rem", background: "#06b6d4", border: "none",
              borderRadius: 7, color: "#fff", fontWeight: 700, fontSize: "0.8rem",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Search
          </button>
          {search && (
            <button
              onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
              style={{ padding: "0.45rem 0.75rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", borderRadius: 7, color: "var(--isp-text-muted)", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
            style={{
              display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.85rem",
              background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)",
              borderRadius: 7, color: "var(--isp-text-muted)", fontSize: "0.78rem",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <RefreshCw size={12} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          </button>
          <button
            onClick={pingAll}
            disabled={pingingAll}
            title="Ping all routers — checks if each router is reachable and updates their status"
            style={{
              display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.85rem",
              background: pingingAll ? "rgba(6,182,212,0.08)" : "rgba(6,182,212,0.05)",
              border: "1px solid rgba(6,182,212,0.3)",
              borderRadius: 7, color: "#06b6d4", fontSize: "0.78rem",
              cursor: pingingAll ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600,
            }}
          >
            {pingingAll
              ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Checking…</>
              : <><Radio size={12} /> Ping All</>}
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => navigate("/admin/network/add-router")}
            style={{
              display: "flex", alignItems: "center", gap: "0.35rem",
              padding: "0.45rem 1rem", background: "#1e3a5f",
              border: "1px solid #2563eb", borderRadius: 7, color: "#60a5fa",
              fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={13} /> New Router
          </button>
        </div>

        <NetworkTabs active="routers" />

        {/* ── table ── */}
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3rem 2rem", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading routers…
            </div>
          ) : error ? (
            <div style={{ padding: "2rem", color: "#f87171", fontSize: "0.875rem" }}>Failed to load routers.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr>
                    {["ID","ROUTER NAME","IP ADDRESS","PROXY VPN BACKUP","USERNAME","DESCRIPTION","STATUS","STATE","UPTIME","MODEL","LAST SEEN","REBOOT","MANAGE","REMOTE ACCESS"].map(h => (
                      <Th key={h} label={h} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ padding: "3rem 1.5rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
                        {search ? `No routers matching "${search}"` : (
                          <>No routers added yet. <a href="/admin/network/add-router" style={{ color: "#06b6d4", textDecoration: "underline", fontWeight: 600 }}>Add your first router</a></>
                        )}
                      </td>
                    </tr>
                  ) : pageRows.map((r, idx) => {
                    const online     = isOnline(r);
                    const currOnline = isCurrentlyOnline(r);
                    const rb         = rebootState[r.id]  ?? "idle";
                    const delSt      = deleteState[r.id]  ?? "idle";
                    const pingSt     = pingState[r.id]    ?? "idle";
                    const pingRes    = pingResult[r.id]   ?? {};
                    const rowBg      = idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";

                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--isp-border-subtle)", background: rowBg }}>

                        {/* ID */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)", fontWeight: 600 }}>
                          {r.id}
                        </td>

                        {/* ROUTER NAME */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <span style={{ color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</span>
                        </td>

                        {/* IP ADDRESS */}
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", color: "#06b6d4", fontSize: "0.75rem" }}>
                          {r.host || r.ip_address || "—"}
                        </td>

                        {/* PROXY VPN BACKUP */}
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                          {r.bridge_ip || "—"}
                        </td>

                        {/* USERNAME */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)" }}>
                          {r.router_username || "admin"}
                        </td>

                        {/* DESCRIPTION */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)", maxWidth: 180 }}>
                          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.description || "—"}
                          </span>
                        </td>

                        {/* STATUS */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <Badge label="Enabled" color="#fff" bg="#1e4d2b" />
                        </td>

                        {/* STATE */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          {online
                            ? <Badge label="Online"  color="#fff" bg="#166534" />
                            : <Badge label="Offline" color="#fff" bg="#7f1d1d" />}
                        </td>

                        {/* UPTIME */}
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                          {r.ros_version ? "—" : "—"}
                        </td>

                        {/* MODEL */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                          {r.model || "—"}
                        </td>

                        {/* LAST SEEN */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          {currOnline
                            ? <Badge label="Currently Online" color="#fff" bg="#166534" />
                            : <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>{timeSince(r.last_seen)}</span>}
                        </td>

                        {/* REBOOT */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                            <div style={{ display: "flex", gap: "0.35rem" }}>
                              {rb === "rebooting" ? (
                                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#f59e0b" }}>
                                  <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Rebooting…
                                </span>
                              ) : rb === "ok" ? (
                                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#4ade80" }}>
                                  <CheckCircle size={10} /> Sent
                                </span>
                              ) : rb === "error" ? (
                                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#f87171" }}>
                                  <AlertCircle size={10} /> Failed
                                </span>
                              ) : (
                                <Btn
                                  label="Reboot"
                                  icon={<RotateCcw size={10} />}
                                  onClick={() => rebootRouter(r)}
                                  color="#fff" bg="#92400e" border="#b45309"
                                />
                              )}
                              <Btn
                                label="Auto Reboot"
                                icon={<Clock size={10} />}
                                onClick={() => setAutoRebootModal(r)}
                                color="#94a3b8" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.1)"
                              />
                            </div>
                            {rb !== "idle" && rebootMsg[r.id] && (
                              <span style={{ fontSize: "0.63rem", color: rb === "ok" ? "#4ade80" : "#f87171", maxWidth: 180, lineHeight: 1.4 }}>
                                {rebootMsg[r.id]}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* MANAGE */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                            <Btn
                              label="Edit"
                              icon={<Edit2 size={10} />}
                              onClick={() => navigate(`/admin/network/add-router?edit=${r.id}`)}
                              color="#60a5fa" bg="rgba(37,99,235,0.15)" border="rgba(37,99,235,0.35)"
                            />
                            {delSt === "confirm" ? (
                              <>
                                <Btn label="Yes" onClick={() => deleteRouter(r)} color="#f87171" bg="rgba(248,113,113,0.15)" border="rgba(248,113,113,0.4)" />
                                <Btn label="No"  onClick={() => setDeleteState(p => ({ ...p, [r.id]: "idle" }))} color="#94a3b8" bg="rgba(255,255,255,0.05)" border="rgba(255,255,255,0.12)" />
                              </>
                            ) : delSt === "deleting" ? (
                              <Loader2 size={12} style={{ animation: "spin 1s linear infinite", color: "#f87171" }} />
                            ) : (
                              <Btn
                                icon={<Trash2 size={11} />}
                                onClick={() => setDeleteState(p => ({ ...p, [r.id]: "confirm" }))}
                                color="#f87171" bg="rgba(248,113,113,0.08)" border="rgba(248,113,113,0.25)"
                                title="Delete router"
                              />
                            )}
                            {pingSt === "pinging" ? (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#06b6d4" }}>
                                <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Pinging…
                              </span>
                            ) : pingSt === "online" ? (
                              <span
                                title={`${pingRes.identity ?? ""}${pingRes.uptime ? ` · up ${pingRes.uptime}` : ""}`}
                                style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#4ade80", cursor: "pointer" }}
                                onClick={() => pingOneRouter(r)}
                              >
                                <CheckCircle size={10} /> Online
                              </span>
                            ) : pingSt === "offline" ? (
                              <span
                                title={pingRes.error ?? "Unreachable"}
                                style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "#f87171", cursor: "pointer" }}
                                onClick={() => pingOneRouter(r)}
                              >
                                <AlertCircle size={10} /> Offline
                              </span>
                            ) : (
                              <Btn
                                label="Ping"
                                icon={<Radio size={10} />}
                                onClick={() => pingOneRouter(r)}
                                color="#06b6d4" bg="rgba(6,182,212,0.08)" border="rgba(6,182,212,0.3)"
                              />
                            )}
                            <Btn
                              label="Offline History"
                              icon={<History size={10} />}
                              onClick={() => setHistoryModal(r)}
                              color="#94a3b8" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.1)"
                            />
                          </div>
                        </td>

                        {/* REMOTE ACCESS */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <Btn
                            label="Access"
                            icon={<ExternalLink size={10} />}
                            onClick={() => navigate(`/admin/network/bridge-ports?routerId=${r.id}`)}
                            color="#fff" bg="#065f46" border="#047857"
                          />
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── pagination ── */}
        {!isLoading && filtered.length > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
            <button
              onClick={() => setPage(1)}
              disabled={currentPage === 1}
              style={{ padding: "0.3rem 0.6rem", borderRadius: 5, border: "1px solid var(--isp-border)", background: "var(--isp-section)", color: "var(--isp-text-muted)", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", opacity: currentPage === 1 ? 0.4 : 1 }}
            >
              1
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{ display: "flex", alignItems: "center", padding: "0.3rem 0.5rem", borderRadius: 5, border: "1px solid var(--isp-border)", background: "var(--isp-section)", color: "var(--isp-text-muted)", fontSize: "0.72rem", cursor: "pointer", opacity: currentPage === 1 ? 0.4 : 1 }}
            >
              <ChevronLeft size={12} /> Prev
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => Math.abs(p - currentPage) <= 2)
              .map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    padding: "0.3rem 0.65rem", borderRadius: 5, fontSize: "0.72rem", fontFamily: "inherit", cursor: "pointer",
                    border: `1px solid ${p === currentPage ? "#06b6d4" : "var(--isp-border)"}`,
                    background: p === currentPage ? "rgba(6,182,212,0.15)" : "var(--isp-section)",
                    color: p === currentPage ? "#06b6d4" : "var(--isp-text-muted)",
                    fontWeight: p === currentPage ? 700 : 400,
                  }}
                >
                  {p}
                </button>
              ))}

            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{ display: "flex", alignItems: "center", padding: "0.3rem 0.5rem", borderRadius: 5, border: "1px solid var(--isp-border)", background: "var(--isp-section)", color: "var(--isp-text-muted)", fontSize: "0.72rem", cursor: "pointer", opacity: currentPage === totalPages ? 0.4 : 1 }}
            >
              Next <ChevronRight size={12} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={currentPage === totalPages}
              style={{ padding: "0.3rem 0.6rem", borderRadius: 5, border: "1px solid var(--isp-border)", background: "var(--isp-section)", color: "var(--isp-text-muted)", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", opacity: currentPage === totalPages ? 0.4 : 1 }}
            >
              Last
            </button>
            <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)", marginLeft: "0.25rem" }}>
              {filtered.length} router{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

      </div>

      {/* ── Offline History Modal ── */}
      {historyModal && (
        <Modal title={`Offline History — ${historyModal.name}`} onClose={() => setHistoryModal(null)}>
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.82rem", lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 0.75rem" }}>
              No offline history events recorded for <strong style={{ color: "var(--isp-text)" }}>{historyModal.name}</strong> yet.
            </p>
            <p style={{ margin: 0, fontSize: "0.75rem" }}>
              Offline events will be tracked here automatically once the router has gone offline and come back online.
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button
              onClick={() => setHistoryModal(null)}
              style={{ padding: "0.4rem 1rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* ── Auto Reboot Modal ── */}
      {autoRebootModal && (
        <Modal title={`Auto Reboot — ${autoRebootModal.name}`} onClose={() => setAutoRebootModal(null)}>
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.82rem", lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 0.75rem" }}>
              Schedule automatic reboots for <strong style={{ color: "var(--isp-text)" }}>{autoRebootModal.name}</strong>.
            </p>
            <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 7, padding: "0.75rem", fontSize: "0.78rem", color: "#fbbf24" }}>
              Auto Reboot scheduling is coming soon. You can configure scheduled reboots directly on the router via:
              <code style={{ display: "block", marginTop: "0.4rem", fontFamily: "monospace", color: "#67e8f9", fontSize: "0.75rem" }}>
                /system scheduler add name=daily-reboot interval=1d on-event="/system reboot"
              </code>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button
              onClick={() => setAutoRebootModal(null)}
              style={{ padding: "0.4rem 1rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
            >
              Close
            </button>
          </div>
        </Modal>
      )}

    </AdminLayout>
  );
}
