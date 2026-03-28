import { useState, useRef, useEffect } from "react";
import { useBrand } from "@/context/BrandContext";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  Building2, CreditCard, MessageSquare, Radio, Wifi, Shield,
  Bell, Wrench, Check, Eye, EyeOff, Copy, Trash2, Plus,
  Upload, RefreshCw, AlertTriangle, Terminal, Save, Key,
  LogOut, Monitor, ChevronDown, Smartphone, Mail,
} from "lucide-react";

// ─── shared primitives ───────────────────────────────────────────────────────

const C = {
  cyan:      "#06b6d4",
  cyanDark:  "#0891b2",
  sidebar:   "#131929",
  card:      "var(--isp-card)",
  border:    "var(--isp-border-subtle)",
  bg:        "var(--isp-bg)",
  text:      "var(--isp-text)",
  muted:     "var(--isp-text-muted)",
  input:     "var(--isp-input-bg)",
  inputBdr:  "var(--isp-input-border)",
};

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      position: "relative", display: "inline-flex", width: 44, height: 24,
      borderRadius: 12, background: on ? C.cyan : "rgba(255,255,255,0.12)",
      border: "none", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 0.2s",
    }}>
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18,
        borderRadius: "50%", background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
        <p style={{ fontSize: "0.875rem", fontWeight: 700, color: C.text, margin: 0 }}>{title}</p>
        {desc && <p style={{ fontSize: "0.72rem", color: C.muted, margin: "2px 0 0" }}>{desc}</p>}
      </div>
      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: "0.68rem", color: C.muted, margin: "4px 0 0", opacity: 0.8 }}>{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{
      width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`,
      borderRadius: 8, color: C.text, fontSize: "0.8125rem",
      padding: "0.45rem 0.75rem", fontFamily: "inherit", outline: "none",
      boxSizing: "border-box", transition: "border-color 0.2s",
      ...props.style,
    }} />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{
      width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`,
      borderRadius: 8, color: C.text, fontSize: "0.8125rem",
      padding: "0.45rem 0.75rem", fontFamily: "inherit", outline: "none",
      boxSizing: "border-box",
    }}>
      {children}
    </select>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {children}
    </div>
  );
}

function SaveBtn({ label = "Save Changes" }: { label?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000); }} style={{
      display: "flex", alignItems: "center", gap: 6,
      background: saved ? "#10b981" : C.cyan, border: "none", cursor: "pointer",
      color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem",
      borderRadius: 8, fontFamily: "inherit", transition: "background 0.2s",
    }}>
      {saved ? <><Check size={13} /> Saved!</> : <><Save size={13} /> {label}</>}
    </button>
  );
}

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, ...style }}>{children}</div>;
}

// ─── tab content ─────────────────────────────────────────────────────────────

function IspProfileTab() {
  const brand = useBrand();
  const year = new Date().getFullYear();
  return (
    <>
      <Card title="ISP Identity" desc="Branding and contact info shown to customers and on invoices">
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: `linear-gradient(135deg,${C.cyan},${C.cyanDark})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 900, color: "white", flexShrink: 0 }}>{brand.ispName.charAt(0)}</div>
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 800, color: C.text, margin: 0 }}>{brand.ispName}</p>
            <p style={{ fontSize: "0.72rem", color: C.muted, margin: "2px 0 4px" }}>{brand.domain}</p>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", color: C.cyan, fontSize: "0.72rem", fontWeight: 600, cursor: "pointer" }}>
              <Upload size={11} /> Upload Logo
            </button>
          </div>
        </div>
        {/* key forces inputs to reset defaultValue once brand data arrives */}
        <Grid2 key={brand.ispName + brand.domain}>
          <Field label="ISP Name"><Input defaultValue={brand.ispName} /></Field>
          <Field label="Website"><Input defaultValue={`https://${brand.domain}`} /></Field>
          <Field label="Support Email"><Input defaultValue={brand.supportEmail} type="email" /></Field>
          <Field label="Support Phone"><Input defaultValue={brand.phone || "+254 700 000 000"} /></Field>
          <Field label="WhatsApp Number" hint="Used for customer support links"><Input defaultValue={brand.phone || "+254 700 000 000"} /></Field>
          <Field label="Country">
            <Select defaultValue="KE">
              <option value="KE">Kenya 🇰🇪</option>
              <option value="UG">Uganda 🇺🇬</option>
              <option value="TZ">Tanzania 🇹🇿</option>
              <option value="NG">Nigeria 🇳🇬</option>
            </Select>
          </Field>
        </Grid2>
        <Field label="Physical Address">
          <Input defaultValue="Tom Mboya St, Nairobi, Kenya" />
        </Field>
        <Field label="Business Registration Number">
          <Input placeholder="e.g. CPR/2020/123456" />
        </Field>
        <Row><SaveBtn /></Row>
      </Card>

      <Card title="Customer Portal" desc="Settings for the customer-facing hotspot and PPPoE portal">
        <Grid2 key={brand.domain + "-portal"}>
          <Field label="Portal Title"><Input defaultValue={`${brand.ispName} Customer Portal`} /></Field>
          <Field label="Portal URL"><Input defaultValue={`https://portal.${brand.domain}`} /></Field>
          <Field label="Terms of Service URL"><Input placeholder={`https://${brand.domain}/terms`} /></Field>
          <Field label="Privacy Policy URL"><Input placeholder={`https://${brand.domain}/privacy`} /></Field>
        </Grid2>
        <Field label="Footer Text on Login Pages" hint="Shown at the bottom of hotspot login pages">
          <Input defaultValue={`© ${year} ${brand.ispName}. All rights reserved.`} />
        </Field>
        <Row><SaveBtn label="Save Portal Settings" /></Row>
      </Card>
    </>
  );
}

function BillingTab() {
  const [currency, setCurrency] = useState("KES");
  const [vatEnabled, setVatEnabled] = useState(true);
  const [gracePeriod, setGracePeriod] = useState(true);
  const [autoRenew, setAutoRenew] = useState(false);
  const [gateway, setGateway] = useState(() => {
    try { return localStorage.getItem("ochola_payment_gateway") || "mpesa"; } catch { return "mpesa"; }
  });
  const [gatewaySaved, setGatewaySaved] = useState(false);

  const saveGateway = () => {
    try { localStorage.setItem("ochola_payment_gateway", gateway); } catch {}
    setGatewaySaved(true);
    setTimeout(() => setGatewaySaved(false), 2000);
  };

  const GATEWAY_OPTIONS = [
    { id: "mpesa",       label: "M-Pesa STK Push (Safaricom Daraja)" },
    { id: "airtel",      label: "Airtel Money" },
    { id: "stripe",      label: "Stripe" },
    { id: "flutterwave", label: "Flutterwave" },
    { id: "paypal",      label: "PayPal" },
    { id: "pesalink",    label: "PesaLink" },
    { id: "manual",      label: "Cash / Manual Collection" },
  ];

  return (
    <>
      <Card title="Active Payment Gateway" desc="Select the payment gateway your ISP uses to collect payments">
        <Field label="Payment Gateway">
          <Select value={gateway} onChange={e => setGateway(e.target.value)}>
            {GATEWAY_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </Select>
        </Field>
        <Row>
          <button onClick={saveGateway} style={{ display: "flex", alignItems: "center", gap: 6, background: gatewaySaved ? "#10b981" : C.cyan, border: "none", cursor: "pointer", color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "0.5rem 1.25rem", borderRadius: 8, fontFamily: "inherit", transition: "background 0.2s" }}>
            {gatewaySaved ? "✓ Saved!" : "Save Gateway"}
          </button>
        </Row>
      </Card>

      <Card title="M-Pesa Integration" desc="Safaricom Daraja API credentials for STK push and C2B payments">
        <Grid2>
          <Field label="Paybill / Business Short Code"><Input defaultValue="174379" /></Field>
          <Field label="Consumer Key"><Input placeholder="xxxxxxxxxxxxxxxxxx" /></Field>
          <Field label="Consumer Secret"><Input type="password" placeholder="••••••••••••" /></Field>
          <Field label="Passkey"><Input type="password" placeholder="••••••••••••" /></Field>
          <Field label="Callback URL" hint="Receives payment confirmations from Safaricom">
            <Input defaultValue="https://api.isplatty.org/mpesa/callback" />
          </Field>
          <Field label="Environment">
            <Select defaultValue="production">
              <option value="sandbox">Sandbox (Testing)</option>
              <option value="production">Production (Live)</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save M-Pesa Settings" /></Row>
      </Card>

      <Card title="Billing Preferences" desc="Currency, VAT, grace periods, and invoice configuration">
        <Grid2>
          <Field label="Currency">
            <Select value={currency} onChange={e => setCurrency(e.target.value)}>
              <option value="KES">KES — Kenyan Shilling</option>
              <option value="UGX">UGX — Ugandan Shilling</option>
              <option value="TZS">TZS — Tanzanian Shilling</option>
              <option value="USD">USD — US Dollar</option>
            </Select>
          </Field>
          <Field label="Invoice Prefix" hint="e.g. INV → INV-0001"><Input defaultValue="INV" /></Field>
          <Field label="Invoice Starting Number"><Input defaultValue="1001" type="number" /></Field>
          <Field label="Default Payment Terms (days)"><Input defaultValue="7" type="number" /></Field>
        </Grid2>

        <div style={{ marginTop: 4 }}>
          {[
            { label: "Enable VAT / Tax on Invoices", desc: "Apply 16% VAT to all customer invoices", val: vatEnabled, fn: setVatEnabled },
            { label: "Grace Period After Expiry", desc: "Allow 3-day grace before cutting off service", val: gracePeriod, fn: setGracePeriod },
            { label: "Auto-Renew Active Plans", desc: "Automatically renew plans if M-Pesa balance is available", val: autoRenew, fn: setAutoRenew },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
              </div>
              <Toggle on={item.val} onChange={item.fn} />
            </div>
          ))}
        </div>
        <Row><SaveBtn label="Save Billing Settings" /></Row>
      </Card>
    </>
  );
}

function SmsEmailTab() {
  const brand = useBrand();
  const [smsGateway, setSmsGateway] = useState("africastalking");
  const [smtpAuth, setSmtpAuth] = useState(true);

  return (
    <>
      <Card title="SMS Gateway" desc="Send OTPs, expiry alerts, and bulk SMS to customers">
        <Field label="SMS Provider">
          <Select value={smsGateway} onChange={e => setSmsGateway(e.target.value)}>
            <option value="africastalking">Africa's Talking</option>
            <option value="twilio">Twilio</option>
            <option value="vonage">Vonage (Nexmo)</option>
            <option value="custom">Custom HTTP API</option>
          </Select>
        </Field>
        {smsGateway === "africastalking" && (
          <Grid2>
            <Field label="Username"><Input defaultValue="ocholasupernet" /></Field>
            <Field label="API Key"><Input type="password" placeholder="•••••••••••••••••" /></Field>
            <Field label="Sender ID"><Input defaultValue="ISPLATTY" /></Field>
            <Field label="Environment">
              <Select defaultValue="live">
                <option value="sandbox">Sandbox</option>
                <option value="live">Live</option>
              </Select>
            </Field>
          </Grid2>
        )}
        {smsGateway === "twilio" && (
          <Grid2>
            <Field label="Account SID"><Input placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></Field>
            <Field label="Auth Token"><Input type="password" placeholder="•••••••••••••••••" /></Field>
            <Field label="From Number"><Input placeholder="+1234567890" /></Field>
          </Grid2>
        )}
        {smsGateway === "custom" && (
          <>
            <Field label="API Endpoint URL"><Input placeholder="https://sms.yourgw.com/send" /></Field>
            <Grid2>
              <Field label="Auth Header Name"><Input placeholder="Authorization" /></Field>
              <Field label="Auth Header Value"><Input type="password" placeholder="Bearer xxxxxxxx" /></Field>
            </Grid2>
          </>
        )}
        <Row><SaveBtn label="Save SMS Settings" /></Row>
      </Card>

      <Card title="Email / SMTP" desc="Outgoing email for invoices, welcome messages, and expiry alerts">
        <Grid2>
          <Field label="SMTP Host"><Input defaultValue="smtp.zoho.com" /></Field>
          <Field label="SMTP Port"><Input defaultValue="587" type="number" /></Field>
          <Field label="From Name"><Input defaultValue={brand.ispName} /></Field>
          <Field label="From Email"><Input defaultValue={`noreply@${brand.domain}`} type="email" /></Field>
          <Field label="SMTP Username"><Input defaultValue={`noreply@${brand.domain}`} /></Field>
          <Field label="SMTP Password"><Input type="password" placeholder="••••••••••" /></Field>
          <Field label="Encryption">
            <Select defaultValue="tls">
              <option value="none">None</option>
              <option value="ssl">SSL</option>
              <option value="tls">TLS (StartTLS)</option>
            </Select>
          </Field>
          <Field label="SMTP Authentication">
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <Toggle on={smtpAuth} onChange={setSmtpAuth} />
              <span style={{ fontSize: "0.8rem", color: C.muted }}>Require auth</span>
            </div>
          </Field>
        </Grid2>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <Mail size={13} /> Send Test Email
          </button>
          <SaveBtn label="Save SMTP Settings" />
        </div>
      </Card>

      <Card title="Notification Templates" desc="Customise the message sent to customers for each event">
        {[
          { label: "Welcome Message",       var: "{name}, {plan}, {expiry}" },
          { label: "Expiry Reminder (3 days)", var: "{name}, {plan}, {days}" },
          { label: "Account Expired",       var: "{name}, {plan}"          },
          { label: "Payment Received",      var: "{name}, {amount}, {plan}"},
          { label: "Voucher Activated",     var: "{name}, {code}, {expiry}"},
        ].map((t, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.label}</label>
              <span style={{ fontSize: "0.65rem", color: C.cyan, fontFamily: "monospace" }}>vars: {t.var}</span>
            </div>
            <textarea rows={2} style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box" }} placeholder={`Write template using ${t.var}`} />
          </div>
        ))}
        <Row><SaveBtn label="Save Templates" /></Row>
      </Card>
    </>
  );
}

function NetworkTab() {
  const [radiusEnabled, setRadiusEnabled] = useState(false);
  const [pppoeEnabled, setPppoeEnabled]   = useState(true);

  return (
    <>
      <Card title="MikroTik / RouterOS API" desc="Default API credentials used to push configs to managed routers">
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: "0.72rem", color: "#f59e0b", margin: 0 }}>These credentials are used to connect to all routers by default. Each router can also have its own credentials set per-device.</p>
        </div>
        <Grid2>
          <Field label="Default API Username"><Input defaultValue="api_admin" /></Field>
          <Field label="Default API Password"><Input type="password" placeholder="••••••••" /></Field>
          <Field label="API Port" hint="Default RouterOS API port"><Input defaultValue="8728" type="number" /></Field>
          <Field label="API SSL Port" hint="For encrypted API connections"><Input defaultValue="8729" type="number" /></Field>
          <Field label="SSH Port"><Input defaultValue="22" type="number" /></Field>
          <Field label="Connection Timeout (s)"><Input defaultValue="10" type="number" /></Field>
        </Grid2>
        <Row><SaveBtn label="Save Router Defaults" /></Row>
      </Card>

      <Card title="FreeRADIUS Server" desc="RADIUS server for PPPoE and hotspot authentication">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>Enable FreeRADIUS Authentication</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Use RADIUS for centralised user authentication</p>
          </div>
          <Toggle on={radiusEnabled} onChange={setRadiusEnabled} />
        </div>
        {radiusEnabled && (
          <Grid2>
            <Field label="RADIUS Server IP"><Input defaultValue="127.0.0.1" /></Field>
            <Field label="Auth Port"><Input defaultValue="1812" type="number" /></Field>
            <Field label="Acct Port"><Input defaultValue="1813" type="number" /></Field>
            <Field label="Shared Secret"><Input type="password" placeholder="••••••••••" /></Field>
            <Field label="NAS Identifier"><Input defaultValue="ocholasupernet-nas" /></Field>
            <Field label="NAS IP Address"><Input defaultValue="10.0.0.1" /></Field>
          </Grid2>
        )}
        <Row><SaveBtn label="Save RADIUS Settings" /></Row>
      </Card>

      <Card title="PPPoE Global Settings" desc="Default PPPoE server behaviour applied to all routers">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>PPPoE Server Enabled</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Toggle PPPoE service across all managed routers</p>
          </div>
          <Toggle on={pppoeEnabled} onChange={setPppoeEnabled} />
        </div>
        <Grid2>
          <Field label="Default Authentication">
            <Select defaultValue="chap">
              <option value="pap">PAP</option>
              <option value="chap">CHAP</option>
              <option value="mschap2">MS-CHAPv2</option>
            </Select>
          </Field>
          <Field label="Max MTU Size"><Input defaultValue="1480" type="number" /></Field>
          <Field label="Max MRU Size"><Input defaultValue="1480" type="number" /></Field>
          <Field label="Keepalive Timeout (s)"><Input defaultValue="10" type="number" /></Field>
          <Field label="Max Sessions Per User"><Input defaultValue="1" type="number" /></Field>
          <Field label="IP Pool Assignment">
            <Select defaultValue="dynamic">
              <option value="dynamic">Dynamic (from pool)</option>
              <option value="static">Static (fixed per user)</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save PPPoE Settings" /></Row>
      </Card>
    </>
  );
}

function HotspotTab() {
  const brand = useBrand();
  const [macAuth, setMacAuth]         = useState(false);
  const [trialEnabled, setTrial]      = useState(true);
  const [uamEnabled, setUam]          = useState(false);

  return (
    <>
      <Card title="Hotspot Server" desc="Global hotspot settings applied to all hotspot-enabled routers">
        <Grid2>
          <Field label="Login Page Template">
            <Select defaultValue="default">
              <option value="default">Default ({brand.ispName})</option>
              <option value="minimal">Minimal</option>
              <option value="branded">Branded with Logo</option>
              <option value="custom">Custom HTML</option>
            </Select>
          </Field>
          <Field label="Redirect After Login" hint="Where to send users after successful login">
            <Input defaultValue={`https://${brand.domain}`} />
          </Field>
          <Field label="Session Timeout (hours)" hint="Max time a session stays active"><Input defaultValue="24" type="number" /></Field>
          <Field label="Idle Timeout (minutes)" hint="Disconnect after this many idle minutes"><Input defaultValue="10" type="number" /></Field>
          <Field label="WALLED Garden URLs" hint="Comma-separated — accessible without login">
            <Input placeholder="isplatty.org, safaricom.com" />
          </Field>
          <Field label="DNS Domain"><Input defaultValue={`hotspot.${brand.domain}`} /></Field>
        </Grid2>

        {[
          { label: "MAC Address Authentication", desc: "Auto-login returning devices by MAC address",              val: macAuth,      fn: setMacAuth      },
          { label: "Enable Free Trials",          desc: "Allow new users to access a trial plan before paying",    val: trialEnabled, fn: setTrial        },
          { label: "UAM Hotspot Mode",            desc: "Forward login to a Universal Access Method (UAM) server", val: uamEnabled,   fn: setUam          },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <Row><SaveBtn label="Save Hotspot Settings" /></Row>
      </Card>

      <Card title="Voucher Settings" desc="How printed vouchers behave when activated">
        <Grid2>
          <Field label="Voucher Code Length"><Input defaultValue="8" type="number" /></Field>
          <Field label="Code Format">
            <Select defaultValue="alphanumeric">
              <option value="numeric">Numeric only</option>
              <option value="alpha">Letters only</option>
              <option value="alphanumeric">Alphanumeric (recommended)</option>
            </Select>
          </Field>
          <Field label="Default Batch Size"><Input defaultValue="50" type="number" /></Field>
          <Field label="Expiry After Activation">
            <Select defaultValue="plan">
              <option value="plan">Follow plan duration</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="never">Never (until used)</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save Voucher Settings" /></Row>
      </Card>
    </>
  );
}

function SecurityTab() {
  const [twoFa, setTwoFa]       = useState(false);
  const [ipWhitelist, setIpWL]  = useState(false);
  const [forceHttps, setHttps]  = useState(true);
  const [auditLog, setAudit]    = useState(true);
  const [showApiKey, setShowKey] = useState(false);
  const [copied, setCopied]     = useState(false);
  const ADMIN_KEY = "demo_admin_key_xxxxxxxxxxxxxxxxxxxxxxxx";
  const SESSIONS = [
    { id: 1, device: "Chrome — Windows 11",   ip: "x.x.x.x", location: "Nairobi, KE", time: "Now",       current: true  },
    { id: 2, device: "Firefox — Ubuntu 22",   ip: "x.x.x.x", location: "Nairobi, KE", time: "1h ago",    current: false },
  ];

  function copy() { navigator.clipboard.writeText(ADMIN_KEY); setCopied(true); setTimeout(() => setCopied(false), 1800); }

  return (
    <>
      <Card title="Two-Factor Authentication" desc="Protect the admin panel with TOTP 2FA">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>Authenticator App (TOTP)</p>
            <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>Google Authenticator, Authy, or any TOTP app</p>
          </div>
          <Toggle on={twoFa} onChange={setTwoFa} />
        </div>
        {twoFa && (
          <div style={{ background: "rgba(6,182,212,0.07)", border: `1px solid rgba(6,182,212,0.25)`, borderRadius: 10, padding: 16, marginTop: 14, display: "flex", alignItems: "flex-start", gap: 16 }}>
            <div style={{ width: 72, height: 72, background: "rgba(255,255,255,0.05)", border: `2px solid rgba(6,182,212,0.3)`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: "2rem" }}>📱</span>
            </div>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, color: C.cyan, margin: "0 0 4px" }}>Scan QR Code</p>
              <p style={{ fontSize: "0.72rem", color: C.muted, margin: "0 0 8px" }}>Scan the QR code with your authenticator app to link it to this admin account.</p>
              <p style={{ fontSize: "0.7rem", fontFamily: "monospace", color: C.text, background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "4px 8px", display: "inline-block" }}>JBSWY3DPEHPK3PXP (manual)</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input placeholder="Enter 6-digit code" style={{ background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 6, color: C.text, fontSize: "0.8rem", padding: "6px 10px", outline: "none", width: 140, fontFamily: "inherit" }} />
                <button style={{ background: C.cyan, border: "none", borderRadius: 6, color: "white", fontSize: "0.8rem", fontWeight: 700, padding: "6px 14px", cursor: "pointer" }}>Verify</button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Access Control" desc="Restrict and secure admin panel access">
        {[
          { label: "Force HTTPS",         desc: "Redirect all HTTP traffic to HTTPS",                          val: forceHttps, fn: setHttps },
          { label: "IP Whitelist",         desc: "Only allow admin access from specific IP addresses",          val: ipWhitelist,fn: setIpWL  },
          { label: "Admin Audit Log",      desc: "Log all admin actions (login, changes, deletions)",           val: auditLog,   fn: setAudit },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        {ipWhitelist && (
          <div style={{ marginTop: 10 }}>
            <Field label="Allowed IP Addresses" hint="One IP or CIDR range per line">
              <textarea rows={4} placeholder={"10.0.0.0/24\n197.x.x.x"} style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "monospace", resize: "none", outline: "none", boxSizing: "border-box" }} />
            </Field>
          </div>
        )}

        <Field label="Admin Session Timeout">
          <Select defaultValue="480">
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="480">8 hours</option>
            <option value="0">Never (not recommended)</option>
          </Select>
        </Field>
        <Row><SaveBtn label="Save Access Settings" /></Row>
      </Card>

      <Card title="Active Admin Sessions" desc="Devices currently signed into the admin panel">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SESSIONS.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: s.current ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${s.current ? "rgba(6,182,212,0.25)" : C.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Monitor size={16} style={{ color: s.current ? C.cyan : C.muted }} />
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>
                    {s.device}
                    {s.current && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: C.cyan, color: "white", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>This device</span>}
                  </p>
                  <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{s.ip} · {s.location} · {s.time}</p>
                </div>
              </div>
              {!s.current && <button style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}><LogOut size={12} /> Revoke</button>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
            <LogOut size={12} /> Sign out all other sessions
          </button>
        </div>
      </Card>

      <Card title="API Key" desc="For integrating with the ISP Management API from scripts or third-party apps">
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
          <Key size={13} style={{ color: C.muted, flexShrink: 0 }} />
          <span style={{ flex: 1, fontFamily: "monospace", fontSize: "0.78rem", color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>
            {showApiKey ? ADMIN_KEY : "demo_admin_key_••••••••••••••••••••••••"}
          </span>
          <button onClick={() => setShowKey(v => !v)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "2px" }}>
            {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={copy} style={{ background: "none", border: "none", color: copied ? "#10b981" : C.muted, cursor: "pointer", padding: "2px" }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: C.cyan, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={12} /> Regenerate Key
          </button>
        </div>
      </Card>
    </>
  );
}

function NotificationsTab() {
  const brand = useBrand();
  const [email, setEmail]     = useState(true);
  const [sms, setSms]         = useState(false);
  const [newCust, setNewCust] = useState(true);
  const [expiry, setExpiry]   = useState(true);
  const [payment, setPayment] = useState(true);
  const [router, setRouter]   = useState(true);
  const [ticket, setTicket]   = useState(true);
  const [lowBal, setLowBal]   = useState(false);
  const [slack, setSlack]     = useState(false);

  return (
    <>
      <Card title="Admin Alert Channels" desc="How you want to receive system and customer alerts">
        {[
          { label: "Email Alerts",   desc: `Send alerts to ${brand.supportEmail}`,  val: email,  fn: setEmail,  icon: Mail },
          { label: "SMS Alerts",     desc: "Send alerts to +254 700 000 000",    val: sms,    fn: setSms,    icon: Smartphone },
          { label: "Slack Webhook",  desc: "Post alerts to a Slack channel",     val: slack,  fn: setSlack,  icon: MessageSquare },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(6,182,212,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={15} style={{ color: C.cyan }} />
                </div>
                <div>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
                  <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
                </div>
              </div>
              <Toggle on={item.val} onChange={item.fn} />
            </div>
          );
        })}
        {slack && (
          <Field label="Slack Webhook URL">
            <Input placeholder="https://hooks.slack.com/services/TXXXXXXXX/BXXXXXXXX/xxxx" />
          </Field>
        )}
      </Card>

      <Card title="Alert Types" desc="Choose which events trigger an alert to the admin">
        {[
          { label: "New Customer Registration", desc: "Alert when a new customer signs up",                   val: newCust, fn: setNewCust },
          { label: "Customer Expiry Today",      desc: "Daily digest of expiring accounts",                   val: expiry,  fn: setExpiry  },
          { label: "Payment Received",           desc: "Alert on every M-Pesa or manual payment",             val: payment, fn: setPayment },
          { label: "Router Goes Offline",        desc: "Notify immediately if a managed router disconnects",  val: router,  fn: setRouter  },
          { label: "New Support Ticket",         desc: "Alert when a customer submits a ticket",              val: ticket,  fn: setTicket  },
          { label: "Low Airtime Balance",        desc: "Warn when SMS gateway credit runs below threshold",   val: lowBal,  fn: setLowBal  },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <Row><SaveBtn label="Save Notification Settings" /></Row>
      </Card>
    </>
  );
}

function SystemTab() {
  const [maintenance, setMaintenance] = useState(false);
  const [autoBackup, setAutoBackup]   = useState(true);
  const [debugMode, setDebug]         = useState(false);

  return (
    <>
      <Card title="System Preferences" desc="Timezone, date format, and localisation">
        <Grid2>
          <Field label="System Timezone">
            <Select defaultValue="Africa/Nairobi">
              <option value="Africa/Nairobi">Africa/Nairobi (EAT +3)</option>
              <option value="Africa/Lagos">Africa/Lagos (WAT +1)</option>
              <option value="UTC">UTC ±0</option>
            </Select>
          </Field>
          <Field label="Date Format">
            <Select defaultValue="DD/MM/YYYY">
              <option>DD/MM/YYYY</option>
              <option>MM/DD/YYYY</option>
              <option>YYYY-MM-DD</option>
            </Select>
          </Field>
          <Field label="Time Format">
            <Select defaultValue="24h">
              <option value="12h">12-hour (2:30 PM)</option>
              <option value="24h">24-hour (14:30)</option>
            </Select>
          </Field>
          <Field label="Default Language">
            <Select defaultValue="en">
              <option value="en">English</option>
              <option value="sw">Swahili</option>
            </Select>
          </Field>
        </Grid2>
        <Row><SaveBtn label="Save Preferences" /></Row>
      </Card>

      <Card title="Data & Backups" desc="Database backup and restore settings">
        {[
          { label: "Automatic Daily Backup", desc: "Backup database to cloud storage every 24 hours", val: autoBackup, fn: setAutoBackup },
          { label: "Debug Mode",             desc: "Log detailed error traces (disable on production)", val: debugMode,  fn: setDebug     },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div>
              <p style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: "0.7rem", color: C.muted, margin: "2px 0 0" }}>{item.desc}</p>
            </div>
            <Toggle on={item.val} onChange={item.fn} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <RefreshCw size={13} /> Backup Now
          </button>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: "0.8rem", fontWeight: 600, padding: "0.45rem 1rem", cursor: "pointer" }}>
            <Upload size={13} /> Restore Backup
          </button>
          <SaveBtn label="Save Backup Settings" />
        </div>
      </Card>

      <Card title="Maintenance Mode" desc="Take the portal offline for all customers while you make changes">
        <div style={{ background: maintenance ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${maintenance ? "rgba(239,68,68,0.35)" : C.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 700, color: maintenance ? "#ef4444" : C.text, margin: 0 }}>
                {maintenance ? "⚠️ Maintenance Mode is ACTIVE" : "Maintenance Mode"}
              </p>
              <p style={{ fontSize: "0.72rem", color: C.muted, margin: "3px 0 0" }}>
                {maintenance ? "All customers see the maintenance page right now." : "Customers see a maintenance page; admin panel remains accessible."}
              </p>
            </div>
            <Toggle on={maintenance} onChange={setMaintenance} />
          </div>
          {maintenance && (
            <div style={{ marginTop: 12 }}>
              <Field label="Maintenance Message">
                <textarea rows={2} defaultValue="We are performing scheduled maintenance. We'll be back shortly. Thank you for your patience." style={{ width: "100%", background: C.input, border: `1px solid ${C.inputBdr}`, borderRadius: 8, color: C.text, fontSize: "0.78rem", padding: "0.45rem 0.75rem", fontFamily: "inherit", resize: "none", outline: "none", boxSizing: "border-box" }} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card title="System Information" desc="Current software and environment details">
        {[
          ["Platform",        "ISP Management v2.6.0"],
          ["Database",        "PostgreSQL 15.4"],
          ["Runtime",         "Node.js 20.x / Express 5"],
          ["Last Backup",     "Mar 27, 2026 — 02:00 EAT"],
          ["Disk Usage",      "4.2 GB / 50 GB"],
          ["Active Customers","247"],
          ["Online Now",      "38"],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: "0.78rem", color: C.muted }}>{k}</span>
            <span style={{ fontSize: "0.78rem", color: C.text, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile",       label: "ISP Profile",     icon: Building2    },
  { id: "billing",       label: "Billing & M-Pesa", icon: CreditCard   },
  { id: "sms",           label: "SMS & Email",      icon: MessageSquare},
  { id: "network",       label: "Network",          icon: Radio        },
  { id: "hotspot",       label: "Hotspot",          icon: Wifi         },
  { id: "security",      label: "Security",         icon: Shield       },
  { id: "notifications", label: "Notifications",    icon: Bell         },
  { id: "system",        label: "System",           icon: Wrench       },
];

export default function AdminSettings() {
  const [tab, setTab] = useState("profile");

  return (
    <AdminLayout>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* Sidebar */}
        <aside style={{ width: 190, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", position: "sticky", top: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Settings</p>
          </div>
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 16px",
                background: active ? "rgba(6,182,212,0.1)" : "transparent",
                borderLeft: active ? `3px solid ${C.cyan}` : "3px solid transparent",
                border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                color: active ? C.cyan : C.muted, fontSize: "0.78rem", fontWeight: active ? 700 : 400,
                textAlign: "left", fontFamily: "inherit", transition: "all 0.15s",
              }}>
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 800, color: C.text, margin: 0 }}>
              {TABS.find(t => t.id === tab)?.label}
            </h1>
            <p style={{ fontSize: "0.75rem", color: C.muted, margin: "3px 0 0" }}>
              Manage your {TABS.find(t => t.id === tab)?.label.toLowerCase()} settings
            </p>
          </div>

          {tab === "profile"       && <IspProfileTab />}
          {tab === "billing"       && <BillingTab />}
          {tab === "sms"           && <SmsEmailTab />}
          {tab === "network"       && <NetworkTab />}
          {tab === "hotspot"       && <HotspotTab />}
          {tab === "security"      && <SecurityTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "system"        && <SystemTab />}
        </div>
      </div>
    </AdminLayout>
  );
}
