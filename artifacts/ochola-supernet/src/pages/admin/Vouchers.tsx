import React, { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID } from "@/lib/supabase";
import { adminApiHeaders } from "@/lib/admin-router-context";
import {
  Plus, Search, Printer, Copy, Trash2, Loader2, CheckCircle2,
  Ticket, Wifi, X, Download, RefreshCw, Filter, Eye, EyeOff,
  AlertTriangle, ChevronDown, Pencil,
} from "lucide-react";
import { getCurrencySymbol } from "@/lib/utils";

/* ─────────────────────────── Types ─────────────────────────── */
interface VoucherRedemptionAccount {
  customer_id: number | null;
  username: string;
  phone: string | null;
  redeemed_at: string;
  service_expires_at: string | null;
  online: boolean;
  service_status: "available" | "expired" | "active" | "inactive" | "unknown";
  data_used_bytes: number;
}

interface VoucherRow {
  code: string;
  plan_name: string;
  router_id: number | null;
  router_name: string;
  price: number;
  validity_mins: number;
  expiry: string | null;
  expiry_kind: "service" | "redeem_by" | null;
  service_expires_at?: string | null;
  used: boolean;
  redemption_status: "available" | "partially_redeemed" | "redeemed" | "expired";
  redemptions_used: number;
  max_redemptions: number;
  remaining_redemptions: number;
  redemption_accounts: VoucherRedemptionAccount[];
  redeemed_at: string | null;
  redeemed_by: string | null;
  online: boolean;
  service_status: "available" | "expired" | "active" | "inactive" | "unknown";
  data_limit_mb: number | null;
  data_cap_mode: "disconnect" | "throttle";
  data_limit_bytes: number | null;
  data_used_bytes: number;
  created_at: string;
}

interface DbPlanLite {
  id: number; name: string; type: string; price: number; validity: number;
  validity_unit?: string | null;
  speed_down: number; speed_up: number; router_id: number | null;
  data_limit_mb: number | null;
  data_cap_mode: "disconnect" | "throttle";
}
interface DbRouterLite { id: number; name: string; host: string; status: string; }

/* ─────────────────────────── Helpers ─────────────────────────── */
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

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

function toEastAfricaDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueByType = new Map(parts.map(part => [part.type, part.value]));
  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}`;
}

function fmtDataLimit(mb: number | null | undefined): string {
  const value = Number(mb);
  if (!Number.isFinite(value) || value <= 0) return "Unlimited";
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("en-KE", { maximumFractionDigits: 2 })} TB`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("en-KE", { maximumFractionDigits: 2 })} GB`;
  return `${value.toLocaleString("en-KE", { maximumFractionDigits: 2 })} MB`;
}

function fmtDataUsage(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString("en-KE", { maximumFractionDigits: 2 })} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("en-KE", { maximumFractionDigits: 2 })} MB`;
  return `${(value / 1_000).toLocaleString("en-KE", { maximumFractionDigits: 1 })} KB`;
}

function fmtPlanValidity(plan: Pick<DbPlanLite, "validity" | "validity_unit">): string {
  const unit = String(plan.validity_unit ?? "days").toLowerCase();
  const unitLabel = /^(m|min|mins|minute|minutes)$/.test(unit)
    ? "minute"
    : /^(h|hr|hrs|hour|hours)$/.test(unit)
      ? "hour"
      : /^(w|wk|wks|week|weeks)$/.test(unit)
        ? "week"
        : /^(mo|month|months)$/.test(unit)
          ? "month"
          : "day";
  return `${plan.validity} ${unitLabel}${Number(plan.validity) === 1 ? "" : "s"}`;
}

function previewCode(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${prefix ? `${prefix.toUpperCase()}-` : ""}${segment()}-${segment()}`;
}

/* ─────────────────────────── DB Functions ─────────────────────── */
interface VoucherConfig {
  plans: DbPlanLite[];
  routers: DbRouterLite[];
}

interface LocalVoucherCleanupRouterResult {
  routerId: number;
  routerName: string;
  status: "cleaned" | "no_matches" | "offline" | "failed";
  inspectedUsers: number;
  matchedVouchers: string[];
  removedUsers: number;
  unmatchedVoucherCodes: string[];
  failedVoucherCodes: string[];
  error?: string;
  warning?: string;
}

interface LocalVoucherCleanupResult {
  ok: boolean;
  removedUsers: number;
  routers: LocalVoucherCleanupRouterResult[];
}

async function voucherApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(adminApiHeaders());
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error(body && typeof body === "object" && "error" in body
      ? String(body.error)
      : `Voucher request failed (${response.status}).`);
  }
  return body as T;
}

async function fetchVoucherConfig(): Promise<VoucherConfig> {
  return voucherApi<VoucherConfig>("/api/vouchers/hotspot/config");
}

async function fetchVouchers(): Promise<VoucherRow[]> {
  return voucherApi<VoucherRow[]>("/api/vouchers/hotspot");
}

interface VoucherGenerationInput {
  quantity: number;
  maxRedemptions: number;
  planId: number;
  routerId: number | null;
  prefix: string;
  fixedCode: string;
  expiryDate: string | null;
}

async function createVouchers(input: VoucherGenerationInput): Promise<{ created: number; codes: string[] }> {
  return voucherApi("/api/vouchers/hotspot/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function deleteVoucher(code: string): Promise<void> {
  await voucherApi(`/api/vouchers/hotspot/${encodeURIComponent(code)}`, { method: "DELETE" });
}

async function deleteVouchers(codes: string[]): Promise<{ deleted: number }> {
  return voucherApi("/api/vouchers/hotspot/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes }),
  });
}

async function cleanLocalVoucherCopies(): Promise<LocalVoucherCleanupResult> {
  return voucherApi("/api/vouchers/hotspot/cleanup-local-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

interface VoucherUpdateInput {
  code: string;
  expiryAt?: string | null;
  dataLimitMb?: number | null;
}

async function updateVoucher(input: VoucherUpdateInput): Promise<{ ok: boolean }> {
  const body: Record<string, unknown> = {};
  if (input.expiryAt !== undefined) body.expiryAt = input.expiryAt;
  if (input.dataLimitMb !== undefined) body.dataLimitMb = input.dataLimitMb;
  return voucherApi(`/api/vouchers/hotspot/${encodeURIComponent(input.code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ─────────────────────────── Print Component ─────────────────── */
function PrintVoucherCard({ v, plan }: { v: VoucherRow; plan?: DbPlanLite }) {
  return (
    <div style={{ width: 220, border: "1.5px dashed var(--isp-accent)", borderRadius: 10, padding: "0.875rem", background: "white", color: "#0f172a", fontFamily: "monospace", pageBreakInside: "avoid", display: "inline-block", margin: "0.5rem" }}>
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: "0.75rem", color: "var(--isp-accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.375rem" }}>
        {v.router_name !== "—" ? v.router_name : "WIFI VOUCHER"}
      </div>
      <div style={{ textAlign: "center", fontSize: "1.375rem", fontWeight: 900, letterSpacing: "0.12em", color: "#0f172a", marginBottom: "0.35rem" }}>
        {v.code}
      </div>
      <div style={{ borderTop: "1px dashed #94a3b8", paddingTop: "0.35rem", fontSize: "0.625rem", display: "flex", justifyContent: "space-between" }}>
        <span><strong>Plan:</strong> {v.plan_name}</span>
        <span><strong>{getCurrencySymbol()} {v.price}</strong></span>
      </div>
      <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.2rem" }}>
        Data: {fmtDataLimit(v.data_limit_mb)} · Time: {v.validity_mins > 0 ? fmtValidity(v.validity_mins) : "No time limit"}
      </div>
      <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.2rem" }}>
        Up to {v.max_redemptions} redemption{v.max_redemptions === 1 ? "" : "s"} · one account each
      </div>
      <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.2rem" }}>
        Up to {v.max_redemptions} redemption{v.max_redemptions === 1 ? "" : "s"} · one account each
      </div>
      {v.expiry && (
        <div style={{ fontSize: "0.6rem", color: "#64748b", marginTop: "0.2rem" }}>
          Expires: {v.expiry}
        </div>
      )}
    </div>
  );
}

function EditVoucherModal({
  voucher,
  saving,
  onClose,
  onSave,
}: {
  voucher: VoucherRow;
  saving: boolean;
  onClose: () => void;
  onSave: (input: VoucherUpdateInput) => void;
}) {
  const [expiry, setExpiry] = useState(toEastAfricaDateInput(voucher.expiry));
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [limited, setLimited] = useState(voucher.data_limit_mb != null && voucher.data_limit_mb > 0);
  const [dataLimitMb, setDataLimitMb] = useState(
    voucher.data_limit_mb != null && voucher.data_limit_mb > 0 ? String(voucher.data_limit_mb) : "",
  );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (limited && (!Number.isFinite(Number(dataLimitMb)) || Number(dataLimitMb) <= 0)) return;
    onSave({
      code: voucher.code,
      ...(expiryTouched ? {
        expiryAt: expiry || null,
      } : {}),
      dataLimitMb: limited ? Number(dataLimitMb) : null,
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--isp-inner-card)",
    border: "1px solid var(--isp-border)",
    borderRadius: 8,
    padding: "0.65rem 0.75rem",
    color: "var(--isp-text)",
    fontSize: "0.85rem",
    fontFamily: "inherit",
  };

  return (
    <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(2,6,23,0.72)", display: "grid", placeItems: "center", padding: "1rem" }}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-voucher-title"
        style={{ width: "min(100%, 480px)", background: "var(--isp-card, #101827)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: "1.25rem", boxShadow: "0 24px 80px rgba(0,0,0,0.4)", display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <h2 id="edit-voucher-title" style={{ margin: 0, color: "var(--isp-text)", fontSize: "1.05rem" }}>Edit voucher</h2>
            <div style={{ marginTop: "0.25rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>{voucher.code} · {voucher.redemptions_used}/{voucher.max_redemptions} redeemed</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close edit voucher"
            style={{ border: 0, background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <label style={{ display: "grid", gap: "0.4rem", color: "var(--isp-text)", fontSize: "0.8rem", fontWeight: 600 }}>
          Redeem-by deadline (East Africa Time)
          <input type="date" value={expiry} onChange={event => { setExpiry(event.target.value); setExpiryTouched(true); }} style={inputStyle} />
          <span style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", fontWeight: 400 }}>
            Leave blank for no redemption deadline. The selected date expires at 11:59:59 p.m. EAT. This changes future redemptions only; existing prepaid accounts keep their own expiry.
          </span>
        </label>

        <div style={{ display: "grid", gap: "0.55rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", color: "var(--isp-text)", fontSize: "0.82rem", fontWeight: 600 }}>
            <input type="checkbox" checked={limited} onChange={event => setLimited(event.target.checked)} />
            Limit this voucher’s total data
          </label>
          {limited && (
            <div style={{ display: "grid", gap: "0.45rem" }}>
              <input aria-label="Voucher data cap in MB" type="number" min="0.01" step="0.01" required value={dataLimitMb}
                onChange={event => setDataLimitMb(event.target.value)} placeholder="Data cap in MB" style={inputStyle} />
              <span style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>
                Current package behavior: {voucher.data_cap_mode === "throttle" ? "throttle at cap" : "disconnect at cap"}.
              </span>
            </div>
          )}
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem", lineHeight: 1.45 }}>
            The data limit applies to each new prepaid account from this voucher; existing accounts keep their saved allowance and usage.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", paddingTop: "0.25rem" }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ background: "transparent", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.9rem", color: "var(--isp-text-muted)", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="submit" disabled={saving || (limited && (!Number.isFinite(Number(dataLimitMb)) || Number(dataLimitMb) <= 0))}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", background: "var(--isp-accent)", border: 0, borderRadius: 8, padding: "0.6rem 0.9rem", color: "#fff", fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─────────────────────────── Generate Modal ─────────────────── */
function GenerateModal({
  plans, routers, generating, onClose, onGenerate,
}: {
  plans: DbPlanLite[];
  routers: DbRouterLite[];
  generating: boolean;
  onClose: () => void;
  onGenerate: (batch: VoucherGenerationInput) => void;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? 0);
  const [selectedRouterId, setSelectedRouterId] = useState<number | "all">("all");
  const [qty, setQty] = useState(5);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [fixedCode, setFixedCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const plan = plans.find(p => p.id === selectedPlanId) ?? plans[0];
  const router = selectedRouterId === "all" ? null : (routers.find(r => r.id === selectedRouterId) ?? null);

  const handleGenerate = () => {
    if (!plan) return;
    onGenerate({
      quantity: fixedCode ? 1 : qty,
      maxRedemptions,
      planId: plan.id,
      routerId: router?.id ?? null,
      prefix,
      fixedCode: fixedCode.trim().toUpperCase(),
      expiryDate: expiryDate || null,
    });
  };

  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "1rem", boxSizing: "border-box" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="voucher-generate-title" style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "calc(100dvh - 2rem)", overflowY: "auto", overscrollBehavior: "contain", padding: "clamp(1rem, 3vw, 1.75rem)", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ticket size={18} style={{ color: "white" }} />
            </div>
            <div>
              <div id="voucher-generate-title" style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)" }}>Generate Vouchers</div>
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
                <option key={p.id} value={p.id}>{p.name} — {getCurrencySymbol()} {p.price} · {fmtPlanValidity(p)} · {fmtDataLimit(p.data_limit_mb)}</option>
              ))}
            </select>
          </label>

          {/* Plan preview */}
          {plan && (
            <div style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 8, padding: "0.75rem 1rem", display: "flex", gap: "1.5rem" }}>
              {[
                ["Price",    `${getCurrencySymbol()} ${plan.price}`],
                ["Validity", fmtPlanValidity(plan)],
                ["Speed",    `${plan.speed_down}/${plan.speed_up} Mbps`],
                ["Data",     plan.data_limit_mb && plan.data_limit_mb > 0
                  ? `${fmtDataLimit(plan.data_limit_mb)} · ${plan.data_cap_mode === "throttle" ? "throttle" : "disconnect"} at cap`
                  : "Unlimited"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: "0.65rem", color: "var(--isp-accent)", fontWeight: 600, textTransform: "uppercase" }}>{k}</div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          {plan && (
            <div style={{ marginTop: "-0.5rem", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
              Each separate account created from a voucher receives this plan allowance.
            </div>
          )}

          {/* Quantity + Prefix row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Quantity</span>
              <input
                type="number" min={1} max={100} value={fixedCode ? 1 : qty} disabled={!!fixedCode}
                onChange={e => setQty(Math.min(100, Math.max(1, Number(e.target.value))))}
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%", opacity: fixedCode ? 0.6 : 1 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Code Prefix <span style={{ textTransform: "none", opacity: 0.6 }}>(optional)</span></span>
              <input
                type="text" placeholder="e.g. HN" value={prefix} disabled={!!fixedCode}
                onChange={e => setPrefix(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))}
                style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%", opacity: fixedCode ? 0.6 : 1 }} />
            </label>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              People per voucher
            </span>
            <input
              type="number" min={1} max={500} step={1} value={maxRedemptions}
              onChange={event => setMaxRedemptions(Math.min(500, Math.max(1, Number(event.target.value) || 1)))}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }}
            />
            <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>
              Each successful redemption creates a separate prepaid Hotspot account. Set 1 for a single-use code.
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Fixed voucher code <span style={{ textTransform: "none", opacity: 0.6 }}>(optional · 3–32 letters or numbers, no spaces)</span>
            </span>
            <input
              type="text"
              placeholder="e.g. HYT46 or T6Y"
              maxLength={32}
              value={fixedCode}
              onChange={e => setFixedCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).toUpperCase())}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }}
            />
            {fixedCode.length > 0 && fixedCode.length < 3 && (
              <span style={{ fontSize: "0.68rem", color: "#f87171" }}>Use at least three letters or numbers.</span>
            )}
          </label>

          {/* Expiry */}
          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Redeem-by deadline <span style={{ textTransform: "none", opacity: 0.6 }}>(optional)</span></span>
            <input
              type="date" value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.6rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" }} />
            <span style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>
              The code expires at the end of the selected date in East Africa Time.
            </span>
          </label>

          {/* Preview code */}
          <div style={{ background: "var(--isp-inner-card)", borderRadius: 8, padding: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Sample code:</span>
            <code style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-accent)", letterSpacing: "0.12em" }}>{fixedCode || previewCode(prefix)}</code>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", borderRadius: 10, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || !plan || (fixedCode.length > 0 && fixedCode.length < 3)}
              style={{ flex: 2, padding: "0.7rem", borderRadius: 10, background: generating ? "var(--isp-accent-border)" : "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              {generating ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Ticket size={15} />}
              {generating ? "Generating…" : fixedCode ? "Create Fixed Voucher" : `Generate ${qty} Voucher${qty !== 1 ? "s" : ""}`}
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
            <button onClick={doPrint} style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "var(--isp-accent)", border: "none", borderRadius: 8, padding: "0.5rem 1rem", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
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
  const [editingVoucher, setEditingVoucher] = useState<VoucherRow | null>(null);
  const [showCodes,      setShowCodes]      = useState(true);
  const [search,         setSearch]         = useState("");
  const [filterRouter,   setFilterRouter]   = useState("all");
  const [filterPlan,     setFilterPlan]     = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [copiedCode,     setCopiedCode]     = useState<string | null>(null);
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null);
  const [cleanupResult,  setCleanupResult]  = useState<LocalVoucherCleanupResult | null>(null);
  const [syncProgress,   setSyncProgress]   = useState<{
    running: boolean;
    total: number;
    completed: number;
    connected: number;
    alreadyConnected: number;
    needsAttention: number;
  } | null>(null);
  const [syncNotes, setSyncNotes] = useState<string[]>([]);
  const syncBusyRef = useRef(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: voucherConfig, isLoading: configLoading } = useQuery({
    queryKey: ["hotspot_voucher_config", ADMIN_ID],
    queryFn: fetchVoucherConfig,
  });
  const plans = voucherConfig?.plans ?? [];
  const routers = voucherConfig?.routers ?? [];
  const {
    data: vouchers = [],
    isLoading: vouchersLoading,
    isError: voucherListFailed,
    error: voucherListError,
    refetch,
  } = useQuery({
    queryKey: ["vouchers", ADMIN_ID],
    queryFn: fetchVouchers,
    refetchOnWindowFocus: false,
  });

  /* ─── Generate mutation ─── */
  const generateMutation = useMutation({
    mutationFn: createVouchers,
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] });
      setShowGenerate(false);
      showToast(`${result.created} voucher${result.created !== 1 ? "s" : ""} created successfully`);
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
    onSuccess: result => { qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] }); setSelected(new Set()); showToast(`Deleted ${result.deleted} vouchers`); },
    onError:   (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const cleanupMutation = useMutation({
    mutationFn: cleanLocalVoucherCopies,
    onSuccess: result => {
      setCleanupResult(result);
      const needsAttention = result.routers.some(item =>
        item.status === "offline"
        || item.status === "failed"
        || item.unmatchedVoucherCodes.length > 0,
      );
      showToast(
        needsAttention
          ? `Removed ${result.removedUsers} matched router voucher user(s); review the router results`
          : `Checked ${result.routers.length} router(s); removed ${result.removedUsers} local voucher user(s)`,
        !needsAttention,
      );
    },
    onError: (e: Error) => showToast(`Router voucher cleanup failed: ${e.message}`, false),
  });

  const syncEligibleAccounts = useMemo(() => {
    const accounts = new Map<number, VoucherRedemptionAccount>();
    for (const voucher of vouchers) {
      for (const account of voucher.redemption_accounts) {
        const customerId = Number(account.customer_id);
        if (
          Number.isSafeInteger(customerId)
          && customerId > 0
          && !account.online
          && account.service_status !== "expired"
        ) {
          accounts.set(customerId, account);
        }
      }
    }
    return [...accounts.entries()].map(([customerId, account]) => ({ customerId, account }));
  }, [vouchers]);

  const syncOfflineVoucherAccounts = async () => {
    if (syncBusyRef.current || syncEligibleAccounts.length === 0) return;
    if (!confirm(
      `Reconnect ${syncEligibleAccounts.length} offline, unexpired voucher account(s) using their individual prepaid usernames? Expired accounts are skipped; voucher codes are never added as router logins.`,
    )) return;

    syncBusyRef.current = true;
    const total = syncEligibleAccounts.length;
    let nextIndex = 0;
    let completed = 0;
    let connected = 0;
    let alreadyConnected = 0;
    let needsAttention = 0;
    const notes: string[] = [];
    setSyncNotes([]);
    setSyncProgress({ running: true, total, completed, connected, alreadyConnected, needsAttention });

    const publishProgress = () => setSyncProgress({
      running: true,
      total,
      completed,
      connected,
      alreadyConnected,
      needsAttention,
    });

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= total) return;
        const { customerId, account } = syncEligibleAccounts[index];
        try {
          const response = await fetch(`/api/customers/${customerId}/hotspot-reconnect`, {
            method: "POST",
            headers: adminApiHeaders(),
          });
          const payload = await response.json() as { status?: string; message?: string; error?: string };
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          if (payload.status === "connected") connected++;
          else if (payload.status === "already_connected") alreadyConnected++;
          else {
            needsAttention++;
            if (notes.length < 5) notes.push(`${account.username}: ${payload.status || "check required"}`);
          }
        } catch {
          needsAttention++;
          if (notes.length < 5) notes.push(`${account.username}: router check failed`);
        } finally {
          completed++;
          publishProgress();
        }
      }
    };

    try {
      await Promise.all(Array.from(
        { length: Math.min(2, total) },
        () => worker(),
      ));
      setSyncProgress({ running: false, total, completed, connected, alreadyConnected, needsAttention });
      setSyncNotes(notes);
      await refetch();
      await qc.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] });
      showToast(
        `Voucher account sync finished: ${connected} connected, ${alreadyConnected} already connected, ${needsAttention} need attention`,
        needsAttention === 0,
      );
    } finally {
      syncBusyRef.current = false;
    }
  };

  const updateMutation = useMutation({
    mutationFn: updateVoucher,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers", ADMIN_ID] });
      setEditingVoucher(null);
              showToast("Voucher settings updated for future redemptions");
    },
    onError: (e: Error) => showToast(`Voucher update failed: ${e.message}`, false),
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
      const matchStatus = filterStatus === "all" || v.redemption_status === filterStatus;
      return matchSearch && matchRouter && matchPlan && matchStatus;
    });
  }, [vouchers, search, filterRouter, filterPlan, filterStatus]);

  const redeemableCount = vouchers.filter(v =>
    v.remaining_redemptions > 0
    && (v.redemption_status === "available" || v.redemption_status === "partially_redeemed"),
  ).length;
  const usedCount = vouchers.reduce((total, voucher) => total + voucher.redemptions_used, 0);

  const selectableFiltered = filtered.filter(v => !v.used);
  const selectedDeletableCodes = selectableFiltered
    .filter(v => selected.has(v.code))
    .map(v => v.code);
  const allSelected  = selectableFiltered.length > 0 && selectableFiltered.every(v => selected.has(v.code));
  const toggleAll    = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableFiltered.map(v => v.code)));
  };
  const toggleOne = (code: string) => {
    if (vouchers.find(v => v.code === code)?.used) return;
    const s = new Set(selected);
    s.has(code) ? s.delete(code) : s.add(code);
    setSelected(s);
  };

  const selectedVouchers = filtered.filter(v => selected.has(v.code));
  const printTarget = selected.size > 0 ? selectedVouchers : filtered;

  const planNames = [...new Set(vouchers.map(v => v.plan_name).filter(n => n !== "—"))];
  const isLoading = vouchersLoading || configLoading;

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
      {showGenerate && !configLoading && (
        <GenerateModal
          plans={plans}
          routers={routers}
          generating={generateMutation.isPending}
          onClose={() => setShowGenerate(false)}
          onGenerate={batch => generateMutation.mutate(batch)}
        />
      )}

      {/* Print Modal */}
      {showPrint && (
        <PrintModal vouchers={printTarget} onClose={() => setShowPrint(false)} />
      )}

      {editingVoucher && (
        <EditVoucherModal
          voucher={editingVoucher}
          saving={updateMutation.isPending}
          onClose={() => { if (!updateMutation.isPending) setEditingVoucher(null); }}
          onSave={input => updateMutation.mutate(input)}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Vouchers</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
              {isLoading ? "Loading…" : voucherListFailed ? "Voucher list could not be loaded" : `${vouchers.length} codes · ${redeemableCount} redeemable · ${usedCount} redemptions`}
            </p>
            <p style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)", margin: "0.25rem 0 0" }}>
              Each code has a redemption limit and creates a separate tracked Hotspot account for each person who redeems it.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <RefreshCw size={13} style={{ animation: vouchersLoading ? "spin 1s linear infinite" : "none" }} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => void syncOfflineVoucherAccounts()}
              disabled={Boolean(syncProgress?.running) || syncEligibleAccounts.length === 0}
              title="Reconnect active, offline voucher accounts using their separate prepaid usernames."
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.25)", color: "var(--isp-accent)", fontWeight: 600, fontSize: "0.8125rem", cursor: syncProgress?.running || syncEligibleAccounts.length === 0 ? "not-allowed" : "pointer", opacity: syncEligibleAccounts.length === 0 ? 0.55 : 1, fontFamily: "inherit" }}
            >
              <RefreshCw size={13} style={{ animation: syncProgress?.running ? "spin 1s linear infinite" : "none" }} />
              {syncProgress?.running
                ? `Syncing ${syncProgress.completed}/${syncProgress.total}…`
                : `Sync offline accounts (${syncEligibleAccounts.length})`}
            </button>
            <button
              onClick={() => {
                if (confirm("Check each MikroTik for locally stored users with the managed voucher marker. Only users whose exact code exists in this account’s voucher records will be removed; unrelated or unmatched users will be left untouched.")) {
                  setCleanupResult(null);
                  cleanupMutation.mutate();
                }
              }}
              disabled={cleanupMutation.isPending || routers.length === 0}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", fontWeight: 600, fontSize: "0.8125rem", cursor: cleanupMutation.isPending || routers.length === 0 ? "not-allowed" : "pointer", opacity: routers.length === 0 ? 0.55 : 1, fontFamily: "inherit" }}
            >
              {cleanupMutation.isPending
                ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                : <Trash2 size={13} />}
              {cleanupMutation.isPending ? "Checking Routers…" : "Clean Router Copies"}
            </button>
            {selected.size > 0 && (
              <>
                <button onClick={() => setShowPrint(true)} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.25)", color: "var(--isp-accent)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                  <Printer size={13} /> Print {selected.size}
                </button>
                {selectedDeletableCodes.length > 0 && (
                  <button
                    onClick={() => { if (confirm(`Delete ${selectedDeletableCodes.length} unused voucher(s)?`)) deleteBulkMutation.mutate(selectedDeletableCodes); }}
                    style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                    <Trash2 size={13} /> Delete {selectedDeletableCodes.length}
                  </button>
                )}
              </>
            )}
            <button onClick={() => { setShowPrint(true); }} style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 0.875rem", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
              <Printer size={13} /> Print All
            </button>
            <button onClick={() => setShowGenerate(true)} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1.125rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px var(--isp-accent-border)" }}>
              <Plus size={15} /> Generate Vouchers
            </button>
          </div>
        </div>

        {syncProgress && !syncProgress.running && (
          <section
            role="status"
            aria-live="polite"
            style={{
              padding: "0.85rem 1rem",
              borderRadius: 10,
              border: `1px solid ${syncProgress.needsAttention ? "rgba(245,158,11,0.28)" : "rgba(34,197,94,0.25)"}`,
              background: syncProgress.needsAttention ? "rgba(245,158,11,0.06)" : "rgba(34,197,94,0.06)",
              color: "var(--isp-text)",
              fontSize: "0.78rem",
            }}
          >
            Account sync finished: {syncProgress.connected} connected, {syncProgress.alreadyConnected} already connected, {syncProgress.needsAttention} need attention.
            <span style={{ display: "block", marginTop: 3, color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>
              Only active prepaid accounts were reconciled. Voucher codes were not added to MikroTik.
            </span>
            {syncNotes.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--isp-text-muted)", fontSize: "0.7rem" }}>
                {syncNotes.map(note => <li key={note}>{note}</li>)}
              </ul>
            )}
          </section>
        )}

        {cleanupResult && (
          <section
            role="status"
            style={{
              padding: "1rem 1.125rem",
              borderRadius: 12,
              border: `1px solid ${cleanupResult.ok ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.25)"}`,
              background: cleanupResult.ok ? "rgba(34,197,94,0.06)" : "rgba(248,113,113,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <div style={{ fontWeight: 700, color: "var(--isp-text)", fontSize: "0.875rem" }}>
                  Router voucher cleanup: {cleanupResult.removedUsers} user(s) removed
                </div>
                <p style={{ margin: "0.3rem 0 0.75rem", color: "var(--isp-text-muted)", fontSize: "0.75rem" }}>
                  Only tagged users matching a voucher record in this account were removed. Unmatched tagged users were left untouched.
                </p>
              </div>
              <button
                type="button"
                aria-label="Dismiss router voucher cleanup results"
                onClick={() => setCleanupResult(null)}
                style={{ background: "transparent", border: 0, color: "var(--isp-text-muted)", cursor: "pointer", padding: 2 }}
              >
                <X size={16} />
              </button>
            </div>
            {cleanupResult.routers.length === 0 ? (
              <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>No routers are registered for this account.</div>
            ) : (
              <div style={{ display: "grid", gap: "0.4rem" }}>
                {cleanupResult.routers.map(item => {
                  const needsAttention = item.status === "offline"
                    || item.status === "failed"
                    || item.unmatchedVoucherCodes.length > 0;
                  const statusLabel = item.status === "offline"
                    ? "Offline / unreachable"
                    : item.status === "failed"
                      ? "Cleanup failed"
                      : item.status === "cleaned"
                        ? "Cleaned"
                        : "No confirmed copies";
                  return (
                    <div key={item.routerId} style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.75rem" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "baseline" }}>
                        <strong style={{ color: "var(--isp-text)" }}>{item.routerName}</strong>
                        <span style={{ color: needsAttention ? "#f87171" : "#4ade80" }}>{statusLabel}</span>
                        <span style={{ color: "var(--isp-text-muted)" }}>
                          {item.inspectedUsers} users checked · {item.removedUsers} removed
                        </span>
                      </div>
                      {item.matchedVouchers.length > 0 && (
                        <span style={{ color: "var(--isp-text-muted)" }}>
                          Tagged voucher codes found: {item.matchedVouchers.join(", ")}
                        </span>
                      )}
                      {item.error && <span style={{ color: "#f87171" }}>{item.error}</span>}
                      {item.failedVoucherCodes.length > 0 && (
                        <span style={{ color: "#f87171" }}>Not confirmed removed: {item.failedVoucherCodes.join(", ")}</span>
                      )}
                      {item.unmatchedVoucherCodes.length > 0 && (
                        <span style={{ color: "#fbbf24" }}>Tagged users without a matching voucher record (left in place): {item.unmatchedVoucherCodes.join(", ")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Stat Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          {[
            { label: "Voucher Codes",  value: vouchers.length,  grad: "linear-gradient(135deg,#0fb8ad,#1fc8db)", icon: <Ticket size={22} style={{ opacity: 0.9 }} /> },
            { label: "Redeemable Codes",  value: redeemableCount,    grad: "linear-gradient(135deg,#43e97b,#38f9d7)", icon: <CheckCircle2 size={22} style={{ opacity: 0.9 }} /> },
            { label: "Total Redemptions", value: usedCount,         grad: "linear-gradient(135deg,#f7971e,#ffd200)", icon: <Wifi size={22} style={{ opacity: 0.9 }} /> },
            { label: "Routers Linked",  value: new Set(vouchers.map(v => v.router_id).filter(Boolean)).size, grad: "linear-gradient(135deg,#a18cd1,#fbc2eb)", icon: <Filter size={22} style={{ opacity: 0.9 }} /> },
          ].map(k => (
            <div key={k.label} style={{ borderRadius: 12, background: k.grad, padding: "1.125rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 90, overflow: "hidden", position: "relative" }}>
              <div>
                <div style={{ fontSize: "2rem", fontWeight: 900, color: "white", lineHeight: 1, letterSpacing: "-0.02em" }}>
                  {isLoading || voucherListFailed ? "—" : k.value}
                </div>
                <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.85)", fontWeight: 600, marginTop: "0.25rem" }}>{k.label}</div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.3)", position: "absolute", right: "1rem" }}>{k.icon}</div>
            </div>
          ))}
        </div>

        {/* ── Router Quick View ── */}
        {!configLoading && routers.length > 0 && (
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
                    <div style={{ marginLeft: "0.5rem", fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 20, background: "rgba(37,99,235,0.1)", color: "var(--isp-accent)", fontWeight: 700 }}>
                      {rVouchers.length} vouchers
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              <option value="available">Unused</option>
              <option value="partially_redeemed">Partially redeemed</option>
              <option value="redeemed">Redeemed</option>
              <option value="expired">Expired</option>
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
                    <input type="checkbox" checked={allSelected} disabled={selectableFiltered.length === 0} onChange={toggleAll}
                      style={{ accentColor: "var(--isp-accent)", width: 14, height: 14 }} />
                  </th>
                  {["Code", "Plan", "Router", "Price", "Speed", "Data", "Prepaid accounts", "Connection", "Service", "Redeem-by (EAT)", "Redemptions", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.75rem 1rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={13} style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--isp-text-muted)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading vouchers…
                    </div>
                  </td></tr>
                ) : voucherListFailed ? (
                  <tr><td colSpan={13} style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--isp-text-muted)" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                      <AlertTriangle size={24} style={{ color: "#f87171" }} />
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--isp-text)", marginBottom: "0.25rem" }}>Voucher list could not be loaded</div>
                        <div style={{ fontSize: "0.8rem" }}>
                          {voucherListError instanceof Error ? voucherListError.message : "Check your connection and try again."}
                        </div>
                      </div>
                      <button onClick={() => { void refetch(); }} style={{ marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                        <RefreshCw size={13} /> Retry
                      </button>
                    </div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={13} style={{ textAlign: "center", padding: "4rem 1rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(37,99,235,0.08)", border: "1.5px dashed var(--isp-accent-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Ticket size={24} style={{ color: "var(--isp-accent)", opacity: 0.6 }} />
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
                        <button onClick={() => setShowGenerate(true)} style={{ marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1.25rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                          <Plus size={14} /> Generate Vouchers
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : filtered.map(v => {
                  const planInfo = plans.find(p => p.name === v.plan_name);
                  const isSelected = selected.has(v.code);
                  const serviceStatusLabel = ({
                    available: "Ready",
                    expired: "Expired",
                    active: "Active",
                    inactive: "Inactive",
                    unknown: "Unknown",
                  } as const)[v.service_status];
                  const serviceStatusColor = v.service_status === "active" || v.service_status === "available"
                    ? "#22c55e"
                    : v.service_status === "inactive" || v.service_status === "expired"
                      ? "#f87171"
                      : "#94a3b8";
                  const redemptionStatusLabel = v.redemption_status === "redeemed"
                    ? `Redeemed ${v.redemptions_used}/${v.max_redemptions}`
                    : v.redemption_status === "partially_redeemed"
                      ? `Partially redeemed ${v.redemptions_used}/${v.max_redemptions}`
                      : v.redemption_status === "expired"
                        ? `Expired · ${v.redemptions_used}/${v.max_redemptions}`
                        : "Unused";
                  const redemptionStatusColor = v.redemption_status === "redeemed"
                    ? "#fbbf24"
                    : v.redemption_status === "expired"
                      ? "#f87171"
                      : v.redemption_status === "partially_redeemed"
                        ? "#60a5fa"
                        : "#22c55e";
                  return (
                    <tr key={v.code} className="vrow"
                      style={{ borderBottom: "1px solid var(--isp-border-subtle)", background: isSelected && !v.used ? "rgba(37,99,235,0.05)" : "transparent", cursor: v.used ? "default" : "pointer" }}
                      onClick={() => { if (!v.used) toggleOne(v.code); }}>
                      <td style={{ padding: "0.7rem 1rem", textAlign: "center" }} onClick={e => { e.stopPropagation(); if (!v.used) toggleOne(v.code); }}>
                        <input type="checkbox" checked={isSelected && !v.used} disabled={v.used} onChange={() => toggleOne(v.code)}
                          title={v.used ? "Redeemed vouchers cannot be selected for deletion." : "Select unused voucher"}
                          style={{ accentColor: "var(--isp-accent)", width: 14, height: 14 }} />
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <code style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--isp-accent)", letterSpacing: "0.1em", fontSize: "0.875rem", filter: showCodes ? "none" : "blur(5px)", userSelect: showCodes ? "auto" : "none", transition: "filter 0.2s" }}>
                            {v.code}
                          </code>
                        </div>
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <span style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem", borderRadius: 6, background: "rgba(37,99,235,0.1)", color: "var(--isp-accent)", fontWeight: 600 }}>{v.plan_name}</span>
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                        {v.router_name !== "—" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
                            {v.router_name}
                          </div>
                        ) : <span style={{ color: "var(--isp-text-sub)", fontSize: "0.75rem" }}>Universal</span>}
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "#4ade80", fontWeight: 700 }}>{getCurrencySymbol()} {v.price}</td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                        {planInfo ? `${planInfo.speed_down}/${planInfo.speed_up} Mbps` : "—"}
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                        <div style={{ color: "var(--isp-text)", fontWeight: 600 }}>
                          {v.data_limit_mb !== null ? fmtDataLimit(v.data_limit_mb) : "Unlimited"}
                        </div>
                        <div style={{ fontSize: "0.64rem", marginTop: "0.15rem" }}>per prepaid account</div>
                        {v.used && v.data_limit_bytes !== null && (
                          <div style={{ fontSize: "0.67rem", marginTop: "0.15rem" }}>
                            {fmtDataUsage(v.data_used_bytes)} combined used
                          </div>
                        )}
                        {v.data_limit_mb !== null && (
                          <div style={{ fontSize: "0.64rem", marginTop: "0.15rem" }}>
                            {v.data_cap_mode === "throttle" ? "Throttle at cap" : "Disconnect at cap"}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.75rem", minWidth: 190 }}>
                        {v.redemption_accounts.length > 0 ? (
                          <div style={{ display: "grid", gap: "0.35rem" }}>
                            {v.redemption_accounts.map((account, index) => (
                              <div key={`${account.username}-${index}`} style={{ borderBottom: index < v.redemption_accounts.length - 1 ? "1px solid var(--isp-border-subtle)" : "none", paddingBottom: index < v.redemption_accounts.length - 1 ? "0.35rem" : 0 }}>
                                <div style={{ color: "var(--isp-text)", fontWeight: 600, overflowWrap: "anywhere" }}>
                                  {account.username || account.phone || "Unlinked account"}
                                </div>
                                {account.phone && account.phone !== account.username && (
                                  <div style={{ fontSize: "0.66rem", marginTop: "0.1rem" }}>{account.phone}</div>
                                )}
                                <div style={{ fontSize: "0.66rem", marginTop: "0.1rem" }}>
                                  {fmtDateTime(account.redeemed_at)} · {account.online ? "Online" : account.service_status === "expired" ? "Expired" : "Offline"}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : v.used ? (
                          <>
                            <div style={{ color: "var(--isp-text)", fontWeight: 600, overflowWrap: "anywhere" }}>
                              {v.redeemed_by ?? "Legacy redemption"}
                            </div>
                            {v.redeemed_at && (
                              <div style={{ fontSize: "0.66rem", marginTop: "0.15rem" }}>First use {fmtDateTime(v.redeemed_at)}</div>
                            )}
                          </>
                        ) : <span>Not redeemed</span>}
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        {v.used ? (
                          <span style={{ fontSize: "0.68rem", padding: "0.2rem 0.5rem", borderRadius: 20, fontWeight: 700, background: v.online ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.1)", color: v.online ? "#22c55e" : "#94a3b8" }}>
                            {v.online ? "Online" : "Offline"}
                          </span>
                        ) : <span style={{ color: "var(--isp-text-sub)" }}>—</span>}
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <span style={{ fontSize: "0.68rem", padding: "0.2rem 0.5rem", borderRadius: 20, fontWeight: 700, background: `${serviceStatusColor}1a`, color: serviceStatusColor, whiteSpace: "nowrap" }}>
                          {serviceStatusLabel}
                        </span>
                      </td>
                      <td style={{ padding: "0.7rem 1rem", color: "var(--isp-text-muted)", fontSize: "0.72rem", minWidth: 150 }}>
                        <div style={{ color: "var(--isp-text)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                          {v.expiry ? fmtDateTime(v.expiry) : "No redeem-by date"}
                        </div>
                        {v.expiry && (
                          <div style={{ fontSize: "0.65rem", marginTop: "0.15rem" }}>
                            Voucher redeem-by date (EAT)
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.7rem 1rem" }}>
                        <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: `${redemptionStatusColor}1a`, color: redemptionStatusColor, whiteSpace: "nowrap" }}>
                          {redemptionStatusLabel}
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
                          <button
                            aria-label={`Edit voucher ${v.code}`}
                            title="Edit expiry or data cap without resetting recorded usage."
                            onClick={() => setEditingVoucher(v)}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--isp-accent)", cursor: "pointer" }}>
                            <Pencil size={13} />
                          </button>
                          <button
                            title={v.used ? "Redeemed vouchers cannot be deleted. You can still edit expiry and data allowance." : "Delete unused voucher"}
                            disabled={v.used || deleteMutation.isPending}
                            onClick={() => { if (!v.used && confirm(`Delete unused voucher ${v.code}?`)) deleteMutation.mutate(v.code); }}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: v.used ? "var(--isp-text-sub)" : "var(--isp-text-muted)", cursor: v.used ? "not-allowed" : "pointer", opacity: v.used ? 0.45 : 1 }}>
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
              <span>{selectedDeletableCodes.length > 0 ? `${selectedDeletableCodes.length} unused selected · ` : ""}{filtered.length} of {vouchers.length} vouchers</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {selectedDeletableCodes.length === 0 && selectableFiltered.length > 0 && (
                  <button onClick={() => setSelected(new Set(selectableFiltered.map(v => v.code)))}
                    style={{ background: "none", border: "none", color: "var(--isp-accent)", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", padding: 0, fontWeight: 600 }}>
                    Select all {selectableFiltered.length} unused
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
