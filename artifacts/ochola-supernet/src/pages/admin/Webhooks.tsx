import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Webhook, Copy, Check, RefreshCw, Loader2, CheckCircle2,
  XCircle, AlertTriangle, Clock, Globe, CreditCard, Zap,
  Terminal, ChevronDown, ChevronUp, ExternalLink, Lock, Info,
  Activity, Server,
} from "lucide-react";

/* ══════════════════════ Types ══════════════════════════════════ */
interface WebhookEvent {
  id?: number;
  gateway: string;
  status: "received" | "processed" | "ignored" | "error";
  reference?: string;
  amount?: number;
  phone?: string;
  error?: string;
  result?: Record<string, unknown>;
  created_at: string;
}

interface WebhookStatus {
  ok: boolean;
  secret: string;
  stripe: string;
  flutterwave: string;
  endpoints: Record<string, string>;
}

/* ══════════════════════ Helpers ══════════════════════════════════ */
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusColor(s: string): { bg: string; text: string; border: string } {
  const m: Record<string, { bg: string; text: string; border: string }> = {
    processed: { bg: "rgba(74,222,128,0.1)",  text: "#4ade80", border: "rgba(74,222,128,0.3)"  },
    received:  { bg: "rgba(37,99,235,0.1)",   text: "var(--isp-accent)", border: "var(--isp-accent-border)"   },
    ignored:   { bg: "rgba(251,191,36,0.1)",  text: "#fbbf24", border: "rgba(251,191,36,0.3)"  },
    error:     { bg: "rgba(248,113,113,0.1)", text: "#f87171", border: "rgba(248,113,113,0.3)" },
  };
  return m[s] ?? m.ignored;
}

function gatewayLabel(g: string): { label: string; emoji: string; color: string } {
  const m: Record<string, { label: string; emoji: string; color: string }> = {
    mpesa_stk:   { label: "M-Pesa STK",    emoji: "🟢", color: "#00a651" },
    mpesa_c2b:   { label: "M-Pesa C2B",    emoji: "🟢", color: "#00a651" },
    stripe:      { label: "Stripe",         emoji: "💳", color: "#635bff" },
    flutterwave: { label: "Flutterwave",    emoji: "🦋", color: "#f5a623" },
    generic:     { label: "Generic",        emoji: "🌐", color: "#64748b" },
    direct_provision: { label: "Direct",   emoji: "⚡", color: "#a78bfa" },
  };
  return m[g] ?? { label: g, emoji: "🔔", color: "#64748b" };
}

/* ── Copy button ── */
function CopyBtn({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: small ? "3px 8px" : "5px 10px",
        borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
        fontSize: small ? 11 : 12, fontWeight: 700, transition: "all 0.15s",
        background: copied ? "rgba(74,222,128,0.12)" : "rgba(99,102,241,0.12)",
        border: `1px solid ${copied ? "rgba(74,222,128,0.35)" : "rgba(99,102,241,0.35)"}`,
        color: copied ? "#4ade80" : "#a5b4fc",
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* ── Endpoint row ── */
function EndpointRow({
  method, path, label, desc, badge,
}: {
  method: string; path: string; label: string; desc: string; badge?: string;
}) {
  const [open, setOpen] = useState(false);
  const full = `https://102.212.246.158:8080${path}`;

  const methColor = method === "POST"
    ? { bg: "var(--isp-accent-glow)", text: "var(--isp-accent)" }
    : { bg: "rgba(74,222,128,0.1)", text: "#4ade80" };

  return (
    <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ padding: "2px 7px", borderRadius: 5, fontSize: 11, fontWeight: 800, background: methColor.bg, color: methColor.text, flexShrink: 0 }}>
          {method}
        </span>
        <code style={{ fontSize: 12, color: "#a5b4fc", fontFamily: "monospace", flex: 1 }}>{path}</code>
        {badge && (
          <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)", flexShrink: 0 }}>
            {badge}
          </span>
        )}
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--isp-text)", flex: 2 }}>{label}</span>
        {open ? <ChevronUp size={14} style={{ color: "var(--isp-text-muted)", flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: "var(--isp-text-muted)", flexShrink: 0 }} />}
      </div>
      {open && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <p style={{ margin: "10px 0 8px", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.6 }}>{desc}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#060b12", borderRadius: 7, padding: "8px 12px" }}>
            <Globe size={12} style={{ color: "var(--isp-text-muted)", flexShrink: 0 }} />
            <code style={{ fontSize: 11, color: "#c7d2fe", fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{full}</code>
            <CopyBtn text={full} small />
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ Main Page ═══════════════════════════════ */
export default function Webhooks() {
  const [activeTab, setActiveTab] = useState<"urls" | "setup" | "events" | "test">("urls");
  const [testGateway, setTestGateway] = useState("generic");
  const [testPhone,   setTestPhone]   = useState("");
  const [testAmount,  setTestAmount]  = useState("100");
  const [testRef,     setTestRef]     = useState(`TEST-${Date.now()}`);
  const [testResult,  setTestResult]  = useState<Record<string, unknown> | null>(null);
  const [testing,     setTesting]     = useState(false);

  const BASE = "https://102.212.246.158:8080";

  /* ── Fetch backend status ── */
  const statusQ = useQuery<WebhookStatus>({
    queryKey: ["webhook_status"],
    queryFn:  async () => { const r = await fetch("/api/webhooks/status"); return r.json() as Promise<WebhookStatus>; },
    refetchInterval: 30_000,
  });

  /* ── Fetch recent events ── */
  const eventsQ = useQuery<{ events: WebhookEvent[] }>({
    queryKey: ["webhook_events"],
    queryFn:  async () => { const r = await fetch("/api/webhooks/events?limit=50"); return r.json() as Promise<{ events: WebhookEvent[] }>; },
    refetchInterval: activeTab === "events" ? 10_000 : false,
  });

  const events  = eventsQ.data?.events ?? [];
  const status  = statusQ.data;

  /* ── Test send ── */
  async function sendTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/webhooks/generic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone, amount: Number(testAmount), reference: testRef, method: testGateway }),
      });
      const j = await r.json() as Record<string, unknown>;
      setTestResult(j);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const inp: React.CSSProperties = {
    background: "var(--isp-input-bg,#0f1923)",
    border: "1px solid var(--isp-input-border,rgba(255,255,255,0.1))",
    borderRadius: 8, padding: "0.5rem 0.875rem",
    color: "var(--isp-text)", fontSize: "0.875rem",
    fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box",
  };

  /* ── Tab content ── */
  const TABS = [
    { id: "urls",   label: "Webhook URLs",  icon: Globe },
    { id: "setup",  label: "Setup Guide",   icon: Terminal },
    { id: "events", label: `Events${events.length ? ` (${events.length})` : ""}`, icon: Activity },
    { id: "test",   label: "Test Fire",     icon: Zap },
  ] as const;

  return (
    <AdminLayout>
      <div style={{ padding: "1.75rem 2rem", display: "flex", flexDirection: "column", gap: "1.5rem", minHeight: "100%" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
              <Webhook size={20} style={{ color: "var(--isp-accent)" }} />
              <h1 style={{ margin: 0, fontWeight: 800, fontSize: "1.4rem", color: "var(--isp-text)" }}>Payment Webhooks</h1>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--isp-text-muted)" }}>
              Receive payment notifications from M-Pesa, Stripe and Flutterwave — auto-provision router accounts instantly
            </p>
          </div>
          {/* Status pill */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: status?.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${status?.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`, borderRadius: 99, padding: "6px 14px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: status?.ok ? "#4ade80" : "#f87171", boxShadow: status?.ok ? "0 0 6px rgba(74,222,128,0.5)" : "none" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: status?.ok ? "#4ade80" : "#f87171" }}>
              {statusQ.isLoading ? "Checking…" : status?.ok ? "Webhook server live" : "Server unreachable"}
            </span>
          </div>
        </div>

        {/* ── VPS URL banner ── */}
        <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <Server size={14} style={{ color: "#a5b4fc", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#a5b4fc" }}>
              <strong>Your VPS base URL:</strong>
            </p>
            <code style={{ fontSize: 12, color: "#c7d2fe", fontFamily: "monospace" }}>{BASE}</code>
          </div>
          <CopyBtn text={BASE} />
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--isp-border)" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", border: "none", background: "none",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
                color: activeTab === t.id ? "var(--isp-accent)" : "var(--isp-text-muted)",
                borderBottom: activeTab === t.id ? "2px solid var(--isp-accent)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* ═══════════════════ WEBHOOK URLS TAB ═══════════════════ */}
        {activeTab === "urls" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* ── M-Pesa ── */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <span style={{ fontSize: 20 }}>🟢</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>M-Pesa (Safaricom Daraja)</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)" }}>STK Push + C2B Pay-bill / Buy-goods</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <EndpointRow
                  method="POST" path="/api/webhooks/mpesa"
                  label="STK Push Callback"
                  badge="CallBackURL"
                  desc="Set this as the CallBackURL when initiating an STK push via Daraja API. Safaricom sends the payment result here automatically after the customer approves on their phone."
                />
                <EndpointRow
                  method="POST" path="/api/webhooks/mpesa/c2b/validation"
                  label="C2B Validation URL"
                  badge="ValidationURL"
                  desc="Set this as your ValidationURL for C2B Pay-bill or Buy-goods registration. Always returns success so no payment is rejected."
                />
                <EndpointRow
                  method="POST" path="/api/webhooks/mpesa/c2b/confirmation"
                  label="C2B Confirmation URL"
                  badge="ConfirmationURL"
                  desc="Set this as your ConfirmationURL for C2B. Triggered after a successful pay-bill or buy-goods transaction. Customer phone is matched and account is provisioned."
                />
              </div>
            </div>

            {/* ── Stripe ── */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <span style={{ fontSize: 20 }}>💳</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>Stripe</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)" }}>payment_intent.succeeded · checkout.session.completed</p>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: status?.stripe?.startsWith("✅") ? "#4ade80" : "#fbbf24" }}>
                  {status?.stripe?.startsWith("✅") ? <CheckCircle2 size={13} style={{ color: "#4ade80" }} /> : <AlertTriangle size={13} style={{ color: "#fbbf24" }} />}
                  {status?.stripe ?? "not checked"}
                </div>
              </div>
              <EndpointRow
                method="POST" path="/api/webhooks/stripe"
                label="Stripe Webhook"
                desc='Add this URL in your Stripe Dashboard → Developers → Webhooks. Listen for "payment_intent.succeeded" and/or "checkout.session.completed". Add the customer phone number in the payment metadata field named "phone".'
              />
              <div style={{ marginTop: 10, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 7, padding: "10px 12px", fontSize: 11, color: "#fbbf24", lineHeight: 1.7 }}>
                <strong>Required:</strong> Set <code style={{ fontFamily: "monospace" }}>STRIPE_WEBHOOK_SECRET</code> on your VPS. Get it from Stripe Dashboard → Webhooks → Signing secret.
                On VPS: <code style={{ fontFamily: "monospace" }}>echo 'STRIPE_WEBHOOK_SECRET=whsec_xxx' &gt;&gt; /etc/environment</code>
              </div>
            </div>

            {/* ── Flutterwave ── */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <span style={{ fontSize: 20 }}>🦋</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>Flutterwave</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)" }}>charge.completed</p>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  {status?.flutterwave?.startsWith("✅") ? <CheckCircle2 size={13} style={{ color: "#4ade80" }} /> : <AlertTriangle size={13} style={{ color: "#fbbf24" }} />}
                  <span style={{ color: status?.flutterwave?.startsWith("✅") ? "#4ade80" : "#fbbf24" }}>{status?.flutterwave ?? "not checked"}</span>
                </div>
              </div>
              <EndpointRow
                method="POST" path="/api/webhooks/flutterwave"
                label="Flutterwave Webhook"
                desc='Set this in your Flutterwave Dashboard → Settings → Webhooks. The customer phone number in the transaction must match one of your customers. Set FLW_SECRET_HASH env var for signature verification.'
              />
            </div>

            {/* ── Generic + Direct ── */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                <span style={{ fontSize: 20 }}>🌐</span>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>Generic & Direct Provision</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <EndpointRow
                  method="POST" path="/api/webhooks/generic"
                  label="Generic Payment"
                  desc='For any custom payment system. POST JSON: { "phone": "07xxxxxxxx", "amount": 500, "reference": "REF123", "method": "cash" }. No authentication required — use behind your own verification.'
                />
                <EndpointRow
                  method="POST" path="/api/webhooks/provision"
                  label="Direct Provision"
                  badge="Secret Required"
                  desc='Directly triggers provisioning. Requires header: Authorization: Bearer <WEBHOOK_SECRET> or ?secret=<WEBHOOK_SECRET> query param. POST body: { "phone": "07xx", "amount": 0, "reference": "..." }'
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════ SETUP GUIDE TAB ═══════════════════ */}
        {activeTab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Step 1 — VPS firewall */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <StepHeader n={1} title="Open VPS Firewall Port" color="var(--isp-accent)" />
              <p style={{ margin: "8px 0", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                Safaricom and other gateways need to reach your VPS on port 8080. Run these on your VPS:
              </p>
              <CmdBlock cmd={`# UFW (Ubuntu/Debian)
sudo ufw allow 8080/tcp
sudo ufw status

# iptables alternative
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT`} />
            </div>

            {/* Step 2 — Environment variables */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <StepHeader n={2} title="Set Environment Variables on VPS" color="#a78bfa" />
              <p style={{ margin: "8px 0", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                SSH into your VPS and set these variables. Restart the backend after each change.
              </p>
              <CmdBlock cmd={`# Edit environment file
sudo nano /etc/environment

# Add these lines:
WEBHOOK_SECRET=your_strong_secret_here
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx
FLW_SECRET_HASH=your_flutterwave_hash

# Reload and restart backend
source /etc/environment
pm2 restart api-server   # or however you run the backend`} />
            </div>

            {/* Step 3 — Supabase table */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <StepHeader n={3} title="Create Webhook Events Table in Supabase" color="#fbbf24" />
              <p style={{ margin: "8px 0", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                Go to your Supabase project → SQL Editor → paste and run this:
              </p>
              <CmdBlock cmd={`CREATE TABLE IF NOT EXISTS isp_webhook_events (
  id          bigserial PRIMARY KEY,
  gateway     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'received',
  reference   text,
  amount      numeric,
  phone       text,
  customer_id bigint,
  plan_id     bigint,
  router_id   bigint,
  action      text,
  error       text,
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_gateway    ON isp_webhook_events(gateway);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON isp_webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_phone      ON isp_webhook_events(phone);`} />
            </div>

            {/* Step 4 — M-Pesa Daraja */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <StepHeader n={4} title="Configure M-Pesa Daraja" color="#00a651" />
              <p style={{ margin: "8px 0", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                In your Safaricom Daraja portal, set these URLs for your Shortcode / C2B:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {[
                  ["STK Push CallbackURL",     `${BASE}/api/webhooks/mpesa`],
                  ["C2B ValidationURL",        `${BASE}/api/webhooks/mpesa/c2b/validation`],
                  ["C2B ConfirmationURL",      `${BASE}/api/webhooks/mpesa/c2b/confirmation`],
                ].map(([label, url]) => (
                  <div key={label} style={{ background: "rgba(0,166,81,0.06)", border: "1px solid rgba(0,166,81,0.2)", borderRadius: 7, padding: "9px 12px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: 11, color: "#86efac", fontWeight: 700 }}>{label}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ fontSize: 11, color: "#c7d2fe", fontFamily: "monospace", flex: 1 }}>{url}</code>
                      <CopyBtn text={url} small />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, background: "rgba(251,191,36,0.06)", borderRadius: 7, padding: "10px 12px", fontSize: 11, color: "#fbbf24", lineHeight: 1.7 }}>
                <strong>Important:</strong> Safaricom requires HTTPS. Consider using Nginx + Let's Encrypt to add SSL to your VPS, or use a service like ngrok for testing.
                Recommended: <code style={{ fontFamily: "monospace" }}>sudo certbot --nginx -d your-domain.com</code>
              </div>
            </div>

            {/* Step 5 — Plan setup */}
            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "18px 20px" }}>
              <StepHeader n={5} title="Assign Routers to Plans" color="#a78bfa" />
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 1.7 }}>
                For auto-provisioning to work, each plan must have a router assigned to it.
                Go to <strong style={{ color: "var(--isp-text)" }}>Packages/Plans → Edit Plan</strong> and select the router that handles that plan's connections.
                When a payment comes in, the system will:
              </p>
              <ol style={{ margin: "10px 0 0", padding: "0 0 0 18px", fontSize: 12, color: "var(--isp-text-muted)", lineHeight: 2 }}>
                <li>Match the paying phone to a customer in your database</li>
                <li>Look up the customer's assigned plan</li>
                <li>Get the router assigned to that plan</li>
                <li>Create / enable the PPPoE secret or Hotspot user on that router</li>
                <li>Update the customer's status and expiry date</li>
                <li>Record the transaction automatically</li>
              </ol>
            </div>
          </div>
        )}

        {/* ═══════════════════ EVENTS TAB ═══════════════════ */}
        {activeTab === "events" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--isp-text-muted)" }}>
                {events.length} recent events · auto-refreshes every 10s
              </p>
              <button
                onClick={() => eventsQ.refetch()}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--isp-text-muted)", fontSize: 12, cursor: "pointer" }}
              >
                {eventsQ.isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Refresh
              </button>
            </div>

            {events.length === 0 ? (
              <div style={{ background: "var(--isp-section)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12, padding: "60px 20px", textAlign: "center" }}>
                <Activity size={28} style={{ color: "var(--isp-text-muted)", display: "block", margin: "0 auto 10px" }} />
                <p style={{ fontWeight: 700, color: "var(--isp-text)", margin: "0 0 6px" }}>No webhook events yet</p>
                <p style={{ fontSize: 12, color: "var(--isp-text-muted)", margin: 0 }}>
                  Events will appear here once the <code style={{ fontFamily: "monospace" }}>isp_webhook_events</code> table is created and payments start coming in.
                </p>
              </div>
            ) : (
              <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Time", "Gateway", "Status", "Reference", "Phone", "Amount", "Details"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em", background: "rgba(255,255,255,0.025)", borderBottom: "1px solid var(--isp-border)", textAlign: "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev, i) => {
                      const gw = gatewayLabel(ev.gateway);
                      const sc = statusColor(ev.status);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Clock size={10} /> {timeAgo(ev.created_at)}
                            </div>
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: gw.color }}>
                              {gw.emoji} {gw.label}
                            </span>
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                              {ev.status}
                            </span>
                          </td>
                          <td style={{ padding: "10px 14px", fontSize: 11, fontFamily: "monospace", color: "var(--isp-text-muted)" }}>
                            {ev.reference ? ev.reference.slice(0, 16) + (ev.reference.length > 16 ? "…" : "") : "—"}
                          </td>
                          <td style={{ padding: "10px 14px", fontSize: 11, fontFamily: "monospace", color: "var(--isp-text)" }}>
                            {ev.phone || "—"}
                          </td>
                          <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "var(--isp-text)" }}>
                            {ev.amount ? `KES ${ev.amount.toLocaleString()}` : "—"}
                          </td>
                          <td style={{ padding: "10px 14px", fontSize: 11, color: ev.status === "error" ? "#f87171" : "var(--isp-text-muted)", maxWidth: 200 }}>
                            {ev.error || (ev.status === "processed" ? "✅ Account provisioned" : "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════ TEST FIRE TAB ═══════════════════ */}
        {activeTab === "test" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
            <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 8 }}>
              <Info size={13} style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12, color: "#fbbf24", lineHeight: 1.6 }}>
                This fires the <strong>generic webhook</strong> endpoint with the data you enter below. The customer must already exist in your database with the matching phone number.
              </p>
            </div>

            <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 12, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" }}>Customer Phone</label>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)} style={inp} placeholder="e.g. 0712345678 or 254712345678" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" }}>Amount (KES)</label>
                <input type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} style={inp} min="1" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" }}>Reference</label>
                <input value={testRef} onChange={e => setTestRef(e.target.value)} style={inp} placeholder="e.g. TEST-001" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 6, display: "block" }}>Payment Method Label</label>
                <select value={testGateway} onChange={e => setTestGateway(e.target.value)} style={{ ...inp, appearance: "none" as const, cursor: "pointer" }}>
                  {["mpesa", "stripe", "flutterwave", "cash", "generic"].map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <button onClick={sendTest} disabled={testing || !testPhone}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px", borderRadius: 9, background: "var(--isp-accent-glow)", border: "1px solid var(--isp-accent-border)", color: "var(--isp-accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {testing ? "Firing…" : "Fire Test Webhook"}
              </button>
            </div>

            {testResult && (
              <div style={{
                borderRadius: 10, padding: "14px 16px",
                background: testResult.ok ? "rgba(74,222,128,0.07)" : "rgba(248,113,113,0.07)",
                border: `1px solid ${testResult.ok ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  {testResult.ok ? <CheckCircle2 size={15} style={{ color: "#4ade80" }} /> : <XCircle size={15} style={{ color: "#f87171" }} />}
                  <span style={{ fontWeight: 700, fontSize: 14, color: testResult.ok ? "#4ade80" : "#f87171" }}>
                    {testResult.ok ? "Webhook processed successfully" : "Webhook processing failed"}
                  </span>
                </div>
                <pre style={{ margin: 0, fontSize: 11, color: "var(--isp-text-muted)", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

/* ── Sub-components ── */
function StepHeader({ n, title, color }: { n: number; title: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: `${color}22`, border: `1.5px solid ${color}55`, color, fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
      <span style={{ fontWeight: 800, fontSize: 14, color: "var(--isp-text)" }}>{title}</span>
    </div>
  );
}

function CmdBlock({ cmd }: { cmd: string }) {
  return (
    <div style={{ background: "#060b12", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8 }}>
      <pre style={{ margin: 0, fontSize: 11, color: "#c7d2fe", fontFamily: "monospace", whiteSpace: "pre", lineHeight: 1.7, flex: 1, overflowX: "auto" }}>{cmd}</pre>
      <CopyBtn text={cmd} small />
    </div>
  );
}
