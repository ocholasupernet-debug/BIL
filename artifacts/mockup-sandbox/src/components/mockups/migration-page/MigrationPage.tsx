import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clipboard,
  CloudDownload,
  Database,
  FileCheck2,
  FileClock,
  Gauge,
  KeyRound,
  Menu,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./_group.css";

type Router = {
  id: string;
  name: string;
  site: string;
  host: string;
  status: "Online" | "Degraded" | "Offline";
  version: string;
  board: string;
};

type Stage = { id: number; label: string; icon: LucideIcon };

const routers: Router[] = [
  { id: "edge-nairobi-01", name: "Nairobi Edge 01", site: "Westlands POP", host: "10.44.8.12", status: "Online", version: "7.14.3", board: "RB5009UG+S+" },
  { id: "edge-kisumu-02", name: "Kisumu Edge 02", site: "Milimani POP", host: "10.44.19.7", status: "Online", version: "7.12.1", board: "CCR2004-1G-12S+" },
  { id: "access-thika-04", name: "Thika Access 04", site: "Makongeni POP", host: "10.44.31.18", status: "Degraded", version: "6.49.10", board: "RB4011iGS+" },
];

const targetRouters = [
  { id: "edge-mombasa-01", name: "Mombasa Edge 01", site: "Nyali POP", host: "10.44.52.10", version: "7.14.3", status: "Standby" },
  { id: "edge-nairobi-03", name: "Nairobi Edge 03", site: "Industrial Area POP", host: "10.44.12.5", version: "7.13.5", status: "Standby" },
];

const stages: Stage[] = [
  { id: 1, label: "Source", icon: Terminal },
  { id: 2, label: "Export", icon: Database },
  { id: 3, label: "Review", icon: FileCheck2 },
  { id: 4, label: "Target", icon: ArrowRight },
  { id: 5, label: "Dry run", icon: Activity },
  { id: 6, label: "Import", icon: KeyRound },
  { id: 7, label: "Report", icon: CheckCircle2 },
];

const sourceTunnelCommand = `/interface ovpn-client
add name=ochola-migration connect-to=mgmt.ochola.net \\
    user=mig_7Q2P1 certificate=none auth=sha1 cipher=aes256`;

const exportCommand = `/system script add name=ochola-export source="\\
:local token \\"mig_7Q2P1\\"; \\
/tool fetch url=(\\"https://mgmt.ochola.net/export/\\" . $token) \\
    http-method=post http-data=[/export compact]"; \\
/system script run ochola-export`;

function IconText({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <span className="migration-meta-item"><Icon size={12} />{children}</span>;
}

function StatusBadge({ children, tone = "good" }: { children: ReactNode; tone?: "good" | "warn" | "neutral" }) {
  return <span className={`migration-status-badge ${tone === "warn" ? "warn" : tone === "neutral" ? "neutral" : ""}`}>{tone === "good" ? <span className="migration-live-dot" /> : null}{children}</span>;
}

export function MigrationPage() {
  const [currentStage, setCurrentStage] = useState(1);
  const [sourceId, setSourceId] = useState(routers[0].id);
  const [targetId, setTargetId] = useState(targetRouters[0].id);
  const [tunnelActive, setTunnelActive] = useState(true);
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState("");
  const [approved, setApproved] = useState<string[]>(["ppp-profiles", "ip-pools", "simple-queues"]);
  const [confirmation, setConfirmation] = useState("");

  const source = routers.find((router) => router.id === sourceId) ?? routers[0];
  const target = targetRouters.find((router) => router.id === targetId) ?? targetRouters[0];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(label);
    notify(`${label} copied to clipboard`);
    window.setTimeout(() => setCopied(""), 1800);
  };

  const toggleApproved = (id: string) => {
    setApproved((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  };

  const advance = () => {
    if (currentStage === 6 && confirmation !== "MODIFY TARGET ROUTER") {
      notify("Enter the exact confirmation phrase before importing");
      return;
    }
    if (currentStage < 7) {
      setCurrentStage((stage) => stage + 1);
      notify(currentStage === 1 ? "Read-only source export is ready for review" : `Stage ${currentStage + 1} is ready`);
    }
  };

  const renderStage = () => {
    if (currentStage === 1) {
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head">
            <div className="migration-card-title">
              <span className="migration-card-icon"><Terminal size={15} /></span>
              <div><h2>Collect source router</h2><p>Issue the temporary path, then run the two read-only scripts.</p></div>
            </div>
            <StatusBadge>{tunnelActive ? "Tunnel connected" : "Tunnel revoked"}</StatusBadge>
          </div>
          <div className="migration-card-body">
            <div className="migration-router-select">
              <div>
                <label className="migration-label" htmlFor="source-router">Registered source router</label>
                <select id="source-router" className="migration-select" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setTunnelActive(false); }}>
                  {routers.map((router) => <option key={router.id} value={router.id}>{router.name} · {router.status}</option>)}
                </select>
              </div>
              <StatusBadge tone={source.status === "Online" ? "good" : "warn"}>{source.status}</StatusBadge>
            </div>
            <div className="migration-router-meta">
              <IconText icon={Wifi}><strong>{source.site}</strong></IconText>
              <IconText icon={Server}><code>{source.host}</code></IconText>
              <IconText icon={Activity}><strong>RouterOS {source.version}</strong></IconText>
              <IconText icon={Gauge}><strong>{source.board}</strong></IconText>
            </div>

            <div className="migration-section-heading">
              <h3>Temporary management tunnel</h3>
              <span>Auto-revokes after 60 minutes</span>
            </div>
            {tunnelActive ? (
              <div className="migration-tunnel">
                <div className="migration-tunnel-top">
                  <div>
                    <div className="migration-tunnel-title"><ShieldCheck size={14} /> Connection-scoped tunnel is active</div>
                    <p className="migration-tunnel-copy">Only the selected source router can reach the migration service. No default route or LAN route is added.</p>
                  </div>
                  <span className="migration-mono" style={{ color: "var(--mg-green)", fontSize: 10 }}>00:48:16</span>
                </div>
                <div className="migration-tunnel-grid">
                  <div><div className="migration-detail-label">Tunnel address</div><div className="migration-detail-value">172.31.240.18</div></div>
                  <div><div className="migration-detail-label">Interface</div><div className="migration-detail-value">ovpn-mig-7Q</div></div>
                  <div><div className="migration-detail-label">Endpoint</div><div className="migration-detail-value">mgmt.ochola.net</div></div>
                  <div><div className="migration-detail-label">Expires</div><div className="migration-detail-value green">14:42 EAT</div></div>
                </div>
              </div>
            ) : (
              <div className="migration-tunnel" style={{ borderColor: "rgba(183,121,33,.25)", background: "rgba(183,121,33,.055)" }}>
                <div className="migration-tunnel-title"><AlertTriangle size={14} style={{ color: "var(--mg-amber)" }} /> Tunnel not issued for this source</div>
                <p className="migration-tunnel-copy">Issue a new one-hour connection-scoped tunnel before running the collector.</p>
              </div>
            )}

            <div className="migration-section-heading">
              <h3>Two-script handoff</h3>
              <span>Run in this order</span>
            </div>
            <div className="migration-script-stack">
              <div className="migration-script">
                <div className="migration-script-head">
                  <div className="migration-script-label"><span>1</span> Connect the router to the web through VPN</div>
                  <button type="button" className="migration-copy-btn" onClick={() => copyText(sourceTunnelCommand, "Tunnel command")}><Clipboard size={11} />{copied === "Tunnel command" ? "Copied" : "Copy"}</button>
                </div>
                <pre>{sourceTunnelCommand}</pre>
                <div className="migration-script-note"><ShieldAlert size={11} /> Adds the temporary interface, cleanup scheduler, and two connection-only firewall rules.</div>
              </div>
              <div className="migration-script">
                <div className="migration-script-head">
                  <div className="migration-script-label"><span>2</span> Enable the read-only export</div>
                  <button type="button" className="migration-copy-btn" onClick={() => copyText(exportCommand, "Export command")}><Clipboard size={11} />{copied === "Export command" ? "Copied" : "Copy"}</button>
                </div>
                <pre>{exportCommand}</pre>
                <div className="migration-script-note"><FileCheck2 size={11} /> Reads and uploads the configuration only. The source router is never modified by the export.</div>
              </div>
            </div>

            <div className="migration-actions">
              <div className="migration-button-row">
                <button type="button" className="migration-button ghost" onClick={() => copyText(`${sourceTunnelCommand}\n\n${exportCommand}`, "Two scripts")}><Clipboard size={12} />Copy both scripts</button>
                <button type="button" className="migration-button danger" onClick={() => { setTunnelActive(false); notify("Temporary tunnel revoked"); }} disabled={!tunnelActive}><X size={12} />Revoke tunnel</button>
              </div>
              <button type="button" className="migration-button primary" onClick={advance} disabled={!tunnelActive}><CloudDownload size={12} />Continue to export <ArrowRight size={12} /></button>
            </div>
          </div>
        </div>
      );
    }

    if (currentStage === 2) {
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><Database size={15} /></span><div><h2>Collected export</h2><p>Read-only configuration received from {source.name}.</p></div></div><StatusBadge>Saved securely</StatusBadge></div>
          <div className="migration-stage-summary">
            <div className="migration-report-hero"><CheckCircle2 size={20} /><div><strong>Source export received and sealed</strong><span>Migration package MIG-2024-0217 · Captured 14:02:11 EAT through the temporary tunnel.</span></div></div>
            <div className="migration-section-heading"><h3>Collected configuration</h3><span>Snapshot integrity verified</span></div>
            <div className="migration-summary-grid">{[["184", "Config items"], ["62", "PPPoE users"], ["37", "Simple queues"], ["6", "IP pools"]].map(([value, label]) => <div className="migration-summary-metric" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
            <div className="migration-finding-list"><div className="migration-finding good"><CheckCircle2 size={13} /> Export checksum <span className="migration-mono">sha256: 9c42…e18b</span> verified.</div><div className="migration-finding manual"><AlertTriangle size={13} /> 4 secrets are present in the package and will be reviewed before import.</div></div>
            <div className="migration-actions"><span className="migration-mono" style={{ color: "var(--mg-muted)", fontSize: 9 }}>source: {source.name} · read_only=true</span><button type="button" className="migration-button primary" onClick={advance}>Review compatibility <ArrowRight size={12} /></button></div>
          </div>
        </div>
      );
    }

    if (currentStage === 3) {
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><FileCheck2 size={15} /></span><div><h2>Review compatibility</h2><p>Resolve what can move cleanly before choosing a target.</p></div></div><StatusBadge tone="warn">3 review items</StatusBadge></div>
          <div className="migration-stage-summary"><div className="migration-finding-list"><div className="migration-finding good"><CheckCircle2 size={13} /> RouterOS major version is compatible with the collected package.</div><div className="migration-finding warning"><AlertTriangle size={13} /> 2 queue trees reference interfaces that do not exist on the target.</div><div className="migration-finding manual"><AlertTriangle size={13} /> Manual review required for 4 IPsec peers and 2 scheduler entries.</div><div className="migration-finding warning"><AlertTriangle size={13} /> 1 unsupported hotspot profile will be skipped automatically.</div></div><div className="migration-actions"><span style={{ color: "var(--mg-muted)", fontSize: 10 }}>Review notes are attached to the migration record.</span><button type="button" className="migration-button primary" onClick={advance}>Choose target <ArrowRight size={12} /></button></div></div>
        </div>
      );
    }

    if (currentStage === 4) {
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><ArrowRight size={15} /></span><div><h2>Select target router</h2><p>Identity check only. No target configuration changes happen at this stage.</p></div></div><StatusBadge tone="neutral">Target contact: read-only</StatusBadge></div>
          <div className="migration-stage-summary"><div className="migration-boundary" style={{ marginBottom: 12 }}><ShieldAlert size={15} /><div><strong>Safe boundary</strong><p>We will contact the target only to verify identity, RouterOS version, and available interfaces.</p></div></div><div className="migration-target-list">{targetRouters.map((router) => <label key={router.id} className={`migration-target-option ${targetId === router.id ? "selected" : ""}`}><input type="radio" name="target" checked={targetId === router.id} onChange={() => setTargetId(router.id)} /><div className="migration-target-option-copy"><strong>{router.name}</strong><span>{router.site} · {router.host} · RouterOS {router.version}</span></div><StatusBadge tone="neutral">{router.status}</StatusBadge></label>)}</div><div className="migration-actions"><span style={{ color: "var(--mg-muted)", fontSize: 10 }}>Selected: <strong style={{ color: "var(--mg-ink)" }}>{target.name}</strong></span><button type="button" className="migration-button primary" onClick={advance}>Run pre-flight dry run <ArrowRight size={12} /></button></div></div>
        </div>
      );
    }

    if (currentStage === 5) {
      const items = [["ppp-profiles", "PPP profiles", "18 entries"], ["ip-pools", "IP pools", "6 pools"], ["simple-queues", "Simple queues", "37 queues"], ["queue-trees", "Queue trees", "2 interface conflicts"], ["ipsec-peers", "IPsec peers", "4 manual review"]];
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><Activity size={15} /></span><div><h2>Pre-flight dry run</h2><p>Plan changes locally before any RouterOS import call.</p></div></div><StatusBadge>Zero RouterOS calls</StatusBadge></div>
          <div className="migration-stage-summary"><div className="migration-boundary" style={{ marginBottom: 12, borderColor: "rgba(22,140,120,.25)", background: "var(--mg-green-wash)" }}><ShieldCheck size={15} style={{ color: "var(--mg-green)" }} /><div><strong>Dry run is non-destructive</strong><p>Choose the compatible items to approve. Nothing is written to {target.name} until the import confirmation.</p></div></div><table className="migration-dryrun-table"><thead><tr><th></th><th>Planned change</th><th>Scope</th></tr></thead><tbody>{items.map(([id, label, scope]) => <tr key={id}><td><input type="checkbox" checked={approved.includes(id)} onChange={() => toggleApproved(id)} /></td><td><strong>{label}</strong></td><td style={{ color: "var(--mg-muted)" }}>{scope}</td></tr>)}</tbody></table><div className="migration-actions"><span style={{ color: "var(--mg-muted)", fontSize: 10 }}><strong style={{ color: "var(--mg-ink)" }}>{approved.length}</strong> of 5 groups approved</span><button type="button" className="migration-button primary" onClick={advance}>Continue to import <ArrowRight size={12} /></button></div></div>
        </div>
      );
    }

    if (currentStage === 6) {
      return (
        <div className="migration-card migration-animate">
          <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><KeyRound size={15} /></span><div><h2>Confirmation and import</h2><p>This is the final write boundary for {target.name}.</p></div></div><StatusBadge tone="warn">Write action</StatusBadge></div>
          <div className="migration-stage-summary"><div className="migration-boundary" style={{ borderColor: "rgba(186,76,71,.25)", background: "rgba(186,76,71,.045)" }}><ShieldAlert size={15} style={{ color: "var(--mg-red)" }} /><div><strong>Target router will be modified</strong><p>Import will apply {approved.length} approved groups to {target.name}. The pre-change state will be captured for recovery.</p></div></div><div className="migration-confirm-box"><p>Type <strong className="migration-mono" style={{ color: "var(--mg-ink)" }}>MODIFY TARGET ROUTER</strong> to authorize this import.</p><input aria-label="Import confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="MODIFY TARGET ROUTER" /></div><div className="migration-actions"><button type="button" className="migration-button ghost" onClick={() => setCurrentStage(5)}><ArrowRight size={12} style={{ transform: "rotate(180deg)" }} />Back to dry run</button><button type="button" className="migration-button primary" onClick={advance} disabled={confirmation !== "MODIFY TARGET ROUTER"}>Import approved changes <ArrowRight size={12} /></button></div></div>
        </div>
      );
    }

    return (
      <div className="migration-card migration-animate">
        <div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon" style={{ color: "var(--mg-green)", background: "var(--mg-green-wash)", borderColor: "rgba(22,140,120,.22)" }}><CheckCircle2 size={15} /></span><div><h2>Migration report</h2><p>Import completed with a recovery package attached.</p></div></div><StatusBadge>Completed</StatusBadge></div>
        <div className="migration-stage-summary"><div className="migration-report-hero"><CheckCircle2 size={20} /><div><strong>Migration completed successfully</strong><span>41 items imported to {target.name}; 2 items skipped for manual review.</span></div></div><div className="migration-summary-grid" style={{ marginTop: 13 }}><div className="migration-summary-metric"><strong>41</strong><span>Imported</span></div><div className="migration-summary-metric"><strong>2</strong><span>Skipped</span></div><div className="migration-summary-metric"><strong>0</strong><span>Failed</span></div><div className="migration-summary-metric"><strong>01:42</strong><span>Duration</span></div></div><div className="migration-log">14:03:02  target identity verified: {target.host}<br />14:03:09  pre-change state captured<br />14:03:18  applied ppp-profiles, ip-pools, simple-queues<br />14:04:21  skipped queue-trees: interface mismatch<br />14:04:44  verification completed: 41 items healthy</div><div className="migration-actions"><span style={{ color: "var(--mg-muted)", fontSize: 10 }}>Recovery package: <strong className="migration-mono" style={{ color: "var(--mg-ink)" }}>MIG-2024-0217</strong></span><button type="button" className="migration-button ghost" onClick={() => notify("Recovery package download prepared")}><CloudDownload size={12} />Download recovery package</button></div></div>
      </div>
    );
  };

  return (
    <div className="migration-mockup">
      <div className="migration-app">
        <aside className="migration-sidebar">
          <div className="migration-brand"><div className="migration-brand-mark"><Activity size={16} /></div><div><div className="migration-brand-name">OcholaSupernet</div><div className="migration-brand-sub">Admin Panel</div></div></div>
          <nav className="migration-nav">
            <div className="migration-nav-label">Overview</div>
            <button type="button" className="migration-nav-item"><Gauge size={14} />Dashboard</button>
            <div className="migration-nav-label">Network</div>
            <button type="button" className="migration-nav-item"><Network size={14} />Network <ArrowRight size={11} style={{ marginLeft: "auto" }} /></button>
            <div className="migration-nav-child">Routers</div>
            <div className="migration-nav-child">Add Router</div>
            <div className="migration-nav-child active">Migration &amp; Recovery</div>
            <div className="migration-nav-child">PPPoE</div>
            <div className="migration-nav-child">IP Pools</div>
            <div className="migration-nav-label">Tools</div>
            <button type="button" className="migration-nav-item"><ShieldCheck size={14} />VPN &amp; Remote Access</button>
            <button type="button" className="migration-nav-item"><FileClock size={14} />System Logs</button>
            <button type="button" className="migration-nav-item"><Bell size={14} />Notifications</button>
          </nav>
          <div className="migration-sidebar-user"><div className="migration-avatar">JM</div><div className="migration-user-copy"><div className="migration-user-name">James Mwangi</div><div className="migration-user-status"><span className="migration-live-dot" />Online</div></div><UserRound size={13} color="#58736d" /></div>
        </aside>

        <div className="migration-main">
          <header className="migration-topbar"><button type="button" className="migration-menu" aria-label="Open navigation"><Menu size={15} /></button><div className="migration-search"><Search size={13} /><input placeholder="Search customers, routers…" aria-label="Search" /></div><div className="migration-top-spacer" /><div className="migration-top-actions"><div className="migration-live-pill"><span className="migration-live-dot" />LIVE</div><button type="button" className="migration-icon-btn" aria-label="Notifications"><Bell size={14} /></button><div className="migration-user-pill"><div className="migration-avatar">JM</div><span>James Mwangi</span></div></div></header>

          <main className="migration-content">
            <div className="migration-page-header"><div><div className="migration-eyebrow"><RefreshCw size={12} />Network operations / controlled change</div><h1 className="migration-page-title">Migration &amp; Disaster Recovery</h1><p className="migration-page-subtitle">Move configuration between MikroTik routers with a read-only source, a bounded tunnel, and an explicit write boundary.</p></div><div className="migration-context-id">MIGRATION <strong>MIG-2024-0217</strong></div></div>

            <div className="migration-tabs" aria-label="Network navigation">{["Routers", "Add Router", "Replace Router", "Migration", "PPPoE", "PPP", "Wireless", "Queues", "IP Pools", "API Config", "Files"].map((tab) => <button type="button" className={`migration-tab ${tab === "Migration" ? "active" : ""}`} key={tab}>{tab === "Migration" ? <RefreshCw size={12} /> : null}{tab}</button>)}</div>

            <div className="migration-context"><div className="migration-node"><div className="migration-node-label">Source / read-only</div><div className="migration-node-name">{source.name}</div><div className="migration-node-meta">{source.site} · <code>{source.host}</code></div></div><div className="migration-context-arrow"><ArrowRight size={13} /></div><div className="migration-node"><div className="migration-node-label">Target / pending</div><div className="migration-node-name">{currentStage >= 4 ? target.name : "Select after review"}</div><div className="migration-node-meta">{currentStage >= 4 ? `${target.site} · ${target.host}` : "No target contacted yet"}</div></div><div className="migration-context-state"><ShieldCheck size={12} />{currentStage < 6 ? "No target writes" : "Write boundary"}</div></div>

            <div className="migration-steps" aria-label="Migration progress">{stages.map((stage, index) => { const done = stage.id < currentStage; const active = stage.id === currentStage; return <div style={{ display: "contents" }} key={stage.id}><button type="button" className={`migration-step ${done ? "done" : ""} ${active ? "active" : ""}`} onClick={() => stage.id <= currentStage && setCurrentStage(stage.id)}><span className="migration-step-number">{done ? <Check size={12} /> : stage.id}</span><span className="migration-step-name">{stage.label}</span></button>{index < stages.length - 1 ? <span className={`migration-step-connector ${done ? "done" : ""}`} /> : null}</div>; })}</div>

            <div className="migration-boundary"><ShieldAlert size={16} /><div><strong>Strict read-only guarantee</strong><p>The source router is never modified. The temporary tunnel expires automatically. Target selection performs identity checks only; dry run performs zero RouterOS calls.</p></div></div>

            <div className="migration-workspace"><section>{renderStage()}</section><aside className="migration-aside"><div className="migration-card"><div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><FileCheck2 size={14} /></span><div><h2>Operator runbook</h2><p>Keep the handoff in this order.</p></div></div></div><div className="migration-runbook-list"><div className="migration-runbook-item"><span className="migration-runbook-number">01</span><div><strong>Connect first</strong><p>Run the tunnel script on the selected source and wait for connected status.</p></div></div><div className="migration-runbook-item"><span className="migration-runbook-number">02</span><div><strong>Export second</strong><p>Run the separate export script. It reads configuration and uploads the sealed package.</p></div></div><div className="migration-runbook-item"><span className="migration-runbook-number">03</span><div><strong>Review before writing</strong><p>Choose a target, dry-run approved groups, then confirm the final import phrase.</p></div></div></div></div><div className="migration-card"><div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon" style={{ color: "var(--mg-green)", background: "var(--mg-green-wash)", borderColor: "rgba(22,140,120,.2)" }}><ShieldCheck size={14} /></span><div><h2>Audit guardrails</h2><p>Boundaries enforced by the workflow.</p></div></div></div><div className="migration-guardrails"><div className="migration-guardrail"><CheckCircle2 size={12} />Source access is read-only.</div><div className="migration-guardrail"><CheckCircle2 size={12} />Tunnel lease: 60 minutes maximum.</div><div className="migration-guardrail"><CheckCircle2 size={12} />Target writes require exact phrase.</div><div className="migration-guardrail"><CheckCircle2 size={12} />Recovery package captured before import.</div></div></div><div className="migration-card"><div className="migration-card-head"><div className="migration-card-title"><span className="migration-card-icon"><Activity size={14} /></span><div><h2>Session telemetry</h2><p>Live record for this migration.</p></div></div></div><div className="migration-session"><div className="migration-session-line"><span>Session status</span><strong style={{ color: "var(--mg-green)" }}>{tunnelActive ? "CONNECTED" : "REVOKED"}</strong></div><div className="migration-session-line"><span>Collector token</span><strong>MIG-7Q2P1</strong></div><div className="migration-session-line"><span>Last event</span><strong>14:02:11 EAT</strong></div></div></div></aside></div>
          </main>
        </div>
      </div>
      {toast ? <div className="migration-toast">{toast}</div> : null}
    </div>
  );
}

export default MigrationPage;