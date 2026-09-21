import { useMemo, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, Network, Plug, ShieldCheck, UserRound } from "lucide-react";
import { useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { setAdminAuth } from "@/lib/supabase";

type RegistrationRole = "isp_admin" | "reseller";

const ROLE_OPTIONS: Array<{
  value: RegistrationRole;
  icon: typeof Network;
  title: string;
  description: string;
}> = [
  {
    value: "isp_admin",
    icon: Network,
    title: "ISP Network Operator",
    description: "Run routers, billing, customer access, and network operations.",
  },
  {
    value: "reseller",
    icon: Plug,
    title: "Sub-Agent / Reseller",
    description: "Manage your own merchant workspace and voucher operations.",
  },
];

function sanitizeSubdomainPrefix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 63);
}

export default function UnifiedRegister() {
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<RegistrationRole>("isp_admin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [subdomainPrefix, setSubdomainPrefix] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedRole = useMemo(
    () => ROLE_OPTIONS.find((option) => option.value === role) ?? ROLE_OPTIONS[0],
    [role],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          businessName: subdomainPrefix,
          subdomain_prefix: subdomainPrefix,
        }),
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        token?: string;
        admin?: {
          id: number;
          username: string;
          name?: string;
          fullname?: string | null;
          role?: string;
          area?: string;
          currency?: string;
        };
      };

      if (!response.ok || !data.ok || !data.admin || !data.token) {
        setError(data.error || "We could not create your workspace.");
        return;
      }

      setAdminAuth(
        data.admin.id,
        data.admin.username,
        data.admin.name || subdomainPrefix,
        data.admin.role || role,
        data.token,
        data.admin.fullname || name.trim(),
      );
      if (data.admin.currency) localStorage.setItem("ochola_admin_currency", data.admin.currency);
      if (data.admin.area) localStorage.setItem("ochola_admin_country", data.admin.area);
      setLocation(role === "reseller" ? "/admin/reseller" : "/admin/dashboard");
    } catch {
      setError("Registration failed. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="unified-register-page">
      <div className="unified-register-glow unified-register-glow--one" />
      <div className="unified-register-glow unified-register-glow--two" />

      <section className="unified-register-brand">
        <Logo size="md" />
        <span className="unified-register-brand-rule" />
        <span>ISPlatty workspace</span>
      </section>

      <section className="unified-register-card" aria-labelledby="unified-register-title">
        <div className="unified-register-card-header">
          <div className="unified-register-kicker"><span className="unified-register-kicker-dot" /> NETWORK OPERATIONS PLATFORM</div>
          <h1 id="unified-register-title">Build the workspace your network deserves.</h1>
          <p>One secure account for the tools, access, and operational clarity behind your business.</p>
        </div>

        <div className="unified-register-role-toggle" role="tablist" aria-label="Choose your workspace type">
          {ROLE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = role === option.value;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={`unified-register-role ${active ? "unified-register-role--active" : ""}`}
                key={option.value}
                onClick={() => setRole(option.value)}
              >
                <span className="unified-register-role-icon"><Icon size={18} strokeWidth={1.8} /></span>
                <span className="unified-register-role-copy">
                  <strong>{option.value === "isp_admin" ? "🖥️ " : "🔌 "}{option.title}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="unified-register-role-check">{active && <Check size={13} strokeWidth={3} />}</span>
              </button>
            );
          })}
        </div>

        <form className="unified-register-form" onSubmit={submit}>
          {error && <div className="unified-register-error" role="alert">{error}</div>}

          <div className="unified-register-field">
            <label htmlFor="register-name">Full Name</label>
            <div className="unified-register-input-wrap">
              <UserRound size={17} aria-hidden="true" />
              <input id="register-name" required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Your full name" />
            </div>
          </div>

          <div className="unified-register-field">
            <label htmlFor="register-email">Email</label>
            <div className="unified-register-input-wrap">
              <Mail size={17} aria-hidden="true" />
              <input id="register-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@yourcompany.com" />
            </div>
          </div>

          <div className="unified-register-field">
            <label htmlFor="register-password">Password</label>
            <div className="unified-register-input-wrap">
              <LockKeyhole size={17} aria-hidden="true" />
              <input id="register-password" required minLength={10} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="At least 10 characters" />
              <button type="button" className="unified-register-password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div className="unified-register-field">
            <label htmlFor="register-subdomain">Business Name / Subdomain Prefix</label>
            <div className="unified-register-input-wrap unified-register-subdomain-input">
              <span className="unified-register-prefix-mark">https://</span>
              <input
                id="register-subdomain"
                required
                minLength={3}
                value={subdomainPrefix}
                onChange={(event) => setSubdomainPrefix(sanitizeSubdomainPrefix(event.target.value))}
                autoComplete="organization"
                inputMode="text"
                placeholder="yourbusiness"
                aria-describedby="register-workspace-url"
              />
              <span className="unified-register-suffix-mark">.isplatty.org</span>
            </div>
            <p id="register-workspace-url" className="unified-register-helper">
              Your workspace URL: https://{subdomainPrefix || "[prefix]"}.isplatty.org
            </p>
          </div>

          <button type="submit" className="unified-register-submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating workspace…" : `Create ${selectedRole.value === "reseller" ? "reseller" : "operator"} workspace`}
            {!isSubmitting && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="unified-register-footer">
          <ShieldCheck size={15} />
          <span>Your workspace is protected with encrypted sessions.</span>
          <span className="unified-register-footer-separator">·</span>
          <button type="button" onClick={() => setLocation("/admin/login")}>Sign in</button>
        </div>
      </section>

      <div className="unified-register-bottom-note">
        <span>© {new Date().getFullYear()} ISPlatty</span>
        <span>Secure infrastructure for connected communities</span>
      </div>
    </main>
  );
}