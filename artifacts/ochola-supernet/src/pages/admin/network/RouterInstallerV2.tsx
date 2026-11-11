import React from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";

export default function RouterInstallerV2() {
  const card: React.CSSProperties = {
    background: "var(--isp-card, #fff)",
    border: "1px solid var(--isp-border, #e5e7eb)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,.05)",
  };

  return (
    <AdminLayout>
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 16 }}>
        <NetworkTabs active="installer-v2" />
        <header>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 5 }}>Network / RouterOS</div>
          <h1 style={{ margin: 0, fontSize: 26, color: "var(--isp-text, #172b3a)" }}>
            OCHOLASUPERNET Router Setup
          </h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", lineHeight: 1.5, maxWidth: 760 }}>
            Use the authenticated Self Install flow for router configuration. It generates setup steps for the selected
            tenant router instead of exposing router credentials through a public script URL.
          </p>
        </header>

        <section style={card} aria-labelledby="router-setup-title">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <ShieldCheck size={22} aria-hidden="true" style={{ color: "var(--isp-accent, #1769e0)", flexShrink: 0, marginTop: 2 }} />
            <div>
              <h2 id="router-setup-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
                Secure, tenant-specific installation
              </h2>
              <p style={{ margin: "0 0 12px", color: "#64748b", lineHeight: 1.55 }}>
                Self Install checks router ownership, then prepares ordered network, management VPN, and Hotspot/PPPoE
                steps for that router. Follow the on-screen order and verify each step before continuing.
              </p>
              <p style={{ margin: "0 0 16px", color: "#64748b", lineHeight: 1.55 }}>
                The public token-free <code>mainhotspot.rsc</code> remains preflight-only; it does not add router
                configuration. Actual setup requires the authenticated flow.
              </p>
              <a
                href="/admin/network/self-install"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  minHeight: 42,
                  padding: "10px 15px",
                  borderRadius: 8,
                  background: "#1769e0",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Open Self Install
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}
