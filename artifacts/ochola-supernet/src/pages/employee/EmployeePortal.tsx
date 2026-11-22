import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, BadgeCheck, Banknote, BriefcaseBusiness,
  Check, ChevronRight, CircleAlert, Clock3, CreditCard, Eye, EyeOff, FileText,
  Landmark, LockKeyhole, LogOut, Menu, RefreshCw, ShieldCheck, UserRound, Users,
  Wallet, X,
} from "lucide-react";
import {
  useAdminEmployees, useAdminWithdrawals, useCreateEmployee, useEmployeeActivate,
  useCreateEmployeeCommissionRule, useCreateEmployeeCompensation, useEmployeeAdminSummary,
  useEmployeeCommissionRules, useEmployeeCompensation, useEmployeeDashboard, useEmployeeDestinations,
  useCancelEmployeeWithdrawal, useEmployeeLogin, useEmployeeLogout, useEmployeeMe, useEmployeePayoutSettings,
  useEmployeePortalStatus, useEmployeeSalaryHistory, usePostEmployeePayroll,
  usePreviewEmployeePayroll, useRecordEmployeePayment, useRequestEmployeeDestinationChange,
  usePendingEmployeeDestinations, useRequestEmployeeWithdrawal, useReviewEmployeeCompensation,
  useReviewEmployeeDestination, useReviewEmployeeWithdrawal,
  useSaveEmployeePayoutSettings, useUpdateEmployeeSalary,
} from "@workspace/api-client-react";
import type { EmployeeCompensationItem, EmployeePortalDashboard, EmployeePortalEmployee, EmployeePortalWithdrawal } from "@workspace/api-client-react";
import { isSuperAdminLoggedIn } from "../super-admin/Login";
import "./employee.css";

type EmployeeView = "overview" | "activity" | "profile";
type AdminView = "overview" | "employees" | "destinations" | "withdrawals" | "payroll" | "settings";

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
const isPositiveDecimal = (value: string) => /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value.trim()) && /[1-9]/.test(value);
const addDecimals = (left: string, right: string) => {
  const parse = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return { whole: BigInt(whole || "0"), fraction: fraction.padEnd(6, "0").slice(0, 6) };
  };
  const a = parse(left), b = parse(right);
  const scale = 1_000_000n;
  const total = (a.whole * scale + BigInt(a.fraction)) + (b.whole * scale + BigInt(b.fraction));
  const whole = total / scale;
  const fraction = String(total % scale).padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
};
const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";
const fragmentInvitation = (value: string) => {
  try {
    const url = new URL(value, window.location.origin);
    const hashToken = new URLSearchParams(url.hash.slice(1)).get("token");
    const token = hashToken || url.searchParams.get("token");
    if (token) {
      url.searchParams.delete("token");
      url.hash = new URLSearchParams({ token }).toString();
    }
    return url.toString();
  } catch {
    return value;
  }
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const makeIdempotencyKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className="ep-brand">
    <span className="ep-brand-symbol" aria-hidden="true"><span /><span /><span /></span>
    {!compact && <span className="ep-brand-word"><strong>ISPlatty</strong><small>PEOPLE & FINANCE</small></span>}
  </div>;
}

function PortalFrame({ children, kind = "employee" }: { children: React.ReactNode; kind?: "employee" | "admin" }) {
  return <main className={`ep-app ${kind === "admin" ? "ep-admin-app" : ""}`}>
    <div className="ep-topline"><BrandMark /><span className="ep-tagline">Connecting People. Powering Businesses.</span></div>
    {children}
    <footer className="ep-footer"><span>ISPlatty internal finance portal</span><span>Secure employee access</span></footer>
  </main>;
}

function Notice({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: React.ReactNode }) {
  return <div className={`ep-notice ep-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
    {tone === "error" ? <CircleAlert size={17} /> : tone === "success" ? <Check size={17} /> : <ShieldCheck size={17} />}
    <span>{children}</span>
  </div>;
}

function LoadingBlock({ label = "Loading your portal" }: { label?: string }) {
  return <div className="ep-loading" role="status" aria-label={label}>
    <div className="ep-skeleton ep-skeleton-heading" />
    <div className="ep-skeleton-grid"><div className="ep-skeleton" /><div className="ep-skeleton" /><div className="ep-skeleton" /></div>
    <div className="ep-skeleton ep-skeleton-row" /><div className="ep-skeleton ep-skeleton-row" />
  </div>;
}

function DisabledPortal() {
  return <PortalFrame><section className="ep-unavailable">
    <span className="ep-unavailable-icon"><BriefcaseBusiness size={24} /></span>
    <p className="ep-eyebrow">EMPLOYEE FINANCE</p>
    <h1>Portal access is not enabled</h1>
    <p>Your employee finance portal is currently unavailable. No account or balance information can be shown right now.</p>
    <p className="ep-muted">Please contact your ISPlatty administrator for assistance.</p>
  </section></PortalFrame>;
}

function PortalGate({ children }: { children: React.ReactNode }) {
  const status = useEmployeePortalStatus();
  if (status.isLoading) return <PortalFrame><LoadingBlock label="Checking portal availability" /></PortalFrame>;
  if (status.isError) return <PortalFrame><section className="ep-unavailable">
    <span className="ep-unavailable-icon"><CircleAlert size={24} /></span><p className="ep-eyebrow">SERVICE STATUS</p>
    <h1>We could not check portal access</h1><p>{errorText(status.error)}</p>
    <button className="ep-button ep-button-secondary" onClick={() => void status.refetch()}><RefreshCw size={16} /> Try again</button>
  </section></PortalFrame>;
  if (!status.data?.enabled) return <DisabledPortal />;
  return <>{children}</>;
}

export function EmployeeLoginPage() {
  return <PortalGate><EmployeeLoginForm /></PortalGate>;
}

function EmployeeLoginForm() {
  const [, setLocation] = useLocation();
  const login = useEmployeeLogin();
  const me = useEmployeeMe();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (me.data?.employee) setLocation("/employee/dashboard"); }, [me.data, setLocation]);
  if (me.isLoading || me.data?.employee) return <PortalFrame><LoadingBlock /></PortalFrame>;
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setMessage("");
    login.mutate({ username: username.trim(), password }, {
      onSuccess: () => setLocation("/employee/dashboard"),
      onError: (error) => setMessage(errorText(error)),
    });
  };
  return <PortalFrame><div className="ep-auth-layout">
    <section className="ep-auth-aside">
      <div className="ep-aside-orbit ep-orbit-one" /><div className="ep-aside-orbit ep-orbit-two" />
      <p className="ep-eyebrow">EMPLOYEE FINANCE, IN ONE PLACE</p>
      <h1>Your work.<br /><em>Accounted for.</em></h1>
      <p>See what you have earned, track your withdrawals and keep your pay history close.</p>
      <div className="ep-aside-note"><span className="ep-note-line" /><span>Salary · commissions · allowances</span></div>
    </section>
    <section className="ep-auth-card">
      <div className="ep-card-icon"><LockKeyhole size={21} /></div>
      <p className="ep-eyebrow">EMPLOYEE SIGN IN</p><h2>Welcome back</h2>
      <p className="ep-card-intro">Use the username provided by your administrator.</p>
      {message && <Notice>{message}</Notice>}
      {me.isError && <Notice tone="info">No active employee session. Sign in to continue.</Notice>}
      <form className="ep-form" onSubmit={submit}>
        <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required placeholder="Your employee username" /></label>
        <label>Password<span className="ep-password-wrap"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="Your password" /><button type="button" className="ep-reveal" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
        <button className="ep-button ep-button-primary ep-button-wide" disabled={login.isPending}>{login.isPending ? "Signing in…" : <>Sign in <ArrowRight size={17} /></>}</button>
      </form>
      <p className="ep-secure-foot"><ShieldCheck size={15} /> Protected by a secure, private session</p>
    </section>
  </div></PortalFrame>;
}

export function EmployeeActivatePage() {
  return <PortalGate><ActivationForm /></PortalGate>;
}

function ActivationForm() {
  const [, setLocation] = useLocation();
  const activate = useEmployeeActivate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (!token) { setError("This activation link is missing its one-time token. Ask your administrator for a new invitation."); return; }
    if (password.length < 12) { setError("Choose a password with at least 12 characters."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    activate.mutate({ token, password }, {
      onSuccess: () => setLocation("/employee/login"),
      onError: (reason) => setError(errorText(reason)),
    });
  };
  return <PortalFrame><div className="ep-activate-layout">
    <div className="ep-activate-copy"><p className="ep-eyebrow">ONE-TIME SETUP</p><h1>Make this account<br /><em>yours.</em></h1><p>Set a private password to activate your employee finance portal account.</p><div className="ep-activation-steps"><span><b>01</b> Choose a strong password</span><span><b>02</b> Sign in to view your account</span></div></div>
    <section className="ep-auth-card ep-activation-card"><div className="ep-card-icon"><BadgeCheck size={21} /></div><p className="ep-eyebrow">ACCOUNT ACTIVATION</p><h2>Set your password</h2><p className="ep-card-intro">This invitation link can only be used once.</p>
      {error && <Notice>{error}</Notice>}
      <form className="ep-form" onSubmit={submit}>
        <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={12} placeholder="At least 12 characters" /></label>
        <label>Confirm password<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required placeholder="Enter it again" /></label>
        <button className="ep-button ep-button-primary ep-button-wide" disabled={activate.isPending}>{activate.isPending ? "Activating…" : <>Activate account <ArrowRight size={17} /></>}</button>
      </form>
    </section>
  </div></PortalFrame>;
}

function EmployeeShell({ children, selected, onSelect, onLogout, name }: {
  children: React.ReactNode; selected: EmployeeView; onSelect: (view: EmployeeView) => void; onLogout: () => void; name: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items: Array<{ id: EmployeeView; label: string; icon: typeof Wallet }> = [
    { id: "overview", label: "Overview", icon: Wallet }, { id: "activity", label: "Pay activity", icon: FileText }, { id: "profile", label: "Account", icon: UserRound },
  ];
  return <div className="ep-workspace">
    <aside className={`ep-sidebar ${menuOpen ? "is-open" : ""}`}>
      <div className="ep-sidebar-brand"><BrandMark /></div><p className="ep-nav-label">YOUR FINANCES</p>
      <nav>{items.map(({ id, label, icon: Icon }) => <button key={id} className={`ep-nav-item ${selected === id ? "active" : ""}`} onClick={() => { onSelect(id); setMenuOpen(false); }}><Icon size={17} />{label}<ChevronRight className="ep-nav-arrow" size={15} /></button>)}</nav>
      <div className="ep-sidebar-bottom"><div className="ep-secure-card"><ShieldCheck size={16} /><span><b>Private by design</b><small>Your session is protected</small></span></div><button className="ep-logout" onClick={onLogout}><LogOut size={16} /> Sign out</button></div>
    </aside>
    <div className="ep-work-main"><header className="ep-work-header"><div className="ep-header-left"><button className="ep-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button><div><p className="ep-header-kicker">EMPLOYEE PORTAL</p><h1>{selected === "overview" ? "Your overview" : selected === "activity" ? "Pay activity" : "Account details"}</h1></div></div><div className="ep-user-chip"><span className="ep-avatar">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></div></header>{children}</div>
    {menuOpen && <button aria-label="Close navigation" className="ep-mobile-scrim" onClick={() => setMenuOpen(false)} />}
  </div>;
}

export function EmployeeDashboardPage() {
  return <PortalGate><EmployeeDashboard /></PortalGate>;
}

function EmployeeDashboard() {
  const [, setLocation] = useLocation();
  const me = useEmployeeMe();
  const logout = useEmployeeLogout();
  useEffect(() => { if (!me.isLoading && !me.data?.employee) setLocation("/employee/login"); }, [me.isLoading, me.data, setLocation]);
  if (me.isLoading || !me.data?.employee) return <PortalFrame><LoadingBlock label="Returning to sign in" /></PortalFrame>;
  const doLogout = () => logout.mutate(undefined, { onSuccess: () => setLocation("/employee/login"), onError: () => setLocation("/employee/login") });
  return <EmployeeDashboardData employee={me.data.employee} onLogout={doLogout} />;
}

function EmployeeDashboardData({ employee, onLogout }: {
  employee: { id: string; username: string; displayName: string }; onLogout: () => void;
}) {
  const dashboardQuery = useEmployeeDashboard();
  const destinationsQuery = useEmployeeDestinations();
  const requestWithdrawal = useRequestEmployeeWithdrawal();
  const cancelWithdrawal = useCancelEmployeeWithdrawal();
  const [view, setView] = useState<EmployeeView>("overview");
  const [amount, setAmount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const dashboard = dashboardQuery.data as EmployeePortalDashboard | undefined;
  const submitWithdrawal = (event: React.FormEvent) => {
    event.preventDefault(); setWithdrawMessage("");
    if (!destinationId) { setWithdrawMessage("Choose an active payout destination."); return; }
    if (!isPositiveDecimal(amount)) { setWithdrawMessage("Enter a positive KES amount with up to two decimal places."); return; }
    requestWithdrawal.mutate({ amount, destinationId, idempotencyKey: makeIdempotencyKey() }, {
      onSuccess: () => { setWithdrawMessage("Your withdrawal request was submitted for review."); setAmount(""); setFormOpen(false); },
      onError: (error) => setWithdrawMessage(errorText(error)),
    });
  };
  const cancelPendingWithdrawal = (id: string) => {
    if (!window.confirm("Cancel this pending request? The reserved amount will be released back to your available balance.")) return;
    cancelWithdrawal.mutate(id);
  };
  return <PortalFrame><EmployeeShell name={employee.displayName} selected={view} onSelect={setView} onLogout={onLogout}>
    <div className="ep-content">
      {view === "overview" && <>
        <div className="ep-welcome"><div><p className="ep-eyebrow">YOUR EMPLOYEE ACCOUNT</p><h2>Good to see you, {employee.displayName.split(" ")[0]}.</h2><p>A clear view of what you have earned and what is available.</p></div><span className="ep-period"><Clock3 size={15} /> Live account view</span></div>
        {withdrawMessage && <Notice tone={withdrawMessage.startsWith("Your withdrawal") ? "success" : "error"}>{withdrawMessage}</Notice>}
        {dashboardQuery.isLoading ? <LoadingBlock /> : dashboardQuery.isError ? <div className="ep-inline-error"><Notice>{errorText(dashboardQuery.error)}</Notice><button className="ep-text-button" onClick={() => void dashboardQuery.refetch()}>Retry</button></div> : dashboard ? <>
          <section className="ep-balance-card"><div className="ep-balance-copy"><p className="ep-balance-label">AVAILABLE BALANCE</p><strong>{money(dashboard.available_balance)}</strong><span>Available to request, subject to review and payout controls.</span></div><div className="ep-balance-mark"><Wallet size={27} /></div><button className="ep-button ep-button-light" onClick={() => { setFormOpen(!formOpen); setWithdrawMessage(""); }}><ArrowDownToLine size={16} /> Request withdrawal</button></section>
          {formOpen && <section className="ep-withdraw-form"><div><p className="ep-eyebrow">WITHDRAWAL REQUEST</p><h3>Choose amount and destination</h3><p>Requests are reviewed by an administrator. This does not initiate an automatic payment.</p></div><form onSubmit={submitWithdrawal}><label>Amount (KES)<input inputMode="decimal" type="text" pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0.00" /></label><label>Destination<select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} required><option value="">Select a destination</option>{destinationsQuery.data?.filter((destination) => destination.status === "active").map((destination) => <option key={destination.id} value={destination.id}>{destination.masked_label} · {destination.destination_type}</option>)}</select></label>{destinationsQuery.isError && <Notice>{errorText(destinationsQuery.error)}</Notice>}{destinationsQuery.data?.length === 0 && <p className="ep-muted">No payout destinations are linked to this account. Contact your administrator to review the available setup.</p>}<div className="ep-form-actions"><button type="button" className="ep-button ep-button-secondary" onClick={() => setFormOpen(false)}>Cancel</button><button className="ep-button ep-button-primary" disabled={requestWithdrawal.isPending || !destinationsQuery.data?.some((item) => item.status === "active")}>{requestWithdrawal.isPending ? "Submitting…" : "Submit request"}</button></div></form></section>}
          <div className="ep-metric-grid">
            <Metric label="Salary earned" value={money(dashboard.salary_earned)} icon={BriefcaseBusiness} tone="navy" />
            <Metric label="Commissions" value={money(dashboard.commissions_earned)} icon={ArrowUpRight} tone="teal" />
            <Metric label="Allowances & bonuses" value={money(addDecimals(dashboard.allowances_earned, dashboard.bonuses_earned))} icon={Banknote} tone="gold" />
            <Metric label="Deductions" value={money(dashboard.deductions)} icon={CreditCard} tone="rose" />
          </div>
          <div className="ep-summary-strip"><div><span>Total withdrawn</span><strong>{money(dashboard.total_withdrawn)}</strong></div><div><span>Withdrawn today</span><strong>{money(dashboard.withdrawn_today)}</strong></div><div><span>Pending requests</span><strong>{money(dashboard.pending_withdrawals)}</strong></div></div>
          <div className="ep-section-heading"><div><p className="ep-eyebrow">RECENT ACTIVITY</p><h3>Latest account movements</h3></div><button className="ep-text-button" onClick={() => setView("activity")}>View all <ArrowRight size={15} /></button></div>
           <ActivityTable dashboard={dashboard} onCancel={cancelPendingWithdrawal} />
        </> : <EmptyState title="Account activity is not available" text="Your account data could not be loaded. Please try again shortly." retry={() => void dashboardQuery.refetch()} />}
      </>}
       {view === "activity" && <>{dashboardQuery.isLoading ? <LoadingBlock /> : dashboardQuery.isError ? <EmptyState title="Could not load pay activity" text={errorText(dashboardQuery.error)} retry={() => void dashboardQuery.refetch()} /> : dashboard ? <><div className="ep-section-heading"><div><p className="ep-eyebrow">PAY & ACCOUNT HISTORY</p><h3>Recent activity</h3><p>Recorded account movements and withdrawal requests.</p></div></div><ActivityTable dashboard={dashboard} full onCancel={cancelPendingWithdrawal} /></> : null}</>}
      {view === "profile" && <div className="ep-account-stack"><section className="ep-profile-panel"><p className="ep-eyebrow">ACCOUNT DETAILS</p><h3>Your employee profile</h3><div className="ep-profile-grid">{[
        ["Name", employee.displayName], ["Username", employee.username], ["Employee ID", employee.id], ["Session", "Secure browser session"],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><Notice tone="info">For account access or profile corrections, contact your ISPlatty administrator.</Notice></section><DestinationChangePanel destinations={destinationsQuery.data} isLoading={destinationsQuery.isLoading} isError={destinationsQuery.isError} error={destinationsQuery.error} retry={() => void destinationsQuery.refetch()} /></div>}
    </div>
  </EmployeeShell></PortalFrame>;
}

type EmployeeDestination = NonNullable<ReturnType<typeof useEmployeeDestinations>["data"]>[number];

function DestinationChangePanel({ destinations, isLoading, isError, error, retry }: {
  destinations?: EmployeeDestination[]; isLoading: boolean; isError: boolean; error: unknown; retry: () => void;
}) {
  const requestChange = useRequestEmployeeDestinationChange();
  const [type, setType] = useState("mpesa_b2c");
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const destinationFields: Record<string, Array<{ name: string; label: string; placeholder: string; pattern?: string; hint?: string }>> = {
    bank: [
      { name: "bankName", label: "Bank name", placeholder: "Bank name" },
      { name: "branch", label: "Branch", placeholder: "Branch or location" },
      { name: "accountName", label: "Account holder name", placeholder: "Name on the account" },
      { name: "accountNumber", label: "Account number", placeholder: "Account number", pattern: "[A-Za-z0-9-]{5,30}", hint: "5–30 letters or digits" },
    ],
    mpesa_b2c: [
      { name: "phone", label: "M-Pesa phone number", placeholder: "+254 7XX XXX XXX", pattern: "(?:\\+254|254|0)(?:7|1)[0-9]{8}", hint: "Kenyan mobile number" },
    ],
    pochi: [
      { name: "phone", label: "Pochi phone number", placeholder: "+254 7XX XXX XXX", pattern: "(?:\\+254|254|0)(?:7|1)[0-9]{8}", hint: "Kenyan mobile number" },
      { name: "businessName", label: "Business or account name", placeholder: "Registered Pochi name" },
    ],
    paybill: [
      { name: "paybillNumber", label: "Paybill number", placeholder: "Paybill number", pattern: "[0-9]{5,7}", hint: "5–7 digits" },
      { name: "accountReference", label: "Account reference", placeholder: "Account or reference number" },
    ],
    till: [
      { name: "tillNumber", label: "Till number", placeholder: "Till number", pattern: "[0-9]{5,7}", hint: "5–7 digits" },
    ],
  };
  const fields = destinationFields[type] ?? [];
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const details: Record<string, string> = {};
    fields.forEach((field) => { details[field.name] = String(form.get(field.name) ?? "").trim(); });
    requestChange.mutate({ destinationType: type, destinationDetails: details }, {
      onSuccess: () => {
        setMessage("Destination change request submitted. It will remain pending until an administrator reviews it.");
        setFormOpen(false);
        formElement.reset();
      },
      onError: (reason) => setMessage(errorText(reason)),
    });
  };
  return <section className="ep-profile-panel ep-destination-panel">
    <div className="ep-section-heading"><div><p className="ep-eyebrow">PAYOUT DETAILS</p><h3>Linked destinations</h3><p>Only masked destination labels are shown here.</p></div><button className="ep-button ep-button-secondary" onClick={() => { setFormOpen(!formOpen); setMessage(""); }}>{formOpen ? "Cancel" : "Request a change"}</button></div>
    {message && <Notice tone={message.startsWith("Destination change request") ? "success" : "error"}>{message}</Notice>}
    {isLoading ? <div className="ep-skeleton ep-destination-skeleton" /> : isError ? <div className="ep-inline-error"><Notice>{errorText(error)}</Notice><button className="ep-text-button" onClick={retry}>Retry</button></div> : destinations?.length ? <div className="ep-destination-list">{destinations.map((destination) => <article key={destination.id}><span className="ep-destination-symbol"><Landmark size={16} /></span><div><b>{destination.masked_label}</b><small>{destination.destination_type.replaceAll("_", " ")}</small></div><StatusPill status={destination.status} /></article>)}</div> : <div className="ep-quiet-empty"><span><CreditCard size={17} /></span><div><b>No destinations are linked</b><small>Request a payout destination change to submit new details for review.</small></div></div>}
    {formOpen && <form className="ep-destination-form" onSubmit={submit}>
      <label>Destination type<select value={type} onChange={(event) => setType(event.target.value)}><option value="bank">Bank transfer</option><option value="mpesa_b2c">M-Pesa B2C</option><option value="pochi">Pochi</option><option value="paybill">Paybill</option><option value="till">Till</option></select></label>
      <div className={`ep-destination-fields ${fields.length > 2 ? "many" : ""}`}>{fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} required placeholder={field.placeholder} pattern={field.pattern} title={field.hint} autoComplete="off" />{field.hint && <small>{field.hint}</small>}</label>)}</div>
      <p className="ep-form-hint"><ShieldCheck size={14} /> Full details are sent securely for review and are not displayed back in this portal. A masked label and review status will be shown.</p>
      <button className="ep-button ep-button-primary" disabled={requestChange.isPending}>{requestChange.isPending ? "Submitting…" : "Submit change request"}</button>
    </form>}
  </section>;
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone: string }) {
  return <article className={`ep-metric ep-metric-${tone}`}><div className="ep-metric-top"><span>{label}</span><i><Icon size={17} /></i></div><strong>{value}</strong></article>;
}

function EmptyState({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return <div className="ep-empty"><span><FileText size={22} /></span><h3>{title}</h3><p>{text}</p>{retry && <button className="ep-button ep-button-secondary" onClick={retry}><RefreshCw size={15} /> Try again</button>}</div>;
}

function StatusPill({ status }: { status: string }) {
  const className = ["paid", "active", "approved"].includes(status) ? "good" : ["pending", "processing", "reconciliation_required"].includes(status) ? "waiting" : ["rejected", "suspended", "terminated"].includes(status) ? "bad" : "neutral";
  return <span className={`ep-status ep-status-${className}`}>{status.replaceAll("_", " ")}</span>;
}

function ActivityTable({ dashboard, full = false, onCancel }: {
  dashboard: EmployeePortalDashboard; full?: boolean; onCancel?: (id: string) => void;
}) {
  const rows = [
    ...dashboard.recent_withdrawals.map((withdrawal) => ({ id: withdrawal.id, date: withdrawal.created_at, type: "Withdrawal request", detail: withdrawal.paid_reference ? `Reference ${withdrawal.paid_reference}` : withdrawal.review_note || "Employee request", amount: `− ${money(withdrawal.amount)}`, status: withdrawal.status, canCancel: withdrawal.status === "pending" })),
    ...dashboard.recent_ledger.map((entry) => ({ id: String(entry.id), date: entry.created_at, type: entry.entry_type.replaceAll("_", " "), detail: entry.reference || "Account entry", amount: money(entry.amount), status: "recorded", canCancel: false })),
    ...dashboard.payroll_history.map((payroll) => ({ id: payroll.id, date: payroll.created_at, type: "Payroll", detail: `Salary and earnings for ${payroll.payroll_period_id}`, amount: money(payroll.net_amount), status: "recorded", canCancel: false })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, full ? 24 : 6);
  if (!rows.length) return <EmptyState title="No activity to show yet" text="Recorded account movements and withdrawal requests will appear here." />;
  return <div className="ep-table-wrap"><table className="ep-table"><thead><tr><th>Activity</th><th>Date</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.type}-${row.id}`}><td><strong>{row.type}</strong><small>{row.detail}</small></td><td>{dateTime(row.date)}</td><td className="ep-amount">{row.amount}</td><td><StatusPill status={row.status} /></td><td>{row.canCancel && onCancel ? <button className="ep-text-button" onClick={() => onCancel(row.id)}>Cancel request</button> : "—"}</td></tr>)}</tbody></table>
    <div className="ep-mobile-rows">{rows.map((row) => <article key={`mobile-${row.type}-${row.id}`}><div><strong>{row.type}</strong><small>{row.detail}</small></div><span className="ep-amount">{row.amount}</span><small>{dateTime(row.date)} · <StatusPill status={row.status} /></small>{row.canCancel && onCancel && <button className="ep-text-button" onClick={() => onCancel(row.id)}>Cancel request</button>}</article>)}</div>
  </div>;
}

export function EmployeeAdminPage() {
  return <AdminAccessGate />;
}

function AdminAccessGate() {
  const [, setLocation] = useLocation();
  const [hasAdminSession] = useState(() => isSuperAdminLoggedIn());
  if (!hasAdminSession) return <PortalFrame kind="admin"><section className="ep-unavailable ep-admin-auth-required">
    <span className="ep-unavailable-icon"><LockKeyhole size={24} /></span><p className="ep-eyebrow">SUPER ADMIN ACCESS</p>
    <h1>Sign in to manage employee finance</h1>
    <p>Employee administration is restricted to an authenticated Super Admin session. No administration data is loaded until you sign in.</p>
    <button className="ep-button ep-button-primary" onClick={() => setLocation("/super-admin/login")}>Go to Super Admin sign in <ArrowRight size={16} /></button>
  </section></PortalFrame>;
  return <PortalGate><AdminPortal /></PortalGate>;
}

function AdminPortal() {
  const [view, setView] = useState<AdminView>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"employee" | "settings" | null>(null);
  const [notice, setNotice] = useState("");
  const summary = useEmployeeAdminSummary();
  const employees = useAdminEmployees();
  const withdrawals = useAdminWithdrawals();
  const pendingDestinations = usePendingEmployeeDestinations();
  const settings = useEmployeePayoutSettings();
  const createEmployee = useCreateEmployee();
  const review = useReviewEmployeeWithdrawal();
  const reviewDestination = useReviewEmployeeDestination();
  const recordPayment = useRecordEmployeePayment();
  const saveSettings = useSaveEmployeePayoutSettings();
  const [search, setSearch] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [bankTransferConfirmed, setBankTransferConfirmed] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<EmployeePortalWithdrawal | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [createError, setCreateError] = useState("");
  const [createdInvite, setCreatedInvite] = useState("");
  const [newDestinationType, setNewDestinationType] = useState("mpesa_b2c");
  const allErrors = [summary.error, employees.error, withdrawals.error, pendingDestinations.error].filter(Boolean);
  const summaryData = summary.data?.summary;
  const menuItems: Array<{ id: AdminView; label: string; icon: typeof Wallet }> = [
    { id: "overview", label: "Overview", icon: Wallet }, { id: "employees", label: "Employees", icon: Users }, { id: "destinations", label: "Destination changes", icon: CreditCard }, { id: "withdrawals", label: "Withdrawals", icon: ArrowDownToLine }, { id: "payroll", label: "Payroll & commissions", icon: Banknote }, { id: "settings", label: "Payout controls", icon: Landmark },
  ];
  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreateError(""); setCreatedInvite("");
    const data = new FormData(event.currentTarget);
    const destinationType = String(data.get("destinationType"));
    const monthlySalary = String(data.get("monthlySalary") ?? "").trim();
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(monthlySalary)) {
      setCreateError("Enter a monthly KES salary with up to two decimal places.");
      return;
    }
    const destinationFields: Record<string, string[]> = {
      bank: ["bankName", "branch", "accountName", "accountNumber"],
      mpesa_b2c: ["phone"],
      pochi: ["phone", "businessName"],
      paybill: ["paybillNumber", "accountReference"],
      till: ["tillNumber"],
    };
    const destinationDetails = (destinationFields[destinationType] ?? []).reduce<Record<string, string>>((fields, name) => {
      fields[name] = String(data.get(name) ?? "").trim();
      return fields;
    }, {});
    createEmployee.mutate({
      employeeNumber: String(data.get("employeeNumber")), username: String(data.get("username")), displayName: String(data.get("displayName")),
      email: String(data.get("email")) || undefined, phone: String(data.get("phone")) || undefined,
      subdomain: String(data.get("subdomain")), monthlySalary, destinationType, destinationDetails,
    }, {
      onSuccess: (result) => { setCreatedInvite(fragmentInvitation(result.invitationUrl)); setNotice("Employee account created. Share the one-time invitation securely."); },
      onError: (error) => setCreateError(errorText(error)),
    });
  };
  const actOnWithdrawal = (decision: "approve" | "reject") => {
    if (!reviewTarget) return;
    review.mutate({ id: reviewTarget.id, decision, note: reviewNote || undefined }, {
      onSuccess: () => { setNotice(`Withdrawal ${decision === "approve" ? "approved" : "rejected"}.`); setReviewTarget(null); setReviewNote(""); },
      onError: (error) => setNotice(errorText(error)),
    });
  };
  const recordPaymentSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentId || !paymentReference.trim() || !bankTransferConfirmed) return;
    recordPayment.mutate({ id: paymentId, reference: paymentReference.trim() }, {
      onSuccess: () => { setNotice("External bank-transfer reference recorded."); setPaymentId(""); setPaymentReference(""); setBankTransferConfirmed(false); },
      onError: (error) => setNotice(errorText(error)),
    });
  };
  const saveSettingsSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const types = ["bank", "mpesa_b2c", "pochi", "paybill", "till"].filter((type) => data.get(type) === "on");
    const credentials: Record<string, string> = {};
    ["b2cInitiator", "b2cShortcode", "b2cSecurityCredential", "b2pochiConfiguration", "b2bShortcode", "b2bInitiator", "b2bSecurityCredential"].forEach((name) => {
      const value = String(data.get(name) || ""); if (value) credentials[name] = value;
    });
    saveSettings.mutate({
      enabled: data.get("enabled") === "on", enabledDestinationTypes: types,
      maxWithdrawal: String(data.get("maxWithdrawal")), dailyLimit: String(data.get("dailyLimit")),
      replacePassword: String(data.get("replacePassword")), credentials,
    }, {
      onSuccess: () => { setNotice("Payout request controls saved. Live disbursements remain disabled."); setDialog(null); },
      onError: (error) => setNotice(errorText(error)),
    });
  };
  const filteredEmployees = (employees.data ?? []).filter((employee) => `${employee.display_name} ${employee.username} ${employee.employee_number} ${employee.subdomain}`.toLowerCase().includes(search.toLowerCase()));
  const failText = allErrors.length ? errorText(allErrors[0]) : "";
  return <PortalFrame kind="admin"><div className="ep-admin-layout">
    <aside className={`ep-sidebar ep-admin-sidebar ${menuOpen ? "is-open" : ""}`}><div className="ep-sidebar-brand"><BrandMark /></div><div className="ep-admin-identity"><span className="ep-admin-emblem"><ShieldCheck size={18} /></span><span><b>People operations</b><small>SUPER ADMIN AREA</small></span></div><p className="ep-nav-label">EMPLOYEE FINANCE</p><nav>{menuItems.map(({ id, label, icon: Icon }) => <button key={id} className={`ep-nav-item ${view === id ? "active" : ""}`} onClick={() => { setView(id); setMenuOpen(false); }}><Icon size={17} />{label}<ChevronRight className="ep-nav-arrow" size={15} />{id === "withdrawals" && summaryData?.pending_withdrawal_count ? <i className="ep-nav-count">{summaryData.pending_withdrawal_count}</i> : null}</button>)}</nav><div className="ep-sidebar-bottom"><div className="ep-secure-card"><LockKeyhole size={16} /><span><b>Restricted access</b><small>Super Admin controls</small></span></div></div></aside>
    <section className="ep-admin-main"><header className="ep-work-header"><div className="ep-header-left"><button className="ep-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button><div><p className="ep-header-kicker">ISPLATTY · PEOPLE OPERATIONS</p><h1>{menuItems.find((item) => item.id === view)?.label}</h1></div></div><span className="ep-admin-status"><span /> Admin workspace</span></header>
      <main className="ep-content ep-admin-content">
        {notice && <div className="ep-notice-inline"><Notice tone={notice.includes("saved") || notice.includes("approved") || notice.includes("recorded") || notice.includes("created") ? "success" : "info"}>{notice}</Notice><button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={15} /></button></div>}
        {failText && <div className="ep-inline-error"><Notice>{failText}</Notice><button className="ep-text-button" onClick={() => { void summary.refetch(); void employees.refetch(); void withdrawals.refetch(); void pendingDestinations.refetch(); }}>Retry</button></div>}
        {(summary.isLoading || employees.isLoading || withdrawals.isLoading || pendingDestinations.isLoading) && !summaryData ? <LoadingBlock label="Loading employee administration" /> : <>
          {view === "overview" && <AdminOverview summary={summaryData} isError={summary.isError} onOpen={(next) => setView(next)} onCreate={() => { setCreatedInvite(""); setCreateError(""); setDialog("employee"); }} withdrawals={withdrawals.data ?? []} onReview={setReviewTarget} />}
          {view === "employees" && <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">WORKFORCE ACCOUNTS</p><h3>Employee directory</h3><p>Manage invitations and review employee account status.</p></div><button className="ep-button ep-button-primary" onClick={() => { setCreatedInvite(""); setCreateError(""); setDialog("employee"); }}><UserRound size={16} /> Add employee</button></div><div className="ep-toolbar"><label className="ep-search"><span>Search accounts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, number or subdomain" /></label><span className="ep-result-count">{filteredEmployees.length} accounts</span></div>{filteredEmployees.length ? <EmployeeTable employees={filteredEmployees} /> : <EmptyState title={search ? "No matching employees" : "No employee accounts yet"} text={search ? "Try another name, employee number or subdomain." : "Create an employee account to start managing finance portal access."} />}</section>}
          {view === "destinations" && <EmployeeDestinationReviewPanel destinations={pendingDestinations.data ?? []} isLoading={pendingDestinations.isLoading} onReview={(id, decision) => reviewDestination.mutate({ id, decision }, { onSuccess: () => setNotice(`Payout destination ${decision === "approve" ? "approved" : "rejected"}.`), onError: (error) => setNotice(errorText(error)) })} busy={reviewDestination.isPending} />}
          {view === "withdrawals" && <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">REVIEW QUEUE</p><h3>Withdrawal requests</h3><p>Approvals are not payments. Recording is for confirmed external bank transfers only.</p></div></div><WithdrawalList withdrawals={withdrawals.data ?? []} onReview={setReviewTarget} onRecord={(item) => { setPaymentId(item.id); setPaymentReference(""); setBankTransferConfirmed(false); }} /><div className="ep-manual-payment"><div><span className="ep-manual-icon"><Landmark size={19} /></span><div><h4>Record confirmed bank transfer only</h4><p>Record a reference after a bank transfer has been completed outside this portal. This does not send funds.</p></div></div><form onSubmit={recordPaymentSubmit}><input aria-label="Withdrawal ID" value={paymentId} onChange={(event) => setPaymentId(event.target.value)} placeholder="Withdrawal ID" required /><input aria-label="External bank transfer reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Bank transfer reference" required /><label className="ep-bank-confirm"><input type="checkbox" checked={bankTransferConfirmed} onChange={(event) => setBankTransferConfirmed(event.target.checked)} /> I confirm an external bank transfer is complete.</label><button className="ep-button ep-button-secondary" disabled={recordPayment.isPending || !bankTransferConfirmed}>{recordPayment.isPending ? "Recording…" : "Record bank transfer"}</button></form></div></section>}
          {view === "payroll" && <AdminPayrollSection employees={employees.data ?? []} />}
          {view === "settings" && <PayoutControlPanel settings={settings.data} isLoading={settings.isLoading} isError={settings.isError} onRetry={() => void settings.refetch()} onEdit={() => setDialog("settings")} />}
        </>}
      </main>
    </section>
    {menuOpen && <button aria-label="Close navigation" className="ep-mobile-scrim" onClick={() => setMenuOpen(false)} />}
    {dialog === "employee" && <div className="ep-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="ep-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="ep-modal-head"><div><p className="ep-eyebrow">NEW ACCOUNT</p><h2 id="create-title">Add an employee</h2></div><button className="ep-icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div>{createError && <Notice>{createError}</Notice>}{createdInvite ? <div className="ep-invite-success"><span className="ep-success-mark"><Check size={20} /></span><h3>Invitation created</h3><p>Copy and share this one-time activation link securely. It expires at {dateTime(createEmployee.data?.invitationExpiresAt)}.</p><input readOnly value={createdInvite} onFocus={(event) => event.currentTarget.select()} aria-label="One-time invitation link" /><button className="ep-button ep-button-secondary ep-button-wide" onClick={() => void navigator.clipboard?.writeText(createdInvite)}>Copy invitation link</button><Notice tone="info">Employee domains require DNS and a valid TLS certificate before invitation links are usable. This host may not be configured yet.</Notice><button className="ep-text-button" onClick={() => { setDialog(null); setView("employees"); }}>Done <ArrowRight size={15} /></button></div> : <form className="ep-form ep-modal-form" onSubmit={handleCreate}><div className="ep-form-two"><label>Employee number<input name="employeeNumber" required placeholder="e.g. IS-1042" /></label><label>Username<input name="username" required placeholder="employee.username" /></label></div><label>Display name<input name="displayName" required placeholder="Employee name" /></label><div className="ep-form-two"><label>Email <small>Optional</small><input name="email" type="email" placeholder="name@company.com" /></label><label>Phone <small>Optional</small><input name="phone" type="tel" placeholder="+254…" /></label></div><div className="ep-form-two"><label>Employee subdomain<input name="subdomain" required pattern="[a-z0-9-]+" title="Use lowercase letters, numbers and hyphens." placeholder="name" /></label><label>Monthly salary (KES)<input name="monthlySalary" required inputMode="decimal" type="text" pattern="[0-9]+([.][0-9]{1,6})?" placeholder="0.00" /></label></div><RegistrationDestinationFields type={newDestinationType} onTypeChange={setNewDestinationType} /><p className="ep-form-hint"><ShieldCheck size={15} /> Destination details are sent to the secure API and are not shown again. Invitation links use a one-time token in the URL fragment.</p><div className="ep-form-actions"><button type="button" className="ep-button ep-button-secondary" onClick={() => setDialog(null)}>Cancel</button><button className="ep-button ep-button-primary" disabled={createEmployee.isPending}>{createEmployee.isPending ? "Creating…" : "Create account"}</button></div></form>}</section></div>}
    {dialog === "settings" && <SettingsDialog controls={settings.data?.controls ?? null} credentials={settings.data?.credentials} isPending={saveSettings.isPending} onClose={() => setDialog(null)} onSubmit={saveSettingsSubmit} />}
    {reviewTarget && <div className="ep-modal-backdrop"><section className="ep-modal ep-review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="ep-modal-head"><div><p className="ep-eyebrow">WITHDRAWAL REVIEW</p><h2 id="review-title">{money(reviewTarget.amount)}</h2></div><button className="ep-icon-button" onClick={() => setReviewTarget(null)} aria-label="Close"><X size={18} /></button></div><p className="ep-modal-description">Select whether to approve or reject this request. Approval does not send funds.</p><label className="ep-field-label">Review note <small>Optional</small><textarea rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Add context for the employee" /></label><div className="ep-form-actions"><button className="ep-button ep-button-secondary" onClick={() => setReviewTarget(null)}>Cancel</button><button className="ep-button ep-button-danger" disabled={review.isPending} onClick={() => actOnWithdrawal("reject")}>Reject</button><button className="ep-button ep-button-primary" disabled={review.isPending} onClick={() => actOnWithdrawal("approve")}>{review.isPending ? "Saving…" : "Approve request"}</button></div></section></div>}
  </div></PortalFrame>;
}

function AdminOverview({ summary, isError, onOpen, onCreate, withdrawals, onReview }: {
  summary?: { employee_count: number; active_employee_count: number; pending_withdrawal_count: number; total_withdrawn: string; withdrawn_today: string };
  isError: boolean; onOpen: (view: AdminView) => void; onCreate: () => void; withdrawals: EmployeePortalWithdrawal[]; onReview: (item: EmployeePortalWithdrawal) => void;
}) {
  if (isError) return <EmptyState title="Admin summary unavailable" text="The administration API did not return its summary. Check your Super Admin access and retry." />;
  const pending = withdrawals.filter((item) => item.status === "pending");
  return <><div className="ep-admin-welcome"><div><p className="ep-eyebrow">FINANCE OPERATIONS</p><h2>Employee accounts, at a glance.</h2><p>Review workforce access and keep withdrawal decisions traceable.</p></div><button className="ep-button ep-button-primary" onClick={onCreate}><UserRound size={16} /> Add employee</button></div>
    <div className="ep-admin-stat-grid"><AdminStat label="Employee accounts" value={summary?.employee_count} detail={`${summary?.active_employee_count ?? "—"} active`} icon={Users} /><AdminStat label="Waiting for review" value={summary?.pending_withdrawal_count} detail="Withdrawal requests" icon={Clock3} urgent={(summary?.pending_withdrawal_count ?? 0) > 0} /><AdminStat label="Total withdrawn" value={money(summary?.total_withdrawn)} detail="Recorded as paid" icon={ArrowDownToLine} /><AdminStat label="Withdrawn today" value={money(summary?.withdrawn_today)} detail="Recorded today" icon={Banknote} /></div>
    <div className="ep-admin-overview-grid"><section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">NEEDS ATTENTION</p><h3>Pending withdrawals</h3></div><button className="ep-text-button" onClick={() => onOpen("withdrawals")}>Review queue <ArrowRight size={15} /></button></div>{pending.length ? <WithdrawalList withdrawals={pending.slice(0, 4)} onReview={onReview} onRecord={() => undefined} compact /> : <div className="ep-quiet-empty"><span><Check size={18} /></span><div><b>Nothing waiting for review</b><small>New employee requests will appear here.</small></div></div>}</section>
      <section className="ep-admin-side-panel"><span className="ep-admin-side-icon"><ShieldCheck size={20} /></span><p className="ep-eyebrow">PAYOUT SAFETY</p><h3>Request controls are not disbursement controls.</h3><p>Live disbursements are currently disabled. An approved request still needs an external payment and a recorded reference.</p><button className="ep-text-button" onClick={() => onOpen("settings")}>View payout controls <ArrowRight size={15} /></button></section></div>
  </>;
}

function AdminStat({ label, value, detail, icon: Icon, urgent = false }: { label: string; value?: string | number; detail: string; icon: typeof Wallet; urgent?: boolean }) {
  return <article className={`ep-admin-stat ${urgent ? "urgent" : ""}`}><div><span>{label}</span><i><Icon size={17} /></i></div><strong>{value ?? "—"}</strong><small>{detail}</small></article>;
}

type PayrollPanel = "commissions" | "compensation" | "salary" | "payroll";
type CompensationKind = "commission" | "bonus" | "allowance" | "deduction";

function AdminPayrollSection({ employees }: { employees: EmployeePortalEmployee[] }) {
  const [panel, setPanel] = useState<PayrollPanel>("commissions");
  const [message, setMessage] = useState("");
  const [salaryEmployeeId, setSalaryEmployeeId] = useState("");
  const [payrollMonth, setPayrollMonth] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const commissionRules = useEmployeeCommissionRules();
  const compensation = useEmployeeCompensation();
  const createRule = useCreateEmployeeCommissionRule();
  const createCompensation = useCreateEmployeeCompensation();
  const reviewCompensation = useReviewEmployeeCompensation();
  const salaryHistory = useEmployeeSalaryHistory(salaryEmployeeId);
  const updateSalary = useUpdateEmployeeSalary();
  const previewPayroll = usePreviewEmployeePayroll();
  const postPayroll = usePostEmployeePayroll();
  const tabs: Array<{ id: PayrollPanel; label: string }> = [
    { id: "commissions", label: "Commission rules" },
    { id: "compensation", label: "Compensation" },
    { id: "salary", label: "Salary history" },
    { id: "payroll", label: "Monthly payroll" },
  ];
  const actionError = [commissionRules.error, compensation.error, salaryHistory.error].find(Boolean);
  const notifyError = (error: unknown) => setMessage(errorText(error));
  const handleRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const rate = String(values.get("rate") ?? "").trim();
    const amountPerUnit = String(values.get("amountPerUnit") ?? "").trim();
    if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(rate)) { setMessage("Enter a commission rate up to four decimal places."); return; }
    if (amountPerUnit && !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountPerUnit)) { setMessage("Enter a per-unit KES amount with up to two decimals."); return; }
    createRule.mutate({
      employeeId: String(values.get("employeeId") || "") || null,
      ruleName: String(values.get("ruleName") ?? "").trim(),
      rate,
      amountPerUnit: amountPerUnit || null,
    }, {
      onSuccess: () => { setMessage("Commission rule created."); form.reset(); },
      onError: notifyError,
    });
  };
  const handleCompensation = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = String(values.get("amount") ?? "").trim();
    const start = String(values.get("periodStart") ?? "");
    const end = String(values.get("periodEnd") ?? "");
    if (!isPositiveDecimal(amount)) { setMessage("Enter a positive compensation amount as an exact decimal string."); return; }
    if (start > end) { setMessage("The period end must be on or after the start date."); return; }
    createCompensation.mutate({
      employeeId: String(values.get("employeeId") ?? ""),
      componentType: String(values.get("componentType")) as CompensationKind,
      amount,
      periodStart: start,
      periodEnd: end,
      description: String(values.get("description") ?? "").trim(),
      idempotencyKey: makeIdempotencyKey(),
    }, {
      onSuccess: () => { setMessage("Compensation item created and awaiting review."); form.reset(); },
      onError: notifyError,
    });
  };
  const handleSalary = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const monthlySalary = String(values.get("monthlySalary") ?? "").trim();
    if (!salaryEmployeeId) { setMessage("Select an employee first."); return; }
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(monthlySalary)) { setMessage("Enter the salary as an exact KES amount with up to two decimals."); return; }
    const effectiveMonth = String(values.get("effectiveMonth") ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) { setMessage("Select a valid effective month."); return; }
    updateSalary.mutate({
      employeeId: salaryEmployeeId,
      monthlySalary,
      effectiveFrom: `${effectiveMonth}-01`,
    }, {
      onSuccess: () => { setMessage("Salary update recorded."); void salaryHistory.refetch(); },
      onError: notifyError,
    });
  };
  const getPeriod = (month: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, monthNumber] = month.split("-").map((part) => parseInt(part, 10));
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
  };
  const handlePreview = () => {
    setMessage("");
    const period = getPeriod(payrollMonth);
    if (!period) { setMessage("Select a valid payroll month."); return; }
    setConfirmation("");
    previewPayroll.mutate({ periodStart: period.start, periodEnd: period.end }, { onError: notifyError });
  };
  const handlePost = () => {
    const period = getPeriod(payrollMonth);
    if (!period || confirmation !== `POST ${payrollMonth}` || !previewPayroll.data?.preview) return;
    postPayroll.mutate({ periodStart: period.start, periodEnd: period.end, confirmation }, {
      onSuccess: (result) => { setMessage(`Payroll posted: ${result.payroll.record_count} employee records created.`); setConfirmation(""); },
      onError: notifyError,
    });
  };
  return <section className="ep-payroll-section">
    <div className="ep-payroll-heading"><div><p className="ep-eyebrow">PEOPLE OPERATIONS</p><h2>Payroll & commissions</h2><p>Compensation records, salary changes and monthly payroll posting.</p></div><span className="ep-payroll-private"><ShieldCheck size={15} /> Super Admin only</span></div>
    <div className="ep-payroll-tabs" role="tablist" aria-label="Payroll sections">{tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={panel === tab.id} className={panel === tab.id ? "active" : ""} onClick={() => { setPanel(tab.id); setMessage(""); }}>{tab.label}</button>)}</div>
    {message && <div className="ep-notice-inline"><Notice tone={message.includes("created") || message.includes("recorded") || message.startsWith("Payroll posted") ? "success" : "info"}>{message}</Notice><button onClick={() => setMessage("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {actionError && <div className="ep-inline-error"><Notice>{errorText(actionError)}</Notice><button className="ep-text-button" onClick={() => { void commissionRules.refetch(); void compensation.refetch(); void salaryHistory.refetch(); }}>Retry</button></div>}
    {panel === "commissions" && <div className="ep-payroll-grid">
      <section className="ep-admin-panel"><p className="ep-eyebrow">NEW RULE</p><h3>Create a commission rule</h3><p className="ep-panel-description">Rules can apply to one employee or the whole team.</p><form className="ep-form ep-payroll-form" onSubmit={handleRule}>
        <label>Rule name<input name="ruleName" required maxLength={100} placeholder="Sales commission" /></label>
        <label>Employee scope<select name="employeeId" defaultValue=""><option value="">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name} · {employee.employee_number}</option>)}</select></label>
        <div className="ep-form-two"><label>Rate<input name="rate" inputMode="decimal" type="text" required pattern="(?:0|[1-9][0-9]{0,2})(?:\\.[0-9]{1,4})?" placeholder="e.g. 0.05" /></label><label>Amount per unit <small>Optional, KES</small><input name="amountPerUnit" inputMode="decimal" type="text" pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" placeholder="Leave blank if unused" /></label></div>
        <p className="ep-form-hint">Rates and amounts remain exact decimal strings. No automatic recalculation is performed here.</p>
        <button className="ep-button ep-button-primary" disabled={createRule.isPending}>{createRule.isPending ? "Saving…" : "Create rule"}</button>
      </form></section>
      <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">CONFIGURED RULES</p><h3>Commission rules</h3></div><button className="ep-icon-button" onClick={() => void commissionRules.refetch()} aria-label="Refresh rules"><RefreshCw size={15} /></button></div>
        {commissionRules.isLoading ? <LoadingBlock label="Loading commission rules" /> : commissionRules.data?.length ? <div className="ep-commission-list">{commissionRules.data.map((rule) => {
          const employee = employees.find((item) => item.id === rule.employee_id);
          return <article key={rule.id}><div><b>{rule.rule_name}</b><small>{employee ? employee.display_name : "All employees"} · {rule.amount_per_unit ? `${money(rule.amount_per_unit)} per unit` : `Rate ${rule.rate}`}</small></div><StatusPill status={rule.active ? "active" : "inactive"} /></article>;
        })}</div> : <EmptyState title="No commission rules yet" text="Create a commission rule to define the current compensation basis." />}
      </section>
    </div>}
    {panel === "compensation" && <div className="ep-payroll-grid">
      <section className="ep-admin-panel"><p className="ep-eyebrow">COMPENSATION ENTRY</p><h3>Add an earnings or deduction item</h3><form className="ep-form ep-payroll-form" onSubmit={handleCompensation}>
        <label>Employee<select name="employeeId" required defaultValue=""><option value="" disabled>Select an employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name} · {employee.employee_number}</option>)}</select></label>
        <div className="ep-form-two"><label>Type<select name="componentType"><option value="commission">Commission</option><option value="bonus">Bonus</option><option value="allowance">Allowance</option><option value="deduction">Deduction</option></select></label><label>Amount (KES)<input name="amount" inputMode="decimal" type="text" required pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" placeholder="0.00" /></label></div>
        <div className="ep-form-two"><label>Period start<input name="periodStart" type="date" required /></label><label>Period end<input name="periodEnd" type="date" required /></label></div>
        <label>Description<input name="description" maxLength={160} required placeholder="Reason or earning context" /></label>
        <button className="ep-button ep-button-primary" disabled={createCompensation.isPending}>{createCompensation.isPending ? "Creating…" : "Create pending item"}</button>
      </form></section>
      <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">REVIEW WORKFLOW</p><h3>Pending & approved items</h3><p>Only pending items can be approved or rejected.</p></div><button className="ep-icon-button" onClick={() => void compensation.refetch()} aria-label="Refresh compensation"><RefreshCw size={15} /></button></div>
        {compensation.isLoading ? <LoadingBlock label="Loading compensation items" /> : compensation.data?.length ? <CompensationList items={compensation.data} employeeList={employees} onReview={(item, decision) => reviewCompensation.mutate({ id: item.id, decision }, { onSuccess: () => setMessage(`Compensation item ${decision === "approve" ? "approved" : "rejected"}.`), onError: notifyError })} busy={reviewCompensation.isPending} /> : <EmptyState title="No compensation entries" text="Commission, bonus, allowance and deduction records will appear here." />}
      </section>
    </div>}
    {panel === "salary" && <div className="ep-payroll-grid salary-grid">
      <section className="ep-admin-panel"><p className="ep-eyebrow">SALARY CHANGE</p><h3>Update fixed monthly salary</h3><form className="ep-form ep-payroll-form" onSubmit={handleSalary}>
        <label>Employee<select required value={salaryEmployeeId} onChange={(event) => setSalaryEmployeeId(event.target.value)}><option value="">Select an employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name} · {employee.employee_number}</option>)}</select></label>
        <label>New monthly salary (KES)<input name="monthlySalary" inputMode="decimal" type="text" required pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" placeholder="0.00" /></label>
        <label>Effective from<input name="effectiveMonth" type="month" required /></label>
        <p className="ep-form-hint">Salary changes start on the first day of the selected month. Prior history remains visible.</p>
        <button className="ep-button ep-button-primary" disabled={updateSalary.isPending || !salaryEmployeeId}>{updateSalary.isPending ? "Saving…" : "Record salary update"}</button>
      </form></section>
      <section className="ep-admin-panel"><div className="ep-section-heading"><div><p className="ep-eyebrow">SALARY AUDIT</p><h3>Employee salary history</h3></div></div>
        {!salaryEmployeeId ? <EmptyState title="Choose an employee" text="Select an employee to view their effective salary history." /> : salaryHistory.isLoading ? <LoadingBlock label="Loading salary history" /> : salaryHistory.data?.length ? <div className="ep-salary-history">{salaryHistory.data.map((row) => <article key={row.id}><div><b>{money(row.monthly_salary)} <span>/ month</span></b><small>Effective from {dateTime(row.effective_from)}</small></div><div className="ep-salary-history-meta"><StatusPill status={row.effective_to ? "ended" : "current"} /><small>{row.effective_to ? `Through ${dateTime(row.effective_to)}` : "Current record"}</small></div></article>)}</div> : <EmptyState title="No salary history returned" text="No salary history is available for this employee." retry={() => void salaryHistory.refetch()} />}
      </section>
    </div>}
    {panel === "payroll" && <section className="ep-admin-panel ep-monthly-payroll"><div className="ep-section-heading"><div><p className="ep-eyebrow">MONTH-END WORKFLOW</p><h3>Preview and post monthly payroll</h3><p>Posting creates internal payroll records only. It does not initiate payments.</p></div></div>
      <div className="ep-payroll-month-select"><label>Payroll month<input type="month" value={payrollMonth} onChange={(event) => { setPayrollMonth(event.target.value); previewPayroll.reset(); setConfirmation(""); }} /></label><button className="ep-button ep-button-primary" onClick={handlePreview} disabled={previewPayroll.isPending || !payrollMonth}>{previewPayroll.isPending ? "Building preview…" : "Preview payroll"}</button></div>
      {previewPayroll.isError && <Notice>{errorText(previewPayroll.error)}</Notice>}
      {previewPayroll.data?.preview && <div className="ep-payroll-preview"><div className="ep-preview-banner"><span><FileText size={18} /></span><div><b>Preview ready · {dateTime(previewPayroll.data.preview.period_start)} – {dateTime(previewPayroll.data.preview.period_end)}</b><small>{previewPayroll.data.preview.employee_count} employee records in this preview. Review values before posting.</small></div></div>
        <div className="ep-preview-totals">{Object.entries(previewPayroll.data.preview.totals).map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ")}</span><b>{money(value)}</b></div>)}</div>
        <div className="ep-table-wrap"><table className="ep-table ep-preview-table"><thead><tr><th>Employee</th><th>Salary</th><th>Commissions</th><th>Bonuses</th><th>Allowances</th><th>Deductions</th><th>Net amount</th></tr></thead><tbody>{previewPayroll.data.preview.employees.map((row, index) => <tr key={`${row.employee_id ?? row.employee_number ?? "employee"}-${index}`}><td><strong>{row.display_name ?? row.employee_name ?? "Employee"}</strong><small>{row.employee_number ?? row.username ?? ""}</small></td><td>{money(row.salary)}</td><td>{money(row.commissions)}</td><td>{money(row.bonuses)}</td><td>{money(row.allowances)}</td><td>{money(row.deductions)}</td><td className="ep-amount">{money(row.net_amount)}</td></tr>)}</tbody></table></div>
        <div className="ep-post-confirm"><label>Type <b>POST {payrollMonth}</b> to confirm posting<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder={`POST ${payrollMonth}`} /></label><button className="ep-button ep-button-primary" disabled={postPayroll.isPending || confirmation !== `POST ${payrollMonth}`} onClick={handlePost}>{postPayroll.isPending ? "Posting…" : `Post ${payrollMonth} payroll`}</button></div>
      </div>}
    </section>}
  </section>;
}

function CompensationList({ items, employeeList, onReview, busy }: {
  items: EmployeeCompensationItem[]; employeeList: EmployeePortalEmployee[]; onReview: (item: EmployeeCompensationItem, decision: "approve" | "reject") => void; busy: boolean;
}) {
  const nameById = new Map(employeeList.map((employee) => [employee.id, employee.display_name]));
  const sorted = [...items].sort((left, right) => left.status === "pending" && right.status !== "pending" ? -1 : 0);
  return <div className="ep-comp-list">{sorted.map((item) => <article key={item.id}><div className="ep-comp-copy"><span className={`ep-comp-kind kind-${item.component_type}`}>{item.component_type}</span><b>{nameById.get(item.employee_id) ?? "Employee"}</b><small>{item.description} · {dateTime(item.period_start)} – {dateTime(item.period_end)}</small></div><strong className="ep-amount">{money(item.amount)}</strong><StatusPill status={item.status} />{item.status === "pending" && <div className="ep-comp-actions"><button className="ep-button ep-button-secondary ep-small-button" disabled={busy} onClick={() => onReview(item, "reject")}>Reject</button><button className="ep-button ep-button-primary ep-small-button" disabled={busy} onClick={() => onReview(item, "approve")}>Approve</button></div>}</article>)}</div>;
}

function RegistrationDestinationFields({ type, onTypeChange }: { type: string; onTypeChange: (type: string) => void }) {
  const details: Record<string, Array<{ name: string; label: string; placeholder: string; pattern?: string; title?: string }>> = {
    bank: [
      { name: "bankName", label: "Bank name", placeholder: "Bank name" },
      { name: "branch", label: "Bank branch", placeholder: "Branch or location" },
      { name: "accountName", label: "Account holder name", placeholder: "Name on account" },
      { name: "accountNumber", label: "Account number", placeholder: "Account number", pattern: "[A-Za-z0-9-]{5,30}", title: "Enter 5–30 letters, digits or hyphens." },
    ],
    mpesa_b2c: [{ name: "phone", label: "M-Pesa phone number", placeholder: "+254 7XX XXX XXX", pattern: "(?:\\+254|254|0)(?:7|1)[0-9]{8}", title: "Enter a valid Kenyan mobile number." }],
    pochi: [
      { name: "phone", label: "Pochi phone number", placeholder: "+254 7XX XXX XXX", pattern: "(?:\\+254|254|0)(?:7|1)[0-9]{8}", title: "Enter a valid Kenyan mobile number." },
      { name: "businessName", label: "Business or account name", placeholder: "Registered Pochi name" },
    ],
    paybill: [
      { name: "paybillNumber", label: "Paybill number", placeholder: "5–7 digits", pattern: "[0-9]{5,7}", title: "Enter a 5–7 digit Paybill number." },
      { name: "accountReference", label: "Account reference", placeholder: "Account number or reference" },
    ],
    till: [{ name: "tillNumber", label: "Till number", placeholder: "5–7 digits", pattern: "[0-9]{5,7}", title: "Enter a 5–7 digit Till number." }],
  };
  return <div className="ep-registration-destination"><label>Initial payout destination<select name="destinationType" value={type} onChange={(event) => onTypeChange(event.target.value)}><option value="bank">Bank transfer</option><option value="mpesa_b2c">M-Pesa B2C</option><option value="pochi">Pochi</option><option value="paybill">Paybill</option><option value="till">Till</option></select></label><div className={`ep-registration-fields ${details[type]?.length > 2 ? "many" : ""}`}>{(details[type] ?? []).map((field) => <label key={field.name}>{field.label}<input name={field.name} required pattern={field.pattern} title={field.title} autoComplete="off" placeholder={field.placeholder} /></label>)}</div></div>;
}

function EmployeeTable({ employees }: { employees: EmployeePortalEmployee[] }) {
  return <div className="ep-table-wrap"><table className="ep-table ep-admin-table"><thead><tr><th>Employee</th><th>Account</th><th>Subdomain</th><th>Monthly salary</th><th>Status</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.display_name}</strong><small>{employee.employee_number}</small></td><td>{employee.username}<small>{employee.email || employee.phone || "No contact details"}</small></td><td className="ep-mono">{employee.subdomain}.employees.isplatty.com</td><td className="ep-amount">{money(employee.fixed_monthly_salary)}</td><td><StatusPill status={employee.status} /></td></tr>)}</tbody></table><div className="ep-mobile-rows">{employees.map((employee) => <article key={`mobile-${employee.id}`}><div><strong>{employee.display_name}</strong><small>{employee.employee_number} · {employee.username}</small></div><StatusPill status={employee.status} /><small>{employee.subdomain}.employees.isplatty.com · {money(employee.fixed_monthly_salary)}/month</small></article>)}</div></div>;
}

type PendingDestination = NonNullable<ReturnType<typeof usePendingEmployeeDestinations>["data"]>[number];

function EmployeeDestinationReviewPanel({ destinations, isLoading, onReview, busy }: {
  destinations: PendingDestination[]; isLoading: boolean;
  onReview: (id: string, decision: "approve" | "reject") => void; busy: boolean;
}) {
  return <section className="ep-admin-panel">
    <div className="ep-section-heading"><div><p className="ep-eyebrow">EMPLOYEE PAYOUT DETAILS</p><h3>Destination change requests</h3><p>Approving a request replaces the employee’s currently active destination.</p></div></div>
    {isLoading ? <LoadingBlock label="Loading payout destination requests" /> : destinations.length ? <div className="ep-destination-review-list">{destinations.map((item) => <article key={item.id}>
      <div><b>{item.destination_type.replaceAll("_", " ")} · {item.masked_label}</b><small>Employee record {item.employee_id.slice(0, 12)} · submitted {dateTime(item.created_at)}</small></div>
      <div className="ep-comp-actions"><button className="ep-button ep-button-danger ep-small-button" disabled={busy} onClick={() => onReview(item.id, "reject")}>Reject</button><button className="ep-button ep-button-primary ep-small-button" disabled={busy} onClick={() => onReview(item.id, "approve")}>Approve destination</button></div>
    </article>)}</div> : <EmptyState title="No destination requests" text="Employee payout changes will appear here for administrator review." />}
  </section>;
}

function WithdrawalList({ withdrawals, onReview, onRecord, compact = false }: {
  withdrawals: EmployeePortalWithdrawal[]; onReview: (item: EmployeePortalWithdrawal) => void; onRecord: (item: EmployeePortalWithdrawal) => void; compact?: boolean;
}) {
  if (!withdrawals.length) return <div className="ep-quiet-empty"><span><FileText size={18} /></span><div><b>No withdrawal requests</b><small>Requests appear here when submitted by employees.</small></div></div>;
  return <div className="ep-withdrawal-list">{withdrawals.map((item) => <article className="ep-withdrawal-row" key={item.id}><div className="ep-withdrawal-main"><span className="ep-withdrawal-icon"><ArrowDownToLine size={17} /></span><div><b>{money(item.amount)}</b><small>Request {item.id.slice(0, 10)} · {dateTime(item.created_at)}</small><small>{item.destination?.masked_label ?? "Payout destination"} · {item.destination?.destination_type?.replaceAll("_", " ") ?? "type unavailable"}</small>{item.review_note && <small>Note: {item.review_note}</small>}</div></div><StatusPill status={item.status} /><div className="ep-withdrawal-actions">{item.status === "pending" && <button className="ep-button ep-button-secondary ep-small-button" onClick={() => onReview(item)}>Review</button>}{!compact && ["approved", "processing", "reconciliation_required"].includes(item.status) && item.destination?.destination_type === "bank" && <button className="ep-button ep-button-secondary ep-small-button" onClick={() => onRecord(item)}>Record bank transfer</button>}{!compact && ["approved", "processing", "reconciliation_required"].includes(item.status) && item.destination?.destination_type !== "bank" && <small>Provider confirmation is required; live payouts are disabled.</small>}</div></article>)}</div>;
}

function PayoutControlPanel({ settings, isLoading, isError, onRetry, onEdit }: {
  settings?: ReturnType<typeof useEmployeePayoutSettings>["data"]; isLoading: boolean; isError: boolean; onRetry: () => void; onEdit: () => void;
}) {
  if (isLoading) return <LoadingBlock label="Loading payout settings" />;
  if (isError || !settings) return <EmptyState title="Payout controls are unavailable" text="No payout configuration has been returned. Credentials are never displayed here." retry={onRetry} />;
  const controls = settings.controls;
  const credentialLabels: Array<[string, string]> = [
    ["Shared Daraja OAuth credentials", settings.credentials.hasSharedDarajaOAuthCredentials ? "Configured" : "Not configured"],
    ["B2C shortcode", settings.credentials.hasB2cShortcode ? "Configured" : "Not configured"],
    ["B2C initiator", settings.credentials.hasB2cInitiator ? "Configured" : "Not configured"],
    ["B2C security credential", settings.credentials.hasB2cSecurityCredential ? "Configured" : "Not configured"],
    ["B2Pochi configuration", settings.credentials.hasB2pochiConfiguration ? "Configured" : "Not configured"],
    ["B2B shortcode", settings.credentials.hasB2bShortcode ? "Configured" : "Not configured"],
    ["B2B initiator", settings.credentials.hasB2bInitiator ? "Configured" : "Not configured"],
    ["B2B security credential", settings.credentials.hasB2bSecurityCredential ? "Configured" : "Not configured"],
  ];
  return <><div className="ep-settings-intro"><div><p className="ep-eyebrow">ADMINISTRATOR CONTROLS</p><h2>Withdrawal request rules</h2><p>These settings limit requests. They do not enable automatic payouts.</p></div><button className="ep-button ep-button-primary" onClick={onEdit}>Edit controls</button></div>
    <div className="ep-live-banner"><span><CircleAlert size={19} /></span><div><b>Live disbursements are disabled</b><p>Payments are not sent automatically by this portal. An administrator must confirm an external payment before recording its reference.</p></div></div>
    <div className="ep-settings-grid"><section className="ep-admin-panel"><p className="ep-eyebrow">REQUEST LIMITS</p><h3>Employee withdrawal rules</h3>{controls ? <div className="ep-settings-list"><div><span>Requests enabled</span><StatusPill status={controls.enabled ? "active" : "disabled"} /></div><div><span>Enabled destinations</span><strong>{controls.enabled_destination_types.length ? controls.enabled_destination_types.join(", ") : "None"}</strong></div><div><span>Maximum per request</span><strong>{money(controls.max_withdrawal)}</strong></div><div><span>Daily limit</span><strong>{money(controls.daily_limit)}</strong></div></div> : <div className="ep-quiet-empty"><div><b>No payout controls returned</b><small>Saved settings are not available yet.</small></div></div>}</section>
      <section className="ep-admin-panel"><p className="ep-eyebrow">SECRET PRESENCE ONLY</p><h3>Provider configuration</h3><div className="ep-settings-list">{credentialLabels.map(([label, value]) => <div key={label}><span>{label}</span><span className={`ep-presence ${value === "Configured" ? "is-set" : ""}`}><i />{value}</span></div>)}</div><p className="ep-form-hint"><LockKeyhole size={14} /> Secret values cannot be read back from this screen.</p></section></div>
  </>;
}

function SettingsDialog({ controls, credentials, isPending, onClose, onSubmit }: {
  controls: { enabled: boolean; enabled_destination_types: string[]; max_withdrawal: string; daily_limit: string } | null;
  credentials?: {
    hasSharedDarajaOAuthCredentials: boolean; hasB2cInitiator: boolean; hasB2cShortcode: boolean;
    hasB2cSecurityCredential: boolean; hasB2pochiConfiguration: boolean; hasB2bShortcode: boolean;
    hasB2bInitiator: boolean; hasB2bSecurityCredential: boolean; liveDisbursementsEnabled: false;
  };
  isPending: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="ep-modal-backdrop"><section className="ep-modal ep-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="ep-modal-head"><div><p className="ep-eyebrow">REQUEST CONFIGURATION</p><h2 id="settings-title">Payout controls</h2></div><button className="ep-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="ep-live-banner compact"><span><CircleAlert size={18} /></span><div><b>Live payouts stay disabled</b><p>Saving controls cannot send money automatically.</p></div></div><form className="ep-form ep-modal-form" onSubmit={onSubmit}>
    <label className="ep-toggle-row"><span><b>Allow withdrawal requests</b><small>Employees may submit requests for admin review</small></span><input name="enabled" type="checkbox" defaultChecked={controls?.enabled ?? false} /></label>
     <div className="ep-form-two"><label>Maximum per request (KES)<input name="maxWithdrawal" type="text" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" defaultValue={controls?.max_withdrawal ?? ""} required /></label><label>Daily limit (KES)<input name="dailyLimit" type="text" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?" defaultValue={controls?.daily_limit ?? ""} required /></label></div>
     <fieldset className="ep-checkboxes"><legend>Accepted destination types</legend>
       <label><input type="checkbox" name="bank" defaultChecked={controls?.enabled_destination_types.includes("bank")} /> Bank transfer</label>
       <label><input type="checkbox" name="mpesa_b2c" defaultChecked={controls?.enabled_destination_types.includes("mpesa_b2c")} /> M-Pesa B2C</label>
       <label><input type="checkbox" name="pochi" defaultChecked={controls?.enabled_destination_types.includes("pochi")} /> Pochi la Biashara</label>
       <label><input type="checkbox" name="paybill" defaultChecked={controls?.enabled_destination_types.includes("paybill")} /> Paybill</label>
       <label><input type="checkbox" name="till" defaultChecked={controls?.enabled_destination_types.includes("till")} /> Till</label>
     </fieldset>
     <div className="ep-form-hint"><LockKeyhole size={14} /> Shared C2B/STK OAuth settings are reused for API authentication and cannot be changed here. These separate payout credentials are stored encrypted. Saving them does not enable live payouts.</div>
     <details className="ep-credential-details"><summary>Configure provider credentials <small>Leave blank to keep the stored value</small></summary><div className="ep-credential-fields">{[
       ["b2cInitiator", "B2C initiator", credentials?.hasB2cInitiator], ["b2cShortcode", "B2C shortcode", credentials?.hasB2cShortcode], ["b2cSecurityCredential", "B2C security credential", credentials?.hasB2cSecurityCredential], ["b2bShortcode", "B2B shortcode", credentials?.hasB2bShortcode], ["b2bInitiator", "B2B initiator", credentials?.hasB2bInitiator], ["b2bSecurityCredential", "B2B security credential", credentials?.hasB2bSecurityCredential], ["b2pochiConfiguration", "B2Pochi configuration", credentials?.hasB2pochiConfiguration],
    ].map(([name, label, hasValue]) => <label key={String(name)}>{String(label)} <small>{hasValue ? "Currently configured" : "Not configured"}</small><input name={String(name)} type="password" autoComplete="new-password" placeholder="Leave blank to keep existing value" /></label>)}</div></details>
    <label>Confirm with your Super Admin password<input name="replacePassword" type="password" autoComplete="current-password" required /></label>
    <div className="ep-form-actions"><button type="button" className="ep-button ep-button-secondary" onClick={onClose}>Cancel</button><button className="ep-button ep-button-primary" disabled={isPending}>{isPending ? "Saving…" : "Save request controls"}</button></div>
  </form></section></div>;
}
