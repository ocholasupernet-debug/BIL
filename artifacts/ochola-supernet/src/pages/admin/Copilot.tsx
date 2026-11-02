import { useMemo, useState } from "react";
import {
  Activity, Bot, Check, ChevronRight, Copy, Download, LoaderCircle, MessageSquare,
  Router, Send, ShieldCheck, Sparkles, Terminal, UserPlus, Wifi,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminApiFetch } from "@/lib/api-client";
import { ADMIN_ID } from "@/lib/supabase";

type Finding = {
  customer: { id: number; name: string | null; username: string | null; pppoeUsername: string | null; phone: string | null; service: string; status: string | null; expiresAt: string | null };
  payment: { recent: Record<string, unknown>[]; hasSuccessfulPayment: boolean };
  plan: Record<string, unknown> | null;
  router: { id: number; name: string; status: string; lastSeen: string | null } | null;
  liveSession: { state: "active" | "not-active" | "unavailable"; checkedAt: string; error?: string };
  findings: string[];
  recommendations: string[];
};
type Message = { role: "assistant" | "user"; text: string; findings?: Finding[] };
type CreateKind = "customer" | "plan" | "voucher";
type InstallStep = { id: string; order: number; title: string; fileName: string; command: string; description: string };

const quickPrompts = [
  { icon: Wifi, label: "Diagnose a disconnected user", prompt: "Diagnose a customer" },
  { icon: Activity, label: "Check API and database", prompt: "Check API health" },
  { icon: Terminal, label: "Generate a read-only router script", prompt: "Generate router diagnostics script" },
];

const createFields: Record<CreateKind, { name: string; label: string; type?: string; required?: boolean; hint?: string }[]> = {
  customer: [
    { name: "name", label: "Customer name", required: true },
    { name: "type", label: "Service", type: "select", required: true },
    { name: "planId", label: "Plan ID", type: "number", required: true },
    { name: "routerId", label: "Router ID", type: "number", required: true },
    { name: "phone", label: "Phone number" },
    { name: "username", label: "Hotspot username" },
    { name: "pppoeUsername", label: "PPPoE username" },
    { name: "password", label: "Service password", type: "password", hint: "Sent only to the existing authenticated customer API." },
  ],
  plan: [
    { name: "name", label: "Package name", required: true },
    { name: "type", label: "Service", type: "select", required: true },
    { name: "price", label: "Price (KES)", type: "number", required: true },
    { name: "routerId", label: "Router ID", type: "number", required: true },
    { name: "durationDays", label: "Validity in days", type: "number" },
    { name: "speedDown", label: "Download speed (Mbps)", type: "number" },
    { name: "speedUp", label: "Upload speed (Mbps)", type: "number" },
  ],
  voucher: [
    { name: "planId", label: "Hotspot plan ID", type: "number", required: true },
    { name: "routerId", label: "Router ID", type: "number", required: true },
    { name: "quantity", label: "Number of vouchers", type: "number", required: true },
    { name: "prefix", label: "Code prefix" },
  ],
};

function formatDate(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function Copilot() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi, I’m OCHOLASUPERNET Co-Pilot. I can check a customer against billing records and live router sessions, run an authorized API/database health check, or prepare a safe read-only RouterOS script. I ask before creating records and never run generated commands on a router." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [installRouterId, setInstallRouterId] = useState("");
  const [installSteps, setInstallSteps] = useState<InstallStep[]>([]);
  const [installWarning, setInstallWarning] = useState("");

  const actionHistory = useMemo(() => messages.filter(message => message.role === "assistant" && /created|checked|generated|diagnos/i.test(message.text)), [messages]);

  async function postJson(path: string, body?: unknown) {
    const response = await adminApiFetch(path, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    return data;
  }

  async function runPrompt(prompt: string) {
    const query = prompt.trim();
    if (!query || busy) return;
    setInput("");
    setMessages(current => [...current, { role: "user", text: query }]);
    setBusy(true);
    setNotice("");
    try {
      const normalized = query.toLowerCase();
      if (normalized.includes("health") || normalized.includes("api") || normalized.includes("vps")) {
        const health = await postJson("/api/admin/copilot/health");
        setMessages(current => [...current, { role: "assistant", text: health.database === "available"
          ? `API request and tenant database check succeeded at ${formatDate(health.checkedAt)}. This check does not SSH into or claim the VPS host itself is healthy.`
          : `The API responded, but the tenant database check failed at ${formatDate(health.checkedAt)}. ${health.error || ""}` }]);
      } else if (normalized.includes("script")) {
        const kind = normalized.includes("hotspot") ? "hotspot-check" : "diagnostics";
        const result = await postJson("/api/admin/copilot/script", { kind });
        setMessages(current => [...current, { role: "assistant", text: `Read-only ${kind === "hotspot-check" ? "Hotspot check" : "router diagnostics"} script generated. It has not been run.` }]);
        setNotice(result.script);
      } else if (normalized.includes("router") && /\b\d+\b/.test(normalized)) {
        const routerId = normalized.match(/\b\d+\b/)?.[0];
        const result = await postJson("/api/admin/copilot/router-check", { routerId: Number(routerId) });
        setMessages(current => [...current, { role: "assistant", text: `${result.router.name}: live RouterOS API check succeeded at ${formatDate(result.checkedAt)}. The API returned ${result.live.hotspotUsers} Hotspot users and ${result.live.pppoeSessions} active PPPoE sessions. Stored status: ${result.router.storedStatus}; last heartbeat: ${formatDate(result.router.lastSeen)}.` }]);
      } else {
        const customerQuery = query.replace(/^(please\s+)?(diagnose|check|find|why\s+is|why\s+does|customer|user)\s+/i, "").trim();
        const result = await postJson("/api/admin/copilot/diagnose", { query: customerQuery });
        setMessages(current => [...current, {
          role: "assistant",
          text: result.matches?.length ? `Checked ${result.matches.length} matching customer${result.matches.length === 1 ? "" : "s"} against account records and assigned-router sessions.` : result.message || "No matching account was found.",
          findings: result.matches || [],
        }]);
      }
    } catch (error) {
      setMessages(current => [...current, { role: "assistant", text: error instanceof Error ? error.message : "The request could not be completed." }]);
    } finally {
      setBusy(false);
    }
  }

  async function createRecord() {
    if (!createKind || busy) return;
    const fields = createFields[createKind];
    if (fields.some(field => field.required && !String(form[field.name] || "").trim())) {
      setNotice("Complete all required fields before continuing.");
      return;
    }
    const descriptions: Record<CreateKind, string> = {
      customer: `Create ${form.name} as a ${form.type} customer using the selected plan and router?`,
      plan: `Create the ${form.name} package at KES ${form.price}?`,
      voucher: `Generate ${form.quantity} Hotspot voucher(s) for plan ${form.planId}?`,
    };
    if (!window.confirm(`${descriptions[createKind]}\n\nThe existing BIL API will validate tenant ownership and service scope.`)) return;
    setBusy(true);
    setNotice("");
    try {
      let path: string;
      let payload: Record<string, unknown>;
      if (createKind === "customer") {
        path = "/api/customers";
        payload = { ...form, adminId: ADMIN_ID, planId: Number(form.planId), routerId: Number(form.routerId), status: "active" };
      } else if (createKind === "plan") {
        path = "/api/plans";
        payload = {
          ...form, adminId: ADMIN_ID, price: Number(form.price), routerId: Number(form.routerId),
          durationDays: form.durationDays ? Number(form.durationDays) : 1,
          speedDown: form.speedDown ? Number(form.speedDown) : 10,
          speedUp: form.speedUp ? Number(form.speedUp) : 5,
          isActive: true, clientCanPurchase: true,
        };
      } else {
        path = "/api/vouchers/hotspot/generate";
        payload = { ...form, adminId: ADMIN_ID, planId: Number(form.planId), routerId: Number(form.routerId), quantity: Number(form.quantity) };
      }
      const result = await postJson(path, payload);
      const createdCount = Array.isArray(result) ? result.length : Array.isArray(result.vouchers) ? result.vouchers.length : 1;
      setMessages(current => [...current, { role: "assistant", text: `${createKind === "voucher" ? `${createdCount} Hotspot voucher(s)` : createKind === "plan" ? "Internet package" : "Customer"} created through the existing BIL service.` }]);
      setCreateKind(null);
      setForm({});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Creation failed. No success is assumed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyScript() {
    try { await navigator.clipboard.writeText(notice); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setNotice("Clipboard access failed. Select and copy the script manually."); }
  }

  async function generateInstallScripts() {
    const id = Number(installRouterId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setNotice("Enter a valid router ID.");
      return;
    }
    if (!window.confirm("Generate the existing three-step Self Install scripts for this router? The scripts will be provided for manual review; Co-Pilot will not run or upload them.")) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await adminApiFetch(`/api/router/${id}/self-install-script?adminId=${encodeURIComponent(String(ADMIN_ID))}&mode=coexist`, { cache: "no-store" });
      const result = await response.json() as { steps?: InstallStep[]; warning?: string; error?: string };
      if (!response.ok || !Array.isArray(result.steps)) throw new Error(result.error || "Self Install scripts could not be generated.");
      setInstallSteps(result.steps);
      setInstallWarning(result.warning || "");
      setMessages(current => [...current, { role: "assistant", text: `Generated ${result.steps!.length} ordered Self Install steps for router ${id}. They have not been uploaded or run.` }]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Self Install script generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setNotice("Clipboard access failed. Select and copy the script manually."); }
  }

  function downloadText(value: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([value], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadScript() {
    downloadText(notice, "ocholasupernet-router-diagnostics.rsc");
  }

  return (
    <AdminLayout>
      <div className="copilot-page">
        <header className="copilot-heading">
          <div className="copilot-mark"><Sparkles size={22} /></div>
          <div><h1>OCHOLASUPERNET Co-Pilot</h1><p>Guided ISP diagnostics and admin actions, scoped to your account.</p></div>
          <span className="copilot-safe"><ShieldCheck size={15} /> Confirmation required for changes</span>
        </header>
        <div className="copilot-grid">
          <section className="copilot-chat" aria-label="Co-Pilot chat">
            <div className="copilot-messages" aria-live="polite">
              {messages.map((message, index) => (
                <article key={index} className={`copilot-message copilot-message--${message.role}`}>
                  <div className="copilot-message-icon">{message.role === "assistant" ? <Bot size={17} /> : <MessageSquare size={16} />}</div>
                  <div className="copilot-message-body">
                    <p>{message.text}</p>
                    {message.findings?.map(item => (
                      <div className="copilot-result" key={item.customer.id}>
                        <h3>{item.customer.name || item.customer.username || item.customer.pppoeUsername || `Customer ${item.customer.id}`}</h3>
                        <div className="copilot-facts">
                          <span><b>Service</b>{item.customer.service.toUpperCase()}</span>
                          <span><b>Account</b>{item.customer.status || "Unknown"}</span>
                          <span><b>Expires</b>{formatDate(item.customer.expiresAt)}</span>
                          <span><b>Payment</b>{item.payment.hasSuccessfulPayment ? "Recent successful record" : "No recent successful record"}</span>
                          <span><b>Router</b>{item.router?.name || "Not assigned / unavailable"}</span>
                          <span><b>Live session</b>{item.liveSession.state === "active" ? "Active" : item.liveSession.state === "not-active" ? "Not found" : "Unverified"}</span>
                          <span><b>Plan</b>{String(item.plan?.name ?? "Unavailable")}</span>
                        </div>
                        {item.findings.length > 0 ? <ul>{item.findings.map((finding, i) => <li key={i}>{finding}</li>)}</ul> : <p className="copilot-good"><Check size={14} /> No issue found in the checked records.</p>}
                        {item.recommendations?.length > 0 && <div className="copilot-recommendations"><b>Recommended next steps</b>{item.recommendations.map((recommendation, i) => <p key={i}>{recommendation}</p>)}</div>}
                        <button type="button" className="copilot-verify" onClick={() => void runPrompt(item.customer.username || item.customer.pppoeUsername || item.customer.phone || String(item.customer.id))}>Run diagnosis again to verify</button>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {busy && <div className="copilot-working"><LoaderCircle size={16} className="copilot-spin" /> Checking authorized BIL services…</div>}
            </div>
            {notice && <div className="copilot-script">
              <div><Terminal size={16} /><b>Generated script</b><span>Manual review and run only</span></div>
              <pre>{notice}</pre>
              <footer><button type="button" onClick={copyScript}><Copy size={14} />{copied ? "Copied" : "Copy"}</button><button type="button" onClick={downloadScript}><Download size={14} />Download .rsc</button><button type="button" onClick={() => setNotice("")}>Close</button></footer>
            </div>}
            {installSteps.length > 0 && <div className="copilot-install-steps">
              <h3>Manual Self Install scripts</h3>
              {installWarning && <p className="copilot-install-warning">{installWarning}</p>}
              <p>Run these in order on the router after reviewing each command. Co-Pilot has not uploaded or executed them.</p>
              {installSteps.map(step => <section key={step.id}><b>{step.order}. {step.title}</b><small>{step.description}</small><pre>{step.command}</pre><div><button type="button" onClick={() => void copyText(step.command)}><Copy size={13} />{copied ? "Copied" : "Copy"}</button><button type="button" onClick={() => downloadText(step.command, step.fileName)}><Download size={13} />Download {step.fileName}</button></div></section>)}
            </div>}
            <div className="copilot-quick-actions">
              {quickPrompts.map(action => <button key={action.label} type="button" onClick={() => action.prompt.includes("customer") ? setInput("Diagnose ") : void runPrompt(action.prompt)}><action.icon size={15} />{action.label}</button>)}
            </div>
            <form className="copilot-composer" onSubmit={event => { event.preventDefault(); void runPrompt(input); }}>
              <input value={input} onChange={event => setInput(event.target.value)} placeholder="Customer name, username, phone, or “check router 12”…" aria-label="Message Co-Pilot" />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send message"><Send size={17} /></button>
            </form>
          </section>
          <aside className="copilot-tools">
            <h2>Quick actions</h2>
            <button type="button" onClick={() => { setCreateKind("customer"); setForm({ type: "hotspot" }); }}><UserPlus size={17} /><span><b>Create customer / PPPoE user</b><small>Uses the existing customer service</small></span><ChevronRight size={16} /></button>
            <button type="button" onClick={() => { setCreateKind("plan"); setForm({ type: "hotspot" }); }}><Wifi size={17} /><span><b>Create internet package</b><small>Existing plan validation applies</small></span><ChevronRight size={16} /></button>
            <button type="button" onClick={() => { setCreateKind("voucher"); setForm({ quantity: "1" }); }}><Router size={17} /><span><b>Create Hotspot vouchers</b><small>Generate through the scoped voucher API</small></span><ChevronRight size={16} /></button>
            <div className="copilot-install-picker"><label htmlFor="copilot-router-id">Self Install router ID</label><input id="copilot-router-id" type="number" min="1" value={installRouterId} onChange={event => setInstallRouterId(event.target.value)} placeholder="Router ID" /><button type="button" disabled={busy} onClick={() => void generateInstallScripts()}>Generate manual install scripts</button></div>
            <div className="copilot-history"><h3>Recent actions</h3>{actionHistory.length ? actionHistory.slice(-5).reverse().map((item, index) => <p key={index}><Check size={13} />{item.text}</p>) : <p>No actions in this session yet.</p>}</div>
            <p className="copilot-disclaimer">Router scripts are read-only templates. Co-Pilot does not execute scripts or apply router changes.</p>
          </aside>
        </div>
        {createKind && <div className="copilot-modal-backdrop" role="presentation">
          <section className="copilot-modal" role="dialog" aria-modal="true" aria-labelledby="copilot-create-title">
            <header><div><h2 id="copilot-create-title">{createKind === "customer" ? "Create customer / PPPoE user" : createKind === "plan" ? "Create internet package" : "Create Hotspot vouchers"}</h2><p>Submitted to the existing tenant-authenticated BIL API.</p></div><button type="button" onClick={() => setCreateKind(null)} aria-label="Close">×</button></header>
            <div className="copilot-form-grid">{createFields[createKind].map(field => <label key={field.name}>{field.label}
              {field.type === "select"
                ? <select value={form[field.name] || ""} onChange={event => setForm(current => ({ ...current, [field.name]: event.target.value }))}>
                    {(createKind === "customer" ? ["hotspot", "pppoe"] : ["hotspot", "pppoe", "static"]).map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                  </select>
                : <input type={field.type || "text"} min={field.type === "number" ? "0" : undefined} value={form[field.name] || ""} onChange={event => setForm(current => ({ ...current, [field.name]: event.target.value }))} required={field.required} />}
              {field.hint && <small>{field.hint}</small>}
            </label>)}</div>
            {notice && <p className="copilot-notice" role="alert">{notice}</p>}
            <footer><button type="button" className="copilot-cancel" onClick={() => setCreateKind(null)}>Cancel</button><button type="button" className="copilot-confirm" disabled={busy} onClick={() => void createRecord()}>{busy ? "Submitting…" : "Review and create"}</button></footer>
          </section>
        </div>}
        <style>{`
          .copilot-page{max-width:1500px;margin:0 auto;padding:24px;color:var(--isp-text)}
          .copilot-heading{display:flex;align-items:center;gap:14px;margin-bottom:22px}
          .copilot-mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#06b6d4,#2563eb);color:white}
          .copilot-heading h1{font-size:22px;margin:0;font-weight:750}.copilot-heading p{margin:5px 0 0;color:var(--isp-text-muted);font-size:13px}
          .copilot-safe{margin-left:auto;display:flex;align-items:center;gap:7px;color:#0f9f72;font-size:12px}
          .copilot-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start}
          .copilot-chat,.copilot-tools{border:1px solid var(--isp-border);border-radius:16px;background:var(--isp-card)}
          .copilot-chat{min-height:650px;display:flex;flex-direction:column;overflow:hidden}
          .copilot-messages{flex:1;min-height:340px;max-height:62vh;overflow:auto;padding:20px}
          .copilot-message{display:flex;gap:10px;margin-bottom:18px}.copilot-message--user{flex-direction:row-reverse}
          .copilot-message-icon{width:30px;height:30px;flex:0 0 30px;border-radius:10px;background:var(--isp-inner-card);display:grid;place-items:center;color:#0891b2}
          .copilot-message--user .copilot-message-icon{color:#2563eb}
          .copilot-message-body{max-width:min(88%,780px);font-size:13px;line-height:1.55}
          .copilot-message-body>p{margin:4px 0 0;white-space:pre-wrap}
          .copilot-result{margin-top:12px;padding:14px;border:1px solid var(--isp-border);border-radius:12px;background:var(--isp-inner-card)}
          .copilot-result h3{margin:0 0 12px;font-size:15px}
          .copilot-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
          .copilot-facts span{font-size:12px}.copilot-facts b{display:block;font-size:10px;color:var(--isp-text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}
          .copilot-result ul{margin:12px 0 0;padding-left:18px;color:#c57b0a;font-size:12px}
          .copilot-good{display:flex;align-items:center;gap:6px;color:#0f9f72}
          .copilot-recommendations{margin-top:10px;border-left:3px solid #0891b2;padding-left:10px;font-size:12px}.copilot-recommendations p{margin:5px 0}
          .copilot-verify{border:0;background:transparent;padding:8px 0 0;color:#0891b2;font:inherit;font-size:11px;text-decoration:underline;cursor:pointer}
          .copilot-working{display:flex;align-items:center;gap:8px;color:var(--isp-text-muted);font-size:12px;padding:0 20px 14px}
          .copilot-spin{animation:copilot-spin 1s linear infinite}@keyframes copilot-spin{to{transform:rotate(360deg)}}
          .copilot-quick-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 12px}
          .copilot-quick-actions button,.copilot-script footer button{display:flex;align-items:center;gap:7px;border:1px solid var(--isp-border);background:var(--isp-inner-card);border-radius:9px;padding:8px 10px;color:var(--isp-text);font:inherit;font-size:11px;cursor:pointer}
          .copilot-composer{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--isp-border)}
          .copilot-composer input{flex:1;min-width:0;background:var(--isp-inner-card);border:1px solid var(--isp-border);border-radius:10px;padding:12px;color:var(--isp-text);font:inherit;font-size:13px}
          .copilot-composer button{width:44px;border:0;border-radius:10px;background:#0891b2;color:#fff;display:grid;place-items:center;cursor:pointer}.copilot-composer button:disabled{opacity:.5;cursor:not-allowed}
          .copilot-tools{padding:16px}.copilot-tools h2{font-size:15px;margin:2px 0 14px}
          .copilot-tools>button{width:100%;display:flex;align-items:center;text-align:left;gap:10px;padding:12px 8px;color:var(--isp-text);border:0;border-bottom:1px solid var(--isp-border);background:transparent;cursor:pointer}
          .copilot-tools>button>span{flex:1}.copilot-tools b{display:block;font-size:12px}.copilot-tools small{display:block;color:var(--isp-text-muted);font-size:10px;margin-top:3px}
          .copilot-history{margin-top:20px}.copilot-history h3{font-size:13px}.copilot-history p{display:flex;gap:7px;align-items:flex-start;color:var(--isp-text-muted);font-size:11px;line-height:1.4}
          .copilot-disclaimer{border-top:1px solid var(--isp-border);padding-top:12px;margin:18px 0 0;color:var(--isp-text-muted);font-size:10px;line-height:1.5}
          .copilot-script{margin:0 18px 14px;padding:12px;border:1px solid var(--isp-border);border-radius:12px;background:var(--isp-inner-card)}
          .copilot-script>div{display:flex;align-items:center;gap:7px;font-size:12px}.copilot-script>div span{margin-left:auto;color:var(--isp-text-muted);font-size:10px}
          .copilot-script pre{white-space:pre-wrap;max-height:240px;overflow:auto;font-size:11px;background:#0b1220;color:#d7e5f5;padding:12px;border-radius:8px}
          .copilot-script footer{display:flex;gap:7px}
          .copilot-install-steps{margin:0 18px 14px;padding:12px;border:1px solid var(--isp-border);border-radius:12px;background:var(--isp-inner-card)}
          .copilot-install-steps h3{font-size:13px;margin:0 0 8px}.copilot-install-steps>p,.copilot-install-warning{font-size:11px;color:var(--isp-text-muted)}
          .copilot-install-steps section{padding:10px 0;border-top:1px solid var(--isp-border)}.copilot-install-steps section b,.copilot-install-steps section small{display:block;font-size:11px}.copilot-install-steps section small{margin-top:4px;color:var(--isp-text-muted)}
          .copilot-install-steps pre{white-space:pre-wrap;max-height:200px;overflow:auto;background:#0b1220;color:#d7e5f5;padding:10px;border-radius:8px;font-size:10px}
          .copilot-install-steps section>div{display:flex;gap:7px}.copilot-install-steps button,.copilot-install-picker button{display:flex;align-items:center;gap:6px;border:1px solid var(--isp-border);background:var(--isp-inner-card);border-radius:8px;padding:7px 9px;color:var(--isp-text);font:inherit;font-size:10px;cursor:pointer}
          .copilot-install-picker{padding:12px 0;border-bottom:1px solid var(--isp-border)}.copilot-install-picker label{display:block;font-size:11px;margin-bottom:6px}.copilot-install-picker input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--isp-border);border-radius:8px;background:var(--isp-inner-card);color:var(--isp-text);margin-bottom:7px}.copilot-install-picker button:disabled{opacity:.5}
          .copilot-modal-backdrop{position:fixed;inset:0;z-index:1100;background:#06101ccc;display:grid;place-items:center;padding:16px}
          .copilot-modal{width:min(680px,100%);max-height:90vh;overflow:auto;background:var(--isp-card);border:1px solid var(--isp-border);border-radius:16px;padding:20px;box-shadow:0 20px 70px #0005}
          .copilot-modal header{display:flex;justify-content:space-between;gap:12px}.copilot-modal header h2{font-size:18px;margin:0}.copilot-modal header p{font-size:12px;color:var(--isp-text-muted);margin:6px 0 18px}.copilot-modal header button{align-self:start;border:0;background:none;color:var(--isp-text);font-size:23px;cursor:pointer}
          .copilot-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.copilot-form-grid label{font-size:11px;font-weight:600;display:grid;gap:6px}
          .copilot-form-grid input,.copilot-form-grid select{width:100%;box-sizing:border-box;background:var(--isp-inner-card);border:1px solid var(--isp-border);border-radius:8px;padding:10px;color:var(--isp-text);font:inherit;font-size:12px}
          .copilot-form-grid small{color:var(--isp-text-muted);font-weight:400}
          .copilot-modal footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.copilot-modal footer button{border-radius:8px;padding:9px 13px;cursor:pointer;font:inherit;font-size:12px}
          .copilot-cancel{border:1px solid var(--isp-border);background:transparent;color:var(--isp-text)}.copilot-confirm{border:0;background:#0891b2;color:white}
          .copilot-notice{color:#dc2626;font-size:12px}
          @media(max-width:900px){.copilot-grid{grid-template-columns:1fr}.copilot-tools{order:-1}.copilot-tools>button{width:33%;display:inline-flex;vertical-align:top}.copilot-history,.copilot-disclaimer{display:none}}
          @media(max-width:600px){.copilot-page{padding:14px}.copilot-heading{align-items:flex-start;flex-wrap:wrap}.copilot-heading h1{font-size:18px}.copilot-safe{margin-left:58px;margin-top:-6px}.copilot-messages{padding:14px;max-height:none}.copilot-chat{min-height:70vh}.copilot-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.copilot-tools>button{width:100%}.copilot-form-grid{grid-template-columns:1fr}.copilot-quick-actions button{font-size:10px}}
        `}</style>
      </div>
    </AdminLayout>
  );
}
