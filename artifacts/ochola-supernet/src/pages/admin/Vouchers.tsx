import React, { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import {
  Plus, Search, Printer, Copy, Trash2, Loader2, CheckCircle2,
  Ticket, Wifi, X, Download, RefreshCw, Filter, Eye, EyeOff,
  AlertTriangle, ChevronDown, UploadCloud,
} from "lucide-react";
import { RouterSyncBar } from "@/components/ui/RouterSyncBar";

/* ─────────────────────────── Types ─────────────────────────── */
interface VoucherRow {
  code: string;
  plan_name: string;
  router_id: number | null;
  router_name: string;
  price: number;
  validity_mins: number;
  expiry: string | null;
  used: boolean;
  created_at: string;
}

interface DbPlanLite { id: number; name: string; type: string; price: number; validity: number; speed_down: number; speed_up: number; }
interface DbRouterLite { id: number; name: string; host: string; status: string; }

/* ─────────────────────────── Helpers ─────────────────────────── */
function genCode(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const raw = `${seg(4)}-${seg(4)}`;
  return prefix ? `${prefix.toUpperCase()}-${raw}` : raw;
}

function fmtValidity(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${mins / 60}h`;
  if (mins < 10080) return `${mins / 1440}d`;
  if (mins < 43200) return `${Math.round(mins / 10080)}w`;
  return `${Math.round(mins / 43200)}mo`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "2-digit" });
}

/* ─────────────────────────── DB Functions ─────────────────────── */
async function fetchPlans(): Promise<DbPlanLite[]> {
  const { data, error } = await supabase.from("isp_plans").select("id,name,type,price,validity,speed_down,speed_up").eq("admin_id", ADMIN_ID).eq("type", "hotspot").order("price", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchRouters(): Promise<DbRouterLite[]> {
  const { data, error } = await supabase.from("isp_routers").select("id,name,host,status").eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

async function fetchVouchers(): Promise<VoucherRow[]> {
  // Fetch from radcheck where attribute = 'Cleartext-Password'
  const { data: checks, error: checkErr } = await supabase
    .from("radcheck")
    .select("id,username,value,attribute")
    .eq("attribute", "Cleartext-Password")
    .order("id", { ascending: false });
  if (checkErr) throw checkErr;
  if (!checks || checks.length === 0) return [];

  const usernames = checks.map(c => c.username);

  // Fetch plan linkage from radusergroup
  const { data: groups } = await supabase.from("radusergroup").select("username,groupname").in("username", usernames);
  const groupMap: Record<string, string> = {};
  (groups ?? []).forEach(g => { groupMap[g.username] = g.groupname; });

  // Fetch metadata from radcheck (custom attributes)
  const { data: meta } = await supabase.from("radcheck").select("username,attribute,value").in("username", usernames).in("attribute", ["Isp-Price", "Isp-Router-Id", "Isp-Router-Name", "Isp-Validity-Mins", "Expiration", "Isp-Created-At"]);
  const metaMap: Record<string, Record<string, string>> = {};
  (meta ?? []).forEach(m => {
    if (!metaMap[m.username]) metaMap[m.username] = {};
    metaMap[m.username][m.attribute] = m.value;
  });

  // Fetch used status from radacct
  const { data: acct } = await supabase.from("radacct").select("username").in("username", usernames);
  const usedSet = new Set((acct ?? []).map(a => a.username));

  return checks.map(c => {
    const m = metaMap[c.username] ?? {};
    return {
      code: c.username,
      plan_name: groupMap[c.username] ?? m["Isp-Plan-Name"] ?? "—",
      router_id: m["Isp-Router-Id"] ? Number(m["Isp-Router-Id"]) : null,
      router_name: m["Isp-Router-Name"] ?? "—",
      price: m["Isp-Price"] ? Number(m["Isp-Price"]) : 0,
      validity_mins: m["Isp-Validity-Mins"] ? Number(m["Isp-Validity-Mins"]) : 0,
      expiry: m["Expiration"] ?? null,
      used: usedSet.has(c.username),
      created_at: m["Isp-Created-At"] ?? new Date().toISOString(),
    };
  });
}

async function createVouchers(batch: {
  codes: string[];
  plan: DbPlanLite;
  router: DbRouterLite | null;
  expiryDate: string | null;
}): Promise<void> {
  const { codes, plan, router, expiryDate } = batch;
  const now = new Date().toISOString();
  const validityMins = plan.validity * (plan.validity <= 30 && plan.name.toLowerCase().includes("min") ? 1 : 1440);

  const checkRows: { username: string; attribute: string; op: string; value: string }[] = [];
  const groupRows: { username: string; groupname: string; priority: number }[] = [];

  for (const code of codes) {
    checkRows.push({ username: code, attribute: "Cleartext-Password", op: ":=", value: code });
    checkRows.push({ username: code, attribute: "Isp-Price", op: ":=", value: String(plan.price) });
    checkRows.push({ username: code, attribute: "Isp-Router-Id", op: ":=", value: router ? String(router.id) : "0" });
    checkRows.push({ username: code, attribute: "Isp-Router-Name", op: ":=", value: router?.name ?? "Any" });
    checkRows.push({ username: code, attribute: "Isp-Plan-Name", op: ":=", value: plan.name });
    checkRows.push({ username: code, attribute: "Isp-Validity-Mins", op: ":=", value: String(plan.validity * 1440) });
    checkRows.push({ username: code, attribute: "Isp-Created-At", op: ":=", value: now });
    if (expiryDate) {
      checkRows.push({ username: code, attribute: "Expiration", op: ":=", value: expiryDate });
    }
    groupRows.push({ username: code, groupname: plan.name, priority: 1 });
  }

  const { error: e1 } = await supabase.from("radcheck").insert(checkRows);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("radusergroup").insert(groupRows);
  if (e2) throw e2;
}

async function deleteVoucher(code: string): Promise<void> {
  await supabase.from("radcheck").delete().eq("username", code);
  await supabase.from("radusergroup").delete().eq("username", code);
}

async function deleteVouchers(codes: string[]): Promise<void> {
  await supabase.from("radcheck").delete().in("username", codes);
  await supabase.from("radusergroup").delete().in("username", codes);
}

/* ─────────────────────────── Print Component ─────────────────── */
function PrintVoucherCard({ v, plan }: { v: VoucherRow; plan?: DbPlanLite }) {
  return (
    <div style={{ width: 220, border: "1.5px dashed #2563EB", borderRadius: 10, padding: "0.875rem", background: "white", color: "#0f172a", fontFamily: "monospace", pageBreakInside: "avoid", display: "inline-block", margin: "0.5rem" }}>
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: "0.75rem", color: "#2563EB", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.375rem" }}>
        {v.router_name !== "—" ? v.router_name : "WIFI VOUCHER"}
      </div>
      <div style={{ textAlign: "center", fontSize: "1.375rem", fontWeight: 900, letterSpacing: "0.12em", color: "#0f172a", marginBottom: "0.35rem" }}>
        {v.code}
      </div>
      <div style={{ borderTop: "1px dashed #94a3b8", paddingTop: "0.35rem", fontSize: "0.625rem", display: "flex", justifyContent: "space-between" }}>
        <span><strong>Plan:</strong> {v.plan_name}</span>
        <span><strong>Ksh {v.price}</strong></span>
      </div>
      {v.expiry && (
        <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.2rem" }}>
          Expires: {v.expiry}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Generate Modal ─────────────────── */
function GenerateModal({
  plans, routers, onClose, onGenerate,
}: {
  plans: DbPlanLite[];
  routers: DbRouterLite[];
  onClose: () => void;
  onGenerate: (batch: { codes: string[]; plan: DbPlanLite; router: DbRouterLite | null; expiryDate: string | null }) => void;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? 0);
  const [selectedRouterId, setSelectedRouterId] = useState<number | "all">("all");
  const [qty, setQty] = useState(5);
  const [prefix, setPrefix] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [generating, setGenerating] = useState(false);

  const plan = plans.find(p => p.id === selectedPlanId) ?? plans[0];
  const router = selectedRouterId === "all" ? null : (routers.find(r => r.id === selectedRouterId) ?? null);

  const handleGenerate = async () => {
    if (!plan) return;
    setGenerating(true);
    const codes = Array.from({ length: qty }, () => genCode(prefix));
    onGenerate({ codes, plan, router, expiryDate: expiryDate || null });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 500, padding: "1.75rem", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#2563EB,#0284c7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ticket size={18} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)" }}>Generate Vouchers</div>
              <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Create new hotspot voucher codes</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4, borderRadius: 6 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Router */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Router (Hotspot)
            </span>
            <select
              value={selectedRouterId}
              onChange={e => setSelectedRouterId(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }}>
              <option value="all">Any Router (universal)</option>
              {routers.map(r => (
                <option key={r.id} value={r.id}>{r.name} — {r.host} {r.status === "online" ? "🟢" : "🔴"}</option>
              ))}
            </select>
          </label>

          {/* Plan */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Hotspot Plan
            </span>
            <select
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(Number(e.target.value))}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }}>
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.name} — Ksh {p.price} · {p.validity}d · {p.speed_down}/{p.speed_up} Mbps</option>
              ))}
            </select>
          </label>

          {/* Plan preview */}
          {plan && (
            <div style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, padding: "0.75rem 1rem", display: "flex", gap: "1.5rem" }}>
              {[
                ["Price",    `Ksh ${plan.price}`],
                ["Validity", `${plan.validity} day${plan.validity !== 1 ? "s" : ""}`],
                ["Speed",    `${plan.speed_down}/${plan.speed_up} Mbps`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: "0.65rem", color: "#3b82f6", fontWeight: 600, textTransform: "uppercase" }}>{k}</div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Quantity + Prefix row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Quantity</span>
              <input
                type="number" min={1} max={100} value={qty}
                onChange={e => setQty(Math.min(100, Math.max(1, Number(e.target.value))))}
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Code Prefix <span style={{ textTransform: "none", opacity: 0.6 }}>(optional)</span></span>
              <input
                type="text" placeholder="e.g. HN" value={prefix}
                onChange={e => setPrefix(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))}
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }} />
            </label>
          </div>

          {/* Expiry */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Batch Expiry Date <span style={{ textTransform: "none", opacity: 0.6 }}>(optional)</span></span>
            <input
              type="date" value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }} />
          </label>

          {/* Preview code */}
          <div style={{ background: "var(--isp-inner-card)", borderRadius: 8, padding: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Sample code:</span>
            <code style={{ fontSize: "0.875rem", fontWeight: 700, color: "#3b82f6", letterSpacing: "0.12em" }}>{genCode(prefix)}</code>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", borderRadius: 10, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || !plan}
              style={{ flex: 2, padding: "0.7rem", borderRadius: 10, background: generating ? "rgba(37,99,235,0.4)" : "linear-gradient(135deg,#2563EB,#0284c7)", border: "none", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              {generating ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Ticket size={15} />}
              {generating ? "Generating…" : `Generate ${qty} Voucher${qty !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Print Dialog ─────────────────────── */
function PrintModal({ vouchers, onClose }: { vouchers: VoucherRow[]; onClose: () => void }) {
  const printRef = useRef<HTMLDivElement>(null);

  const doPrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open("", "_blank")!;
    win.document.write(`<html><head><title>Vouchers</title><style>body{margin:0;padding:1rem;background:#fff;font-family:monospace}@media print{@page{margin:0.5cm}}</style></head><body>${el.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 300);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.125rem 1.5rem", borderBottom: "1px solid var(--isp-border)" }}>
          <span style={{ fontWeight: 700, color: "var(--isp-text)" }}>Print Preview — {vouchers.length} voucher{vouchers.length !== 1 ? "s" : ""}</span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={doPrint} style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "#2563EB", border: "none", borderRadius: 8, padding: "0.5rem 1rem", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <Printer size={14} /> Print
            </button>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text-muted)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div style={{ overflowY: "auto", padding: "1.5rem", background: "#f1f5f9" }}>
          <div ref={printRef} style={{ display: "flex", flexWrap: "wrap", gap: "0" }}>
            {vouchers.map(v => <PrintVoucherCard key={v.code} v={v} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Main Page ─────────────────────────── */
export default function Vouchers() {
  const qc = useQueryClient();
  const autoGenerate = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("action") === "generate";
  const [showGenerate,   setShowGenerate]   = useState(autoGenerate);
  const [showPrint,      setShowPrint]      = useState(false);
  const [showCodes,      setShowCodes]      = useState(true);
  const [search,         setSearch]         = useState("");
  const [filterRouter,   setFilterRouter]   = useState("all");
  const [filterPlan,     setFilterPlan]     = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [copiedCode,     setCopiedCode]     = useState<string | null>(null);
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: adminInfo } = useQuery({
    queryKey: ["admin_info", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("name").eq("id", ADMIN_ID).single();
      return data as { name: string } | null;
    },
  });
  const companyName = adminInfo?.name ?? "ISP";

  const { data: plans   = [], isLoading: plansLoading   } = useQuery({ queryKey: ["isp_plans_hotspot", ADMIN_ID],  queryFn: fetchPlans   });
  const { data: routers = [], isLoading: routersLoading } = useQuery({ queryKey: ["isp_routers", ADMIN_ID],        queryFn: fetchRouters });
  const { data: vouchers = [], isLoading: vouchersLoading, refetch } = useQuery({
    queryKey: ["vouchers", ADMIN_ID],
    queryFn: fetchVouchers,
    refetchOnWindowFocus: false,
  });

  /* ─── Generate mutation ─── */
  const generateMutation = useMutation({
    mutationFn: createVouchers,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] });
      setShowGenerate(false);
      showToast(`${vars.codes.length} voucher${vars.codes.length !== 1 ? "s" : ""} created successfully`);
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  /* ─── Delete single ─── */
  const deleteMutation = useMutation({
    mutationFn: deleteVoucher,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] }); showToast("Voucher deleted"); },
    onError:   (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  /* ─── Delete bulk ─── */
  const deleteBulkMutation = useMutation({
    mutationFn: deleteVouchers,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] }); setSelected(new Set()); showToast(`Deleted ${selected.size} vouchers`); },
    onError:   (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  /* ─── Copy ─── */
  const copyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      showToast(`Copied: ${code}`);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  }, []);

  /* ─── Filtering ─── */
  const filtered = useMemo(() => {
    return vouchers.filter(v => {
      const matchSearch = !search ||
        v.code.toLowerCase().includes(search.toLowerCase()) ||
        v.plan_name.toLowerCase().includes(search.toLowerCase());
      const matchRouter = filterRouter === "all" || String(v.router_id) === filterRouter || (filterRouter === "0" && !v.router_id);
      const matchPlan   = filterPlan   === "all" || v.plan_name === filterPlan;
      const matchStatus = filterStatus === "all" || (filterStatus === "used" ? v.used : !v.used);
      return matchSearch && matchRouter && matchPlan && matchStatus;
    });
  }, [vouchers, search, filterRouter, filterPlan, filterStatus]);

  const unusedCount = vouchers.filter(v => !v.used).length;
  const usedCount   = vouchers.filter(v =>  v.used).length;

  const allSelected  = filtered.length > 0 && filtered.every(v => selected.has(v.code));
  const toggleAll    = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(v => v.code)));
  };
  const toggleOne = (code: string) => {
    const s = new Set(selected);
    s.has(code) ? s.delete(code) : s.add(code);
    setSelected(s);
  };

  const selectedVouchers = filtered.filter(v => selected.has(v.code));
  const printTarget = selected.size > 0 ? selectedVouchers : filtered;

  const planNames = [...new Set(vouchers.map(v => v.plan_name).filter(n => n !== "—"))];
  const isLoading = vouchersLoading || plansLoading || routersLoading;

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }
        .vrow:hover { background: rgba(255,255,255,0.035) !important; }
        .vrow td { transition: background 0.1s; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 24, zIndex: 2000, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderRadius: 10, background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${toast.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`, color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.875rem", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "slideIn 0.2s ease" }}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Generate Modal */}
      {showGenerate && !plansLoading && !routersLoading && (
        <GenerateModal
          plans={plans}
          routers={routers}
          onClose={() => setShowGenerate(false)}
          onGenerate={batch => generateMutation.mutate(batch)}
        />
      )}

      {/* Print Modal */}
      {showPrint && (
        <PrintModal vouchers={printTarget} onClose={() => setShowPrint(false)} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Hotspot Vouchers</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
              {isLoading ? "Loading…" : `${vouchers.length} total · ${unusedCount} unused · ${usedCount} used`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <RefreshCw size={13} style={{ animation: vouchersLoading ? "spin 1s linear infinite" : "none" }} /> Refresh
            </button>
            {selected.size > 0 && (
              <>
                <button onClick={() => setShowPrint(true)} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.25)", color: "#3b82f6", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                  <Printer size={13} /> Print {selected.size}
                </button>
                <button
                  onClick={() => { if (confirm(`Delete ${selected.size} voucher(s)?`)) deleteBulkMutation.mutate([...selected]); }}
                  style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                  <Trash2 size={13} /> Delete {selected.size}
                </button>
              </>
            )}
            <button onClick={() => { setShowPrint(true); }} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <Printer size={13} /> Print All
            </button>
            <button onClick={() => setShowGenerate(true)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1.125rem", borderRadius: 8, background: "linear-gradient(135deg,#2563EB,#0284c7)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(37,99,235,0.3)" }}>
              <Plus size={15} /> Generate Vouchers
            </button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {[
            { label: "Total Vouchers",  value: vouchers.length,  grad: "linear-gradient(135deg,#0fb8ad,#1fc8db)", icon: <Ticket size={22} style={{ opacity: 0.9 }} /> },
            { label: "Unused / Ready",  value: unusedCount,       grad: "linear-gradient(135deg,#43e97b,#38f9d7)", icon: <CheckCircle2 size={22} style={{ opacity: 0.9 }} /> },
            { label: "Used / Redeemed", value: usedCount,         grad: "linear-gradient(135deg,#f7971e,#ffd200)", icon: <Wifi size={22} style={{ opacity: 0.9 }} /> },
            { label: "Routers Linked",  value: new Set(vouchers.map(v => v.router_id).filter(Boolean)).size, grad: "linear-gradient(135deg,#a18cd1,#fbc2eb)", icon: <Filter size={22} style={{ opacity: 0.9 }} /> },
          ].map(k => (
            <div key={k.label} style={{ borderRadius: 12, background: k.grad, padding: "1.125rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 90, overflow: "hidden", position: "relative" }}>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 900, color: "white", lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {isLoading ? "—" : k.value}
                </div>
                <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.85)", fontWeight: 600, marginTop: "0.25rem" }}>{k.label}</div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", position: "absolute", right: "1rem" }}>{k.icon}</div>
            </div>
          ))}
        </div>

        {/* ── Router Quick View ── */}
        {!routersLoading && routers.length > 0 && (
          <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "0.875rem 1.25rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: "0.625rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Hotspot Routers</div>
            <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
              {routers.map(r => {
                const rVouchers = vouchers.filter(v => v.router_id === r.id || (!v.router_id && v.router_name === r.name));
                const isOnline = r.status === "online";
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "var(--isp-inner-card)", border: `1px solid ${isOnline ? "rgba(34,197,94,0.2)" : "rgba(248,113,113,0.15)"}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: isOnline ? "#22c55e" : "#f87171", display: "inline-block", flexShrink: 0, boxShadow: isOnline ? "0 0 5px #22c55e" : "none" }} />
                    <div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--isp-text)" }}>{r.name}</div>
                      <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>{r.host}</div>
                    </div>
                    <div style={{ marginLeft: "0.5rem", fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 20, background: "rgba(37,99,235,0.1)", color: "#3b82f6", fontWeight: 700 }}>
                      {rVouchers.length} vouchers
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Sync to Router ── */}
        <RouterSyncBar
          label="Sync Vouchers to Router"
          description="Push all unused voucher codes as MikroTik hotspot users so they can be authenticated locally on the router (useful as a RADIUS fallback)."
          icon={<UploadCloud size={18} />}
          endpoint="/api/admin/sync/users"
          color="#2563EB"
          buildPayload={() => ({
            users: vouchers.filter(v => !v.used).map(v => ({
              username:  v.code,
              password:  v.code,
              type:      "voucher",
              plan_name: v.plan_name,
              comment:   `${companyName} voucher · ${v.plan_name}`,
            })),
          })}
        />

        {/* ── Table Container ── */}
        <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>

          {/* Filter Bar */}
          <div style={{ display: "flex", gap: "0.75rem", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
              <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by code or plan…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem 0.5rem 2rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }} />
            </div>
            <select value={filterRouter} onChange={e => setFilterRouter(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
              <option value="all">All Routers</option>
              <option value="0">Universal</option>
              {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
              <option value="all">All Plans</option>
              {planNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
              <option value="all">All Status</option>
              <option value="unused">Unused</option>
              <option value="used">Used</option>
            </select>
            <button onClick={() => setShowCodes(c => !c)} title={showCodes ? "Hide codes" : "Show codes"}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.75rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
              {showCodes ? <EyeOff size={13} /> : <Eye size={13} />}
              {showCodes ? "Hide" : "Show"} Codes
            </button>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "center", width: 40 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      style={{ accentColor: "#2563EB", width: 14, height: 14 }} />
                  </th>
                  {["Code", "Plan", "Router", "Price", "Speed", "Expiry", "Status", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.75rem 1rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--isp-text-muted)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading vouchers…
                    </div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: "4rem 1rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(37,99,235,0.08)", border: "1.5px dashed rgba(37,99,235,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ticket size={24} style={{ color: "#2563EB", opacity: 0.6 }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--isp-text)", marginBottom: "0.25rem" }}>
                          {vouchers.length === 0 ? "No vouchers yet" : "No matching vouchers"}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
                          {vouchers.length === 0
                            ? "Click Generate Vouchers to create your first batch."
                            : "Try changing your search or filters."}
                        </div>
                      </div>
                      {vouchers.length === 0 && (
                        <button onClick={() => setShowGenerate(true)} style={{ marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1.25rem", borderRadius: 8, background: "linear-gradient(135deg,#2563EB,#0284c7)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                          <Plus size={14} /> Generate Vouchers
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : filtered.map(v => {
                  const planInfo = plans.find(p => p.name === v.plan_name);
                  const isSelected = selected.has(v.code);
                  return (
                    <tr key={v.code} className="vrow"
                      style={{ borderBottom: "1px solid var(--isp-border-subtle)", background: isSelected ? "rgba(37,99,235,0.05)" : "transparent", cursor: "pointer" }}
                      onClick={() => toggleOne(v.code)}>
                      <td style={{ padding: "0.7rem 1rem", textAlign: "center" }} onClick={e => { e.stopPropagation(); toggleOne(v.code); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(v.code)}
                          style={{ accentColor: "#2563EB", width: 14, height: 14 }} />
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <code style={{ fontFamily: "monospace", fontWeight: 700, color: "#3b82f6", letterSpacing: "0.1em", fontSize: "0.875rem", filter: showCodes ? "none" : "blur(5px)", userSelect: showCodes ? "auto" : "none", transition: "filter 0.2s" }}>
                            {v.code}
                          </code>
                        </div>
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <span style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem", borderRadius: 6, background: "rgba(37,99,235,0.1)", color: "#3b82f6", fontWeight: 600 }}>{v.plan_name}</span>
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                        {v.router_name !== "—" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
                            {v.router_name}
                          </div>
                        ) : <span style={{ color: "var(--isp-text-sub)", fontSize: "0.75rem" }}>Universal</span>}
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "#4ade80", fontWeight: 700 }}>Ksh {v.price}</td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                        {planInfo ? `${planInfo.speed_down}/${planInfo.speed_up} Mbps` : "—"}
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.75rem", fontFamily: "monospace" }}>
                        {v.expiry ? v.expiry : "—"}
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: v.used ? "rgba(251,191,36,0.1)" : "rgba(34,197,94,0.1)", color: v.used ? "#fbbf24" : "#22c55e" }}>
                          {v.used ? "Used" : "Unused"}
                        </span>
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          <button title="Copy code" onClick={() => copyCode(v.code)}
                            style={{ padding: "0.35rem", borderRadius: 6, background: copiedCode === v.code ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: copiedCode === v.code ? "#4ade80" : "var(--isp-text-muted)", cursor: "pointer" }}>
                            {copiedCode === v.code ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                          </button>
                          <button title="Print" onClick={() => { setSelected(new Set([v.code])); setShowPrint(true); }}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
                            <Printer size={13} />
                          </button>
                          <button title="Delete" onClick={() => { if (confirm(`Delete voucher ${v.code}?`)) deleteMutation.mutate(v.code); }}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {!isLoading && vouchers.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.25rem", borderTop: "1px solid var(--isp-border-subtle)", fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
              <span>{selected.size > 0 ? `${selected.size} selected · ` : ""}{filtered.length} of {vouchers.length} vouchers</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {selected.size === 0 && (
                  <button onClick={() => setSelected(new Set(filtered.map(v => v.code)))}
                    style={{ background: "none", border: "none", color: "#2563EB", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", padding: 0, fontWeight: 600 }}>
                    Select all {filtered.length}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
