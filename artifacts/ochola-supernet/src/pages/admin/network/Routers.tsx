import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { supabase, ADMIN_ID, type DbRouter } from "@/lib/supabase";
import {
  Loader2, RefreshCw, Search, Plus, Clock, RotateCcw,
  Edit2, Trash2, History, ExternalLink, X, CheckCircle,
  AlertCircle, ChevronLeft, ChevronRight, Radio, Wand2, Save, Copy,
} from "lucide-react";
import { useLocation } from "wouter";

const PAGE_SIZE = 10;

/* ── Live clock — forces re-render every `interval` ms so timeSince stays fresh ── */
function useTicker(interval = 10_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
}

/* ── helpers ── */
async function fetchRouters(): Promise<DbRouter[]> {
  /* A router only counts as "added" once it is fully configured, meaning:
       1. Bridge ports have been assigned (status promoted out of "setup")
       2. The router has reported back via heartbeat at least once
       3. Its current status is one of the two "real" states: online | connected
     Anything else — auto-created stubs, half-configured devices, unknown
     statuses — is hidden completely. No pending state, no placeholder row. */
  const { data, error } = await supabase
    .from("isp_routers")
    .select("*")
    .eq("admin_id", ADMIN_ID)
    .in("status", ["online", "connected"])
    .not("last_seen", "is", null)
    .order("id", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* Classify a router ping error and return a short label + fix commands */
function pingErrorInfo(err: string): { label: string; cmds: string[]; hint: string } {
  const e = err.toLowerCase();
  if (e.includes("refused") || e.includes("econnrefused")) {
    return {
      label: "API service disabled",
      hint:  "Run in Winbox → Terminal:",
      cmds:  ["/ip service enable api"],
    };
  }
  if (e.includes("timed out") || e.includes("etimedout") || e.includes("did not respond")) {
    return {
      label: "Port 8728 blocked by firewall",
      hint:  "Run both commands in Winbox → Terminal:",
      cmds:  [
        "/ip service enable api",
        "/ip firewall filter add chain=input protocol=tcp dst-port=8728 src-address=10.8.0.0/16 action=accept place-before=0",
      ],
    };
  }
  if (e.includes("login failed") || e.includes("authentication") || e.includes("bad password")) {
    return {
      label: "Wrong API credentials",
      hint:  "Check the router's username/password, or reset:",
      cmds:  ["/user set admin password=yourpassword"],
    };
  }
  if (e.includes("ehostunreach") || e.includes("enetunreach") || e.includes("routing failure")) {
    return {
      label: "VPN tunnel not reachable",
      hint:  "Re-run the install script or restart the VPN client:",
      cmds:  ["/interface ovpn-client enable ovpn-out1"],
    };
  }
  return { label: "Unreachable", hint: "", cmds: [] };
}

function PingErrorHint({ error }: { error: string }) {
  const [copied, setCopied] = React.useState<string | null>(null);
  const { label, hint, cmds } = pingErrorInfo(error);
  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(txt); setTimeout(() => setCopied(null), 2000);
    });
  };
  return (
    <span style={{ display: "block", marginTop: "0.375rem" }}>
      <span style={{ color: "#f87171", fontWeight: 600 }}>✗ {label}</span>
      {cmds.length > 0 && (
        <span style={{ display: "block", marginTop: "0.3rem", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: 7, padding: "0.4rem 0.6rem" }}>
          <span style={{ display: "block", fontSize: "0.68rem", color: "#4ade80", fontWeight: 700, marginBottom: "0.25rem" }}>{hint}</span>
          {cmds.map(cmd => (
            <span key={cmd} style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.2rem" }}>
              <code style={{ flex: 1, fontFamily: "monospace", fontSize: "0.68rem", color: "#67e8f9", background: "rgba(0,0,0,0.3)", padding: "0.15rem 0.4rem", borderRadius: 4, wordBreak: "break-all" }}>{cmd}</code>
              <button onClick={() => copy(cmd)} style={{ flexShrink: 0, background: copied === cmd ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied === cmd ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 4, color: copied === cmd ? "#4ade80" : "#64748b", cursor: "pointer", fontSize: "0.6rem", padding: "0.15rem 0.35rem", display: "flex", alignItems: "center", gap: "0.15rem", fontFamily: "inherit" }}>
                <Copy size={8} />{copied === cmd ? "✓" : "copy"}
              </button>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function timeSince(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  /* Compare full calendar date strings in local timezone */
  if (d.toDateString() === now.toDateString()) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
  /* Older → "Mar 31, 14:30" */
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ── Format RouterOS uptime string ("1w2d3h40m5s") to readable "1w 2d 3h 40m" ── */
function formatUptime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = raw.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return raw;
  const [, w, d, h, min] = m;
  const parts = [
    w   && `${w}w`,
    d   && `${d}d`,
    h   && `${h}h`,
    min && `${min}m`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : raw;
}

/* ── RouterOS uptime string → total seconds ── */
function uptimeToSeconds(raw: string): number {
  const m = raw.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  const [, w, d, h, min, s] = m;
  return (+(w||0))*604800 + (+(d||0))*86400 + (+(h||0))*3600 + (+(min||0))*60 + (+(s||0));
}

/* ── Total seconds → "Xw Xd Xh Xm" ── */
function secondsToUptime(total: number): string {
  if (total <= 0) return "—";
  const w   = Math.floor(total / 604800); total %= 604800;
  const d   = Math.floor(total / 86400);  total %= 86400;
  const h   = Math.floor(total / 3600);   total %= 3600;
  const min = Math.floor(total / 60);
  return [w && `${w}w`, d && `${d}d`, h && `${h}h`, min && `${min}m`]
    .filter(Boolean).join(" ") || "< 1m";
}

/* ── Compute live uptime from DB values, with optional in-memory ping override ──
 * Priority: freshest in-memory ping result → DB snapshot from last ping.
 * Both paths add elapsed seconds since the measurement was taken.
 * ─────────────────────────────────────────────────────────────────────────── */
function liveUptime(
  dbUptime:   string | null | undefined,
  dbUptimeAt: string | null | undefined,
  pingUptime?: string,
  pingAt?:     number,
): string {
  if (pingUptime && pingAt) {
    const elapsed = Math.max(0, Math.floor((Date.now() - pingAt) / 1000));
    return secondsToUptime(uptimeToSeconds(pingUptime) + elapsed);
  }
  if (dbUptime && dbUptimeAt) {
    const at = new Date(dbUptimeAt).getTime();
    if (!isNaN(at)) {
      const elapsed = Math.max(0, Math.floor((Date.now() - at) / 1000));
      return secondsToUptime(uptimeToSeconds(dbUptime) + elapsed);
    }
  }
  return "—";
}

/* Router online check — trusts the status field written by the backend.
   Ping / sweep endpoints are the source of truth; no stale-time penalty. */
function isOnline(r: DbRouter) {
  return r.status === "online" || r.status === "connected";
}

/* Alias — same logic as isOnline; kept for places that use currOnline */
const isCurrentlyOnline = isOnline;

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

/* ── Text-only status label — no dots ── */
function StatusDot({ online, sub }: { online: boolean; label?: string; sub?: string }) {
  if (online) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#22c55e" }}>Online</span>
        {sub && <span style={{ fontSize: "0.65rem", color: "var(--isp-text-sub)" }}>{sub}</span>}
      </span>
    );
  }
  const hasTime = sub && sub !== "—";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      {hasTime
        ? <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Since {sub}</span>
        : <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Offline</span>}
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
/* ── Live install progress panel ──
   Polls /api/admin/router/install-progress every 2s and renders a compact
   timeline for each router currently running the self-install script. The
   server auto-collapses successful installs after 60s, so this panel
   disappears on its own once everything is healthy. */
type InstallStepDto = {
  step: number; name: string;
  phase: "downloading" | "applied" | "failed";
  error?: string; ts: number;
};
type InstallDto = {
  routerId: number; routerName: string;
  startedAt: number; updatedAt: number;
  done: boolean; failures: number;
  steps: InstallStepDto[];
};

const INSTALL_STEP_ORDER: Array<{ num: number; name: string; label: string }> = [
  { num: 1, name: "vpn",       label: "VPN tunnel" },
  { num: 2, name: "hotspot",   label: "Hotspot config" },
  { num: 3, name: "pppoe",     label: "PPPoE config" },
  { num: 4, name: "users",     label: "Users config" },
  { num: 5, name: "syncusers", label: "Sync-users firewall" },
  { num: 6, name: "heartbeat", label: "Heartbeat firewall" },
  { num: 7, name: "syncfull",  label: "Sync-full script" },
];

function InstallProgressPanel() {
  const { data } = useQuery({
    queryKey:        ["isp-install-progress", ADMIN_ID],
    queryFn:         async (): Promise<InstallDto[]> => {
      const r = await fetch(`/api/admin/router/install-progress?adminId=${ADMIN_ID}`);
      if (!r.ok) return [];
      const j = await r.json() as { ok: boolean; installs?: InstallDto[] };
      return j.installs ?? [];
    },
    refetchInterval: 2_000,
    staleTime:       0,
  });

  const installs = data ?? [];
  if (installs.length === 0) return null;

  return (
    <div style={{
      borderRadius: 10, background: "var(--isp-section)",
      border: "1px solid var(--isp-border)", padding: "1rem 1.25rem",
      marginBottom: "1rem",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: "0.85rem", fontSize: "0.82rem",
        color: "var(--isp-text)", fontWeight: 600,
      }}>
        <Loader2 size={14} style={{ animation: "spin 1.2s linear infinite", color: "var(--isp-accent)" }} />
        Live install progress ({installs.length})
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {installs.map(inst => {
          const stepMap = new Map(inst.steps.map(s => [s.step, s]));
          const completed = inst.steps.filter(s => s.phase === "applied").length;
          const pct       = Math.round((completed / 7) * 100);
          const allOk     = inst.done && inst.failures === 0;
          const anyFail   = inst.failures > 0;

          return (
            <div key={inst.routerId} style={{
              borderRadius: 8, padding: "0.75rem 0.9rem",
              background: "rgba(255,255,255,0.025)",
              border: "1px solid var(--isp-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, fontSize: "0.78rem" }}>
                <Radio size={12} style={{
                  color: anyFail ? "#f87171" : allOk ? "#34d399" : "var(--isp-accent)",
                }} />
                <span style={{ fontWeight: 600, color: "var(--isp-text)" }}>{inst.routerName}</span>
                <span style={{ color: "var(--isp-text-muted)" }}>#{inst.routerId}</span>
                <span style={{ marginLeft: "auto", color: "var(--isp-text-muted)" }}>
                  {completed}/7 steps {pct}%{anyFail ? ` · ${inst.failures} failed` : ""}
                  {allOk ? " · done" : ""}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
                {INSTALL_STEP_ORDER.map(s => {
                  const cur = stepMap.get(s.num);
                  const bg =
                    !cur                         ? "rgba(255,255,255,0.06)" :
                    cur.phase === "failed"       ? "#dc2626" :
                    cur.phase === "applied"      ? "#16a34a" :
                                                   "var(--isp-accent)";
                  return (
                    <div key={s.num} title={`[${s.num}/7] ${s.label}${cur ? ` — ${cur.phase}` : " — pending"}`}
                         style={{ height: 6, borderRadius: 3, background: bg, opacity: cur ? 1 : 0.5 }} />
                  );
                })}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem" }}>
                {INSTALL_STEP_ORDER.map(s => {
                  const cur = stepMap.get(s.num);
                  const phase = cur?.phase ?? "pending";
                  const color =
                    phase === "failed"      ? "#f87171" :
                    phase === "applied"     ? "#34d399" :
                    phase === "downloading" ? "var(--isp-accent)" :
                                              "var(--isp-text-muted)";
                  const icon =
                    phase === "failed"      ? <AlertCircle size={11} /> :
                    phase === "applied"     ? <CheckCircle size={11} /> :
                    phase === "downloading" ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> :
                                              <Clock size={11} />;
                  return (
                    <div key={s.num} style={{ display: "flex", alignItems: "flex-start", gap: 6, color }}>
                      <span style={{ marginTop: 1 }}>{icon}</span>
                      <span style={{ minWidth: 28, color: "var(--isp-text-muted)" }}>[{s.num}/7]</span>
                      <span style={{ minWidth: 130 }}>{s.label}</span>
                      <span style={{ textTransform: "capitalize" }}>{phase}</span>
                      {cur?.error && (
                        <span style={{
                          marginLeft: 6, color: "#f87171",
                          fontFamily: "monospace", fontSize: "0.7rem",
                          overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", maxWidth: 520,
                        }} title={cur.error}>
                          {cur.error}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Install history modal ──
   Pulls past install runs from the persistent table so admins can audit
   failures even after the in-memory live timeline has expired. */
type InstallHistoryRun = {
  routerId: number; routerName: string;
  startedAt: number; updatedAt: number;
  done: boolean; failures: number;
  steps: InstallStepDto[];
};

function InstallHistoryModal({ router, onClose }: { router: DbRouter; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["isp-install-history", router.id],
    queryFn: async (): Promise<InstallHistoryRun[]> => {
      const r = await fetch(`/api/admin/router/install-history?adminId=${ADMIN_ID}&routerId=${router.id}&limit=500`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as { ok: boolean; runs?: InstallHistoryRun[]; error?: string };
      if (!j.ok) throw new Error(j.error || "Failed to load install history");
      return j.runs ?? [];
    },
    staleTime: 10_000,
  });

  const runs = data ?? [];

  return (
    <Modal title={`Install history — ${router.name}`} onClose={onClose}>
      <div style={{ maxHeight: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--isp-text-muted)", fontSize: "0.82rem" }}>
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading install history…
          </div>
        )}
        {error && (
          <div style={{ color: "#f87171", fontSize: "0.82rem", padding: "0.6rem 0.75rem", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 7 }}>
            {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && runs.length === 0 && (
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.82rem", lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 0.5rem" }}>
              No past install runs recorded for <strong style={{ color: "var(--isp-text)" }}>{router.name}</strong>.
            </p>
            <p style={{ margin: 0, fontSize: "0.75rem" }}>
              Future self-install attempts will appear here automatically — including failed steps and error messages.
            </p>
          </div>
        )}
        {runs.map(run => {
          const stepMap = new Map(run.steps.map(s => [s.step, s]));
          const completed = run.steps.filter(s => s.phase === "applied").length;
          const pct       = Math.round((completed / 7) * 100);
          const allOk     = run.done && run.failures === 0;
          const anyFail   = run.failures > 0;
          const startedDate = new Date(run.startedAt);

          return (
            <div key={`${run.routerId}-${run.startedAt}`} style={{
              borderRadius: 8, padding: "0.75rem 0.9rem",
              background: "rgba(255,255,255,0.025)",
              border: "1px solid var(--isp-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, fontSize: "0.78rem" }}>
                <Radio size={12} style={{
                  color: anyFail ? "#f87171" : allOk ? "#34d399" : "var(--isp-text-muted)",
                }} />
                <span style={{ fontWeight: 600, color: "var(--isp-text)" }}>
                  {startedDate.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--isp-text-muted)" }}>
                  {completed}/7 steps {pct}%{anyFail ? ` · ${run.failures} failed` : ""}
                  {allOk ? " · done" : ""}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
                {INSTALL_STEP_ORDER.map(s => {
                  const cur = stepMap.get(s.num);
                  const bg =
                    !cur                         ? "rgba(255,255,255,0.06)" :
                    cur.phase === "failed"       ? "#dc2626" :
                    cur.phase === "applied"      ? "#16a34a" :
                                                   "var(--isp-accent)";
                  return (
                    <div key={s.num} title={`[${s.num}/7] ${s.label}${cur ? ` — ${cur.phase}` : " — pending"}`}
                         style={{ height: 6, borderRadius: 3, background: bg, opacity: cur ? 1 : 0.5 }} />
                  );
                })}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem" }}>
                {INSTALL_STEP_ORDER.map(s => {
                  const cur = stepMap.get(s.num);
                  const phase = cur?.phase ?? "pending";
                  const color =
                    phase === "failed"      ? "#f87171" :
                    phase === "applied"     ? "#34d399" :
                    phase === "downloading" ? "var(--isp-accent)" :
                                              "var(--isp-text-muted)";
                  const icon =
                    phase === "failed"      ? <AlertCircle size={11} /> :
                    phase === "applied"     ? <CheckCircle size={11} /> :
                    phase === "downloading" ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> :
                                              <Clock size={11} />;
                  return (
                    <div key={s.num} style={{ display: "flex", alignItems: "flex-start", gap: 6, color }}>
                      <span style={{ marginTop: 1 }}>{icon}</span>
                      <span style={{ minWidth: 28, color: "var(--isp-text-muted)" }}>[{s.num}/7]</span>
                      <span style={{ minWidth: 130 }}>{s.label}</span>
                      <span style={{ textTransform: "capitalize" }}>{phase}</span>
                      {cur?.error && (
                        <span style={{
                          marginLeft: 6, color: "#f87171",
                          fontFamily: "monospace", fontSize: "0.7rem",
                          overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", maxWidth: 420,
                        }} title={cur.error}>
                          {cur.error}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
        <button
          onClick={onClose}
          style={{ padding: "0.4rem 1rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

export default function Routers() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  useTicker(10_000); /* re-render every 10 s so "last seen" stays live */

  const [search, setSearch]           = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage]               = useState(1);

  /* per-router UI state */
  const [rebootState, setRebootState]   = useState<Record<number, "idle" | "rebooting" | "ok" | "error">>({});
  const [rebootMsg, setRebootMsg]       = useState<Record<number, string>>({});
  const [deleteState, setDeleteState]   = useState<Record<number, "idle" | "confirm" | "deleting">>({});
  const [historyModal, setHistoryModal] = useState<DbRouter | null>(null);
  const [installHistoryModal, setInstallHistoryModal] = useState<DbRouter | null>(null);
  const [autoRebootModal, setAutoRebootModal] = useState<DbRouter | null>(null);

  /* ── Edit router modal ── */
  const [editRouter, setEditRouter] = useState<DbRouter | null>(null);
  const [editForm, setEditForm] = useState({ name: "", host: "", bridge_ip: "", proxy_ip: "", bridge_interface: "", router_username: "", router_secret: "", coordinates: "", coverage: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{ bridgeInterfaces: string[]; detectedBridgeInterface: string | null } | null>(null);

  function openEdit(r: DbRouter) {
    setEditRouter(r);
    setEditForm({
      name:             r.name               ?? "",
      host:             r.host               ?? "",
      bridge_ip:        r.bridge_ip          ?? "",
      proxy_ip:         r.proxy_ip           ?? "",
      bridge_interface: r.bridge_interface   ?? "",
      router_username:  r.router_username    ?? "admin",
      router_secret:    r.router_secret      ?? "",
      coordinates:      (r as any).coordinates ?? "",
      coverage:         (r as any).coverage    ?? "",
    });
    setEditError(null);
    setDetectResult(null);
  }

  async function handleDetectBridge() {
    if (!editRouter) return;
    setDetecting(true);
    setDetectResult(null);
    try {
      const r = await fetch(`/api/routers/${editRouter.id}/detect-bridge`);
      const j = await r.json() as { ok: boolean; bridgeInterfaces: string[]; detectedBridgeInterface: string | null; error?: string };
      if (j.ok) {
        setDetectResult(j);
        if (j.detectedBridgeInterface) {
          setEditForm(f => ({ ...f, bridge_interface: j.detectedBridgeInterface! }));
        }
      } else {
        setDetectResult({ bridgeInterfaces: [], detectedBridgeInterface: null });
        setEditError(j.error ?? "Could not connect to router");
      }
    } catch (e: any) {
      setDetectResult({ bridgeInterfaces: [], detectedBridgeInterface: null });
      setEditError(e.message ?? "Detect failed");
    } finally {
      setDetecting(false);
    }
  }

  async function saveEdit() {
    if (!editRouter) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const { error } = await supabase
        .from("isp_routers")
        .update({
          name:             editForm.name.trim()             || editRouter.name,
          host:             editForm.host.trim()             || editRouter.host,
          bridge_ip:        editForm.bridge_ip.trim()        || null,
          proxy_ip:         editForm.proxy_ip.trim()         || null,
          bridge_interface: editForm.bridge_interface.trim() || "hotspot-bridge",
          router_username:  editForm.router_username.trim()  || "admin",
          router_secret:    editForm.router_secret.trim()    || null,
          coordinates:      editForm.coordinates.trim()      || null,
          coverage:         editForm.coverage.trim()         || null,
          updated_at:       new Date().toISOString(),
        })
        .eq("id", editRouter.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
      setEditRouter(null);
    } catch (e: any) {
      setEditError(e.message ?? "Save failed");
    } finally {
      setEditSaving(false);
    }
  }

  /* ping state */
  const [pingState,  setPingState]  = useState<Record<number, "idle" | "pinging" | "online" | "offline">>({});
  const [pingResult, setPingResult] = useState<Record<number, { identity?: string; uptime?: string; pingAt?: number; error?: string }>>({});
  const [pingingAll, setPingingAll] = useState(false);

  /* ping a single router */
  const pingOneRouter = async (r: DbRouter) => {
    setPingState(p => ({ ...p, [r.id]: "pinging" }));
    setPingResult(p => ({ ...p, [r.id]: {} }));
    try {
      const res = await fetch(`/api/routers/${r.id}/ping`, { method: "POST" });
      const data = await res.json() as { ok: boolean; identity?: string; uptime?: string; error?: string };
      const pingAt = data.ok && data.uptime ? Date.now() : undefined;
      setPingState(p => ({ ...p, [r.id]: data.ok ? "online" : "offline" }));
      setPingResult(p => ({ ...p, [r.id]: { identity: data.identity, uptime: data.uptime, pingAt, error: data.error } }));
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

  /* auto-check all offline routers once after initial data load */
  const autoCheckedRef = useRef(false);
  const { data: routers = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["isp_routers"],
    queryFn: fetchRouters,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!routers.length || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routers]);

  /* auto-fix VPN IPs */
  const [autoFixing,     setAutoFixing]     = useState(false);
  const [autoFixResults, setAutoFixResults] = useState<null | {
    ok: boolean; error?: string;
    summary?: { total: number; updated: number; online: number; unmatched: number };
    results?: {
      routerId: number; routerName: string; matched: boolean;
      clientName?: string; oldIp?: string; newIp?: string;
      pingOk?: boolean; pingError?: string; identity?: string; uptime?: string;
    }[];
    vpnClients?: Record<string, string>;
    searched?: string[];
  }>(null);

  const autoFixVpnIps = async () => {
    setAutoFixing(true);
    setAutoFixResults(null);
    try {
      const res  = await fetch(`/api/vpn/auto-fix-ips?adminId=${ADMIN_ID}`, { method: "POST" });
      const text = await res.text();
      let data: typeof autoFixResults;
      try {
        data = JSON.parse(text);
      } catch {
        /* Server returned non-JSON (HTML error page) — surface the raw text */
        const preview = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        data = { ok: false, error: `Server returned unexpected response (HTTP ${res.status}): ${preview || text.slice(0, 200)}` };
      }
      setAutoFixResults(data);
      if (data?.ok) {
        qc.invalidateQueries({ queryKey: ["isp_routers"] });
        /* Immediately reflect online routers in pingState so STATE column updates */
        if (data.results) {
          const stateUpdate: Record<number, "online" | "offline"> = {};
          const resUpdate:   Record<number, { identity?: string; uptime?: string; pingAt?: number }> = {};
          const now = Date.now();
          for (const r of data.results) {
            if (r.matched) {
              stateUpdate[r.routerId] = r.pingOk ? "online" : "offline";
              if (r.pingOk) {
                resUpdate[r.routerId] = { identity: r.identity, uptime: r.uptime, pingAt: r.uptime ? now : undefined };
              }
            }
          }
          setPingState(p => ({ ...p, ...stateUpdate }));
          setPingResult(p => ({ ...p, ...resUpdate }));
        }
      }
    } catch (e) {
      setAutoFixResults({ ok: false, error: (e as Error).message });
    } finally {
      setAutoFixing(false);
    }
  };

  /* filtered list (DB query already excludes setup/never-seen routers) */
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

  /* ── delete a router ──
     Uses the server-side endpoint which:
       • runs with the service-role key (bypasses RLS)
       • cascades clean-up of child records (VPN users, IP pools, sessions, …)
       • returns a useful error message when something blocks the delete */
  const [deleteError, setDeleteError] = useState<Record<number, string>>({});
  const deleteRouter = async (r: DbRouter) => {
    setDeleteState(prev => ({ ...prev, [r.id]: "deleting" }));
    setDeleteError(prev => ({ ...prev, [r.id]: "" }));
    try {
      const res = await fetch(`/api/routers/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        let msg = `Delete failed (HTTP ${res.status})`;
        try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      qc.invalidateQueries({ queryKey: ["isp_routers"] });
      setDeleteState(prev => ({ ...prev, [r.id]: "idle" }));
    } catch (e) {
      setDeleteState(prev => ({ ...prev, [r.id]: "idle" }));
      setDeleteError(prev => ({ ...prev, [r.id]: e instanceof Error ? e.message : "Delete failed" }));
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
              padding: "0.45rem 1.25rem", background: "var(--isp-accent)", border: "none",
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
              background: pingingAll ? "rgba(37,99,235,0.08)" : "rgba(37,99,235,0.05)",
              border: "1px solid var(--isp-accent-border)",
              borderRadius: 7, color: "var(--isp-accent)", fontSize: "0.78rem",
              cursor: pingingAll ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600,
            }}
          >
            {pingingAll
              ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Checking…</>
              : <><Radio size={12} /> Ping All</>}
          </button>
          <button
            onClick={autoFixVpnIps}
            disabled={autoFixing}
            title="Auto-detect VPN IPs from OpenVPN ipp.txt and update router IP addresses"
            style={{
              display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.45rem 0.85rem",
              background: autoFixing ? "var(--isp-accent-glow)" : "rgba(167,139,250,0.05)",
              border: "1px solid var(--isp-accent-border)",
              borderRadius: 7, color: "var(--isp-accent)", fontSize: "0.78rem",
              cursor: autoFixing ? "default" : "pointer", fontFamily: "inherit", fontWeight: 600,
            }}
          >
            {autoFixing
              ? <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Detecting…</>
              : <><Wand2 size={12} /> Auto-fix IPs</>}
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

        <InstallProgressPanel />

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
                    {["ID","ROUTER NAME","WAN IP (Public)","VPN IP (Tunnel)","PROXY (Backup)","USERNAME","DESCRIPTION","STATUS","STATE","UPTIME","MODEL","LAST SEEN","REBOOT","MANAGE","REMOTE ACCESS"].map(h => (
                      <Th key={h} label={h} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={15} style={{ padding: "3rem 1.5rem", textAlign: "center", color: "var(--isp-text-muted)", fontSize: "0.875rem" }}>
                        {search ? `No routers matching "${search}"` : (
                          <>No routers added yet. <a href="/admin/network/add-router" style={{ color: "var(--isp-accent)", textDecoration: "underline", fontWeight: 600 }}>Add your first router</a></>
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
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", color: "var(--isp-accent)", fontSize: "0.75rem" }}>
                          {r.host || r.ip_address || "—"}
                        </td>

                        {/* VPN IP (Tunnel) */}
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                          {r.bridge_ip || "—"}
                        </td>

                        {/* PROXY (Backup) */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          {r.proxy_ip ? (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)",
                              color: "#c084fc", borderRadius: 5,
                              padding: "0.18rem 0.55rem", fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700,
                            }}>
                              ⇄ {r.proxy_ip}
                            </span>
                          ) : (
                            <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>—</span>
                          )}
                        </td>

                        {/* USERNAME */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)" }}>
                          {r.router_username || "admin"}
                        </td>

                        {/* DESCRIPTION */}
                        <td style={{ padding: "0.65rem 0.75rem", maxWidth: 200 }}>
                          {(() => {
                            const desc = r.description || "";
                            if (!desc) return <span style={{ color: "var(--isp-text-muted)" }}>—</span>;
                            const lower = desc.toLowerCase();
                            if (lower.startsWith("replaced on")) {
                              const when = desc.slice("Replaced on ".length);
                              return (
                                <span title={desc} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                                  🔄 Replaced on <span style={{ fontWeight: 500 }}>{when}</span>
                                </span>
                              );
                            }
                            if (lower.startsWith("manually installed on")) {
                              const when = desc.slice("Manually installed on ".length);
                              return (
                                <span title={desc} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                                  ✚ Installed on <span style={{ fontWeight: 500 }}>{when}</span>
                                </span>
                              );
                            }
                            if (lower.startsWith("installed on")) {
                              const when = desc.slice("Installed on ".length);
                              return (
                                <span title={desc} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: "#34d399", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                                  ✚ Installed on <span style={{ fontWeight: 500 }}>{when}</span>
                                </span>
                              );
                            }
                            return (
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--isp-text-muted)", fontSize: "0.78rem" }} title={desc}>
                                {desc}
                              </span>
                            );
                          })()}
                        </td>

                        {/* STATUS */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          <Badge label="Enabled" color="#fff" bg="#1e4d2b" />
                        </td>

                        {/* STATE */}
                        <td style={{ padding: "0.65rem 0.75rem", verticalAlign: "top" }}>
                          {pingSt === "pinging"
                            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "var(--isp-accent)" }}>
                                <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Checking…
                              </span>
                            : pingSt === "online"
                              ? <StatusDot online={true} />
                              : pingSt === "offline"
                                ? <>
                                    <StatusDot online={false} sub={timeSince(r.last_seen)} />
                                    {pingRes.error && (
                                      <div style={{ marginTop: "0.35rem" }}>
                                        <PingErrorHint error={pingRes.error} />
                                      </div>
                                    )}
                                  </>
                                : online
                                  ? <StatusDot online={true} />
                                  : <StatusDot online={false} sub={timeSince(r.last_seen)} />
                          }
                        </td>

                        {/* UPTIME — live: DB snapshot + elapsed since recorded, overridden by fresh in-memory ping */}
                        <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", fontSize: "0.72rem", color: currOnline ? "var(--isp-text)" : "var(--isp-text-muted)" }}>
                          {currOnline
                            ? liveUptime(r.router_uptime, r.uptime_at, pingResult[r.id]?.uptime, pingResult[r.id]?.pingAt)
                            : "—"}
                        </td>

                        {/* MODEL */}
                        <td style={{ padding: "0.65rem 0.75rem", color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                          {r.model || "—"}
                        </td>

                        {/* LAST SEEN */}
                        <td style={{ padding: "0.65rem 0.75rem" }}>
                          {currOnline
                            ? <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#4ade80" }}>Active</span>
                            : <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                                {timeSince(r.last_seen)}
                              </span>
                          }
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
                              onClick={() => openEdit(r)}
                              color="#60a5fa" bg="var(--isp-accent-glow)" border="var(--isp-accent-border)"
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
                            {deleteError[r.id] && (
                              <span
                                title={deleteError[r.id]}
                                onClick={() => setDeleteError(p => ({ ...p, [r.id]: "" }))}
                                style={{
                                  fontSize: "0.68rem", color: "#f87171", cursor: "pointer",
                                  maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
                                  whiteSpace: "nowrap", padding: "0.15rem 0.4rem",
                                  background: "rgba(248,113,113,0.08)", borderRadius: 4,
                                  border: "1px solid rgba(248,113,113,0.25)",
                                }}
                              >
                                ✕ {deleteError[r.id]}
                              </span>
                            )}
                            {pingSt === "pinging" ? (
                              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.68rem", color: "var(--isp-accent)" }}>
                                <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> Checking…
                              </span>
                            ) : pingSt === "online" ? (
                              <Btn
                                label="Re-check"
                                icon={<Radio size={10} />}
                                onClick={() => pingOneRouter(r)}
                                color="#4ade80" bg="rgba(34,197,94,0.08)" border="rgba(34,197,94,0.3)"
                              />
                            ) : pingSt === "offline" ? (
                              <Btn
                                label="Re-check"
                                icon={<RefreshCw size={10} />}
                                onClick={() => pingOneRouter(r)}
                                color="#f87171" bg="rgba(248,113,113,0.12)" border="rgba(248,113,113,0.35)"
                              />
                            ) : (
                              <Btn
                                label={online ? "Ping" : "Re-check"}
                                icon={online ? <Radio size={10} /> : <RefreshCw size={10} />}
                                onClick={() => pingOneRouter(r)}
                                color={online ? "var(--isp-accent)" : "#f87171"}
                                bg={online ? "rgba(37,99,235,0.08)" : "rgba(248,113,113,0.12)"}
                                border={online ? "var(--isp-accent-border)" : "rgba(248,113,113,0.35)"}
                              />
                            )}
                            <Btn
                              label="Offline History"
                              icon={<History size={10} />}
                              onClick={() => setHistoryModal(r)}
                              color="#94a3b8" bg="rgba(255,255,255,0.04)" border="rgba(255,255,255,0.1)"
                            />
                            <Btn
                              label="Install History"
                              icon={<History size={10} />}
                              onClick={() => setInstallHistoryModal(r)}
                              color="#a78bfa" bg="rgba(167,139,250,0.08)" border="rgba(167,139,250,0.3)"
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
                    border: `1px solid ${p === currentPage ? "var(--isp-accent)" : "var(--isp-border)"}`,
                    background: p === currentPage ? "var(--isp-accent-glow)" : "var(--isp-section)",
                    color: p === currentPage ? "var(--isp-accent)" : "var(--isp-text-muted)",
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

      {/* ── Edit Router Modal ── */}
      {editRouter && (
        <Modal title={`Edit Router — ${editRouter.name}`} onClose={() => setEditRouter(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.2)", color: "#7dd3fc", fontSize: "0.72rem", lineHeight: 1.5 }}>
              <strong>VPN setup:</strong> If your router has no public IP (common in Kenya), leave <em>WAN IP</em> empty and only set the <em>VPN Tunnel IP</em>. The system uses the VPN IP to reach the router. Seeing the same IP in both fields is normal.
            </div>
            {(["name", "host", "bridge_ip", "proxy_ip", "bridge_interface", "router_username", "router_secret", "coordinates", "coverage"] as const).map((field) => {
              const labels: Record<string, string> = {
                name:             "Router Name",
                host:             "WAN / Public IP (optional — leave empty if no public IP)",
                bridge_ip:        "VPN Tunnel IP (10.8.0.x) — Main VPN connection",
                proxy_ip:         "Proxy VPN IP (10.9.0.x) — Backup connection via OcholaSuper-Proxy",
                bridge_interface: "Hotspot Bridge Interface",
                router_username:  "API Username",
                router_secret:    "API Password",
                coordinates:      "GPS Coordinates (Latitude, Longitude)",
                coverage:         "Coverage Radius (meters)",
              };
              const placeholders: Record<string, string> = {
                name:             "e.g. come1",
                host:             "e.g. 41.80.123.45 — public WAN IP if available",
                bridge_ip:        "e.g. 10.8.0.2 — assigned by main OpenVPN",
                proxy_ip:         "e.g. 10.9.0.2 — assigned by proxy OpenVPN",
                bridge_interface: "Click Detect or type e.g. hotspot-bridge",
                router_username:  "admin",
                router_secret:    "••••••••",
                coordinates:      "e.g. -1.2921, 36.8219 (Nairobi)",
                coverage:         "e.g. 500",
              };

              const inputStyle: React.CSSProperties = {
                width: "100%", boxSizing: "border-box",
                padding: "0.5rem 0.75rem", borderRadius: 7,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--isp-border)",
                color: "var(--isp-text)", fontSize: "0.84rem",
                fontFamily: "inherit", outline: "none",
              };

              if (field === "bridge_interface") {
                return (
                  <div key={field}>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.3rem", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                      {labels[field]}
                    </label>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <input
                        type="text"
                        value={editForm.bridge_interface}
                        onChange={e => setEditForm(p => ({ ...p, bridge_interface: e.target.value }))}
                        placeholder={placeholders[field]}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        onClick={handleDetectBridge}
                        disabled={detecting}
                        title="Auto-detect bridge interfaces from the router"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "0.4rem 0.75rem", borderRadius: 7, flexShrink: 0,
                          background: detecting ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.1)",
                          border: "1px solid rgba(34,197,94,0.3)",
                          color: "#4ade80", fontSize: "0.72rem", fontWeight: 700,
                          cursor: detecting ? "wait" : "pointer", fontFamily: "inherit",
                          whiteSpace: "nowrap" as const,
                        }}
                      >
                        {detecting
                          ? <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Detecting…</>
                          : <><Radio size={11} /> Detect</>}
                      </button>
                    </div>
                    {/* Detection result pill */}
                    {detectResult && (
                      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.6 }}>
                        {detectResult.detectedBridgeInterface ? (
                          <span style={{ color: "#4ade80" }}>
                            ✓ Found: <strong style={{ fontFamily: "monospace" }}>{detectResult.detectedBridgeInterface}</strong>
                            {detectResult.bridgeInterfaces.length > 1 && (
                              <span style={{ color: "var(--isp-text-muted)", marginLeft: 6 }}>
                                (all: {detectResult.bridgeInterfaces.join(", ")})
                              </span>
                            )}
                            <span style={{ marginLeft: 6, color: "rgba(74,222,128,0.7)", fontSize: 10 }}>— auto-filled & saved</span>
                          </span>
                        ) : (
                          <span style={{ color: "#fbbf24" }}>⚠ No bridge interfaces found on this router</span>
                        )}
                      </div>
                    )}
                    <p style={{ margin: "3px 0 0", fontSize: "0.65rem", color: "var(--isp-text-muted)" }}>
                      Detected automatically from the router's /interface/bridge. Used by hotspot setup scripts.
                    </p>
                  </div>
                );
              }

              if (field === "coordinates") {
                const hasCoords = editForm.coordinates.trim().length > 0;
                const [lat, lng] = editForm.coordinates.split(",").map(s => s.trim());
                const validCoords = hasCoords && !isNaN(Number(lat)) && !isNaN(Number(lng));
                return (
                  <div key={field}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border)", paddingBottom: "0.375rem", marginBottom: "0.5rem" }}>
                      Location & Coverage
                    </div>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.3rem", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                      {labels[field]}
                    </label>
                    <input
                      type="text"
                      value={editForm.coordinates}
                      onChange={e => setEditForm(p => ({ ...p, coordinates: e.target.value }))}
                      placeholder={placeholders[field]}
                      style={inputStyle}
                    />
                    <p style={{ margin: "3px 0 0", fontSize: "0.65rem", color: "var(--isp-text-muted)" }}>
                      Used for the network coverage map. Format: latitude, longitude
                    </p>
                    {validCoords && (
                      <div style={{ marginTop: 8, borderRadius: 8, overflow: "hidden", border: "1px solid var(--isp-border)", height: 140 }}>
                        <iframe
                          title="Router location"
                          width="100%" height="140" frameBorder="0" style={{ border: 0 }}
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(lng)-0.01},${Number(lat)-0.01},${Number(lng)+0.01},${Number(lat)+0.01}&layer=mapnik&marker=${lat},${lng}`}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              if (field === "coverage") {
                return (
                  <div key={field}>
                    <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.3rem", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                      {labels[field]}
                    </label>
                    <input
                      type="number"
                      value={editForm.coverage}
                      onChange={e => setEditForm(p => ({ ...p, coverage: e.target.value }))}
                      placeholder={placeholders[field]}
                      style={inputStyle}
                    />
                    <p style={{ margin: "3px 0 0", fontSize: "0.65rem", color: "var(--isp-text-muted)" }}>
                      Approximate coverage radius in meters. Displayed as a circle on the network map.
                    </p>
                  </div>
                );
              }

              return (
                <div key={field}>
                  <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.3rem", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                    {labels[field]}
                  </label>
                  <input
                    type={field === "router_secret" ? "password" : "text"}
                    value={editForm[field]}
                    onChange={e => setEditForm(p => ({ ...p, [field]: e.target.value }))}
                    placeholder={placeholders[field]}
                    style={inputStyle}
                  />
                </div>
              );
            })}
            {editError && (
              <div style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: "0.78rem" }}>
                {editError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.25rem" }}>
              <button
                onClick={() => setEditRouter(null)}
                style={{ padding: "0.45rem 1rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", color: "var(--isp-text)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.45rem 1.25rem", borderRadius: 6, background: "var(--isp-accent)", border: "none", color: "white", fontSize: "0.8rem", fontWeight: 700, cursor: editSaving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: editSaving ? 0.7 : 1 }}
              >
                {editSaving ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={12} />}
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {installHistoryModal && (
        <InstallHistoryModal
          router={installHistoryModal}
          onClose={() => setInstallHistoryModal(null)}
        />
      )}

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

      {/* ── Auto-fix VPN IPs Results Modal ── */}
      {autoFixResults && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
        }} onClick={() => setAutoFixResults(null)}>
          <div style={{
            background: "var(--isp-section)", border: "1px solid var(--isp-border)",
            borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: 580,
            maxHeight: "80vh", overflow: "auto",
          }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Wand2 size={16} style={{ color: "var(--isp-accent)" }} />
                <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--isp-text)" }}>Auto-fix VPN IPs — Results</span>
              </div>
              <button onClick={() => setAutoFixResults(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--isp-text-muted)", padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            {/* Error state */}
            {!autoFixResults.ok && (
              <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "1rem" }}>
                <p style={{ margin: "0 0 6px", fontWeight: 700, color: "#f87171", fontSize: "0.85rem" }}>
                  <AlertCircle size={12} style={{ display: "inline", marginRight: 5 }} />
                  Could not read VPN IP data from server
                </p>
                <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "var(--isp-text-muted)", lineHeight: 1.6 }}>
                  {autoFixResults.error}
                </p>
                {autoFixResults.searched && (
                  <div>
                    <p style={{ margin: "0 0 4px", fontSize: "0.73rem", color: "var(--isp-text-muted)", fontWeight: 600 }}>Looked in these paths on the VPS:</p>
                    {autoFixResults.searched.map(p => (
                      <code key={p} style={{ display: "block", fontSize: "0.7rem", color: "#94a3b8", fontFamily: "monospace", padding: "1px 0" }}>{p}</code>
                    ))}
                    <p style={{ margin: "10px 0 0", fontSize: "0.73rem", color: "#fbbf24", lineHeight: 1.6 }}>
                      Make sure OpenVPN is running on the VPS and the <code style={{ fontFamily: "monospace" }}>ipp.txt</code> file exists. You may need to add <code style={{ fontFamily: "monospace" }}>ifconfig-pool-persist /etc/openvpn/server/ipp.txt</code> to your OpenVPN server config.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Success state */}
            {autoFixResults.ok && autoFixResults.summary && (
              <>
                {/* Summary pills */}
                <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
                  {[
                    { label: "Routers found",  val: autoFixResults.summary.total,     color: "#94a3b8" },
                    { label: "IPs updated",    val: autoFixResults.summary.updated,   color: "var(--isp-accent)" },
                    { label: "Now online",     val: autoFixResults.summary.online,    color: "#4ade80" },
                    { label: "No VPN match",   val: autoFixResults.summary.unmatched, color: "#f87171" },
                  ].map(p => (
                    <div key={p.label} style={{ flex: 1, minWidth: 100, background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "10px 12px", textAlign: "center" }}>
                      <p style={{ margin: "0 0 2px", fontSize: "1.4rem", fontWeight: 800, color: p.color }}>{p.val}</p>
                      <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.label}</p>
                    </div>
                  ))}
                </div>

                {/* VPN clients detected */}
                {autoFixResults.vpnClients && Object.keys(autoFixResults.vpnClients).length > 0 && (
                  <div style={{ marginBottom: "1rem" }}>
                    <p style={{ margin: "0 0 6px", fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      VPN clients detected on this server
                    </p>
                    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
                      {Object.entries(autoFixResults.vpnClients).map(([name, ip]) => (
                        <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--isp-text)" }}>{name}</span>
                          <code style={{ fontSize: "0.73rem", color: "var(--isp-accent)", fontFamily: "monospace" }}>{ip}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-router results */}
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: "0.75rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Router results</p>
                  {(autoFixResults.results ?? []).map(r => (
                    <div key={r.routerId} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}>
                      <span style={{ marginTop: 2, flexShrink: 0 }}>
                        {r.pingOk
                          ? <CheckCircle size={13} style={{ color: "#4ade80" }} />
                          : r.matched
                            ? <AlertCircle size={13} style={{ color: "#f59e0b" }} />
                            : <AlertCircle size={13} style={{ color: "#64748b" }} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 2px", fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text)" }}>
                          {r.routerName}
                        </p>
                        {r.matched ? (
                          <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
                            Matched <strong style={{ color: "var(--isp-accent)" }}>{r.clientName}</strong>
                            {" → "}
                            <code style={{ fontFamily: "monospace", color: "var(--isp-accent)" }}>{r.newIp}</code>
                            {r.pingOk
                              ? <span style={{ color: "#4ade80" }}> · Online ✓ {r.identity && `(${r.identity})`} {r.uptime && `· up ${formatUptime(r.uptime)}`}</span>
                              : r.pingError ? <PingErrorHint error={r.pingError} /> : null}
                          </p>
                        ) : (
                          <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748b" }}>
                            No VPN client matched this router name. Edit the router and set the IP manually.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {autoFixResults.summary.unmatched > 0 && (
                  <div style={{ marginTop: "0.75rem", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "10px 12px", fontSize: "0.75rem", color: "#fbbf24", lineHeight: 1.6 }}>
                    <strong>Unmatched routers</strong> — the router name in the database doesn't match any OpenVPN client name. Make sure the OpenVPN client name on the MikroTik matches the router name here. You can also edit the router and set the IP manually.
                  </div>
                )}
              </>
            )}

            <button onClick={() => setAutoFixResults(null)} style={{
              marginTop: "1rem", width: "100%", padding: "8px", borderRadius: 8,
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--isp-text-muted)", fontSize: "0.8rem", cursor: "pointer",
            }}>Close</button>
          </div>
        </div>
      )}

    </AdminLayout>
  );
}
