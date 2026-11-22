import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, Banknote,
  Check, ChevronDown, Clock3, FileClock, Landmark, LockKeyhole, Menu,
  Search, ShieldCheck, SlidersHorizontal, Users, Wallet, X, XCircle,
} from "lucide-react";
import "./Polished.css";

type View = "overview" | "employees" | "destinations" | "withdrawals" | "payroll" | "settings";
type Status = "active" | "pending" | "approved" | "rejected" | "paid";
type Employee = {
  id: string; name: string; number: string; username: string; email: string;
  subdomain: string; salary: string; status: Status;
};
type Withdrawal = {
  id: string; employee: string; amount: string; status: Status; date: string;
  destination: string; destinationType: "bank" | "mpesa_b2c"; note?: string;
};

const originalEmployees: Employee[] = [
  { id: "sample-employee-001", name: "Sample Amina Njeri", number: "DEMO-1042", username: "sample.amina", email: "amina.sample@example.test", subdomain: "sample-amina", salary: "85000.00", status: "active" },
  { id: "sample-employee-002", name: "Sample Brian Otieno", number: "DEMO-1043", username: "sample.brian", email: "brian.sample@example.test", subdomain: "sample-brian", salary: "72000.00", status: "active" },
  { id: "sample-employee-003", name: "Sample Wanjiku Maina", number: "DEMO-1044", username: "sample.wanjiku", email: "wanjiku.sample@example.test", subdomain: "sample-wanjiku", salary: "68000.00", status: "pending" },
  { id: "sample-employee-004", name: "Sample David Kiptoo", number: "DEMO-1045", username: "sample.david", email: "david.sample@example.test", subdomain: "sample-david", salary: "91000.00", status: "active" },
];
const originalWithdrawals: Withdrawal[] = [
  { id: "sample-withdrawal-001", employee: "Sample Amina Njeri", amount: "12500.00", status: "pending", date: "16 Apr 2026 · 08:42", destination: "•••• 4821", destinationType: "bank" },
  { id: "sample-withdrawal-002", employee: "Sample Brian Otieno", amount: "8400.00", status: "pending", date: "15 Apr 2026 · 14:16", destination: "+254 ••• •• 731", destinationType: "mpesa_b2c" },
  { id: "sample-withdrawal-003", employee: "Sample Wanjiku Maina", amount: "5600.00", status: "pending", date: "15 Apr 2026 · 10:03", destination: "•••• 0917", destinationType: "bank" },
  { id: "sample-withdrawal-004", employee: "Sample David Kiptoo", amount: "9800.00", status: "approved", date: "14 Apr 2026 · 12:20", destination: "•••• 2234", destinationType: "bank" },
];
const destinationChanges = [
  { id: "sample-destination-001", employee: "Sample Wanjiku Maina", kind: "Bank transfer", masked: "•••• 0917", submitted: "16 Apr 2026 · 09:18" },
  { id: "sample-destination-002", employee: "Sample Brian Otieno", kind: "M-Pesa B2C", masked: "+254 ••• •• 731", submitted: "15 Apr 2026 · 13:04" },
];
const nav: Array<{ id: View; label: string; icon: typeof Wallet }> = [
  { id: "overview", label: "Overview", icon: Wallet },
  { id: "employees", label: "Employees", icon: Users },
  { id: "destinations", label: "Destination changes", icon: Landmark },
  { id: "withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
  { id: "payroll", label: "Payroll & commissions", icon: Banknote },
  { id: "settings", label: "Payout settings", icon: SlidersHorizontal },
];
const formatMoney = (value: string | number) => `KES ${Number(value).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

function Pill({ status }: { status: string }) {
  return <span className={`pa-pill pa-pill-${status}`}>{status.replaceAll("_", " ")}</span>;
}

function SectionTitle({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail?: string; children?: ReactNode }) {
  return <div className="pa-section-title"><div><p className="pa-eyebrow">{eyebrow}</p><h2>{title}</h2>{detail && <p className="pa-subtitle">{detail}</p>}</div>{children}</div>;
}

function Metric({ label, value, detail, icon: Icon, tone = "" }: { label: string; value: string; detail: string; icon: typeof Wallet; tone?: string }) {
  return <article className={`pa-metric ${tone}`}><div className="pa-metric-top"><span>{label}</span><i><Icon size={17} /></i></div><strong>{value}</strong><small>{detail}</small></article>;
}

export function Polished() {
  const [view, setView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [employees] = useState(originalEmployees);
  const [withdrawals, setWithdrawals] = useState(originalWithdrawals);
  const [aggregateWithdrawn, setAggregateWithdrawn] = useState(184500);
  const [destinationStatuses, setDestinationStatuses] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [recordId, setRecordId] = useState("");
  const [reference, setReference] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);

  const pendingCount = withdrawals.filter((item) => item.status === "pending").length;
  const employeeResults = useMemo(() => employees.filter((item) => {
    const matchesQuery = `${item.name} ${item.username} ${item.number} ${item.subdomain}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (employeeFilter === "all" || item.status === employeeFilter);
  }), [employees, employeeFilter, query]);

  const moveTo = (next: View) => { setView(next); setMobileNav(false); setNotice(""); };
  const decideWithdrawal = (id: string, status: "approved" | "rejected") => {
    setWithdrawals((items) => items.map((item) => item.id === id ? { ...item, status } : item));
    setNotice(status === "approved"
      ? "Review decision saved in this illustrative preview. Approval is not payment."
      : "Request marked rejected in this illustrative preview.");
  };
  const decideDestination = (id: string, status: "approved" | "rejected") => {
    setDestinationStatuses((items) => ({ ...items, [id]: status }));
    setNotice(`Destination change marked ${status} in this illustrative preview.`);
  };
  const recordPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recordId || !reference.trim() || !transferConfirmed) {
      setNotice("Choose an approved bank request, enter its external transfer reference, and confirm the transfer is complete.");
      return;
    }
    const recordedAmount = Number(withdrawals.find((item) => item.id === recordId)?.amount ?? "0");
    setWithdrawals((items) => items.map((item) => item.id === recordId ? { ...item, status: "paid" } : item));
    setAggregateWithdrawn((total) => total + recordedAmount);
    setNotice("External bank transfer reference recorded in this illustrative preview. No funds were sent.");
    setRecordId(""); setReference(""); setTransferConfirmed(false);
  };

  return <main className="pa-app">
    <header className="pa-global-header">
      <div className="pa-brand"><span className="pa-brand-mark" aria-hidden="true"><i /><i /><i /></span><span><b>ISPlatty</b><small>PEOPLE & FINANCE</small></span></div>
      <div className="pa-global-meta"><span>Connecting People. Powering Businesses.</span><span className="pa-sample-tag">ILLUSTRATIVE SAMPLE</span></div>
    </header>

    <div className="pa-workspace">
      <aside className={`pa-sidebar ${mobileNav ? "pa-sidebar-open" : ""}`} aria-label="Workspace navigation">
        <div className="pa-workspace-label"><span className="pa-shield"><ShieldCheck size={17} /></span><span><b>People operations</b><small>SUPER ADMIN AREA</small></span></div>
        <p className="pa-nav-caption">EMPLOYEE FINANCE</p>
        <nav>{nav.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`pa-nav-link ${view === id ? "selected" : ""}`} onClick={() => moveTo(id)} aria-current={view === id ? "page" : undefined}>
          <Icon size={17} /><span>{label}</span>{id === "withdrawals" && pendingCount > 0 && <i className="pa-count">{pendingCount}</i>}
        </button>)}</nav>
        <div className="pa-sidebar-bottom"><div className="pa-restricted"><LockKeyhole size={16} /><span><b>Restricted access</b><small>Super Admin controls</small></span></div><small className="pa-build-note">LOCAL PREVIEW · NOT CONNECTED</small></div>
      </aside>

      <section className="pa-main">
        <header className="pa-toolbar">
          <div className="pa-toolbar-heading"><button className="pa-menu-toggle" type="button" aria-label={mobileNav ? "Close navigation" : "Open navigation"} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={19} /> : <Menu size={19} />}</button><div><p className="pa-eyebrow">ISPLATTY / FINANCE OPERATIONS</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div></div>
          <div className="pa-workspace-state"><span /> SAMPLE WORKSPACE</div>
        </header>

        <div className="pa-content">
          {notice && <div className="pa-notice" role="status"><ShieldCheck size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {view === "overview" && <Overview employees={employees} withdrawals={withdrawals} totalWithdrawn={aggregateWithdrawn} onNavigate={moveTo} />}
          {view === "employees" && <section className="pa-panel">
            <SectionTitle eyebrow="WORKFORCE ACCOUNTS" title="Employee directory" detail="Sample employee accounts, account status and fixed monthly salary.">
              <button className="pa-button pa-button-quiet" type="button" onClick={() => setNotice("Employee invitations are not connected in this local sample preview.")}><Users size={16} /> Add employee</button>
            </SectionTitle>
            <div className="pa-table-controls"><label className="pa-search"><Search size={16} /><span className="pa-sr-only">Search employee accounts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, number or subdomain" /></label>
              <label className="pa-select-label"><span>Status</span><span className="pa-select-wrap"><select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="all">All accounts</option><option value="active">Active</option><option value="pending">Pending</option></select><ChevronDown size={15} /></span></label>
              <span className="pa-result-count">{employeeResults.length} of {employees.length} accounts</span>
            </div>
            {employeeResults.length ? <div className="pa-table-scroll"><table className="pa-table"><thead><tr><th>Employee</th><th>Account</th><th>Subdomain</th><th>Monthly salary</th><th>Status</th></tr></thead><tbody>{employeeResults.map((employee) => <tr key={employee.id}><td><b>{employee.name}</b><small>{employee.number}</small></td><td>{employee.username}<small>{employee.email}</small></td><td className="pa-mono">{employee.subdomain}.employees.isplatty.com</td><td className="pa-money">{formatMoney(employee.salary)}</td><td><Pill status={employee.status} /></td></tr>)}</tbody></table>
              <div className="pa-mobile-employee-list">{employeeResults.map((employee) => <article key={employee.id}><div><b>{employee.name}</b><small>{employee.number} · {employee.username}</small></div><Pill status={employee.status} /><small>{employee.subdomain}.employees.isplatty.com</small><strong>{formatMoney(employee.salary)} <small>/ month</small></strong></article>)}</div>
            </div> : <div className="pa-empty"><Users size={22} /><b>No matching employee accounts</b><span>Try a different search or status.</span></div>}
          </section>}
          {view === "destinations" && <Destinations statuses={destinationStatuses} onDecision={decideDestination} />}
          {view === "withdrawals" && <section className="pa-panel">
            <SectionTitle eyebrow="REQUEST REVIEW" title="Withdrawal requests" detail="A review decision does not move money. Payment must happen externally and be recorded separately." />
            <div className="pa-inline-summary"><span><Clock3 size={16} /> {pendingCount} requests waiting for review</span><span>Live disbursements <b className="pa-off-label">OFF</b></span></div>
            <div className="pa-request-list">{withdrawals.map((item) => <article className="pa-request" key={item.id}>
              <div className="pa-request-amount"><span className="pa-request-icon"><ArrowDownLeft size={18} /></span><div><b>{formatMoney(item.amount)}</b><small>{item.employee} · {item.date}</small></div></div>
              <div className="pa-request-destination"><small>DESTINATION</small><b>{item.destination}</b><span>{item.destinationType === "bank" ? "Bank transfer" : "M-Pesa B2C"}</span></div>
              <Pill status={item.status} />
              <div className="pa-row-actions">{item.status === "pending" ? <><button type="button" className="pa-button pa-button-quiet pa-small" onClick={() => decideWithdrawal(item.id, "rejected")}><XCircle size={14} /> Reject</button><button type="button" className="pa-button pa-button-primary pa-small" onClick={() => decideWithdrawal(item.id, "approved")}><Check size={14} /> Approve request</button></> : item.status === "approved" && item.destinationType === "bank" ? <button type="button" className="pa-text-action" onClick={() => { setRecordId(item.id); setNotice("Recording requires confirmation that the external bank transfer is already complete."); }}>Record external transfer</button> : null}</div>
            </article>)}</div>
            <div className="pa-manual">
              <div className="pa-manual-heading"><span className="pa-manual-icon"><Landmark size={18} /></span><div><p className="pa-eyebrow">MANUAL PAYMENT RECORD</p><h3>Bank transfer only</h3><p>Use only after a bank transfer is complete outside this portal. Recording a reference does not send funds.</p></div></div>
              <form onSubmit={recordPayment} className="pa-record-form">
                <label>Approved bank request<select aria-label="Approved bank withdrawal request" value={recordId} onChange={(event) => setRecordId(event.target.value)}><option value="">Select request</option>{withdrawals.filter((item) => item.status === "approved" && item.destinationType === "bank").map((item) => <option key={item.id} value={item.id}>{item.employee} · {formatMoney(item.amount)}</option>)}</select></label>
                <label>External bank transfer reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Enter bank reference" /></label>
                <label className="pa-confirm-check"><input type="checkbox" checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} /> I confirm the external bank transfer is complete.</label>
                <button className="pa-button pa-button-primary" type="submit"><Check size={15} /> Record transfer reference</button>
              </form>
            </div>
          </section>}
          {view === "payroll" && <Payroll />}
          {view === "settings" && <PayoutSettings totalWithdrawn={aggregateWithdrawn} />}
        </div>
      </section>
      {mobileNav && <button type="button" className="pa-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    </div>
    <footer className="pa-footer"><span>ISPlatty internal finance portal</span><span>Sample fixture data · not connected to production</span></footer>
  </main>;
}

function Overview({ employees, withdrawals, totalWithdrawn, onNavigate }: { employees: Employee[]; withdrawals: Withdrawal[]; totalWithdrawn: number; onNavigate: (view: View) => void }) {
  const waiting = withdrawals.filter((item) => item.status === "pending");
  return <>
    <div className="pa-welcome"><div><p className="pa-eyebrow">FINANCE OPERATIONS / OVERVIEW</p><h2>Clear view. Careful decisions.</h2><p>Employee accounts, review queues and recorded withdrawals in one workspace.</p></div><div className="pa-data-note"><span /> Illustrative sample data</div></div>
    <div className="pa-metric-grid">
      <Metric label="Employee accounts" value="24" detail="22 active accounts" icon={Users} />
      <Metric label="Waiting for review" value={String(waiting.length)} detail="Withdrawal requests" icon={Clock3} tone="pa-metric-attention" />
      <Metric label="Total withdrawn" value={formatMoney(totalWithdrawn)} detail="Recorded as paid" icon={ArrowDownToLine} tone="pa-metric-money" />
      <Metric label="Withdrawn today" value={formatMoney("12500")} detail="Recorded today" icon={Banknote} />
    </div>
    <div className="pa-overview-grid">
      <section className="pa-panel pa-queue-panel">
        <SectionTitle eyebrow="NEEDS ATTENTION" title="Pending withdrawals"><button type="button" className="pa-text-action" onClick={() => onNavigate("withdrawals")}>Open review queue <ArrowRight size={15} /></button></SectionTitle>
        {waiting.length ? <div className="pa-compact-list">{waiting.slice(0, 4).map((item) => <article key={item.id}><span className="pa-compact-icon"><ArrowDownLeft size={17} /></span><div><b>{formatMoney(item.amount)}</b><small>{item.employee} · {item.date}</small></div><Pill status={item.status} /><button type="button" aria-label={`Review withdrawal from ${item.employee}`} onClick={() => onNavigate("withdrawals")}><ArrowRight size={16} /></button></article>)}</div> : <div className="pa-clear-queue"><Check size={17} /><span><b>Nothing waiting for review</b><small>New employee requests will appear here.</small></span></div>}
        <div className="pa-employee-total"><span><Users size={16} /> Employee total</span><b>{employees.length} sample records <small>of 24 accounts</small></b></div>
      </section>
      <aside className="pa-safety-card"><span className="pa-safety-icon"><ShieldCheck size={20} /></span><p className="pa-eyebrow">PAYOUT SAFETY</p><h3>Approval is a decision, not a disbursement.</h3><p>Live disbursements are disabled. Only completed external bank transfers can be recorded here with their reference.</p><span className="pa-safety-state"><i /> LIVE DISBURSEMENTS OFF</span></aside>
    </div>
    <div className="pa-overview-footnote"><FileClock size={16} /><span>Withdrawal totals reflect amounts recorded as paid; approved requests are not included until external payment is confirmed and recorded.</span><button type="button" onClick={() => onNavigate("withdrawals")}>Review records <ArrowRight size={14} /></button></div>
  </>;
}

function Destinations({ statuses, onDecision }: { statuses: Record<string, string>; onDecision: (id: string, status: "approved" | "rejected") => void }) {
  return <section className="pa-panel">
    <SectionTitle eyebrow="EMPLOYEE PAYOUT DETAILS" title="Destination-change review" detail="Review change requests before they become an employee's payout destination. Full account details are never displayed." />
    <div className="pa-review-banner"><ShieldCheck size={18} /><span><b>Review status is separate from payment.</b> No payout is initiated by accepting a destination change.</span></div>
    <div className="pa-destination-list">{destinationChanges.map((item) => {
      const status = statuses[item.id] ?? "pending";
      return <article key={item.id} className="pa-destination-row"><span className="pa-destination-icon"><Landmark size={18} /></span><div className="pa-dest-person"><b>{item.employee}</b><small>Submitted {item.submitted}</small></div><div className="pa-dest-kind"><small>REQUESTED DESTINATION</small><b>{item.kind}</b><span>{item.masked}</span></div><Pill status={status} />{status === "pending" && <div className="pa-row-actions"><button type="button" className="pa-button pa-button-quiet pa-small" onClick={() => onDecision(item.id, "rejected")}><XCircle size={14} /> Reject</button><button type="button" className="pa-button pa-button-primary pa-small" onClick={() => onDecision(item.id, "approved")}><Check size={14} /> Approve change</button></div>}</article>;
    })}</div>
    <p className="pa-fixture-caption">Illustrative destination labels only. No real account details or employee records are present.</p>
  </section>;
}

function Payroll() {
  return <div className="pa-stack">
    <section className="pa-panel">
      <SectionTitle eyebrow="COMPENSATION" title="Payroll & commissions" detail="Preview the compensation items and payroll history associated with employee accounts." />
      <div className="pa-payroll-callout"><span><Banknote size={19} /></span><div><b>Payroll posting and disbursement are not active in this preview.</b><small>Figures below are illustrative fixture values; no payroll is calculated or sent.</small></div></div>
      <div className="pa-payroll-table-wrap"><table className="pa-table"><thead><tr><th>Illustrative period</th><th>Salary</th><th>Commissions</th><th>Allowances & bonuses</th><th>Deductions</th><th>Net amount</th><th>Status</th></tr></thead><tbody>
        <tr><td><b>Sample period · Apr 2026</b><small>Sample employee: Sample Amina Njeri</small></td><td className="pa-money">{formatMoney("85000")}</td><td className="pa-money">{formatMoney("12400")}</td><td className="pa-money">{formatMoney("6500")}</td><td className="pa-money">{formatMoney("3200")}</td><td className="pa-money">{formatMoney("100700")}</td><td><Pill status="paid" /></td></tr>
        <tr><td><b>Sample period · Mar 2026</b><small>Sample employee: Sample Brian Otieno</small></td><td className="pa-money">{formatMoney("72000")}</td><td className="pa-money">{formatMoney("8900")}</td><td className="pa-money">{formatMoney("2000")}</td><td className="pa-money">{formatMoney("2500")}</td><td className="pa-money">{formatMoney("80400")}</td><td><Pill status="paid" /></td></tr>
      </tbody></table></div>
      <div className="pa-payroll-category"><div><ArrowUpRight size={17} /><span><b>Commissions</b><small>Earned compensation component</small></span></div><div><Banknote size={17} /><span><b>Allowances & bonuses</b><small>Shown separately from fixed salary</small></span></div><div><ArrowDownLeft size={17} /><span><b>Deductions</b><small>Displayed as a reduction</small></span></div></div>
    </section>
    <section className="pa-panel">
      <SectionTitle eyebrow="SALARY HISTORY" title="Fixed monthly salary" detail="Illustrative salary history; changes require the existing compensation review workflow." />
      <div className="pa-salary-history"><article><span className="pa-history-dot" /><div><b>Sample Amina Njeri · {formatMoney("85000")} / month</b><small>Current illustrative salary · status: active</small></div><span className="pa-history-date">01 Apr 2026</span></article><article><span className="pa-history-dot muted" /><div><b>Sample Brian Otieno · {formatMoney("72000")} / month</b><small>Current illustrative salary · status: active</small></div><span className="pa-history-date">01 Apr 2026</span></article></div>
    </section>
  </div>;
}

function PayoutSettings({ totalWithdrawn }: { totalWithdrawn: number }) {
  return <div className="pa-stack">
    <section className="pa-panel">
      <SectionTitle eyebrow="DISBURSEMENT CONTROL" title="Payout settings" detail="A view of payout safety controls. These sample settings are not editable or connected to a payment service." />
      <div className="pa-live-control"><span className="pa-control-symbol"><LockKeyhole size={19} /></span><div><b>Live disbursements</b><small>Payment initiation through this workspace is disabled.</small></div><span className="pa-toggle-off" aria-label="Live disbursements off"><i /> OFF</span></div>
      <div className="pa-setting-list"><article><span className="pa-setting-index">01</span><div><b>Manual payment recording</b><small>Bank-transfer-only notation after an external transfer is complete.</small></div><span className="pa-reference-tag">REFERENCE</span></article><article><span className="pa-setting-index">02</span><div><b>Request review</b><small>Approving or rejecting a request does not make or schedule payment.</small></div><span className="pa-reference-tag">REFERENCE</span></article><article><span className="pa-setting-index">03</span><div><b>Destination changes</b><small>Change requests are reviewed separately from withdrawals.</small></div><span className="pa-reference-tag">REFERENCE</span></article></div>
      <div className="pa-setting-note"><ShieldCheck size={17} /><p><b>Not a live configuration screen.</b> Request limits and allowed destination rules are intentionally not represented as editable values in this mockup.</p></div>
    </section>
    <section className="pa-panel pa-aggregate-panel"><div><p className="pa-eyebrow">AGGREGATE WITHDRAWALS</p><h3>Total recorded as paid</h3><small>Aggregate summary fixture · payment entries only</small></div><strong>{formatMoney(totalWithdrawn)}</strong><div className="pa-aggregate-detail"><span>Recorded today</span><b>{formatMoney("12500.00")}</b></div></section>
  </div>;
}
