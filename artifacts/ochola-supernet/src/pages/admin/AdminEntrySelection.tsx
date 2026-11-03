import { Link } from "wouter";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";

const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  width: "100%",
  padding: "18px 20px",
  border: "1px solid var(--isp-input-border)",
  borderRadius: 14,
  color: "var(--isp-text)",
  background: "var(--isp-card)",
  textDecoration: "none",
  fontWeight: 700,
};

export default function AdminEntrySelection() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--isp-bg)", color: "var(--isp-text)", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 440, display: "grid", gap: 18 }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
          <Logo size="lg" />
          <h1 style={{ margin: 0, fontSize: 26 }}>Choose your sign-in</h1>
          <p style={{ margin: 0, color: "var(--isp-text-muted)", textAlign: "center" }}>
            Select the account type for this secure BIL sign-in.
          </p>
        </div>
        <Link href="/admin/login/isp" style={optionStyle}>
          <span>ISP administrator</span><ArrowRight size={18} />
        </Link>
        <Link href="/super-admin/login" style={optionStyle}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><ShieldCheck size={18} />Super Admin</span>
          <ArrowRight size={18} />
        </Link>
      </section>
    </main>
  );
}
