import "./_group.css";
import { useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Banknote, Check, ChevronRight, Clock3,
  CreditCard, FileText, Landmark, LockKeyhole, Menu, ShieldCheck, UserRound,
  Users, Wallet, X,
} from "lucide-react";

type AdminView = "overview" | "employees" | "destinations" | "withdrawals" | "payroll" | "settings";

type Employee = {
  id: string;
  display_name: string;
  employee_number: string;
  username: string;
  email: string;
  phone?: string;
  subdomain: string;
  fixed_monthly_salary: string;
  status: string;
};

type Withdrawal = {
  id: string;
  amount: string;
  status: string;
  created_at: string;
  review_note?: string;
  destination?: { masked_label: string; destination_type: string };
};

// Fixed, synthetic fixtures for this isolated preview. No API client or auth code is used.
const sampleSummary = {
  employee_count: 24,
  active_employee_count: 22,
  pending_withdrawal_count: 3,
  total_withdrawn: "184500.00",
  withdrawn_today: "12500.00",
};

const sampleEmployees: Employee[] = [
  { id: "sample-employee-001", display_name: "Sample Amina Njeri", employee_number: "DEMO-1042", username: "sample.amina", email: "amina.sample@example.test", subdomain: "sample-amina", fixed_monthly_salary: "85000.00", status: "active" },
  { id: "sample-employee-002", display_name: "Sample Brian Otieno", employee_number: "DEMO-1043", username: "sample.brian", email: "brian.sample@example.test", subdomain: "sample-brian", fixed_monthly_salary: "72000.00", status: "active" },
  { id: "sample-employee-003", display_name: "Sample Wanjiku Maina", employee_number: "DEMO-1044", username: "sample.wanjiku", email: "wanjiku.sample@example.test", subdomain: "sample-wanjiku", fixed_monthly_salary: "68000.00", status: "pending" },
  { id: "sample-employee-004", display_name: "Sample David Kiptoo", employee_number: "DEMO-1045", username: "sample.david", email: "david.sample@example.test", subdomain: "sample-david", fixed_monthly_salary: "91000.00", status: "active" },
];

const sampleWithdrawals: Withdrawal[] = [
  { id: "sample-withdrawal-001", amount: "12500.00", status: "pending", created_at: "2026-04-16T08:42:00Z", destination: { masked_label: "•••• 4821", destination_type: "bank" } },
  { id: "sample-withdrawal-002", amount: "8400.00", status: "pending", created_at: "2026-04-15T14:16:00Z", destination: { masked_label: "+254 ••• •• 731", destination_type: "mpesa_b2c" } },
  { id: "sample-withdrawal-003", amount: "5600.00", status: "pending", created_at: "2026-04-15T10:03:00Z", destination: { masked_label: "•••• 0917", destination_type: "bank" } },
  { id: "sample-withdrawal-004", amount: "9800.00", status: "approved", created_at: "2026-04-14T12:20:00Z", destination: { masked_label: "•••• 2234", destination_type: "bank" } },
];

const money = (value?: string | number | null) => {
  if (value === undefined || value === null || value === "") return "—";
  const raw = String(value).trim();
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return "—";
  const sign = match[1] === "-" ? "−" : "";
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `KES ${sign}${integer}${fraction ? `.${fraction}` : ""}`;
};

const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";

function BrandMark() {
  return <div className="ep-brand">
    <span className="ep-brand-symbol" aria-hidden="true"><span /><span /><span /></span>
    <span className="ep-brand-word"><strong>ISPlatty</strong><small>PEOPLE & FINANCE</small></span>
  </div>;
}

function PortalFrame({ children }: { children: React.ReactNode }) {
  return <main className="ep-app ep-admin-app">
    <div className="ep-topline"><BrandMark /><span className="ep-tagline">Connecting People. Powering Businesses.</span></div>
    {children}
    <footer className="ep-footer"><span>ISPlatty internal finance portal</span><span>Sample fixture data · not connected to production</span></footer>
  </main>;
}

function StatusPill({ status }: { status: string }) {
  const className = ["paid", "active", "approved"].includes(status) ? "good" : ["pending", "processing", "reconciliation_required"].includes(status) ? "waiting" : ["rejected", "suspended", "terminated"].includes(status) ? "bad" : "neutral";
  return <span className={`ep-status ep-status-${className}`}>{status.replaceAll("_", " ")}</span>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="ep-empty"><span><FileText size={22} /></span><h3>{title}</h3><p>{text}</p></div>;
}

export function Current() {
  return <AdminAccessGate />;
}

function AdminAccessGate() {
  // The real gate depends on Super Admin authentication. The preview is intentionally
  // pre-authenticated with a local sample identity and never reads or creates a session.
  return <PortalFrame><AdminPortal /></PortalFrame>;
}

function AdminPortal() {
  const [view, setView] = useState<AdminView>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const summaryData = sampleSummary;
  const menuItems: Array<{ id: AdminView; label: string; icon: typeof Wallet }> = [
    { id: "overview", label: "Overview", icon: Wallet },
    { id: "employees", label: "Employees", icon: Users },
    { id: "destinations", label: "Destination changes", icon: CreditCard },
    { id: "withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
    { id: "payroll", label: "Payroll & commissions", icon: Banknote },
    { id: "settings", label: "Payout controls", icon: Landmark },
  ];
  const filteredEmployees = sampleEmployees.filter((employee) =>
    `${employee.display_name} ${employee.username} ${employee.employee_number} ${employee.subdomain}`.toLowerCase().includes(search.toLowerCase()),
  );

  return <div className="ep-admin-layout">
    <aside className={`ep-sidebar ep-admin-sidebar ${menuOpen ? "is-open" : ""}`}>
      <div className="ep-sidebar-brand"><BrandMark /></div>
      <div className="ep-admin-identity"><span className="ep-admin-emblem"><ShieldCheck size={18} /></span><span><b>People operations</b><small>SUPER ADMIN AREA</small></span></div>
      <p className="ep-nav-label">EMPLOYEE FINANCE</p>
      <nav>{menuItems.map(({ id, label, icon: Icon }) => <button key={id} className={`ep-nav-item ${view === id ? "active" : ""}`} onClick={() => { setView(id); setMenuOpen(false); }}><Icon size={17} />{label}<ChevronRight className="ep-nav-arrow" size={15} />{id === "withdrawals" && summaryData.pending_withdrawal_count ? <i className="ep-nav-count">{summaryData.pending_withdrawal_count}</i> : null}</button>)}</nav>
      <div className="ep-sidebar-bottom"><div className="ep-secure-card"><LockKeyhole size={16} /><span><b>Restricted access</b><small>Super Admin controls</small></span></div></div>
    </aside>
    <section className="ep-admin-main">
      <header className="ep-work-header">
        <div className="ep-header-left"><button className="ep-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button><div><p className="ep-header-kicker">ISPLATTY · PEOPLE OPERATIONS</p><h1>{menuItems.find((item) => item.id === view)?.label}</h1></div></div>
        <span className="ep-admin-status"><span /> Admin workspace</span>
      </header>
      <main className="ep-content ep-admin-content">
        {view === "overview" && <AdminOverview summary={summaryData} isError={false} onOpen={setView} onCreate={() => setView("employees")} withdrawals={sampleWithdrawals} onReview={() => setView("withdrawals")} />}
        {view === "employees" && <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">WORKFORCE ACCOUNTS</p><h3>Employee directory</h3><p>Manage invitations and review employee account status.</p></div><button className="ep-button ep-button-primary" onClick={() => setSearch("")}><UserRound size={16} /> Add employee</button></div><div className="ep-toolbar"><label className="ep-search"><span>Search accounts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, number or subdomain" /></label><span className="ep-result-count">{filteredEmployees.length} accounts</span></div>{filteredEmployees.length ? <EmployeeTable employees={filteredEmployees} /> : <EmptyState title="No matching employees" text="Try another name, employee number or subdomain." />}</section>}
        {view === "withdrawals" && <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">REVIEW QUEUE</p><h3>Withdrawal requests</h3><p>Approvals are not payments. Recording is for confirmed external bank transfers only.</p></div></div><WithdrawalList withdrawals={sampleWithdrawals} onReview={() => undefined} onRecord={() => undefined} /><div className="ep-manual-payment"><div><span className="ep-manual-icon"><Banknote size={19} /></span><div><h4>Record confirmed bank transfer only</h4><p>Record a reference after a bank transfer has been completed outside this portal. This does not send funds.</p></div></div><form onSubmit={(event) => event.preventDefault()}><input aria-label="Withdrawal ID" placeholder="Withdrawal ID" /><input aria-label="External bank transfer reference" placeholder="Bank transfer reference" /><label className="ep-bank-confirm"><input type="checkbox" /> I confirm an external bank transfer is complete.</label><button className="ep-button ep-button-secondary" type="button">Record bank transfer</button></form></div></section>}
        {["destinations", "payroll", "settings"].includes(view) && <section className="ep-admin-panel"><EmptyState title={`${menuItems.find((item) => item.id === view)?.label} preview`} text="This isolated current-baseline preview uses static fixture data and does not connect to the employee administration service." /></section>}
      </main>
    </section>
    {menuOpen && <button aria-label="Close navigation" className="ep-mobile-scrim" onClick={() => setMenuOpen(false)} />}
  </div>;
}

function AdminOverview({ summary, isError, onOpen, onCreate, withdrawals, onReview }: {
  summary?: { employee_count: number; active_employee_count: number; pending_withdrawal_count: number; total_withdrawn: string; withdrawn_today: string };
  isError: boolean; onOpen: (view: AdminView) => void; onCreate: () => void; withdrawals: Withdrawal[]; onReview: (item: Withdrawal) => void;
}) {
  if (isError) return <EmptyState title="Admin summary unavailable" text="The administration API did not return its summary. Check your Super Admin access and retry." />;
  const pending = withdrawals.filter((item) => item.status === "pending");
  return <><div className="ep-admin-welcome"><div><p className="ep-eyebrow">FINANCE OPERATIONS</p><h2>Employee accounts, at a glance.</h2><p>Review workforce access and keep withdrawal decisions traceable.</p></div><button className="ep-button ep-button-primary" onClick={onCreate}><UserRound size={16} /> Add employee</button></div>
    <div className="ep-admin-stat-grid"><AdminStat label="Employee accounts" value={summary?.employee_count} detail={`${summary?.active_employee_count ?? "—"} active`} icon={Users} /><AdminStat label="Waiting for review" value={summary?.pending_withdrawal_count} detail="Withdrawal requests" icon={Clock3} urgent={(summary?.pending_withdrawal_count ?? 0) > 0} /><AdminStat label="Total withdrawn" value={money(summary?.total_withdrawn)} detail="Recorded as paid" icon={ArrowDownToLine} /><AdminStat label="Withdrawn today" value={money(summary?.withdrawn_today)} detail="Recorded today" icon={Banknote} /></div>
    {summary?.employee_count === 0 && <section className="ep-admin-panel ep-admin-start" aria-labelledby="employee-setup-title"><div className="ep-section-heading"><div><p className="ep-eyebrow">GETTING STARTED</p><h3 id="employee-setup-title">Set up employee finance</h3></div></div><ol><li><button onClick={onCreate}><Users size={19} aria-hidden="true" /><span><b>Invite an employee</b><small>Set up their account and registered payout destination.</small></span><ArrowRight size={16} aria-hidden="true" /></button></li><li><button onClick={() => onOpen("employees")}><Banknote size={19} aria-hidden="true" /><span><b>Review payroll</b><small>Set salaries and preview earnings before posting.</small></span><ArrowRight size={16} aria-hidden="true" /></button></li><li><button onClick={() => onOpen("withdrawals")}><Users size={19} aria-hidden="true" /><span><b>Set withdrawal rules</b><small>Choose allowed destinations and set request limits.</small></span><ArrowRight size={16} aria-hidden="true" /></button></li></ol></section>}
    <div className="ep-admin-overview-grid"><section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">NEEDS ATTENTION</p><h3>Pending withdrawals</h3></div><button className="ep-text-button" onClick={() => onOpen("withdrawals")}>Review queue <ArrowRight size={15} /></button></div>{pending.length ? <WithdrawalList withdrawals={pending.slice(0, 4)} onReview={onReview} onRecord={() => undefined} compact /> : <div className="ep-quiet-empty"><span><Check size={18} /></span><div><b>Nothing waiting for review</b><small>New employee requests will appear here.</small></div></div>}</section>
      <section className="ep-admin-side-panel"><span className="ep-admin-side-icon"><ShieldCheck size={20} /></span><p className="ep-eyebrow">PAYOUT SAFETY</p><h3>Request controls are not disbursement controls.</h3><p>Live disbursements are currently disabled. An approved request still needs an external payment and a recorded reference.</p><button className="ep-text-button" onClick={() => onOpen("withdrawals")}>View payout controls <ArrowRight size={15} /></button></section></div>
  </>;
}

function AdminStat({ label, value, detail, icon: Icon, urgent = false }: { label: string; value?: string | number; detail: string; icon: typeof Wallet; urgent?: boolean }) {
  return <article className={`ep-admin-stat ${urgent ? "urgent" : ""}`}><div><span>{label}</span><i><Icon size={17} /></i></div><strong>{value ?? "—"}</strong><small>{detail}</small></article>;
}

function EmployeeTable({ employees }: { employees: Employee[] }) {
  return <div className="ep-table-wrap"><table className="ep-table ep-admin-table"><thead><tr><th>Employee</th><th>Account</th><th>Subdomain</th><th>Monthly salary</th><th>Status</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.display_name}</strong><small>{employee.employee_number}</small></td><td>{employee.username}<small>{employee.email || employee.phone || "No contact details"}</small></td><td className="ep-mono">{employee.subdomain}.employees.isplatty.com</td><td className="ep-amount">{money(employee.fixed_monthly_salary)}</td><td><StatusPill status={employee.status} /></td></tr>)}</tbody></table><div className="ep-mobile-rows">{employees.map((employee) => <article key={`mobile-${employee.id}`}><div><strong>{employee.display_name}</strong><small>{employee.employee_number} · {employee.username}</small></div><StatusPill status={employee.status} /><small>{employee.subdomain}.employees.isplatty.com · {money(employee.fixed_monthly_salary)}/month</small></article>)}</div></div>;
}

function WithdrawalList({ withdrawals, onReview, onRecord, compact = false }: {
  withdrawals: Withdrawal[]; onReview: (item: Withdrawal) => void; onRecord: (item: Withdrawal) => void; compact?: boolean;
}) {
  if (!withdrawals.length) return <div className="ep-quiet-empty"><span><FileText size={18} /></span><div><b>No withdrawal requests</b><small>Requests appear here when submitted by employees.</small></div></div>;
  return <div className="ep-withdrawal-list">{withdrawals.map((item) => <article className="ep-withdrawal-row" key={item.id}><div className="ep-withdrawal-main"><span className="ep-withdrawal-icon"><ArrowDownToLine size={17} /></span><div><b>{money(item.amount)}</b><small>Request {item.id.slice(0, 10)} · {dateTime(item.created_at)}</small><small>{item.destination?.masked_label ?? "Payout destination"} · {item.destination?.destination_type?.replaceAll("_", " ") ?? "type unavailable"}</small>{item.review_note && <small>Note: {item.review_note}</small>}</div></div><StatusPill status={item.status} /><div className="ep-withdrawal-actions">{item.status === "pending" && <button className="ep-button ep-button-secondary ep-small-button" onClick={() => onReview(item)}>Review</button>}{!compact && ["approved", "processing", "reconciliation_required"].includes(item.status) && item.destination?.destination_type === "bank" && <button className="ep-button ep-button-secondary ep-small-button" onClick={() => onRecord(item)}>Record bank transfer</button>}{!compact && ["approved", "processing", "reconciliation_required"].includes(item.status) && item.destination?.destination_type !== "bank" && <small>Provider confirmation is required; live payouts are disabled.</small>}</div></article>)}</div>;
}
