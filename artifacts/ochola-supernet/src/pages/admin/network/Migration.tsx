import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Database, FileSearch, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";

const panel: CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "var(--shadow-sm)",
};

const muted: CSSProperties = {
  color: "var(--isp-text-muted)",
  fontSize: 13,
  lineHeight: 1.55,
};

const actionLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  color: "var(--isp-accent)",
  fontWeight: 800,
  fontSize: 13,
  textDecoration: "none",
};

function MigrationAction({
  icon,
  title,
  description,
  href,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <section style={{ ...panel, display: "grid", gap: 10 }}>
      <div style={{ color: "var(--isp-accent)" }}>{icon}</div>
      <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>{title}</div>
      <div style={muted}>{description}</div>
      <Link href={href} style={actionLink}>
        Open {title} <ArrowRight size={15} />
      </Link>
    </section>
  );
}

export default function Migration() {
  return (
    <AdminLayout>
      <div style={{ maxWidth: 1200, display: "flex", flexDirection: "column", gap: 16 }}>
        <NetworkTabs active="migration" />

        <header>
          <div style={{ color: "var(--isp-accent)", fontSize: 11, fontWeight: 900, letterSpacing: ".12em" }}>
            NETWORK RECOVERY
          </div>
          <h1 style={{ margin: "6px 0 5px", color: "var(--isp-text)", fontSize: "1.5rem", fontWeight: 850 }}>
            Migration &amp; recovery
          </h1>
          <p style={{ ...muted, margin: 0, maxWidth: 780 }}>
            Safely inspect an existing RouterOS installation, prepare its replacement, and keep the recovery path visible before making changes.
          </p>
        </header>

        <section style={{ ...panel, display: "flex", gap: 12, alignItems: "flex-start", background: "rgba(37,99,235,.06)" }}>
          <ShieldCheck size={21} color="var(--isp-accent)" />
          <div>
            <div style={{ color: "var(--isp-text)", fontWeight: 850 }}>Use the recovery order</div>
            <p style={{ ...muted, margin: "5px 0 0" }}>
              Inspect the source router first, confirm the destination router, then use Self Install or Replace Router. This keeps the source available until the new device is verified.
            </p>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
          <MigrationAction
            icon={<FileSearch size={22} />}
            title="Inspect source router"
            description="Review router files and current installation artifacts before starting recovery."
            href="/admin/network/files"
          />
          <MigrationAction
            icon={<Server size={22} />}
            title="Choose destination router"
            description="Confirm the replacement device is registered and available to the ISP account."
            href="/admin/network/routers"
          />
          <MigrationAction
            icon={<RotateCcw size={22} />}
            title="Replace router"
            description="Start the supported replacement flow while preserving the existing router identity."
            href="/admin/network/replace-router"
          />
        </section>

        <section style={{ ...panel, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-text)", fontWeight: 850 }}>
            <Database size={19} color="var(--isp-accent)" />
            Recovery checklist
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
            {[
              ["1", "Inspect", "Confirm the source router and its stored files are reachable."],
              ["2", "Prepare", "Register or install the destination router before switching traffic."],
              ["3", "Verify", "Check VPN, RouterOS access, and customer services before closing recovery."],
            ].map(([number, title, description]) => (
              <div key={number} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ minWidth: 25, height: 25, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 99, background: "rgba(37,99,235,.12)", color: "var(--isp-accent)", fontWeight: 900, fontSize: 12 }}>
                  {number}
                </span>
                <div>
                  <div style={{ color: "var(--isp-text)", fontWeight: 800, fontSize: 13 }}>{title}</div>
                  <div style={{ ...muted, marginTop: 3, fontSize: 12 }}>{description}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}